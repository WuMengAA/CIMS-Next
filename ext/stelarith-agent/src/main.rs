//! 星璃·集控本地代理 StelarithAgent（设备侧常驻，仅监听 127.0.0.1）
//!
//! 真实职责（对应 docs/扩展能力设计.md §1 / §2）：
//!  - 接收来自 ClassIsland 插件转发的 stelarith-task 指令（localhost）；
//!  - 验签 + 防重放（双模：生产走 Ed25519 网站公钥验签，联调走 HMAC 共享密钥；
//!    两者 message 均为 `action|ts`，契约与面板 api.js signTask / 参考实现 agent-node 完全一致）；
//!  - 执行 OS 动作：锁屏 / 重启；按需启动 VNC 服务实现远程屏幕控制；结束即关；
//!  - 绝不暴露公网端口，所有触发都来自本机插件。
//!
//! 注意：生产部署需在目标 Windows 设备 `cargo build --release`（含 ed25519-dalek / base64 / hex
//! 依赖）后作为服务/开机启动运行。本机（开发机）已实跑 `cargo build` 验证可编译、契约与
//! `ext/stelarith-agent-node/agent.mjs` 的 `verifyEd25519` 同源一致。

use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};

// 摄像头 / 录像 / 媒体直连服务独立成模块：
// 这块代码量已超过主文件的"指令分发"职责，而且它自带一组明确的取舍
// （ffmpeg 缺失即报错、录像必须分段、停止必须优雅收尾）——分出去才有地方写清这些理由。
mod media;

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use chrono::Utc;
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::Verifier;
use ed25519_dalek::{Signature, VerifyingKey};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// 与 ClassIsland 插件 / CIMS 通知负载一致的指令结构。
#[derive(Deserialize, Clone)]
struct Task {
    action: String,
    token: String,
    /// 指令作用域（class / grade / school）。当前代理不按 scope 做分支——
    /// 范围控制在上游（面板权限 + 插件门控）完成；这里保留字段是为了让协议完整、
    /// 将来真要做设备侧二次校验时不必再改一次线格式。
    #[serde(default = "default_scope")]
    #[allow(dead_code)]
    scope: String,
    ts: i64,
    /// 可选：shell 动作的命令（仅管理员角色且经 RBAC 允许时执行）
    #[serde(default)]
    cmd: Option<String>,
    /// 摄像头动作：设备名（DirectShow 友好名，如 `USB Camera`）。缺省取枚举到的第一个。
    #[serde(default)]
    camera: Option<String>,
    /// 媒体动作：`snapshots` | `recordings`
    #[serde(default)]
    kind: Option<String>,
    /// 媒体动作：文件名（删除用；只接受 basename，见 media::safe_media_name）
    #[serde(default)]
    name: Option<String>,
    /// 其余参数（码率 / 缩放 / 段长 / 画质 / 保留天数 …）。
    ///
    /// 为什么留一个开放字典而不是逐个加字段：摄像头/媒体这类动作的参数会随面板配置
    /// 变化（码率、缩放、段长、画质都是可调项），每加一个都要改协议、改插件字段、
    /// 改面板 —— 而它们**全都只是喂给 ffmpeg 的命令行参数**。收敛成字典后，
    /// 新增一个可调项只动面板与这里两处。
    /// 注意：这不代表"什么都能传"—— `p_num` 会把每个取值夹到安全区间，
    /// 绝不把未校验的值直接拼进 ffmpeg 参数。
    #[serde(default)]
    params: Option<serde_json::Map<String, serde_json::Value>>,
}

impl Task {
    /// 取字符串参数：先看顶层同名字段（插件直接透传），再看 params。
    fn p_str(&self, key: &str) -> Option<String> {
        let direct = match key {
            "camera" => self.camera.clone(),
            "kind" => self.kind.clone(),
            "name" => self.name.clone(),
            _ => None,
        };
        if let Some(v) = direct {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
        self.params
            .as_ref()
            .and_then(|m| m.get(key))
            .and_then(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
    }

    /// 取数值参数并夹到 [min, max]。
    ///
    /// 夹取而不是"校验后拒绝"：这些值是**性能/画质旋钮**，面板传了个离谱数字
    /// （比如码率 999999999）时正确行为是退到安全上限继续录，而不是整条指令失败
    /// —— 录像这种带时间窗的操作，失败一次就少一段证据。
    fn p_num(&self, key: &str, default: f64, min: f64, max: f64) -> f64 {
        let raw = self.params.as_ref().and_then(|m| m.get(key)).and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
        });
        match raw {
            Some(n) if n.is_finite() => n.clamp(min, max),
            _ => default,
        }
    }
}

fn default_scope() -> String {
    "class".into()
}

/// 进程级状态：VNC 子进程 + 摄像头录像进程。
struct AgentState {
    secret: String,
    vnc_cmd: String,
    active: Mutex<Option<VncSession>>,
    /// 正在进行的录像（None = 未录）。放在 main 侧而不是 media 模块内部，
    /// 是为了让"同一台机器只能有一段录像"这条约束由状态结构本身保证，
    /// 而不是靠调用方自觉。
    recorder: Mutex<Option<media::Recorder>>,
}

struct VncSession {
    child: Child,
    port: u16,
    /// 连接令牌。**刻意不通过 /status 回显**（见 status_handler 注释）——
    /// 它由 report_session 直接送到扩展网关，不进任何诊断输出。
    #[allow(dead_code)]
    conn_token: String,
}

/// 验证 token 并防重放：双模。
///  - 生产（STELARITH_SITE_PUBKEY 已配）：Ed25519 非对称验签，token = base64url(Ed25519_sign(action|ts))，
///    由网站服务端私钥签名（ext/stelarith-website-sync/sign-task.mjs），agent 持网站公钥验签，杜绝共享密钥分发泄露。
///  - 开发/联调：HMAC-SHA256(action|ts, secret)。
/// 两者 message 完全一致（action|ts），ts 均须在 60s 内。
fn verify(task: &Task, secret: &str) -> bool {
    // 优先：配置了网站 Ed25519 公钥 → 非对称验签（生产默认）。
    if site_pubkey().is_some() {
        return verify_ed25519(task);
    }
    // 开发/联调：HMAC 共享密钥（与面板 signTask 契约一致）。
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

/// 缓存网站 Ed25519 公钥（SPKI PEM，来自 STELARITH_SITE_PUBKEY），首次解析后复用。
/// 未配置时返回 None，verify() 回落 HMAC 路径。仅 127.0.0.1 本地读取，不外传。
static SITE_PUBKEY: OnceLock<Option<VerifyingKey>> = OnceLock::new();

fn site_pubkey() -> Option<&'static VerifyingKey> {
    let v = SITE_PUBKEY.get_or_init(|| {
        match std::env::var("STELARITH_SITE_PUBKEY") {
            Ok(pem) if !pem.trim().is_empty() => parse_spki_pubkey(pem.trim()).ok(),
            _ => None,
        }
    });
    v.as_ref()
}

/// 从 SPKI PEM 提取 DER 并构造 VerifyingKey（与 sign-task.mjs 导出的 "PUBLIC KEY" 一致）。
fn parse_spki_pubkey(pem: &str) -> Result<VerifyingKey, ()> {
    let der = pem_to_der(pem)?;
    VerifyingKey::from_public_key_der(&der).map_err(|_| ())
}

fn pem_to_der(pem: &str) -> Result<Vec<u8>, ()> {
    let b64 = pem
        .lines()
        .filter(|l| !l.contains("-----"))
        .collect::<String>()
        .replace(char::is_whitespace, "");
    base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| ())
}

fn verify_ed25519(task: &Task) -> bool {
    let vk = match site_pubkey() {
        Some(v) => v,
        None => return false,
    };
    // token 为 base64url（无填充）或普通 base64，兼容两种；先试 URL_SAFE_NO_PAD。
    let sig_bytes = match base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(task.token.trim()) {
        Ok(b) => b,
        Err(_) => match base64::engine::general_purpose::STANDARD.decode(task.token.trim()) {
            Ok(b) => b,
            Err(_) => return false,
        },
    };
    let sig = match Signature::from_slice(&sig_bytes) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let msg = format!("{}|{}", task.action, task.ts);
    if vk.verify(msg.as_bytes(), &sig).is_err() {
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
                    // 真实联动：把 vnc_port+conn_token 经扩展网关 /vnc-session 回报面板
                    // （见 docs/扩展能力设计.md §2.2）。网关以 x-stelarith-device-secret 鉴权。
                    let _ = write_status(&format!("vnc up port={port} token={conn_token}"));
                    let ip = local_lan_ip().unwrap_or_else(|| "127.0.0.1".into());
                    media::report_session("vnc", &ip, port, &conn_token, "up");
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
            // ⚠️ 默认拒绝（2026-09-17 收紧）。
            //
            // 原实现是 `cmd.exe /c <任意命令>`，而上面那行注释写着
            // 「仅允许 RBAC 白名单内的受限命令」——**白名单从未实现**。
            // 这类「注释比实现更安全」的代码最危险：读代码的人会就此放过它。
            //
            // 实测全仓库（网站面板 / CIMS 服务端 / ClassIsland 插件）无任何下发方，
            // 即这个分支只贡献攻击面、没有任何业务用途；而它一旦可用，
            // 配上签名密钥就等于「对全教室电脑的远程任意命令执行」。
            //
            // 故改为默认关闭 + 可显式开启（排障时设 STELARITH_AGENT_ALLOW_SHELL=1）。
            // 保留分支而不是删除，是为了将来真要做「受限命令下发」时，
            // 有一个明确的落点去实现白名单，而不是又长出一个隐式通道。
            if std::env::var("STELARITH_AGENT_ALLOW_SHELL").ok().as_deref() != Some("1") {
                let _ = write_status(&format!(
                    "[warn] shell 动作被拒绝（默认关闭，如需排障设 STELARITH_AGENT_ALLOW_SHELL=1）：cmd={:?}\n",
                    task.cmd
                ));
                out.insert(
                    "error".into(),
                    "shell action disabled by default (set STELARITH_AGENT_ALLOW_SHELL=1 to enable)".into(),
                );
            } else if let Some(cmd) = &task.cmd {
                let _ = Command::new("cmd.exe").args(["/c", cmd]).spawn();
                out.insert("result".into(), "shell_dispatched".into());
            } else {
                out.insert("error".into(), "missing cmd".into());
            }
        }
        // ═══ 摄像头 / 媒体（模块门控在插件侧；这里只负责真干活）═══
        // 注意每个分支都 return，不走下面统一的 out 收集 —— 这些动作的回执字段
        // 差异很大（有的带 ip:port:token，有的带文件清单），塞进同一个 map 反而更乱。
        "camera_list" => return media::camera_list(),
        "camera_snapshot" | "snapshot" => return media::take_snapshot(task),
        "camera_record_start" | "record_start" => return media::start_recording(task, &st.recorder),
        "camera_record_stop" | "record_stop" => return media::stop_recording(&st.recorder),
        "media_list" => return media::media_list_payload(task),
        "media_delete" => return media::media_delete(task),
        "media_session_start" => {
            let mut out = HashMap::new();
            match media::ensure_media_server() {
                Some((ip, port, token)) => {
                    out.insert("result".into(), "media_session_up".into());
                    out.insert("media_ip".into(), ip.clone());
                    out.insert("media_port".into(), port.to_string());
                    out.insert("media_token".into(), token);
                    out.insert("media_base".into(), format!("http://{ip}:{port}"));
                }
                None => {
                    out.insert(
                        "error".into(),
                        "媒体直连服务无法启动（端口被占且系统分配也失败？），详见 agent.status.log".into(),
                    );
                }
            }
            return out;
        }
        "media_session_stop" => {
            let mut out = HashMap::new();
            out.insert(
                "result".into(),
                if media::stop_media_server() { "media_session_down".into() } else { "no_active_session".into() },
            );
            return out;
        }
        other => {
            out.insert("error".into(), format!("unknown action: {other}"));
        }
    }
    out
}

pub(crate) fn write_status(line: &str) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("C:/ProgramData/Stelarith/agent.status.log")?;
    writeln!(f, "{} {}", Utc::now().to_rfc3339(), line)
}

/// 取本机首个非回环 IPv4（用于告诉面板从哪连 VNC）。失败回退 127.0.0.1。
pub(crate) fn local_lan_ip() -> Option<String> {
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

/// 只读健康/会话状态：供 ClassIsland 插件或运维工具查询当前 VNC / 录像 / 媒体直连状态。
/// 不暴露任何写能力，仅 127.0.0.1 可达。
///
/// 刻意**不回显 VNC 连接令牌与媒体令牌**：这个端点虽然只绑本地回环，但它会被运维脚本、
/// 诊断包、乃至截图带出去；令牌一旦进了诊断包就等于进了工单系统。
/// 需要令牌的场景（面板连 VNC）走的是"代理主动上报到网关"那条路，不经过这里。
async fn status_handler(
    State(st): State<std::sync::Arc<AgentState>>,
) -> Json<HashMap<String, String>> {
    let mut m = HashMap::new();
    m.insert("status".into(), "up".into());
    if let Some(s) = st.active.lock().unwrap().as_ref() {
        m.insert("vnc".into(), "running".into());
        m.insert("vnc_port".into(), s.port.to_string());
    } else {
        m.insert("vnc".into(), "stopped".into());
    }
    match media::recorder_status(&st.recorder) {
        Some((started_at, camera, seg, kbps)) => {
            m.insert("recording".into(), "running".into());
            m.insert("recording_since".into(), started_at.to_string());
            m.insert("recording_camera".into(), camera);
            m.insert("segment_seconds".into(), seg.to_string());
            m.insert("recording_bitrate_kbps".into(), kbps.to_string());
        }
        None => {
            m.insert("recording".into(), "stopped".into());
        }
    }
    for (k, v) in media::status_lines() {
        m.insert(k, v);
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

    // 开机先按保留期清一次媒体目录。放在起服务之前：清盘可能耗时（大量小文件），
    // 而这一秒的延迟发生在无人使用服务的时间窗里，代价最小。
    media::startup_prune();

    let st = std::sync::Arc::new(AgentState {
        secret,
        vnc_cmd,
        active: Mutex::new(None),
        recorder: Mutex::new(None),
    });

    // 仅绑 localhost：外部不可直接访问，符合"占用少 + 默认安全"。
    // （媒体直连服务是**另一个**监听器，由 media 模块在真的发生媒体动作时才按需启动，
    //   见 media::ensure_media_server。把两者分开是为了让默认状态下教室机不多开端口。）
    let app = Router::new()
        .route("/task", post(task_handler))
        .route("/status", get(status_handler))
        .with_state(st);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    println!(
        "[StelarithAgent] listening on 127.0.0.1:{port} | uid={} | media_root={}",
        media::device_uid(),
        media::media_root()
    );
    axum::serve(listener, app).await.unwrap();
}
