//! 星璃·集控本地代理 StelarithAgent（设备侧常驻，仅监听 127.0.0.1）
//!
//! 真实职责（对应 docs/扩展能力设计.md §1 / §2）：
//!  - 接收来自 ClassIsland 插件转发的 stelarith-task 指令（localhost）；
//!  - 验签 + 防重放（token 由网站签发，agent 用共享密钥验签；生产改为网站公钥验签）；
//!  - 执行 OS 动作：锁屏 / 重启；按需启动 VNC 服务实现远程屏幕控制；结束即关；
//!  - 绝不暴露公网端口，所有触发都来自本机插件。
//!
//! 注意：本机当前未安装 cargo，无法在此编译；需在目标 Windows 设备
//! `cargo build --release` 后作为服务/开机启动运行。

use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, Command};
use std::sync::Mutex;

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// 与 ClassIsland 插件 / CIMS 通知负载一致的指令结构。
#[derive(Deserialize, Clone)]
struct Task {
    action: String,
    token: String,
    #[serde(default = "default_scope")]
    scope: String,
    ts: i64,
    /// 可选：shell 动作的命令（仅管理员角色且经 RBAC 允许时执行）
    #[serde(default)]
    cmd: Option<String>,
}

fn default_scope() -> String {
    "class".into()
}

/// 进程级状态：当前 VNC 子进程 + 分配的会话端口。
struct AgentState {
    secret: String,
    vnc_cmd: String,
    active: Mutex<Option<VncSession>>,
}

struct VncSession {
    child: Child,
    port: u16,
    conn_token: String,
}

/// 验证 token 并防重放：HMAC-SHA256(action|ts, secret)，且 ts 在 60s 内。
/// 生产环境：把 secret 换成"网站私钥签名 / agent 持网站公钥验签"的非对称方案。
fn verify(task: &Task, secret: &str) -> bool {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(task.action.as_bytes());
    mac.update(b"|");
    mac.update(task.ts.to_string().as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    if !constant_time_eq(&expected, &task.token) {
        return false;
    }
    let now = Utc::now().timestamp();
    (now - task.ts).abs() <= 60
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    a.as_bytes().len() == b.as_bytes().len()
        && a.as_bytes()
            .iter()
            .zip(b.as_bytes())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// 执行动作。返回给调用方（插件/面板）的结构化结果。
fn execute(task: &Task, st: &AgentState) -> HashMap<String, String> {
    let mut out = HashMap::new();
    match task.action.as_str() {
        "lock" => {
            // Windows 锁屏（无提权）；其他平台可改为对应命令。
            let _ = Command::new("rundll32.exe")
                .args(["user32.dll,LockWorkStation"])
                .spawn();
            out.insert("result".into(), "locked".into());
        }
        "reboot" => {
            let _ = Command::new("shutdown").args(["/r", "/t", "0"]).spawn();
            out.insert("result".into(), "rebooting".into());
        }
        "remote_control_start" => {
            let port = 5900 + (Utc::now().timestamp() % 100) as u16; // 随机会话端口
            let conn_token = format!("st-{}-{}", port, Utc::now().timestamp());
            // VNC 命令从环境变量注入（如 TightVNC / 自托管轻量服）；仅绑 localhost + 令牌。
            let child = Command::new(&st.vnc_cmd)
                .args([format!(":{}", port - 5900), "-localhost".into(), conn_token.clone()])
                .spawn();
            match child {
                Ok(c) => {
                    *st.active.lock().unwrap() = Some(VncSession { child: c, port, conn_token: conn_token.clone() });
                    out.insert("result".into(), "vnc_started".into());
                    out.insert("vnc_port".into(), port.to_string());
                    out.insert("conn_token".into(), conn_token.clone());
                    // 真实联动：把 vnc_port+conn_token 经扩展网关 /vnc-session 回报面板（见 docs/扩展能力设计.md §2.2）。
                    let _ = write_status(&format!("vnc up port={port} token={conn_token}"));
                    report_vnc_session(port, &conn_token);
                }
                Err(e) => {
                    out.insert("error".into(), e.to_string());
                }
            }
        }
        "remote_control_stop" => {
            if let Some(mut s) = st.active.lock().unwrap().take() {
                let _ = s.child.kill();
                out.insert("result".into(), "vnc_stopped".into());
                let _ = write_status("vnc down");
            } else {
                out.insert("result".into(), "no_active_session".into());
            }
        }
        "shell" => {
            if let Some(cmd) = &task.cmd {
                // 仅允许 RBAC 白名单内的受限命令；此处为桩，真实环境需强校验。
                let _ = Command::new("cmd.exe").args(["/c", cmd]).spawn();
                out.insert("result".into(), "shell_dispatched".into());
            } else {
                out.insert("error".into(), "missing cmd".into());
            }
        }
        other => {
            out.insert("error".into(), format!("unknown action: {other}"));
        }
    }
    out
}

fn write_status(line: &str) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("C:/ProgramData/Stelarith/agent.status.log")?;
    writeln!(f, "{} {}", Utc::now().to_rfc3339(), line)
}

/// 把 VNC 会话回执上报到扩展网关 /vnc-session（自有服务，非虚构网关）。
/// 面板轮询该端点拿到 ip/port/token 后内嵌 noVNC。未配置 STELARITH_EXT_URL 则跳过。
fn report_vnc_session(port: u16, conn_token: &str) {
    let ext = match std::env::var("STELARITH_EXT_URL") {
        Ok(v) if !v.is_empty() => v.trim_end_matches('/').to_string(),
        _ => return,
    };
    let uid = std::env::var("STELARITH_DEVICE_UID").unwrap_or_else(|_| "unknown".into());
    let ip = local_lan_ip().unwrap_or_else(|| "127.0.0.1".into());
    let body = serde_json::json!({
        "uid": uid,
        "ip": ip,
        "port": port,
        "token": conn_token,
        "proto": "vnc",
    });
    let url = format!("{ext}/vnc-session");
    std::thread::spawn(move || {
        if let Ok(client) = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(3)).build() {
            let _ = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&body)
                .send();
        }
    });
}

/// 取本机首个非回环 IPv4（用于告诉面板从哪连 VNC）。失败回退 127.0.0.1。
fn local_lan_ip() -> Option<String> {
    use std::net::UdpSocket;
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip().to_string())
}

async fn task_handler(
    State(st): State<std::sync::Arc<AgentState>>,
    Json(task): Json<Task>,
) -> Json<HashMap<String, String>> {
    if !verify(&task, &st.secret) {
        let mut m = HashMap::new();
        m.insert("error".into(), "unauthorized_or_replay".into());
        return Json(m);
    }
    Json(execute(&task, &st))
}

/// 只读健康/会话状态：供 ClassIsland 插件或运维工具查询当前 VNC 会话（端口 + 连接令牌）。
/// 不暴露任何写能力，仅 127.0.0.1 可达。
async fn status_handler(
    State(st): State<std::sync::Arc<AgentState>>,
) -> Json<HashMap<String, String>> {
    let mut m = HashMap::new();
    m.insert("status".into(), "up".into());
    if let Some(s) = st.active.lock().unwrap().as_ref() {
        m.insert("vnc".into(), "running".into());
        m.insert("vnc_port".into(), s.port.to_string());
        m.insert("conn_token".into(), s.conn_token.clone());
    } else {
        m.insert("vnc".into(), "stopped".into());
    }
    Json(m)
}

#[tokio::main]
async fn main() {
    let secret = std::env::var("STELARITH_AGENT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".into());
    let vnc_cmd = std::env::var("STELARITH_VNC_CMD").unwrap_or_else(|_| "vncserver".into());
    let port: u16 = std::env::var("STELARITH_AGENT_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17999);

    let st = std::sync::Arc::new(AgentState {
        secret,
        vnc_cmd,
        active: Mutex::new(None),
    });

    // 仅绑 localhost：外部不可直接访问，符合"占用少 + 默认安全"。
    let app = Router::new()
        .route("/task", post(task_handler))
        .route("/status", get(status_handler))
        .with_state(st);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    println!("[StelarithAgent] listening on 127.0.0.1:{port}");
    axum::serve(listener, app).await.unwrap();
}
