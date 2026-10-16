//! 被控端 WebRTC（#247-A）
//!
//! 给教室机（本代理，被控侧）补**真 WebRTC**，与面板 `static/console/p2p-connector.js`
//! （billdDesk 协议）端到端对齐。此前"远控"只有 VNC + 媒体直连，面板却是真 WebRTC，
//! 协议不通等于没有远控。
//!
//! 角色：被控（教室机）。流程严格按 `static/console/protocol.mjs`（唯一事实源）：
//!   join `room-<uid>` → 等 `billdDeskOffer` → `setRemoteDescription(offer)`
//!   → 挂桌面视频轨 + 准备 DataChannel → `createAnswer` / `setLocalDescription`
//!   → 发 `billdDeskAnswer` → 双向交换 `billdDeskCandidate`
//!   → 通过 DataChannel / `billdDeskBehavior` 收输入事件并注入本机。
//!
//! 配置**全部走环境变量，一个值都不写死**（见 [`p2p_enabled`] / [`parse_ice_servers`]）：
//!   - `STELARITH_P2P_SIGNAL`  信令地址（空 = 不开 WebRTC，直接回落 VNC/媒体直连）
//!   - `STELARITH_P2P_ICE`    iceServers 的 JSON（空 = 仅 host candidate，只能同网段）
//!   - `STELARITH_P2P_SECRET` 信令 join 令牌（billdDesk `deskUserPassword`）；
//!                          未配则回退 `STELARITH_AGENT_SECRET`。
//!
//! ⚠️ **绝对不要默认 `stun:stun.l.google.com:19302`**——国内不可达，会静默连不上。
//! 没配 STUN/TURN 就在日志明确说"当前仅局域网可达"。
//!
//! 降级：本模块**只新增**能力，绝不删 VNC / 媒体直连。`STELARITH_P2P_SIGNAL` 为空、
//! 信令连不上、join 被拒、ICE 失败、ffmpeg 缺失导致无视频轨——都只是让 WebRTC 这条路
//! 不可用，并在 `/status` 如实反映；VNC 与媒体直连始终在。

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use rust_socketio::{ClientBuilder, Payload, TransportType};

use rtc::media::Sample;
use rtc::media_stream::MediaStreamTrack;
use rtc::rtp_transceiver::rtp_sender::{
    RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters, RtpCodecKind,
};
use webrtc::data_channel::{DataChannel, DataChannelEvent};
use webrtc::media_stream::track_local::{TrackLocal, static_sample::TrackLocalStaticSample};
use webrtc::peer_connection::{
    MediaEngine, PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler,
    RTCConfigurationBuilder, RTCIceGatheringState, RTCIceServer, RTCPeerConnectionState,
    Registry, register_default_interceptors,
};
use webrtc::runtime::channel;
use webrtc::peer_connection::RTCSessionDescription;
use webrtc::peer_connection::{RTCIceCandidate, RTCIceCandidateInit};
use webrtc::runtime::{Runtime, TokioRuntime};
use std::time::Instant;
use rtc::rtp_transceiver::{PayloadType, SSRC};
use rtc::rtp_transceiver::rtp_sender::RTCRtpCodec;


use crate::write_status;

// ─────────────────────────────────────────────────────────────────────────────
// 共享状态 + /status 反映
// ─────────────────────────────────────────────────────────────────────────────

struct P2PStatus {
    enabled: bool,
    signal: String,
    lan_only: bool,
    joined: bool,
    pc_state: String,
    last_error: String,
}

static P2P_STATUS: OnceLock<Mutex<P2PStatus>> = OnceLock::new();

fn status() -> &'static Mutex<P2PStatus> {
    P2P_STATUS.get_or_init(|| {
        Mutex::new(P2PStatus {
            enabled: false,
            signal: String::new(),
            lan_only: false,
            joined: false,
            pc_state: "idle".into(),
            last_error: String::new(),
        })
    })
}

fn set_status(f: impl FnOnce(&mut P2PStatus)) {
    if let Ok(mut s) = status().lock() {
        f(&mut s);
    }
}

/// `/status` 回显用的摘要（不含任何令牌）。
pub fn status_lines() -> Vec<(String, String)> {
    let mut v = Vec::new();
    let s = status().lock().unwrap();
    v.push(("p2p".into(), if s.enabled { "on".into() } else { "off".into() }));
    if s.enabled {
        v.push(("p2p_signal".into(), s.signal.clone()));
        v.push(("p2p_lan_only".into(), s.lan_only.to_string()));
        v.push(("p2p_joined".into(), s.joined.to_string()));
        v.push(("p2p_state".into(), s.pc_state.clone()));
        if !s.last_error.is_empty() {
            v.push(("p2p_error".into(), s.last_error.clone()));
        }
    }
    v
}

// ─────────────────────────────────────────────────────────────────────────────
// 配置（环境变量）
// ─────────────────────────────────────────────────────────────────────────────

/// WebRTC 是否启用：`STELARITH_P2P_SIGNAL` 非空才开。
pub fn p2p_enabled() -> bool {
    match std::env::var("STELARITH_P2P_SIGNAL") {
        Ok(s) => !s.trim().is_empty(),
        Err(_) => false,
    }
}

/// join 令牌：优先 `STELARITH_P2P_SECRET`，否则回退 `STELARITH_AGENT_SECRET`。
/// 与面板 / 信令边车约定一致——边车用 `HMAC(HMAC_KEY, "p2p:"+uid)` 派生并登记，
/// 被控端必须呈现同一令牌才能完成 `billdDeskJoin` 鉴权。

/// 自注册：启动时用设备密钥向网站要 p2p-signal（网站会把令牌注入信令边车），
/// 返回边车下发的 secret。失败（网站不可达/密钥错）回退环境变量 secret。
/// 解决「边车重启丢令牌 → agent JOIN 被拒」的冷启动问题。
fn self_register(uid: &str) -> Option<String> {
    // ⚠️ 不能在 tokio 上下文里 drop blocking reqwest（会 panic）。
    // 在独立 std 线程里跑同步请求，线程结束即释放，无 tokio 依赖。
    let uid_owned = uid.to_string();
    std::thread::spawn(move || {
        let ext_url = std::env::var("STELARITH_EXT_URL").ok().filter(|s| !s.trim().is_empty())?;
        let ext_secret = std::env::var("STELARITH_EXT_SECRET").ok().filter(|s| !s.trim().is_empty())?;
        let url = format!("{}/api/console/ext/p2p-signal?uid={}", ext_url.trim_end_matches('/'), uid_owned);
        let client = reqwest::blocking::Client::new();
        let resp = client
            .get(&url)
            .header("x-stelarith-device-secret", ext_secret)
            .timeout(std::time::Duration::from_secs(6))
            .send()
            .ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let json: serde_json::Value = resp.json().ok()?;
        json.get("secret").and_then(|s| s.as_str()).map(|s| s.to_string())
    })
    .join()
    .ok()
    .flatten()
}

fn p2p_secret() -> String {
    std::env::var("STELARITH_P2P_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("STELARITH_AGENT_SECRET").ok())
        .unwrap_or_default()
}

/// 解析 `STELARITH_P2P_ICE`：JSON 数组，元素 `{ urls, username?, credential? }`。
/// 为空 → 返回空（仅 host candidate，只能同网段）。绝不注入任何默认 STUN。
fn parse_ice_servers() -> Vec<RTCIceServer> {
    let raw = match std::env::var("STELARITH_P2P_ICE") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let arr = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Array(a)) => a,
        _ => {
            let _ = write_status("[p2p] STELARITH_P2P_ICE 不是合法 JSON 数组，忽略（仅局域网）");
            return Vec::new();
        }
    };
    arr.into_iter()
        .filter_map(|e| {
            let urls = match e.get("urls") {
                Some(Value::String(s)) => vec![s.clone()],
                Some(Value::Array(a)) => a
                    .iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect(),
                _ => return None,
            };
            if urls.is_empty() {
                return None;
            }
            Some(RTCIceServer {
                urls,
                username: e.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                credential: e
                    .get("credential")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// 信令信封（对齐 protocol.mjs / p2p-connector.js）
// ─────────────────────────────────────────────────────────────────────────────

/// 非加密、仅求唯一的 request_id（够用即可，不需要密码学强度）。
fn new_request_id() -> String {
    static C: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u64;
    let c = C.fetch_add(1, Ordering::Relaxed);
    format!("{:016x}-{:016x}-{:04x}-{}", nanos, pid, c & 0xffff, c)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 构造出站信封 `{ request_id, socket_id, time, data }`。
/// 信令边车对房间内事件只转发 `data` 字段（与浏览器连接器 `p.data` 读取一致），
/// 因此这里把真实载荷放进 `data`，其余字段留作排障。
fn envelope(room: &str, data: Value) -> Value {
    let _ = room; // 房名由边车按 socket 归属决定，不在每帧重复塞；保留参数以便将来扩展
    json!({
        "request_id": new_request_id(),
        "socket_id": "",
        "time": now_ms(),
        "data": data,
    })
}

/// 收包时取"真实载荷"：若外层有 `data` 对象（边车透传了完整信封）就剥一层，
/// 否则认为外层本身就是载荷。对"边车剥离 data 转发"与"边车透传整包"两种实现都兼容。
fn extract_data(p: &Payload) -> Option<Value> {
    let vals = match p {
        Payload::Text(v) => v,
        _ => return None,
    };
    let obj = vals.first()?;
    if let Some(Value::Object(d)) = obj.get("data") {
        return Some(Value::Object(d.clone()));
    }
    Some(obj.clone())
}

// ─────────────────────────────────────────────────────────────────────────────
// 入站事件
// ─────────────────────────────────────────────────────────────────────────────

enum InMsg {
    Joined(Payload),
    Offer(Payload),
    Candidate(Payload),
    StartRemote(Payload),
    Behavior(Payload),
    UpdateUser(Payload),
}

enum OutMsg {
    Emit(String, Value),
    Close,
}

// ─────────────────────────────────────────────────────────────────────────────
// 启动：信令（同步 socketio 客户端）+ 驱动（async webrtc）
// ─────────────────────────────────────────────────────────────────────────────

/// 在 agent 启动时调用。空信令地址则直接返回（不启用，回落 VNC/媒体直连）。
pub fn start_p2p(uid: String) {
    if !p2p_enabled() {
        let _ = write_status("[p2p] STELARITH_P2P_SIGNAL 未配置：不启用 WebRTC（保持 VNC/媒体直连）");
        return;
    }
    let signal = std::env::var("STELARITH_P2P_SIGNAL").unwrap().trim().to_string();
    let ice = parse_ice_servers();
    let lan_only = ice.is_empty();
    if lan_only {
        let _ = write_status(
            "[p2p] 未配置 STUN/TURN（STELARITH_P2P_ICE 为空）：当前仅局域网可达，跨网段/公网无法连接",
        );
    }
    // 自注册优先：向网站要 p2p-signal（注入边车令牌），拿不到再回退环境变量。
    let secret = self_register(&uid).unwrap_or_else(|| p2p_secret());
    let room = format!("room-{uid}");

    set_status(|s| {
        s.enabled = true;
        s.signal = signal.clone();
        s.lan_only = lan_only;
    });

    let (in_tx, in_rx) = mpsc::unbounded_channel::<InMsg>();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<OutMsg>();

    // 信令线程：持有 socketio 客户端，连上后发 JOIN，并持续把出站消息推出去。
    // 收包回调只做"转发到 in_tx"，真正的 webrtc 异步工作交给驱动任务。
    let sig_clone = signal.clone();
    let room_sig = room.clone();
    let join_payload = envelope(
        &room_sig,
        json!({
            "deskUserUuid": uid,
            "deskUserPassword": secret,
            "live_room_id": room_sig,
        }),
    );
    let emit_thread = std::thread::spawn(move || {
        let builder = ClientBuilder::new(sig_clone)
            .transport_type(TransportType::Websocket)
            .on("billdDeskJoined", {
                let tx = in_tx.clone();
                move |p: Payload, _| {
                    let _ = tx.send(InMsg::Joined(p));
                }
            })
            .on("billdDeskOffer", {
                let tx = in_tx.clone();
                move |p: Payload, _| {
                    let _ = tx.send(InMsg::Offer(p));
                }
            })
            .on("billdDeskCandidate", {
                let tx = in_tx.clone();
                move |p: Payload, _| {
                    let _ = tx.send(InMsg::Candidate(p));
                }
            })
            .on("billdDeskStartRemote", {
                let tx = in_tx.clone();
                move |p: Payload, _| {
                    let _ = tx.send(InMsg::StartRemote(p));
                }
            })
            .on("billdDeskBehavior", {
                let tx = in_tx.clone();
                move |p: Payload, _| {
                    let _ = tx.send(InMsg::Behavior(p));
                }
            })
            .on("billdDeskUpdateUser", {
                let tx = in_tx.clone();
                move |p: Payload, _| {
                    let _ = tx.send(InMsg::UpdateUser(p));
                }
            });

        let client = match builder.connect() {
            Ok(c) => c,
            Err(e) => {
                let _ = write_status(&format!("[p2p] 信令连接失败：{e}（WebRTC 不可用，回落 VNC/媒体直连）"));
                set_status(|s| s.last_error = format!("信令连接失败：{e}"));
                return;
            }
        };
        let _ = write_status(&format!("[p2p] 已连信令 {signal}；发送 JOIN room={room_sig}"));
        let _ = client.emit("billdDeskJoin", join_payload);

        // 出站循环（阻塞在 std 线程，用 blocking_recv 读 mpsc）。
        while let Some(m) = out_rx.blocking_recv() {
            match m {
                OutMsg::Emit(ev, payload) => {
                    if let Err(e) = client.emit(ev.as_str(), payload) {
                        let _ = write_status(&format!("[p2p] 信令发送失败：{e}"));
                    }
                }
                OutMsg::Close => break,
            }
        }
    });

    // 驱动任务：async，持有 pc，处理 Offer/Candidate/输入事件。
    tokio::spawn(async move {
        driver(in_rx, out_tx, room, ice).await;
    });

    let _ = emit_thread; // 连接生命周期与进程一致；这里不 join
}

struct P2PConfig {
    room: String,
    ice: Vec<RTCIceServer>,
}

async fn driver(mut in_rx: mpsc::UnboundedReceiver<InMsg>, out_tx: mpsc::UnboundedSender<OutMsg>, room: String, ice: Vec<RTCIceServer>) {
    let cfg = Arc::new(P2PConfig { room, ice });
    let mut pc: Option<Box<dyn PeerConnection + Send + Sync>> = None;

    while let Some(msg) = in_rx.recv().await {
        match msg {
            InMsg::Joined(p) => {
                // 边车的 JOINED 响应**无信封包装**（{code,msg,data} 顶层直发），
                // 不能走 extract_data（它会剥掉 data 层把 code 弄丢）。
                let top = match &p {
                    Payload::Text(v) => v.first().cloned(),
                    _ => None,
                };
                let code = top.as_ref()
                    .and_then(|d| d.get("code").cloned())
                    .and_then(|c| c.as_i64())
                    .unwrap_or(-1);
                if code == 0 {
                    set_status(|s| s.joined = true);
                    let _ = write_status("[p2p] JOIN 成功（code=0）");
                } else {
                    let msg = top.as_ref()
                        .and_then(|d| d.get("msg").and_then(|m| m.as_str()).map(|s| s.to_string()))
                        .unwrap_or_default();
                    set_status(|s| {
                        s.joined = false;
                        s.last_error = format!("JOIN 被拒：{msg}");
                    });
                    let _ = write_status(&format!("[p2p] JOIN 被拒：{msg}（WebRTC 不可用，回落 VNC/媒体直连）"));
                }
            }
            InMsg::Offer(p) => {
                let sdp = match extract_data(&p)
                    .and_then(|d| d.get("sdp").cloned())
                    .and_then(|s| s.get("sdp").and_then(|v| v.as_str()).map(|s| s.to_string()))
                {
                    Some(s) => s,
                    None => {
                        let _ = write_status("[p2p] Offer 缺少 sdp.sdp，忽略");
                        continue;
                    }
                };
                match ensure_pc(&cfg, &out_tx).await {
                    Ok(mut pc) => {
                        // 0.21：set_remote_description 接收 RTCSessionDescription（JSON 反序列化）。
                        // offer SDP 字符串直接放入 RTCSessionDescription 的 sdp 字段。
                        // 0.21：RTCSessionDescription 字段私有，须经 serde_json 反序列化构造。
                        let desc: RTCSessionDescription = match serde_json::from_value(json!({
                            "type": "offer",
                            "sdp": sdp,
                        })) {
                            Ok(d) => d,
                            Err(e) => {
                                let _ = write_status(&format!("[p2p] 解析 Offer SDP 失败：{e}"));
                                continue;
                            }
                        };
                        if let Err(e) = pc.set_remote_description(desc).await {
                            let _ = write_status(&format!("[p2p] setRemoteDescription 失败：{e}"));
                            continue;
                        }
                        // 挂桌面视频轨（ffmpeg → VP8/IVF）。失败只记日志，不阻断（数据通道仍可用）。
                        match spawn_desktop_capture().await {
                            Some(track) => {
                                if let Err(e) = pc.add_track(track).await {
                                    let _ = write_status(&format!("[p2p] addTrack 失败：{e}（无视频轨）"));
                                } else {
                                    let _ = write_status("[p2p] 桌面视频轨已挂（ffmpeg → VP9）");
                                }
                            }
                            None => {
                                let _ = write_status("[p2p] 无桌面视频轨（ffmpeg 缺失/会话0）：仅数据通道（输入可用，无画面）");
                            }
                        }
                        match pc.create_answer(None).await {
                            Ok(ans) => {
                                if let Err(e) = pc.set_local_description(ans.clone()).await {
                                    let _ = write_status(&format!("[p2p] setLocalDescription 失败：{e}"));
                                    continue;
                                }
                                let payload = envelope(&cfg.room, json!({ "sdp": { "type": "answer", "sdp": ans.sdp } }));
                                let _ = out_tx.send(OutMsg::Emit("billdDeskAnswer".into(), payload));
                                set_status(|s| s.pc_state = "answer-sent".into());
                                let _ = write_status("[p2p] 已发 Answer（等待连通）");
                            }
                            Err(e) => {
                                let _ = write_status(&format!("[p2p] createAnswer 失败：{e}"));
                                set_status(|s| s.last_error = format!("createAnswer 失败：{e}"));
                            }
                        }
                    }
                    Err(e) => {
                        let _ = write_status(&format!("[p2p] 建立 PeerConnection 失败：{e}"));
                        set_status(|s| s.last_error = format!("建立 PC 失败：{e}"));
                    }
                }
            }
            InMsg::Candidate(p) => {
                let init: RTCIceCandidateInit = match extract_data(&p)
                    .and_then(|d| d.get("candidate").cloned())
                    .and_then(|c| serde_json::from_value(c).ok())
                {
                    Some(i) => i,
                    None => continue,
                };
                if let Some(pc) = pc.as_mut() {
                    if let Err(e) = pc.add_ice_candidate(init).await {
                        let _ = write_status(&format!("[p2p] addIceCandidate 失败：{e}"));
                    }
                }
            }
            InMsg::StartRemote(_) => {
                // 被控侧由 Offer 驱动；StartRemote 是主控的"准备"信号，收到即可，无需动作。
                let _ = write_status("[p2p] 收到 billdDeskStartRemote（等待 Offer）");
            }
            InMsg::Behavior(p) => {
                if let Some(d) = extract_data(&p) {
                    dispatch_input(&d);
                }
            }
            InMsg::UpdateUser(_) => {}
        }
    }
}

/// 建立（或复用已建）PeerConnection，挂好 ICE / DataChannel 回调。
/// 0.21 重构（2026-09-26）：PeerConnectionBuilder + handler trait + trickle ICE。
/// 被控侧只发桌面视频（VP8），另开 DataChannel 收输入事件（Behavior）。
#[derive(Clone)]
struct PCState {
    out_tx: mpsc::UnboundedSender<OutMsg>,
    room: String,
}

#[async_trait::async_trait]
impl PeerConnectionEventHandler for PCState {
    /// trickle ICE：每个新 candidate 立即经信令发给对端（billdDeskCandidate）。
    async fn on_ice_candidate(&self, event: webrtc::peer_connection::RTCPeerConnectionIceEvent) {
        let room = self.room.clone();
        if let Ok(v) = serde_json::to_value(&event.candidate) {
            let payload = envelope(&room, json!({ "candidate": v }));
            let _ = self.out_tx.send(OutMsg::Emit("billdDeskCandidate".into(), payload));
        }
    }
}

async fn ensure_pc(
    cfg: &Arc<P2PConfig>,
    out_tx: &mpsc::UnboundedSender<OutMsg>,
) -> Result<Box<dyn PeerConnection + Send + Sync>, String> {
    let mut m = MediaEngine::default();
    m.register_default_codecs().map_err(|e| format!("默认编解码注册失败：{e}"))?;

    let ice_servers: Vec<RTCIceServer> = cfg.ice.clone();
    let config = RTCConfigurationBuilder::new()
        .with_ice_servers(ice_servers)
        .build();

    let runtime: Arc<dyn Runtime> = Arc::new(TokioRuntime);
    let state = PCState { out_tx: out_tx.clone(), room: cfg.room.clone() };

    let pc_raw = PeerConnectionBuilder::new()
        .with_configuration(config)
        .with_media_engine(m)
        .with_handler(Arc::new(state) as Arc<dyn PeerConnectionEventHandler>)
        .with_runtime(runtime.clone() as Arc<dyn webrtc::runtime::Runtime>)
        .with_udp_addrs(vec!["127.0.0.1:0".to_string()])
        .build()
        .await
        .map_err(|e| format!("PeerConnection 构建失败：{e}"))?;
    Ok(Box::new(pc_raw))
}
// ─────────────────────────────────────────────────────────────────────────────
// 桌面采集：沿用项目已有的 ffmpeg 做法（gdigrab → libvpx → IVF 裸帧 → TrackLocal）
// ─────────────────────────────────────────────────────────────────────────────

/// 起 ffmpeg 把桌面编码成 VP8/IVF 写到 stdout，另起任务逐帧读入 `TrackLocalStaticSample`。
/// 失败（ffmpeg 缺失 / 不可达）返回 None —— 此时 WebRTC 仍建立，只是没有视频轨。
///
/// ⚠️ 代理若在会话 0（SYSTEM 服务）运行，gdigrab 可能抓不到交互桌面，这是运行时限制，
/// 不是代码问题；无画面时数据通道（输入控制）依然可用。

/// 拉监控参数（截图/远控编码）：经设备密钥 GET /api/console/ext/monitor-config。
/// 失败（网站不可达/密钥错）返回默认值——绝不因配置失败阻断远控。
async fn fetch_monitor_params() -> (String, u32, u32, String) {
    // (codec, bitrate_kbps, fps, resolution) 默认 vp9/600/30/1080p
    let ext_url = std::env::var("STELARITH_EXT_URL").ok().filter(|s| !s.trim().is_empty());
    let ext_secret = std::env::var("STELARITH_EXT_SECRET").ok().filter(|s| !s.trim().is_empty());
    let (Some(base), Some(sec)) = (ext_url, ext_secret) else {
        return ("vp9".into(), 600, 30, "1080p".into());
    };
    let url = format!("{}/api/console/ext/monitor-config", base.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = match client
        .get(&url)
        .header("x-stelarith-device-secret", sec)
        .timeout(std::time::Duration::from_secs(4))
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return ("vp9".into(), 600, 30, "1080p".into()),
    };
    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        _ => return ("vp9".into(), 600, 30, "1080p".into()),
    };
    let cfg = json.get("config").cloned().unwrap_or(json);
    let s = |k: &str, d: &str| cfg.get(k).and_then(|v| v.as_str()).map(|x| x.to_string()).filter(|x| !x.is_empty()).unwrap_or_else(|| d.to_string());
    let n = |k: &str, d: u32| cfg.get(k).and_then(|v| v.as_u64()).map(|x| x as u32).filter(|x| *x > 0).unwrap_or(d);
    (s("video_codec", "vp9"), n("video_bitrate_kbps", 600), n("video_fps", 30), s("video_resolution", "1080p"))
}


/// ffmpeg 命令构造（Windows 带 CREATE_NO_WINDOW，不弹控制台窗口）。
fn ffmpeg_cmd_no_window(ff: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = tokio::process::Command::new(ff);
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW
        c
    }
    #[cfg(not(windows))]
    {
        tokio::process::Command::new(ff)
    }
}

async fn spawn_desktop_capture() -> Option<Arc<dyn TrackLocal>> {
    let ff = std::env::var("STELARITH_FFMPEG")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "ffmpeg".into());
    // 监控参数（服务端配置，拉不到用默认）：codec/码率/帧率/分辨率。
    let (_codec, bitrate_kbps, fps, resolution) = fetch_monitor_params().await;
    let (width, height) = match resolution.as_str() {
        "720p" => ("1280", "720"),
        "480p" => ("854", "480"),
        _ => ("1920", "1080"),
    };
    let fps_s = fps.to_string();
    let bitrate_s = format!("{}k", bitrate_kbps);

    // 0.21：构造 MediaStreamTrack（VP9 编码 + 随机 SSRC）再包成 TrackLocalStaticSample。
    // VP9（payload 98）≈ H265 压缩率的 70-80%，浏览器 WebRTC 全兼容（H265 仅 Safari）。
    let video_codec = RTCRtpCodec {
        mime_type: "video/VP9".into(),
        clock_rate: 90000,
        sdp_fmtp_line: "profile-id=0".into(),
        ..Default::default()
    };
    let ssrc: u32 = rand::random();
    let mst = MediaStreamTrack::new(
        "stelarith-desktop".to_string(),
        "video".to_string(),
        "stelarith-desktop".to_string(),
        RtpCodecKind::Video,
        vec![RTCRtpEncodingParameters {
            rtp_coding_parameters: RTCRtpCodingParameters {
                ssrc: Some(ssrc),
                ..Default::default()
            },
            codec: video_codec,
            ..Default::default()
        }],
    );
    let track_arc: Arc<TrackLocalStaticSample> = Arc::new(
        TrackLocalStaticSample::new(Instant::now(), mst).ok()?,
    );
    let track: Arc<dyn TrackLocal> = track_arc.clone() as Arc<dyn TrackLocal>;
    let track_out = track_arc.clone();
    let ssrc: SSRC = ssrc;
    let payload_type: PayloadType = 98;

    // 0.21：用 tokio::process（stdout 是 AsyncRead，read_exact 可直接 await）。
    let mut child = ffmpeg_cmd_no_window(&ff)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "gdigrab",
            "-i",
            "desktop",
            "-pix_fmt",
            "yuv420p",
            "-r",
            fps_s.as_str(),
            "-vf",
            &format!("scale='min({},ih)':-2", width),
            "-c:v",
            "libvpx-vp9",
            "-b:v",
            bitrate_s.as_str(),
            "-deadline",
            "realtime",
            "-cpu-used",
            "6",
            "-row-mt",
            "1",
            "-f",
            "ivf",
            "pipe:1",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let mut out = child.stdout.take()?;
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        // 跳过 32 字节 IVF 文件头，之后每帧：12 字节帧头（4 字节大小 LE + 8 字节时间戳）+ 帧数据。
        let mut header = [0u8; 32];
        if out.read_exact(&mut header).await.is_err() {
            return;
        }
        let mut size_buf = [0u8; 4];
        loop {
            if out.read_exact(&mut size_buf).await.is_err() {
                break;
            }
            let size = u32::from_le_bytes(size_buf) as usize;
            if size == 0 || size > 5_000_000 {
                break;
            }
            let mut ts = [0u8; 8];
            if out.read_exact(&mut ts).await.is_err() {
                break;
            }
            let mut frame = vec![0u8; size];
            if out.read_exact(&mut frame).await.is_err() {
                break;
            }
            let sample = Sample {
                data: bytes::Bytes::from(frame),
                timestamp: Instant::now(),
                duration: Duration::from_millis(40),
                packet_timestamp: 0,
                prev_dropped_packets: 0,
                prev_padding_packets: 0,
            };
            // 0.21：write_sample(ssrc, payload_type, sample, extensions)
            if track_out.write_sample(ssrc, payload_type, &sample, &[]).await.is_err() {
                break;
            }
        }
    });
    Some(track)
}

// ─────────────────────────────────────────────────────────────────────────────
// 输入注入（Windows）
// ─────────────────────────────────────────────────────────────────────────────

/// 收到输入事件（来自 DataChannel 或 billdDeskBehavior），注入本机。
/// 事件形状（参考面板 connector 的下发）：
///   { "type": "mousemove"|"mousedown"|"mouseup"|"wheel"|"keydown"|"keyup", x?, y?, dy?, key? }
fn dispatch_input(ev: &Value) {
    let kind = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
    #[cfg(windows)]
    {
        inject_input(ev, kind);
    }
    #[cfg(not(windows))]
    {
        let _ = write_status(&format!("[p2p] 收到输入事件(非 Windows 平台，仅记录)：{kind} {ev}"));
    }
}

#[cfg(windows)]
fn inject_input(ev: &Value, kind: &str) {
    use std::mem;
    use winapi::um::winuser::*;
    match kind {
        "mousemove" => {
            let x = ev.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0) as i32;
            let y = ev.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0) as i32;
            send_mouse(MOUSEEVENTF_MOVE, x, y, 0);
        }
        "mousedown" => send_mouse(MOUSEEVENTF_LEFTDOWN, 0, 0, 0),
        "mouseup" => send_mouse(MOUSEEVENTF_LEFTUP, 0, 0, 0),
        "wheel" => {
            let dy = ev.get("dy").and_then(|v| v.as_f64()).unwrap_or(0.0) as i32;
            send_mouse(MOUSEEVENTF_WHEEL, 0, 0, dy as u32);
        }
        "keydown" | "keyup" => {
            if let Some(k) = ev.get("key").and_then(|v| v.as_str()) {
                let vk = key_to_vk(k);
                let flags = if kind == "keyup" { KEYEVENTF_KEYUP } else { 0 };
                send_key(vk, flags);
            }
        }
        _ => {
            let _ = write_status(&format!("[p2p] 未识别输入事件：{kind}"));
        }
    }
}

#[cfg(windows)]
fn send_mouse(flags: u32, dx: i32, dy: i32, wheel: u32) {
    unsafe {
        let mut input: winapi::um::winuser::INPUT = std::mem::zeroed();
        input.type_ = winapi::um::winuser::INPUT_MOUSE;
        input.u.mi_mut().dx = dx;
        input.u.mi_mut().dy = dy;
        input.u.mi_mut().mouseData = wheel;
        input.u.mi_mut().dwFlags = flags;
        input.u.mi_mut().time = 0;
        input.u.mi_mut().dwExtraInfo = 0;
        winapi::um::winuser::SendInput(1, &mut input, std::mem::size_of::<winapi::um::winuser::INPUT>() as i32);
    }
}

#[cfg(windows)]
fn send_key(vk: u16, flags: u32) {
    unsafe {
        let mut input: winapi::um::winuser::INPUT = std::mem::zeroed();
        input.type_ = winapi::um::winuser::INPUT_KEYBOARD;
        input.u.ki_mut().wVk = vk;
        input.u.ki_mut().wScan = 0;
        input.u.ki_mut().dwFlags = flags;
        input.u.ki_mut().time = 0;
        input.u.ki_mut().dwExtraInfo = 0;
        winapi::um::winuser::SendInput(1, &mut input, std::mem::size_of::<winapi::um::winuser::INPUT>() as i32);
    }
}

#[cfg(windows)]
fn key_to_vk(k: &str) -> u16 {
    match k.to_ascii_lowercase().as_str() {
        "enter" | "return" => 0x0D,
        "backspace" => 0x08,
        "tab" => 0x09,
        "escape" | "esc" => 0x1B,
        "space" => 0x20,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        "delete" => 0x2E,
        "home" => 0x24,
        "end" => 0x23,
        "f1" => 0x70,
        "f2" => 0x71,
        "f3" => 0x72,
        "f4" => 0x73,
        "f5" => 0x74,
        "f6" => 0x75,
        "f7" => 0x76,
        "f8" => 0x77,
        "f9" => 0x78,
        "f10" => 0x79,
        "f11" => 0x7A,
        "f12" => 0x7B,
        other => {
            let b = other.as_bytes();
            if b.len() == 1 {
                let c = b[0].to_ascii_uppercase();
                if c.is_ascii_alphanumeric() {
                    c as u16
                } else {
                    0
                }
            } else {
                0
            }
        }
    }
}
