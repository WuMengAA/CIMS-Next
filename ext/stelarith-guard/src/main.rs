// Stelarith guard - 防拆 L2 守护进程（Rust, 纯 std 零依赖）
// ---------------------------------------------------------------
// 职责（对应防拆文档 §2.1 L2）：
//   1) 每 15s 探活本地 stelarith-agent（HTTP GET http://127.0.0.1:<port>/status）
//      与 ClassIsland（进程存在性检查）；
//   2) 探到不在 → 通过计划任务/启动器拉起，并追加一条篡改事件到日志；
//   3) 互斥：绑定 127.0.0.1:18001，已有实例时立即退出（防双开重复拉起）。
//
// 设计约束（延续 stelarith-agent 的"体量/安全"原则）：
//   - 零第三方 crate：HTTP 探活 = std::net::TcpStream 手写极简 GET（无 reqwest 依赖树）；
//   - 仅监听/连接 127.0.0.1，不给外部开任何端口（本进程无服务端面）；
//   - 日志追加到 C:/ProgramData/Stelarith/guard.log，与 agent.status.log 同级；
//   - 全 ASCII 注释与字符串（避免编码问题），不依赖 PowerShell/中文语言环境。
//
// 环境变量（可选，均有默认值）：
//   STELARITH_AGENT_PORT    agent 端口（默认 17999）
//   STELARITH_AGENT_TASK    拉起用的计划任务名（默认 Stelarith-Agent-AutoStart，T08 已加固）
//   STELARITH_AGENT_CMD     计划任务兜底失败时直接跑的 cmd（默认 C:\ClassIsland\agent\run-agent.cmd）
//   STELARITH_CLASSISLAND_EXE  ClassIsland 可执行文件（默认 C:\ClassIsland\ClassIsland.exe）
//   STELARITH_GUARD_INTERVAL_SEC  探活间隔秒（默认 15）
//   STELARITH_GUARD_LOG     日志路径（默认 C:/ProgramData/Stelarith/guard.log）
//   STELARITH_GUARD_PORT    互斥端口（默认 18001）
// -----------------------------------------------------------------

use std::env;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const VERSION: &str = "0.1.0";
const LOG_DIR: &str = "C:/ProgramData/Stelarith";

fn main() {
    // ---- 互斥：绑定本地端口，已有实例则退出 ----
    let guard_port: u16 = env::var("STELARITH_GUARD_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(18001);
    let _mutex = match std::net::TcpListener::bind(("127.0.0.1", guard_port)) {
        Ok(l) => l,
        Err(_) => {
            let _ = log_line(&format!("[warn] another guard instance already running on 127.0.0.1:{guard_port}, exiting"));
            return;
        }
    };

    let interval: u64 = env::var("STELARITH_GUARD_INTERVAL_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(15);
    // 拉起失败冷却：连续 N 次拉起失败后，冷却期内只记一次事件、不再尝试。
    // 场景：无桌面会话/托盘不可用时 ClassIsland.exe 会启动即退——不冷却会每 15s 刷一次日志。
    const COOLDOWN_TICKS: u64 = 40; // 40 tick ≈ 10 分钟
    const MAX_FAILS_BEFORE_COOLDOWN: u64 = 3;
    let mut agent_fails: u64 = 0;
    let mut classisland_fails: u64 = 0;
    let mut agent_cooldown: u64 = 0;
    let mut classisland_cooldown: u64 = 0;

    let _ = log_line(&format!(
        "[start] stelarith-guard v{VERSION} | probe every {interval}s | agent_port={} | classisland={}",
        agent_port(),
        classisland_exe()
    ));

    let mut tick: u64 = 0;
    loop {
        tick += 1;
        let now = unix_now();
        // 探活 agent（冷却期内跳过拉起，仍探活记录）
        let agent_up = probe_agent();
        if agent_up {
            agent_fails = 0;
        } else if agent_cooldown > 0 {
            agent_cooldown -= 1;
        } else if agent_fails >= MAX_FAILS_BEFORE_COOLDOWN {
            let _ = log_line(&format!("[event:cooldown] agent relaunch failed {agent_fails}x -> cooldown {COOLDOWN_TICKS} ticks"));
            agent_fails = 0;
            agent_cooldown = COOLDOWN_TICKS;
        } else {
            let _ = log_line(&format!("[event:tamper] agent DOWN (probe failed) -> relaunching"));
            let ok = relaunch_agent();
            let _ = log_line(&format!(
                "[event:relaunch] agent relaunch {} (attempt #{tick}, t={now})",
                if ok { "OK" } else { "FAILED" }
            ));
            if ok {
                agent_fails = 0;
            } else {
                agent_fails += 1;
            }
        }
        // 探活 ClassIsland（同上冷却逻辑）
        let ci_up = process_exists("ClassIsland.exe");
        if ci_up {
            classisland_fails = 0;
        } else if classisland_cooldown > 0 {
            classisland_cooldown -= 1;
        } else if classisland_fails >= MAX_FAILS_BEFORE_COOLDOWN {
            let _ = log_line(&format!("[event:cooldown] ClassIsland relaunch failed {classisland_fails}x -> cooldown {COOLDOWN_TICKS} ticks"));
            classisland_fails = 0;
            classisland_cooldown = COOLDOWN_TICKS;
        } else {
            let _ = log_line(&format!("[event:tamper] ClassIsland DOWN (process missing) -> relaunching"));
            let ok = relaunch_classisland();
            let _ = log_line(&format!(
                "[event:relaunch] ClassIsland relaunch {} (attempt #{tick}, t={now})",
                if ok { "OK" } else { "FAILED" }
            ));
            if ok {
                classisland_fails = 0;
            } else {
                classisland_fails += 1;
            }
        }
        thread::sleep(Duration::from_secs(interval));
    }
}

fn agent_port() -> u16 {
    env::var("STELARITH_AGENT_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(17999)
}

fn agent_task() -> String {
    env::var("STELARITH_AGENT_TASK")
        .unwrap_or_else(|_| "Stelarith-Agent-AutoStart".to_string())
}

fn agent_cmd() -> String {
    env::var("STELARITH_AGENT_CMD")
        .unwrap_or_else(|_| "C:\\ClassIsland\\agent\\run-agent.cmd".to_string())
}

fn classisland_exe() -> String {
    env::var("STELARITH_CLASSISLAND_EXE")
        .unwrap_or_else(|_| "C:\\ClassIsland\\ClassIsland.exe".to_string())
}

/// 探活 agent：TCP 连 127.0.0.1:<port> 发极简 HTTP GET /status，读到 "200 OK" 即视为存活。
fn probe_agent() -> bool {
    let port = agent_port();
    let req = format!(
        "GET /status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    match TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().unwrap(), Duration::from_secs(3)) {
        Ok(mut s) => {
            let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
            if s.write_all(req.as_bytes()).is_err() {
                return false;
            }
            let mut buf = [0u8; 512];
            match s.read(&mut buf) {
                Ok(n) if n > 0 => {
                    let head = String::from_utf8_lossy(&buf[..n]);
                    head.contains("200 OK")
                }
                _ => false,
            }
        }
        Err(_) => false,
    }
}

/// 进程存在性：tasklist /FI "IMAGENAME eq <name>" 输出里含目标进程名。
/// （tasklist 是 Windows 自带命令，输出语言无关地包含进程名，鲁棒性优先于 Get-Process）
fn process_exists(name: &str) -> bool {
    let out = Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {name}"), "/NH"])
        .output();
    match out {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            text.contains(name)
        }
        Err(_) => false,
    }
}

/// 拉起 agent：优先 Start-ScheduledTask（T08 的 AutoStart 任务已带 RestartCount 等加固），
/// 拉起后 sleep 4s 验证 /status 真的 up；仍 down 再直接执行 run-agent.cmd（detached）。
/// 返回值为"最终探活是否 up"（不是"命令是否发出"），保证日志里 OK 是真实状态。
fn relaunch_agent() -> bool {
    // 1) 计划任务拉起
    let task = agent_task();
    let r1 = Command::new("schtasks").args(["/Run", "/TN", &task]).output();
    if let Ok(o) = r1 {
        if o.status.success() {
            thread::sleep(Duration::from_secs(4));
            if probe_agent() {
                return true;
            }
        }
    }
    // 2) 兜底：直接执行 run-agent.cmd（detached，stdout/stderr 进 agent.log）
    let cmd = agent_cmd();
    let r2 = Command::new("cmd")
        .args(["/c", "call", &cmd])
        .spawn();
    if r2.is_ok() {
        thread::sleep(Duration::from_secs(4));
        return probe_agent();
    }
    false
}

/// 拉起 ClassIsland：直接 spawn 其 exe（detached，不经过 cmd start——非交互会话下
/// cmd 的 start 内建命令创建的子进程可能挂在别的会话，直接 spawn 更可靠）。
/// 返回值 = 拉起后 4s 进程是否真实存在。
fn relaunch_classisland() -> bool {
    let exe = classisland_exe();
    if !std::path::Path::new(&exe).exists() {
        let _ = log_line(&format!("[error] classisland exe missing: {exe}"));
        return false;
    }
    match Command::new(&exe).spawn() {
        Ok(_) => {
            thread::sleep(Duration::from_secs(4));
            process_exists("ClassIsland.exe")
        }
        Err(_) => false,
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 追加日志行到 guard.log（与 agent.status.log 同级目录，目录不存在则创建）。
/// 行格式：[UTC ISO 秒] 消息
fn log_line(line: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(LOG_DIR)?;
    let path = env::var("STELARITH_GUARD_LOG")
        .unwrap_or_else(|_| format!("{LOG_DIR}/guard.log"));
    use std::fs::OpenOptions;
    let mut f = OpenOptions::new().create(true).append(true).open(&path)?;
    writeln!(f, "[{ts}] {line}", ts = unix_now(), line = line)?;
    Ok(())
}
