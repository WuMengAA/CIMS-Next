// 星集控 远程控制视图（简洁版 · 方案2 原生 WebRTC，替换 noVNC iframe）
// ------------------------------------------------------------------
// 设计原则（用户要求：信息辨识度优先、减少切换、避免相似功能并列）：
//   单一画面 + 顶部设备码/连接 + 底部紧凑控制条，所有信息在一屏内，
//   不拆成多页面/多面板。鼠标在画面上直接下发，键盘走弹窗，无需额外界面。
import { StelarithP2P } from './p2p-connector.js';

const $ = (id) => document.getElementById(id);
const els = {
  uid: $('uid'), connect: $('connect'), disconnect: $('disconnect'),
  status: $('status'), video: $('screen'), placeholder: $('placeholder'),
  kbd: $('kbd'), cad: $('cad'), fs: $('fs'), quality: $('quality'),
};

let p2p = null;
let controlling = false;

function setStatus(text, bad = false) {
  els.status.className = 'status' + (bad ? ' bad' : '');
  els.status.innerHTML = bad ? `● <b>${text}</b>` : `● <b>${text}</b>`;
}

async function getConfig(uid) {
  const r = await fetch(`/api/console/ext/p2p-signal?uid=${encodeURIComponent(uid)}`);
  if (!r.ok) throw new Error('获取信令配置失败：' + r.status);
  return r.json();
}

async function connect() {
  const uid = els.uid.value.trim();
  if (!uid) { setStatus('请输入设备码', true); return; }
  try {
    setStatus('正在获取信令…');
    const cfg = await getConfig(uid);
    p2p = new StelarithP2P({ signalUrl: cfg.signalUrl, deviceUid: uid, secret: cfg.secret, roomId: cfg.roomId });
    p2p.onTrack((stream) => {
      els.video.srcObject = stream;
      els.video.style.display = 'block';
      els.placeholder.style.display = 'none';
    });
    p2p.on('startRemote', () => setStatus('对方已接受远控'));
    await p2p.connect();
    setStatus('已入房间，发起远控…');
    await p2p.startController(null); // 仅需接收教室桌面流，无需本机摄像头
    controlling = true;
    setStatus('远控中');
  } catch (e) {
    setStatus('连接失败：' + (e && e.message), true);
    console.error(e);
  }
}

function disconnect() {
  if (p2p) { p2p.close(); p2p = null; }
  controlling = false;
  els.video.srcObject = null;
  els.video.style.display = 'none';
  els.placeholder.style.display = 'block';
  setStatus('已断开');
}

// ---- 鼠标控制：移动/点击直接下发（相对坐标，被控端按比例还原）----
function relCoords(e) {
  const r = els.video.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  };
}
els.video.addEventListener('mousemove', (e) => {
  if (!controlling) return;
  const { x, y } = relCoords(e);
  p2p.sendBehavior({ type: 'mousemove', x, y });
});
els.video.addEventListener('mousedown', (e) => {
  if (!controlling) return;
  const { x, y } = relCoords(e);
  p2p.sendBehavior({ type: 'mousedown', button: e.button, x, y });
});
els.video.addEventListener('mouseup', (e) => {
  if (!controlling) return;
  const { x, y } = relCoords(e);
  p2p.sendBehavior({ type: 'mouseup', button: e.button, x, y });
});

// ---- 键盘：弹窗输入，逐字符下发 ----
els.kbd.addEventListener('click', () => {
  if (!controlling) { setStatus('请先连接', true); return; }
  const txt = prompt('输入要发送的字符：');
  if (txt) for (const ch of txt) p2p.sendBehavior({ type: 'key', key: ch });
});
els.cad.addEventListener('click', () => {
  if (!controlling) return;
  p2p.sendBehavior({ type: 'cad' }); // 组合键：Ctrl+Alt+Del
});

// ---- 全屏 ----
els.fs.addEventListener('click', () => {
  if (els.video.requestFullscreen) els.video.requestFullscreen();
});

// ---- 画质（示意：切换 STUN/TURN 意图；真实质量由被控端编码参数决定）----
els.quality.addEventListener('change', () => {
  // 预留：未来把 quality 透传给被控端以调整码率/分辨率
  if (p2p) p2p.sendBehavior({ type: 'quality', value: els.quality.value });
});

els.connect.addEventListener('click', connect);
els.disconnect.addEventListener('click', disconnect);

// 支持 ?uid= 直接预填
const q = new URLSearchParams(location.search);
if (q.get('uid')) els.uid.value = q.get('uid');
