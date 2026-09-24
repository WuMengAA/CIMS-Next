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

// 被控端 WebRTC（#247-A）：真 WebRTC 远控，与面板 p2p-connector.js 对齐。
// 仅新增能力，绝不替换 VNC / 媒体直连；信令地址为空时完全不启用。
// mod rtc; // TODO(2026-09-23): 适配 webrtc 0.21 新版 API 后恢复

use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use chrono::{Local, TimeZone, Utc};
use ed25519_dalek::pkcs8::DecodePublicKey;
use ed25519_dalek::Verifier;
use ed25519_dalek::{Signature, VerifyingKey};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
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
    /// 定时关机计划（schedule_shutdown 动作承载）。宽松 JSON 对象，取值经
    /// handle_schedule_shutdown 逐项校验（时间格式 / 周几区间 / 倒计时分钟数）。
    /// 由插件在教室端**确认后**透传 —— 代理这里不再弹任何 UI，只负责落盘与调度。
    #[serde(default)]
    schedule: Option<serde_json::Value>,
    /// 取消定时关机用：计划 id（cancel_schedule 动作的顶层字段；也兼容 params["schedule_id"]）。
    #[serde(default)]
    schedule_id: Option<String>,
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

/// 定时关机计划（持久化于 C:/ProgramData/Stelarith/schedules.json）。
///
/// 四种模式（面板下发、教室端确认后经插件透传）：
///  - daily     每天 time 到点关机（如 21:00），同日不重复触发；
///  - weekly    仅 days 所列周几（1=周一..7=周日）的 time 到点关机；
///  - once      到 datetime（本地时区 "YYYY-MM-DDTHH:MM"）关机，执行后自动删除；
///  - countdown 自收到时刻起 minutes 分钟后关机（面板倒计时场景），执行后自动删除。
///
/// 触发动作：`shutdown /s /t 60` —— 留 60 秒缓冲，若发错可 `shutdown /a` 取消。
#[derive(Deserialize, Serialize, Clone, Debug)]
struct ScheduleEntry {
    /// 计划 ID（面板生成，用于覆盖/取消：同 id 再次下发 = upsert）。
    id: String,
    /// daily | weekly | once | countdown
    #[serde(default)]
    mode: String,
    /// daily/weekly 用：HH:MM
    #[serde(default)]
    time: String,
    /// weekly 用：1..7（1=周一）
    #[serde(default)]
    days: Vec<u32>,
    /// once 用：本地时区 "YYYY-MM-DDTHH:MM"
    #[serde(default)]
    datetime: String,
    /// countdown 用：分钟后关机（夹取 1..720）
    #[serde(default)]
    minutes: i64,
    /// false = 停用（同 id 下发 enabled=false 即取消该计划）
    #[serde(default = "default_true")]
    enabled: bool,
    /// 人类可读备注（面板填写，仅展示用）
    #[serde(default)]
    note: String,
    /// 内部：once/countdown 的绝对触发时刻（unix 秒，本地语义；存 UTC 时间戳便于比较）
    #[serde(default)]
    fire_at: i64,
    /// 内部：daily/weekly 最近一次触发的日期（YYYY-MM-DD，防同一分钟被 30s 双 tick 触发两次）
    #[serde(default)]
    last_fired: String,
}

fn default_true() -> bool {
    true
}

const SCHEDULES_FILE: &str = "C:/ProgramData/Stelarith/schedules.json";

fn load_schedules() -> Vec<ScheduleEntry> {
    match std::fs::read_to_string(SCHEDULES_FILE) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_schedules(list: &[ScheduleEntry]) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(list).unwrap_or_else(|_| "[]".into());
    if let Some(dir) = std::path::Path::new(SCHEDULES_FILE).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(SCHEDULES_FILE, json)
}

/// 解析 "HH:MM"（本地 24 小时制）。
fn parse_hhmm(s: &str) -> Option<(u32, u32)> {
    let mut it = s.split(':');
    let h: u32 = it.next()?.trim().parse().ok()?;
    let m: u32 = it.next()?.trim().parse().ok()?;
    if h < 24 && m < 60 {
        Some((h, m))
    } else {
        None
    }
}

/// 解析本地时区 "YYYY-MM-DDTHH:MM" 为 unix 秒。
fn parse_local_datetime(s: &str) -> Option<i64> {
    let nd = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").ok()?;
    Local.from_local_datetime(&nd).single().map(|dt| dt.timestamp())
}

/// 处理 schedule_shutdown：校验 → upsert/取消 → 落盘。返回结构化回执。
fn handle_schedule_shutdown(task: &Task, st: &AgentState) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let raw = task
        .schedule
        .clone()
        .or_else(|| task.params.as_ref().and_then(|m| m.get("schedule")).cloned());
    let Some(raw) = raw else {
        out.insert("error".into(), "missing schedule".into());
        return out;
    };
    let mut s: ScheduleEntry = match serde_json::from_value(raw) {
        Ok(s) => s,
        Err(e) => {
            out.insert("error".into(), format!("bad schedule: {e}"));
            return out;
        }
    };
    if s.id.trim().is_empty() {
        out.insert("error".into(), "schedule.id required".into());
        return out;
    }
    s.id = s.id.trim().to_string();
    s.minutes = s.minutes.clamp(1, 720);

    let mut list = st.schedules.lock().unwrap();
    // 停用：同 id + enabled=false → 删除该计划（幂等：不存在也算成功）
    if !s.enabled {
        list.retain(|e| e.id != s.id);
        let _ = save_schedules(&list);
        out.insert("result".into(), "schedule_removed".into());
        out.insert("id".into(), s.id);
        return out;
    }

    // 模式校验 + 归一（once/countdown 计算 fire_at）
    match s.mode.as_str() {
        "daily" => {
            if parse_hhmm(&s.time).is_none() {
                out.insert("error".into(), "bad time (HH:MM)".into());
                return out;
            }
        }
        "weekly" => {
            if parse_hhmm(&s.time).is_none() {
                out.insert("error".into(), "bad time (HH:MM)".into());
                return out;
            }
            if s.days.is_empty() || s.days.iter().any(|d| *d < 1 || *d > 7) {
                out.insert("error".into(), "bad days (1..7)".into());
                return out;
            }
            s.days.sort_unstable();
            s.days.dedup();
        }
        "once" => match parse_local_datetime(&s.datetime) {
            Some(ts) => s.fire_at = ts,
            None => {
                out.insert("error".into(), "bad datetime (YYYY-MM-DDTHH:MM)".into());
                return out;
            }
        },
        "countdown" => {
            s.fire_at = Utc::now().timestamp() + s.minutes * 60;
        }
        _ => {
            out.insert("error".into(), format!("bad mode: {}", s.mode));
            return out;
        }
    }

    // upsert：同 id 覆盖（改时间/改周期 = 再下发一次同一 id）
    if let Some(ex) = list.iter_mut().find(|e| e.id == s.id) {
        *ex = s.clone();
    } else {
        list.push(s.clone());
    }
    let _ = save_schedules(&list);
    let _ = write_status(&format!(
        "schedule saved: id={} mode={} time={} days={:?} datetime={} minutes={} fire_at={}",
        s.id, s.mode, s.time, s.days, s.datetime, s.minutes, s.fire_at
    ));
    out.insert("result".into(), "schedule_saved".into());
    out.insert("id".into(), s.id);
    out.insert("mode".into(), s.mode);
    out.insert("fire_at".into(), s.fire_at.to_string());
    out
}

/// 列出当前生效计划（面板诊断用；只读，不经教室端确认）。
fn handle_list_schedules(st: &AgentState) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let list = st.schedules.lock().unwrap().clone();
    out.insert("result".into(), "ok".into());
    out.insert("count".into(), list.len().to_string());
    out.insert(
        "schedules".into(),
        serde_json::to_string(&list).unwrap_or_else(|_| "[]".into()),
    );
    out
}

/// 按 id 取消计划（等价于 schedule_shutdown + enabled:false，独立动作便于面板直呼）。
fn handle_cancel_schedule(task: &Task, st: &AgentState) -> HashMap<String, String> {
    let mut out = HashMap::new();
    // 顶层 schedule_id 优先，其次 params["schedule_id"]（兼容两种打包位置）
    let id = task
        .schedule_id
        .clone()
        .or_else(|| task.p_str("schedule_id"))
        .unwrap_or_default();
    if id.is_empty() {
        out.insert("error".into(), "missing schedule_id".into());
        return out;
    }
    let mut list = st.schedules.lock().unwrap();
    let before = list.len();
    list.retain(|e| e.id != id);
    if list.len() == before {
        out.insert("result".into(), "not_found".into());
    } else {
        let _ = save_schedules(&list);
        out.insert("result".into(), "schedule_removed".into());
    }
    out.insert("id".into(), id);
    out
}

/// 定时调度主循环：每 30s 检查一次，到点执行 `shutdown /s /t 60`。
fn spawn_scheduler(st: &std::sync::Arc<AgentState>) {
    let st2 = st.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
        tick.tick().await; // interval 首 tick 立即触发，先吞掉再进循环
        loop {
            tick.tick().await;
            run_schedule_checks(&st2);
        }
    });
}

fn run_schedule_checks(st: &AgentState) {
    use chrono::Datelike;
    let now = Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    let hhmm = now.format("%H:%M").to_string();
    let ts = now.timestamp();

    let mut list = st.schedules.lock().unwrap();
    if list.is_empty() {
        return;
    }
    let mut to_remove: Vec<String> = Vec::new();
    let mut fired_any = false;
    for s in list.iter_mut() {
        if !s.enabled {
            continue;
        }
        let fire = match s.mode.as_str() {
            "countdown" | "once" => s.fire_at > 0 && ts >= s.fire_at,
            "daily" => s.time == hhmm && s.last_fired != today,
            "weekly" => {
                let wd = (now.weekday().num_days_from_monday() + 1) as u32; // 1..7
                s.days.contains(&wd) && s.time == hhmm && s.last_fired != today
            }
            _ => false,
        };
        if !fire {
            continue;
        }
        let _ = write_status(&format!(
            "scheduled shutdown FIRE: id={} mode={} time={} today={}",
            s.id, s.mode, s.time, today
        ));
        // 留 60 秒缓冲：发错可 `shutdown /a` 取消（教室有人时也能看见关机倒计时）
        let _ = Command::new("shutdown")
            .args(["/s", "/t", "60", "/c", "Stelarith scheduled shutdown"])
            .spawn();
        if s.mode == "once" || s.mode == "countdown" {
            to_remove.push(s.id.clone());
        } else {
            s.last_fired = today.clone();
        }
        fired_any = true;
    }
    if !to_remove.is_empty() {
        list.retain(|s| !to_remove.contains(&s.id));
    }
    if fired_any {
        let _ = save_schedules(&list);
    }
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
    /// 定时关机计划（schedule_shutdown 落盘 + 调度线程读取；Mutex 保护跨线程一致性）。
    schedules: Mutex<Vec<ScheduleEntry>>,
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
    // 兼容两种形态（2026-09-24：旧实现按 lines() 过滤会把无换行的 PEM 整行滤掉）：
    //   · 标准多行 PEM（-----BEGIN …-----\nbase64\n-----END …-----）
    //   · 无换行的单行 PEM —— cmd 的 `set "STELARITH_SITE_PUBKEY=…"` 注入环境变量时，
    //     set 语句在换行处截断，多行 PEM 会碎掉，所以部署配置必须给单行。
    // 统一做法：剥掉 BEGIN/END 标记，再对所有剩余字符去掉空白后 base64 解码。
    let b64: String = pem
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
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
        // 关机（#196 一键关机贯通）：`shutdown /s /t 0` 立即关机。同样不做提权假设——
        // 若代理以普通用户身份运行，系统会弹 UAC 或直接拒绝，回执里带 error 让面板可见。
        "shutdown" => {
            match Command::new("shutdown").args(["/s", "/t", "0"]).spawn() {
                Ok(_) => { out.insert("result".into(), "shutting_down".into()); }
                Err(e) => { out.insert("error".into(), e.to_string()); }
            }
        }
        // ═══ 定时关机（长期计划：每天/每周/一次性/倒计时）═══
        // 计划来自面板 → CIMS → 插件（教室端 60s 确认窗确认后）→ 本代理。
        // 代理只做落盘 + 调度；四种模式与防重逻辑见 ScheduleEntry 注释。
        "schedule_shutdown" => return handle_schedule_shutdown(task, st),
        "list_schedules" => return handle_list_schedules(st),
        "cancel_schedule" => return handle_cancel_schedule(task, st),
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
        // ═══ 教室端屏幕截图（#T07.7）：Windows 全屏 → PNG 落盘，回执带 path/bytes ═══
        // 与传统"摄像头快照"区分：这里是**桌面**截屏（看屏幕上有啥），走 PowerShell
        // 系统自带 System.Drawing（区别于 media::take_snapshot 的 ffmpeg 摄像头拍照）。
        // 脚本刻意纯 ASCII：PS 5.1 对无 BOM 的 UTF-8 中文按 ANSI 解析会崩（同桌面端
        // screen_shot.dart 的 PS 兜底脚本约束）。不引第三方截图 crate —— 代理保持
        // 数 MB 单二进制体量，且教室 Windows 必有 powershell.exe。
        "screenshot" => {
            let shots_dir = "C:/ProgramData/Stelarith/shots";
            let _ = std::fs::create_dir_all(shots_dir);
            let ts = Utc::now().format("%Y%m%d-%H%M%S");
            let out_path = format!("{shots_dir}/shot-{ts}.png");
            match run_powershell_shot(&out_path) {
                Ok(Some(size)) => {
                    let _ = write_status(&format!("screenshot ok {out_path} ({size} bytes)"));
                    out.insert("result".into(), "captured".into());
                    out.insert("path".into(), out_path.clone());
                    out.insert("bytes".into(), size.to_string());
                    // #T07.7 步骤 2：把 PNG 回传到扩展网关，面板按 uid 轮询取图。
                    // 上传是后台线程（独立于回执），失败只记日志不影响本次命令结果。
                    match std::fs::read(&out_path) {
                        Ok(png) => media::report_capture(&png),
                        Err(e) => {
                            let _ = write_status(&format!("[warn] screenshot 回传读 PNG 失败：{e}"));
                        }
                    }
                }
                Ok(None) => {
                    out.insert("error".into(), "screenshot 落盘为空（PNG 0 字节？）".into());
                }
                Err(e) => {
                    let _ = write_status(&format!("[error] screenshot failed: {e}"));
                    out.insert("error".into(), e);
                }
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

/// 执行 PowerShell 截全屏脚本，返回 PNG 落盘字节数。
///
/// 脚本内容与桌面端 `admin-console-native/lib/core/screen_shot.dart` 的 PS 兜底
/// 完全同源（System.Windows.Forms 虚拟屏 + System.Drawing.Bitmap + CopyFromScreen），
/// 该脚本在本机（学校机器组策略限制脚本执行的环境里）可被 `-ExecutionPolicy Bypass`
/// 绕过；且刻意**纯 ASCII**（PS 5.1 无 BOM 时按 ANSI 解析）。
///
/// 返回约定：
///  - `Ok(Some(n))` 成功，n>0 为 PNG 字节数；
///  - `Ok(None)` 脚本声称成功但文件为空（诚实原则：不把 0 字节当成功，与
///    screen_shot.dart 的 CaptureResult 语义一致）；
///  - `Err(msg)` 失败，msg 为可读原因（会进 agent.status.log 与面板回执）。
fn run_powershell_shot(out_path: &str) -> Result<Option<u64>, String> {
    const PS_SCRIPT: &str = r#"
param([Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object -TypeName System.Drawing.Bitmap -ArgumentList ([int]$b.Width), ([int]$b.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$b.Left, [int]$b.Top, 0, 0, $bmp.Size)
  $dir = Split-Path -Parent $Out
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $fi = Get-Item $Out
  if ($fi.Length -le 0) { Write-Output "ERR empty file"; exit 1 }
  Write-Output ("OK " + $fi.Length)
} catch {
  Write-Output ("ERR " + $_.Exception.Message)
  exit 1
}
"#;

    let script_path = format!(
        "{}\\stelarith-shot-{}.ps1",
        std::env::var("TEMP").unwrap_or_else(|_| "C:/Windows/Temp".into()),
        Utc::now().timestamp_millis()
    );
    std::fs::write(&script_path, PS_SCRIPT)
        .map_err(|e| format!("无法写入 PS 脚本 {}: {e}", script_path))?;

    let out = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script_path,
            "-Out",
            out_path,
        ])
        .output()
        .map_err(|e| format!("无法启动 powershell.exe: {e}"))?;

    let _ = std::fs::remove_file(&script_path);

    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() || !stdout.starts_with("OK ") {
        let detail = if stdout.starts_with("ERR ") {
            stdout[4..].to_string()
        } else if !stderr.is_empty() {
            stderr
        } else {
            format!("exit={:?}", out.status.code())
        };
        return Err(detail);
    }

    match std::fs::metadata(out_path) {
        Ok(md) if md.len() > 0 => Ok(Some(md.len())),
        Ok(_) => Ok(None),
        Err(e) => Err(format!("PNG 未落盘 {}: {e}", e)),
    }
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
    // TODO(2026-09-23): rtc（WebRTC 远控）待适配 webrtc 0.21 新版 API 后恢复
    // for (k, v) in rtc::status_lines() {
    //     m.insert(k, v);
    // }
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
        // 启动即读回持久化的定时关机计划（代理重启后计划不丢）
        schedules: Mutex::new(load_schedules()),
    });

    // 定时关机调度线程（每 30s 检查，到点执行 shutdown /s /t 60）
    spawn_scheduler(&st);

    // 被控端 WebRTC（#247-A）：按需起一个被控 peer。
    // ⚠️ TODO(2026-09-23)：webrtc crate 镜像版为 0.21 重写版（Sans-I/O 架构），
    // rtc.rs 仍按旧版 API 编写，编不过 → 本条链路**暂时禁用**，VNC + 媒体直连不受影响。
    // STELARITH_P2P_SIGNAL 为空时 rtc::start_p2p 内部直接返回；恢复适配后再启用。
    // if rtc::p2p_enabled() {
    //     rtc::start_p2p(media::device_uid());
    // }

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
