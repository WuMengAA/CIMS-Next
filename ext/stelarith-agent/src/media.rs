//! 摄像头抓拍 / 分段录像 / 压缩 / 媒体直连服务
//!
//! 这一模块承担三件事，都是「面板上看得见、但教室里真正干活」的那部分：
//!
//! 1. **抓拍/录像**：靠 ffmpeg（DirectShow 取流 + libx264 编码 + scale 缩放）。
//! 2. **压缩**：码率上限 / 分辨率缩放 / 关键帧间隔全部按面板配置落地 ——
//!    教室网是共享带宽，不给上限会出现"某台机器把整条走廊上行吃满"这类
//!    只在大规模现场才暴露的问题。
//! 3. **媒体直连服务**：录像/快照这些**大字节**操作不让数据穿过网站服务器。
//!    一条 720p 的 5 分钟录像接近 60MB，全班几十台机器同时调取会把站点上行打死。
//!    做法是代理在本机起一个**令牌门控**的文件服务，把 ip:port:token 登记到扩展网关，
//!    面板拿地址后**直连教室机**下载。
//!
//! ## 关于「P2P」这个词的诚实说明
//!
//! 上面第 3 点是**局域网直连**，不是 WebRTC。校园网里教室机与运维终端本来就在同一
//! 三层网络内，直连可达，这已经能拿到高带宽（不经中转）。但**真正的 NAT 穿越
//! （STUN/TURN/ICE、DataChannel）没有实现** —— 跨网段或公网访问时当前方案连不上。
//! 这一点必须在文档与面板上写明，不能拿 `media_mode=p2p` 这样一个配置值去充当能力。
//!
//! ## 三条不肯妥协的取舍
//!
//! - **ffmpeg 缺失时明确报错，绝不静默降级**。考虑过"没有 ffmpeg 就存裸帧"，
//!   但那会让面板拿到一个能显示、却不是约定格式的东西（后续压缩/回传全部对不上），
//!   比直接报"缺 ffmpeg"难以排查得多。
//! - **录像必须分段**。单文件长写在断电/进程被杀时整段作废；分段后最坏只丢最后一段。
//! - **停止录像要优雅收尾**（写 `q`），强杀会产生打不开的 mp4。见 [`Recorder`] 注释。

use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};

use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::{local_lan_ip, write_status, Task};

type HmacSha256 = Hmac<Sha256>;

// ═══════════════════════════════════════════════════════════════════════════
// 目录与文件名
// ═══════════════════════════════════════════════════════════════════════════

/// 媒体根目录。可用 STELARITH_MEDIA_DIR 覆盖（部署包默认写 ProgramData，与 status log 同级）。
pub(crate) fn media_root() -> String {
    std::env::var("STELARITH_MEDIA_DIR")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "C:/ProgramData/Stelarith/media".to_string())
}

/// `snapshots` | `recordings`；其他值一律归一到 snapshots
/// （不报错：一个拼错的 kind 不该让整条链路失败，它只该拿到默认桶）。
fn kind_dir(kind: &str) -> String {
    let k = match kind {
        "recordings" | "record" | "videos" => "recordings",
        _ => "snapshots",
    };
    format!("{}/{}", media_root(), k)
}

fn ensure_dir(p: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(p)
}

fn norm_kind(kind: &str) -> &'static str {
    match kind {
        "recordings" | "record" | "videos" => "recordings",
        _ => "snapshots",
    }
}

/// 只允许 basename：媒体文件名来自面板输入，直接拼路径就等于把"删除任意文件"的能力送出去。
fn safe_media_name(name: &str) -> Option<String> {
    let n = name.trim();
    if n.is_empty() || n.len() > 160 {
        return None;
    }
    if n.contains('/') || n.contains('\\') || n.contains("..") || n.contains(':') {
        return None;
    }
    Some(n.to_string())
}

pub(crate) fn device_uid() -> String {
    std::env::var("STELARITH_DEVICE_UID")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

// ═══════════════════════════════════════════════════════════════════════════
// ffmpeg 解析与探测
// ═══════════════════════════════════════════════════════════════════════════

/// 解析顺序：显式配置 → 与自身同目录（部署包会带上）→ 交给 PATH。
fn ffmpeg_exe() -> String {
    if let Ok(p) = std::env::var("STELARITH_FFMPEG") {
        let p = p.trim().to_string();
        if !p.is_empty() {
            return p;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for cand in ["ffmpeg.exe", "ffmpeg"] {
                let p = dir.join(cand);
                if p.exists() {
                    return p.to_string_lossy().into_owned();
                }
            }
        }
    }
    "ffmpeg".to_string()
}

static FFMPEG_OK: OnceLock<bool> = OnceLock::new();

/// 探测 ffmpeg 是否真能用（跑一次 `-version`），结果缓存。
///
/// 不要用"PATH 里找不到就等于没有"来判断：Windows 上 WinGet 装的 ffmpeg 是
/// `Links\ffmpeg.exe` 软链，`where` 能找到、`Path::exists` 却可能判假。
/// 同理也不能只靠 `exists()` 判存在 —— 能跑起来才算数。
fn ffmpeg_ok() -> bool {
    *FFMPEG_OK.get_or_init(|| {
        Command::new(ffmpeg_exe())
            .args(["-hide_banner", "-version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

/// 缺 ffmpeg 时的统一错误文案（要把"怎么办"写清楚，否则等于没报错）。
fn ffmpeg_missing_error() -> String {
    format!(
        "未找到可用的 ffmpeg（当前解析为 {}）。摄像头抓拍/录像依赖它做取流与 H.264 压缩；\
         请把 ffmpeg.exe 放到代理同目录、或设 STELARITH_FFMPEG 指向它。",
        ffmpeg_exe()
    )
}

/// 是否允许用测试图源（lavfi testsrc）。
///
/// 存在的理由：开发机 / 无摄像头的机器上要能把**压缩、落盘、直连下载、面板预览**
/// 整条链路跑通。这是显式开关 + 显式标注（回执里 `source=testsrc(测试图源，非真实摄像头)`），
/// 不会伪装成真实画面 —— 悄悄用假数据顶替真实设备，是这套系统里最不能接受的一类实现。
fn testpattern_enabled() -> bool {
    std::env::var("STELARITH_CAMERA_TESTPATTERN").ok().as_deref() == Some("1")
}

/// 枚举摄像头：解析 `ffmpeg -list_devices true -f dshow -i dummy` 的 stderr。
///
/// 为什么用 ffmpeg 而不是 WMI/PnP：DirectShow 的**设备名**（`-i video="XXX"` 要用的那个）
/// 与 PnP 的 FriendlyName 经常不是同一个字符串（实测形如 `USB Video Device` vs
/// `Integrated Camera`）。拿 PnP 名字去取流会直接报 `Could not find video device` ——
/// 所以枚举与取流必须来自同一个来源。
fn list_cameras() -> Vec<String> {
    if !ffmpeg_ok() {
        return Vec::new();
    }
    let out = Command::new(ffmpeg_exe())
        .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .output();
    let text = match out {
        Ok(o) => String::from_utf8_lossy(&o.stderr).into_owned(),
        Err(_) => return Vec::new(),
    };
    let mut cams = Vec::new();
    for line in text.lines() {
        if !line.contains("(video)") {
            continue;
        }
        // 形如: [dshow @ 0000] "USB Camera" (video)
        if let Some(a) = line.find('"') {
            let rest = &line[a + 1..];
            if let Some(b) = rest.find('"') {
                let name = rest[..b].trim();
                if !name.is_empty() && name != "dummy" {
                    cams.push(name.to_string());
                }
            }
        }
    }
    cams
}

/// 解析要用的摄像头名；解析不到时给出可直接照做的提示。
fn resolve_camera(task: &Task) -> Result<Option<String>, String> {
    if let Some(c) = task.p_str("camera") {
        return Ok(Some(c));
    }
    if testpattern_enabled() {
        return Ok(None); // 测试图源不需要设备名
    }
    match list_cameras().first() {
        Some(c) => Ok(Some(c.clone())),
        None => Err(
            "本机未发现可用摄像头（ffmpeg dshow 枚举为空）。若已知设备名请在面板指定；\
             注意代理以 SYSTEM 身份运行在**会话 0**，部分 USB 摄像头在该会话下不可见。"
                .to_string(),
        ),
    }
}

/// 构造 ffmpeg 取流输入参数（dshow 或测试图源）。
fn input_args(cam: &Option<String>, rtbuf: &str, width: u32, height: u32) -> Vec<String> {
    match cam {
        Some(name) => vec![
            "-f".into(),
            "dshow".into(),
            "-rtbufsize".into(),
            rtbuf.into(),
            "-i".into(),
            format!("video={name}"),
        ],
        None => vec![
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            format!("testsrc=size={width}x{height}:rate=25"),
        ],
    }
}

/// 统一的时间戳文件名（用 UTC，避免教室机时区设置不一致导致排序错乱）。
fn stamp() -> String {
    Utc::now().format("%Y%m%d-%H%M%S").to_string()
}

/// 取流来源的如实描述，写进回执让面板能显示。
fn source_label(cam: &Option<String>) -> String {
    match cam {
        Some(_) => "camera".into(),
        None => "testsrc(测试图源，非真实摄像头)".into(),
    }
}

fn stderr_tail(o: &std::process::Output) -> String {
    let err = String::from_utf8_lossy(&o.stderr);
    let s: String = err.chars().rev().take(400).collect();
    s.chars().rev().collect()
}

// ═══════════════════════════════════════════════════════════════════════════
// 抓拍 / 录像
// ═══════════════════════════════════════════════════════════════════════════

/// 一次分段录像。`child` 是 ffmpeg 进程；停止时**先送 `q` 让它优雅收尾**。
pub(crate) struct Recorder {
    child: Child,
    pub(crate) started_at: i64,
    pub(crate) camera: String,
    pub(crate) bitrate_kbps: i64,
    pub(crate) segment_seconds: i64,
}

/// 抓拍单帧 → JPEG。
pub(crate) fn take_snapshot(task: &Task) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if !ffmpeg_ok() {
        out.insert("error".into(), ffmpeg_missing_error());
        return out;
    }
    let cam = match resolve_camera(task) {
        Ok(c) => c,
        Err(e) => {
            out.insert("error".into(), e);
            return out;
        }
    };
    let dir = kind_dir("snapshots");
    if let Err(e) = ensure_dir(&dir) {
        out.insert("error".into(), format!("创建快照目录失败：{e}"));
        return out;
    }
    let scale = task.p_num("scale", 1280.0, 160.0, 3840.0) as u32;
    let quality = task.p_num("quality", 4.0, 2.0, 31.0) as i32;
    let name = format!("{}_{}.jpg", device_uid(), stamp());
    let path = format!("{dir}/{name}");

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into()];
    args.extend(input_args(&cam, "256M", scale.max(640), 480));
    args.extend([
        "-frames:v".into(),
        "1".into(),
        // 最长边压到 scale（min() 保证不放大）；-2 让高度自动取偶数（yuv420p 要求）
        "-vf".into(),
        format!("scale='min({scale},iw)':-2"),
        "-q:v".into(),
        quality.to_string(),
        "-f".into(),
        "image2".into(),
        path.clone(),
    ]);

    match Command::new(ffmpeg_exe()).args(&args).output() {
        Ok(o) if o.status.success() => {
            let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            out.insert("result".into(), "snapshot_saved".into());
            out.insert("kind".into(), "snapshots".into());
            out.insert("name".into(), name.clone());
            out.insert("bytes".into(), bytes.to_string());
            out.insert("camera".into(), cam.clone().unwrap_or_else(|| "testsrc".into()));
            out.insert("source".into(), source_label(&cam));
            // 抓拍成功也要拿到直连端点，否则面板手里没有可预览/下载的地址。
            attach_endpoint(&mut out, ensure_media_server().as_ref());
            let _ = write_status(&format!("snapshot ok {name} camera={cam:?} bytes={bytes}"));
            out
        }
        Ok(o) => {
            out.insert(
                "error".into(),
                format!("抓拍失败（ffmpeg 退出码 {:?}）：{}", o.status.code(), stderr_tail(&o)),
            );
            let _ = write_status(&format!("snapshot FAIL camera={cam:?}"));
            out
        }
        Err(e) => {
            out.insert("error".into(), format!("无法启动 ffmpeg：{e}"));
            out
        }
    }
}

/// 开始分段录像。`slot` 指向进程级的录像槽（由 main 持有）。
pub(crate) fn start_recording(
    task: &Task,
    slot: &Mutex<Option<Recorder>>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if !ffmpeg_ok() {
        out.insert("error".into(), ffmpeg_missing_error());
        return out;
    }
    if slot.lock().unwrap().is_some() {
        out.insert("error".into(), "本机已在录像中，请先停止当前录像".into());
        return out;
    }
    let cam = match resolve_camera(task) {
        Ok(c) => c,
        Err(e) => {
            out.insert("error".into(), e);
            return out;
        }
    };
    let dir = kind_dir("recordings");
    if let Err(e) = ensure_dir(&dir) {
        out.insert("error".into(), format!("创建录像目录失败：{e}"));
        return out;
    }

    let bitrate = task.p_num("bitrate_kbps", 1500.0, 200.0, 20000.0) as i64;
    let scale = task.p_num("scale", 1280.0, 160.0, 3840.0) as u32;
    let seg = task.p_num("segment_seconds", 300.0, 15.0, 3600.0) as i64;
    let pattern = format!("{dir}/{}_%Y%m%d-%H%M%S.mp4", device_uid());

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into(), "-nostdin".into()];
    args.extend(input_args(&cam, "512M", scale.max(640), 480));
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        // 码率三件套：目标 + 上限 + 缓冲。不给上限就会出现"某台机器把整条走廊
        // 的上行吃满"，而这类问题只在真实规模下才暴露。
        "-b:v".into(),
        format!("{bitrate}k"),
        "-maxrate".into(),
        format!("{}k", (bitrate as f64 * 1.4) as i64),
        "-bufsize".into(),
        format!("{}k", bitrate * 2),
        "-vf".into(),
        format!("scale='min({scale},iw)':-2"),
        // 关键帧间隔 ~2s：录像要能拖着看，间隔太大拖到任意位置都要等一大段解码
        "-g".into(),
        "50".into(),
        "-f".into(),
        "segment".into(),
        "-segment_time".into(),
        seg.to_string(),
        "-reset_timestamps".into(),
        "1".into(),
        "-strftime".into(),
        "1".into(),
        pattern.clone(),
    ]);

    let child = Command::new(ffmpeg_exe())
        .args(&args)
        .stdin(std::process::Stdio::piped()) // 留句柄给"优雅停止"
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();

    match child {
        Ok(c) => {
            let started = Utc::now().timestamp();
            *slot.lock().unwrap() = Some(Recorder {
                child: c,
                started_at: started,
                camera: cam.clone().unwrap_or_else(|| "testsrc".into()),
                bitrate_kbps: bitrate,
                segment_seconds: seg,
            });
            // 开了录像就先按保留期清一次：这是唯一能保证"长期运行不会把盘写满"的时机点
            // （若只在开机清，连续录一周都没重启的机器会把盘吃光）。
            let pruned = prune_media(task.p_num("retention_days", 7.0, 0.0, 3650.0) as i64);
            out.insert("result".into(), "recording_started".into());
            out.insert("started_at".into(), started.to_string());
            out.insert("bitrate_kbps".into(), bitrate.to_string());
            out.insert("scale".into(), scale.to_string());
            out.insert("segment_seconds".into(), seg.to_string());
            out.insert("pruned_old".into(), pruned.to_string());
            out.insert("camera".into(), cam.clone().unwrap_or_else(|| "testsrc".into()));
            out.insert("source".into(), source_label(&cam));
            out.insert("path".into(), pattern);
            attach_endpoint(&mut out, ensure_media_server().as_ref());
            let _ = write_status(&format!(
                "record start bitrate={bitrate}k seg={seg}s camera={cam:?}"
            ));
            out
        }
        Err(e) => {
            out.insert("error".into(), format!("无法启动 ffmpeg（录像）：{e}"));
            out
        }
    }
}

/// 停止录像：写 `q` 优雅收尾 → 最多等 3s → 还在才强杀。
pub(crate) fn stop_recording(slot: &Mutex<Option<Recorder>>) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut rec = match slot.lock().unwrap().take() {
        Some(r) => r,
        None => {
            out.insert("result".into(), "no_active_recording".into());
            return out;
        }
    };
    let secs = (Utc::now().timestamp() - rec.started_at).max(0);

    let mut graceful = false;
    if let Some(mut si) = rec.child.stdin.take() {
        if si.write_all(b"q").is_ok() && si.flush().is_ok() {
            for _ in 0..30 {
                match rec.child.try_wait() {
                    Ok(Some(_)) => {
                        graceful = true;
                        break;
                    }
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
                    Err(_) => break,
                }
            }
        }
    }
    if !graceful {
        let _ = rec.child.kill();
        let _ = rec.child.wait();
        let _ = write_status(
            "[warn] 录像进程被强杀（ffmpeg 未在 3s 内优雅退出），最后一段可能不完整",
        );
    }

    let files = list_media("recordings");
    out.insert("result".into(), "recording_stopped".into());
    out.insert("seconds".into(), secs.to_string());
    out.insert("graceful".into(), graceful.to_string());
    out.insert("file_count".into(), files.len().to_string());
    if let Some(last) = files.last() {
        out.insert("last_file".into(), last.name.clone());
        out.insert("last_bytes".into(), last.bytes.to_string());
    }
    attach_endpoint(&mut out, ensure_media_server().as_ref());
    let _ = write_status(&format!(
        "record stop seconds={secs} graceful={graceful} files={}",
        files.len()
    ));
    out
}

/// 录像中的状态摘要（供 /status 只读查询）。
/// (起始时间, 摄像头名, 段长秒, 码率kbps)
pub(crate) fn recorder_status(slot: &Mutex<Option<Recorder>>) -> Option<(i64, String, i64, i64)> {
    slot.lock()
        .unwrap()
        .as_ref()
        .map(|r| (r.started_at, r.camera.clone(), r.segment_seconds, r.bitrate_kbps))
}

// ═══════════════════════════════════════════════════════════════════════════
// 媒体库：列表 / 删除 / 保留期清理
// ═══════════════════════════════════════════════════════════════════════════

pub(crate) struct MediaFile {
    pub(crate) name: String,
    pub(crate) bytes: u64,
    pub(crate) mtime: i64,
}

pub(crate) fn list_media(kind: &str) -> Vec<MediaFile> {
    let dir = kind_dir(kind);
    let mut v = Vec::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return v,
    };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let md = match e.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        v.push(MediaFile {
            name: p
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default(),
            bytes: md.len(),
            mtime,
        });
    }
    v.sort_by(|a, b| a.mtime.cmp(&b.mtime));
    v
}

/// 按保留天数清理。`days <= 0` 视为"不清理"（而不是"全删"）——
/// 一个配错的 0 不该变成"把录像全删了"。
pub(crate) fn prune_media(days: i64) -> usize {
    if days <= 0 {
        return 0;
    }
    let cutoff = Utc::now().timestamp() - days * 86400;
    let mut removed = 0usize;
    for kind in ["snapshots", "recordings"] {
        for f in list_media(kind) {
            if f.mtime > 0 && f.mtime < cutoff {
                let p = format!("{}/{}", kind_dir(kind), f.name);
                if std::fs::remove_file(&p).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    if removed > 0 {
        let _ = write_status(&format!("prune removed={removed} retention_days={days}"));
    }
    removed
}

/// 开机清一次：断电重启后盘上多半躺着过期录像，趁服务刚起、无人使用时清掉。
pub(crate) fn startup_prune() {
    let days = std::env::var("STELARITH_MEDIA_RETENTION_DAYS")
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(7.0);
    let n = prune_media(days.clamp(0.0, 3650.0) as i64);
    let _ = write_status(&format!("startup prune removed={n} retention_days={days}"));
}

/// 列出摄像头（面板「选择设备」用）。
pub(crate) fn camera_list() -> HashMap<String, String> {
    let mut out = HashMap::new();
    let cams = list_cameras();
    out.insert("result".into(), "camera_listed".into());
    out.insert("ffmpeg".into(), ffmpeg_ok().to_string());
    out.insert("ffmpeg_path".into(), ffmpeg_exe());
    out.insert("testpattern_enabled".into(), testpattern_enabled().to_string());
    out.insert("count".into(), cams.len().to_string());
    out.insert(
        "cameras".into(),
        serde_json::Value::Array(cams.iter().map(|c| serde_json::json!(c)).collect()).to_string(),
    );
    if !ffmpeg_ok() {
        out.insert("error".into(), ffmpeg_missing_error());
    } else if cams.is_empty() && !testpattern_enabled() {
        // 不是 error（工具本身是好的），但要立刻让人知道"没有可用设备"这件事。
        out.insert(
            "warning".into(),
            "未枚举到摄像头。若本机确实有摄像头，通常是代理运行在会话 0（SYSTEM 服务）导致设备不可见。"
                .into(),
        );
    }
    out
}

pub(crate) fn media_list_payload(task: &Task) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let kind = norm_kind(&task.p_str("kind").unwrap_or_else(|| "snapshots".into()));
    let files = list_media(kind);
    let items: Vec<serde_json::Value> = files
        .iter()
        .map(|f| {
            serde_json::json!({
                "name": f.name,
                "bytes": f.bytes,
                "mtime": f.mtime,
                "url_path": format!("/file/{kind}/{}", f.name),
            })
        })
        .collect();
    out.insert("result".into(), "media_listed".into());
    out.insert("kind".into(), kind.into());
    out.insert("count".into(), items.len().to_string());
    out.insert("items".into(), serde_json::Value::Array(items).to_string());
    out.insert(
        "limit_mb".into(),
        std::env::var("STELARITH_MEDIA_LIMIT_MB").unwrap_or_else(|_| "2048".into()),
    );
    attach_endpoint(&mut out, ensure_media_server().as_ref());
    out
}

pub(crate) fn media_delete(task: &Task) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let kind = norm_kind(&task.p_str("kind").unwrap_or_default());
    let name = match task.p_str("name").and_then(|n| safe_media_name(&n)) {
        Some(n) => n,
        None => {
            out.insert("error".into(), "文件名非法（只接受不含路径的文件名）".into());
            return out;
        }
    };
    let path = format!("{}/{name}", kind_dir(kind));
    match std::fs::remove_file(&path) {
        Ok(_) => {
            out.insert("result".into(), "media_deleted".into());
            out.insert("kind".into(), kind.into());
            out.insert("name".into(), name.clone());
            let _ = write_status(&format!("media delete {kind}/{name}"));
        }
        Err(e) => {
            // 文件不存在要如实说"不存在"，不要伪装成删除成功 ——
            // 否则运维以为清理过了，实际还占着空间。
            out.insert("error".into(), format!("删除失败（{path}）：{e}"));
        }
    }
    out
}

// ═══════════════════════════════════════════════════════════════════════════
// 会话登记（代理 → 扩展网关）
// ═══════════════════════════════════════════════════════════════════════════

/// 把设备会话（VNC / 媒体直连）登记到扩展网关。
///
/// ⚠️ 这一步是**面板能否连上教室端的唯一来源**。网关侧曾长期把这条上报丢弃
/// （GET 恒返回 `session:null`），于是面板停在"正在等待设备回报会话地址…"永远等不到
/// —— 那不是超时问题，是链路里少了一环。
///
/// 鉴权用部署级共享密钥（`STELARITH_EXT_SECRET` ↔ 站点 `CONSOLE_DEVICE_REPORT_SECRET`）：
/// 代理没有用户会话，走不了面板那套登录鉴权；而网关侧未配置密钥时**一律拒绝**。
/// 这里失败只记日志、不重试 —— 重试解决不了"两边密钥不一致"，
/// 而静默吞掉这条错误会让下次排障又从"面板为什么连不上"重新开始。
pub(crate) fn report_session(proto: &str, ip: &str, port: u16, token: &str, state: &str) {
    let ext = match std::env::var("STELARITH_EXT_URL") {
        Ok(v) if !v.trim().is_empty() => v.trim().trim_end_matches('/').to_string(),
        _ => {
            let _ = write_status(
                "[warn] 未配置 STELARITH_EXT_URL —— 会话无法登记到网关，面板将看不到地址",
            );
            return;
        }
    };
    let secret = std::env::var("STELARITH_EXT_SECRET").unwrap_or_default();
    if secret.trim().is_empty() {
        let _ = write_status("[warn] 未配置 STELARITH_EXT_SECRET —— 网关会拒绝本次会话登记");
    }
    let body = serde_json::json!({
        "uid": device_uid(),
        "ip": ip,
        "port": port,
        "token": token,
        "proto": proto,
        "state": state,
    });
    let path = if proto == "vnc" { "vnc-session" } else { "media-session" };
    let url = format!("{ext}/{path}");
    let (proto, state) = (proto.to_string(), state.to_string());
    std::thread::spawn(move || {
        let client = match reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .build()
        {
            Ok(c) => c,
            Err(_) => return,
        };
        match client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("x-stelarith-device-secret", secret)
            .json(&body)
            .send()
        {
            Ok(r) if r.status().is_success() => {
                let _ = write_status(&format!("session report ok {proto}/{state}"));
            }
            Ok(r) => {
                // 状态码与响应体都记下来：网关对"密钥不对"和"参数非法"给的是不同状态码，
                // 只记一句"上报失败"会丢掉唯一能定位的线索。
                let code = r.status().as_u16();
                let txt = r.text().unwrap_or_default();
                let _ = write_status(&format!(
                    "[error] session report {proto}/{state} 被拒 HTTP {code}: {}",
                    txt.chars().take(200).collect::<String>()
                ));
            }
            Err(e) => {
                let _ = write_status(&format!(
                    "[error] session report {proto}/{state} 失败：{e}"
                ));
            }
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// 媒体直连服务（高带宽操作绕开服务器中转）
// ═══════════════════════════════════════════════════════════════════════════

/// 媒体直连运行时信息。`root` 目前未参与鉴权，仅用于健康检查诊断。
struct MediaRuntime {
    enabled: bool,
    token: String,
}

#[derive(Clone)]
struct MediaCtx {
    rt: std::sync::Arc<Mutex<MediaRuntime>>,
    root: String,
}

static MEDIA_RT: OnceLock<std::sync::Arc<Mutex<MediaRuntime>>> = OnceLock::new();
static MEDIA_EP: OnceLock<Mutex<Option<(String, u16, String)>>> = OnceLock::new();

fn media_rt() -> std::sync::Arc<Mutex<MediaRuntime>> {
    MEDIA_RT
        .get_or_init(|| {
            std::sync::Arc::new(Mutex::new(MediaRuntime {
                enabled: false,
                token: String::new(),
            }))
        })
        .clone()
}

fn media_ep_slot() -> &'static Mutex<Option<(String, u16, String)>> {
    MEDIA_EP.get_or_init(|| Mutex::new(None))
}

/// 不引入 rand 依赖：用时间戳 + 进程 id + 内存地址熵拼一个不可猜串。
/// 这枚令牌只在局域网存活且会轮换，不承担抵抗离线爆破的职责。
fn new_media_token() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let addr = format!("{:p}", &nanos);
    let raw = format!("{nanos}-{pid}-{addr}");
    let mut mac = HmacSha256::new_from_slice(b"stelarith-media-token").unwrap();
    mac.update(raw.as_bytes());
    hex::encode(&mac.finalize().into_bytes()[..16])
}

/// 懒启动媒体直连服务；已在跑则直接返回 `(ip, port, token)`。
pub(crate) fn ensure_media_server() -> Option<(String, u16, String)> {
    {
        let slot = media_ep_slot().lock().unwrap();
        if let Some(ep) = slot.as_ref() {
            // 已在跑：确保是启用态（抓拍/录像/列表都隐含"要能取文件"）
            media_rt().lock().unwrap().enabled = true;
            return Some(ep.clone());
        }
    }

    let want: u16 = std::env::var("STELARITH_MEDIA_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(18081);
    let root = media_root();
    let _ = ensure_dir(&root);
    let _ = ensure_dir(&kind_dir("snapshots"));
    let _ = ensure_dir(&kind_dir("recordings"));

    // 先试配置端口；被占用则退到系统分配。
    // 绝不因为"端口被占"就让整个媒体能力不可用 —— 那会把一个可恢复的冲突
    // 放大成"摄像头功能坏了"。
    let std_listener = match std::net::TcpListener::bind(("0.0.0.0", want)) {
        Ok(l) => l,
        Err(e) => {
            let _ = write_status(&format!(
                "[warn] 媒体端口 {want} 不可用（{e}），改用系统分配端口"
            ));
            match std::net::TcpListener::bind(("0.0.0.0", 0)) {
                Ok(l) => l,
                Err(e2) => {
                    let _ = write_status(&format!("[error] 媒体直连服务无法监听：{e2}"));
                    return None;
                }
            }
        }
    };
    let port = match std_listener.local_addr() {
        Ok(a) => a.port(),
        Err(_) => return None,
    };
    let _ = std_listener.set_nonblocking(true);

    let token = new_media_token();
    {
        // 必须先绑定 Arc 再 lock：`media_rt().lock()` 的临时 Arc 会在语句结束就被释放，
        // 而 guard 还要继续用 —— 编译器会直接拒绝（E0716）。
        let rt_arc = media_rt();
        let mut rt = rt_arc.lock().unwrap();
        rt.enabled = true;
        rt.token = token.clone();
    }
    let ctx = MediaCtx {
        rt: media_rt(),
        root: root.clone(),
    };
    let app = Router::new()
        .route("/health", get(media_health))
        .route("/list", get(media_list_http))
        .route("/file/:kind/:name", get(media_get).delete(media_del))
        .with_state(ctx);

    let listener = match tokio::net::TcpListener::from_std(std_listener) {
        Ok(l) => l,
        Err(e) => {
            let _ = write_status(&format!("[error] 媒体直连服务绑定失败：{e}"));
            return None;
        }
    };
    match tokio::runtime::Handle::try_current() {
        Ok(h) => {
            h.spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
        }
        Err(_) => {
            let _ = write_status("[error] 媒体直连服务无法启动：缺少 tokio 运行时上下文");
            return None;
        }
    }

    let ip = local_lan_ip().unwrap_or_else(|| "127.0.0.1".into());
    let ep = (ip.clone(), port, token.clone());
    *media_ep_slot().lock().unwrap() = Some(ep.clone());
    let _ = write_status(&format!("media direct up {ip}:{port}"));
    report_session("media", &ip, port, &token, "up");
    Some(ep)
}

/// 停止媒体直连：**置 enabled=false + 轮换令牌**，让已发出的旧地址立刻失效。
/// （只把地址从面板上藏起来不算关闭 —— 拿到过 URL 的人仍然能下载。）
pub(crate) fn stop_media_server() -> bool {
    let had = media_ep_slot().lock().unwrap().take();
    {
        let rt_arc = media_rt();
        let mut rt = rt_arc.lock().unwrap();
        rt.enabled = false;
        rt.token = new_media_token();
    }
    match had {
        Some((ip, port, token)) => {
            // 注销登记用原令牌上报即可（网关只看 uid+state）
            report_session("media", &ip, port, &token, "stopped");
            let _ = write_status("media direct down");
            true
        }
        None => false,
    }
}

/// 只读查询：媒体直连是否在跑、端口多少（面板诊断用；不泄露令牌）。
pub(crate) fn media_status() -> Option<(String, u16, bool)> {
    let slot = media_ep_slot().lock().unwrap();
    let enabled = media_rt().lock().unwrap().enabled;
    slot.as_ref().map(|(ip, port, _)| (ip.clone(), *port, enabled))
}

/// 令牌门控：未启用 / 令牌不符一律 403。
///
/// 令牌允许走 **query**（`?t=…`）：面板要用 `<img src>` / `<video src>` 直接嵌文件，
/// 而 HTML 标签**没法自定义请求头** —— 只支持 header 就等于面板永远显示不出图。
/// 走 query 的代价是令牌会进访问日志/Referer，因此令牌按会话轮换。
fn media_guard(
    ctx: &MediaCtx,
    headers: &axum::http::HeaderMap,
    qtok: Option<&str>,
) -> Result<(), axum::response::Response> {
    let rt = ctx.rt.lock().unwrap();
    if !rt.enabled {
        return Err(with_cors(
            (
                axum::http::StatusCode::FORBIDDEN,
                "media session disabled",
            )
                .into_response(),
        ));
    }
    let got = qtok
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            headers
                .get("x-stelarith-media-token")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_default();
    if got.is_empty() || got != rt.token {
        return Err(with_cors(
            (axum::http::StatusCode::FORBIDDEN, "bad token").into_response(),
        ));
    }
    Ok(())
}

/// 面板与媒体服务**不同源**（面板在站点域名下，媒体服务在教室机 ip:port）。
/// `<img>`/`<video>` 这类标签不受同源限制，但面板要 fetch `/list` 就必需 CORS
/// —— 否则列表永远拉不到、只在控制台留一行红字。
fn with_cors(mut resp: axum::response::Response) -> axum::response::Response {
    resp.headers_mut().insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        "*".parse().unwrap(),
    );
    resp
}

fn mime_of(name: &str) -> &'static str {
    if name.ends_with(".mp4") {
        "video/mp4"
    } else if name.ends_with(".jpg") || name.ends_with(".jpeg") {
        "image/jpeg"
    } else if name.ends_with(".png") {
        "image/png"
    } else {
        "application/octet-stream"
    }
}

async fn media_health(State(ctx): State<MediaCtx>) -> axum::response::Response {
    let rt = ctx.rt.lock().unwrap();
    with_cors(
        Json(serde_json::json!({
            "ok": true,
            "enabled": rt.enabled,
            "root": ctx.root,
        }))
        .into_response(),
    )
}

async fn media_list_http(
    State(ctx): State<MediaCtx>,
    headers: axum::http::HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> axum::response::Response {
    if let Err(r) = media_guard(&ctx, &headers, q.get("t").map(|s| s.as_str())) {
        return r;
    }
    let mut all = Vec::new();
    for kind in ["snapshots", "recordings"] {
        for f in list_media(kind) {
            all.push(serde_json::json!({
                "kind": kind,
                "name": f.name,
                "bytes": f.bytes,
                "mtime": f.mtime,
            }));
        }
    }
    with_cors(Json(serde_json::json!({ "ok": true, "items": all })).into_response())
}

async fn media_del(
    State(ctx): State<MediaCtx>,
    Path((kind, name)): Path<(String, String)>,
    headers: axum::http::HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> axum::response::Response {
    if let Err(r) = media_guard(&ctx, &headers, q.get("t").map(|s| s.as_str())) {
        return r;
    }
    let k = norm_kind(&kind);
    let n = match safe_media_name(&name) {
        Some(n) => n,
        None => {
            return with_cors(
                (axum::http::StatusCode::BAD_REQUEST, "bad name").into_response(),
            )
        }
    };
    match std::fs::remove_file(format!("{}/{n}", kind_dir(k))) {
        Ok(_) => with_cors(Json(serde_json::json!({ "ok": true })).into_response()),
        Err(e) => with_cors(
            (axum::http::StatusCode::NOT_FOUND, format!("{e}")).into_response(),
        ),
    }
}

/// 取文件。**支持 Range**：录像要在浏览器里能拖进度条，没有 Range 就得整段下载完
/// 才能看 —— 一条 60MB 的录像在局域网里也要等十几秒，体验上等于"打不开"。
async fn media_get(
    State(ctx): State<MediaCtx>,
    Path((kind, name)): Path<(String, String)>,
    headers: axum::http::HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> axum::response::Response {
    if let Err(r) = media_guard(&ctx, &headers, q.get("t").map(|s| s.as_str())) {
        return r;
    }
    let k = norm_kind(&kind);
    let n = match safe_media_name(&name) {
        Some(n) => n,
        None => {
            return with_cors(
                (axum::http::StatusCode::BAD_REQUEST, "bad name").into_response(),
            )
        }
    };
    let path = format!("{}/{n}", kind_dir(k));
    let mut file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(e) => {
            return with_cors(
                (axum::http::StatusCode::NOT_FOUND, format!("文件不可读：{e}")).into_response(),
            )
        }
    };
    use std::io::{Read, Seek, SeekFrom};
    let total = match file.metadata() {
        Ok(m) => m.len(),
        Err(e) => {
            return with_cors(
                (axum::http::StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")).into_response(),
            )
        }
    };
    if total == 0 {
        return with_cors((axum::http::StatusCode::NO_CONTENT, "").into_response());
    }

    let range = headers
        .get(axum::http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("bytes=").map(|r| r.to_string()));

    let (start, end, partial) = match range {
        Some(r) => {
            let mut sp = r.splitn(2, '-');
            let a = sp.next().unwrap_or("").trim();
            let b = sp.next().unwrap_or("").trim();
            let s: u64 = a.parse().unwrap_or(0);
            let e: u64 = if b.is_empty() {
                total - 1
            } else {
                b.parse().unwrap_or(total - 1)
            };
            if s >= total {
                return with_cors(
                    (
                        axum::http::StatusCode::RANGE_NOT_SATISFIABLE,
                        format!("请求范围越界：{s} >= {total}"),
                    )
                        .into_response(),
                );
            }
            (s, e.min(total - 1), true)
        }
        None => (0u64, total - 1, false),
    };

    let len = (end - start + 1) as usize;
    if file.seek(SeekFrom::Start(start)).is_err() {
        return with_cors(
            (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "seek failed").into_response(),
        );
    }
    let mut buf = vec![0u8; len];
    if let Err(e) = file.read_exact(&mut buf) {
        return with_cors(
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("read failed: {e}"),
            )
                .into_response(),
        );
    }

    use axum::http::header;
    let mut resp = if partial {
        let mut r = axum::response::Response::new(axum::body::Body::from(buf));
        *r.status_mut() = axum::http::StatusCode::PARTIAL_CONTENT;
        r.headers_mut().insert(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{total}").parse().unwrap(),
        );
        r
    } else {
        axum::response::Response::new(axum::body::Body::from(buf))
    };
    {
        let h = resp.headers_mut();
        h.insert(header::CONTENT_TYPE, mime_of(&n).parse().unwrap());
        h.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
        h.insert(header::CONTENT_LENGTH, len.to_string().parse().unwrap());
        h.insert(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{n}\"").parse().unwrap(),
        );
    }
    with_cors(resp)
}

/// 把直连端点塞进动作回执（同时说明取用方式，面板不必自己猜拼法）。
fn attach_endpoint(out: &mut HashMap<String, String>, ep: Option<&(String, u16, String)>) {
    if let Some((ip, port, token)) = ep {
        out.insert("media_ip".into(), ip.clone());
        out.insert("media_port".into(), port.to_string());
        out.insert("media_token".into(), token.clone());
        out.insert("media_base".into(), format!("http://{ip}:{port}"));
        out.insert(
            "media_direct".into(),
            "1".into(),
        );
    } else {
        out.insert(
            "media_warning".into(),
            "媒体直连服务未启动（端口不可用？）；文件仍在本机，但面板无法直连取回".into(),
        );
    }
}

/// 供 main 在 /status 里回显的媒体摘要（不含令牌）。
pub(crate) fn status_lines() -> Vec<(String, String)> {
    let mut v = Vec::new();
    v.push(("ffmpeg".into(), ffmpeg_ok().to_string()));
    match media_status() {
        Some((ip, port, enabled)) => {
            v.push(("media_direct".into(), if enabled { "on".into() } else { "off".into() }));
            v.push(("media_addr".into(), format!("{ip}:{port}")));
        }
        None => v.push(("media_direct".into(), "off".into())),
    }
    v
}
