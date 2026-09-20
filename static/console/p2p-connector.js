/*
 * Stelarith P2P 连接器（面板侧 · 方案2）
 * ---------------------------------------------------------------
 * 职责：让零依赖面板（static/console）也能做"面板内无感远控"。
 *   - 从信令边车自带地址懒加载 socket.io 客户端（/socket.io/socket.io.js），
 *     自身零 npm 依赖，符合面板"零依赖"铁律。
 *   - 用 billdDesk* 协议完成：join(令牌鉴权) → StartRemote → Offer/Answer/Candidate 转发。
 *   - 封装 RTCPeerConnection：自动协商 + ICE 收集 + 远端流回调。
 *
 * 事件名与信封格式统一来自 ./protocol.mjs（单一事实源），与信令边车共用，
 * 不在本文件再写一份字面量，避免协议漂移。
 *
 * 用法（ES module，面板 api.js 用）：
 *   import { StelarithP2P } from './p2p-connector.js';
 *   const p2p = new StelarithP2P({ signalUrl, deviceUid, secret, roomId });
 *   await p2p.connect();
 *   const pc = await p2p.startController(localStream);   // 主控：发 offer
 *   p2p.onRemoteOffer(async (offer) => p2p.startControlled(offer, desktopStream)); // 被控
 *   p2p.onTrack((stream) => videoEl.srcObject = stream);
 */
import { EVENTS, envelope, roomKey, uid } from './protocol.mjs';

(function (global) {
  'use strict';

  // 懒加载 socket.io 客户端（由信令边车自动提供，零额外依赖）
  function ensureIo(signalUrl) {
    return new Promise((resolve, reject) => {
      if (global.io) return resolve(global.io);
      const s = document.createElement('script');
      s.src = signalUrl.replace(/\/$/, '') + '/socket.io/socket.io.js';
      s.onload = () => (global.io ? resolve(global.io) : reject(new Error('socket.io client not found')));
      s.onerror = () => reject(new Error('failed to load socket.io client from ' + s.src));
      document.head.appendChild(s);
    });
  }

  // 入站事件 → 本地回调名 的声明式映射（替代原先 6 条并列 socket.on）
  // 注：CANDIDATE 需调用实例方法（addIceCandidate），单独在 connect() 里挂，避免类外 this 丢失。
  const INBOUND = {
    [EVENTS.OFFER]: 'remoteOffer',
    [EVENTS.ANSWER]: 'remoteAnswer',
    [EVENTS.START_REMOTE]: 'startRemote',
    [EVENTS.BEHAVIOR]: 'behavior',
  };

  class StelarithP2P {
    constructor(opts) {
      // 单一配置对象：归一化一次，内部统一取用，避免散落字段
      this.config = {
        signalUrl: String(opts.signalUrl || ''),
        deviceUid: String(opts.deviceUid || ''),       // 设备码（lab-pc-001）
        secret: String(opts.secret || ''),             // 媒体令牌（星集控 media_token）
        roomId: String(opts.roomId || roomKey(opts.deviceUid)),
        rtcConfig: opts.rtcConfig || { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      };
      // 便捷别名（公共 API），均派生自 config，不改单一来源
      this.signalUrl = this.config.signalUrl;
      this.deviceUid = this.config.deviceUid;
      this.secret = this.config.secret;
      this.roomId = this.config.roomId;
      this.rtcConfig = this.config.rtcConfig;

      this.socket = null;
      this.pc = null;
      this._dataChannel = null;
      this._handlers = {};
    }

    on(evt, fn) { (this._handlers[evt] || (this._handlers[evt] = [])).push(fn); return this; }
    emitLocal(evt, payload) { (this._handlers[evt] || []).forEach((f) => { try { f(payload); } catch (e) { console.error(e); } }); }

    // 统一信封发送：所有出站消息走这里，消除各方法里重复的 request_id/time/data 样板
    _send(event, payload) {
      this.socket.emit(event, envelope({ roomId: this.roomId, ...payload }));
    }

    async connect() {
      const io = await ensureIo(this.signalUrl);
      this.socket = io(this.signalUrl, { transports: ['websocket'], forceNew: true });
      return new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('join timeout')), 8000);
        this.socket.on('connect', () => {
          this._send(EVENTS.JOIN, { deskUserUuid: this.deviceUid, deskUserPassword: this.secret, live_room_id: this.roomId });
        });
        this.socket.on(EVENTS.JOINED, (resp) => {
          clearTimeout(to);
          if (resp && resp.code === 0) { this.emitLocal('joined', resp); resolve(resp); }
          else { reject(new Error('join rejected: ' + (resp && resp.msg))); this.socket.disconnect(); }
        });
        this.socket.on('connect_error', (e) => reject(e));
        // 声明式入站映射（INBOUND）替代 6 条并列 socket.on
        for (const [evt, localEvt] of Object.entries(INBOUND)) {
          this.socket.on(evt, (p) => this.emitLocal(localEvt, p && p.data));
        }
        // CANDIDATE 需调用实例方法，单独挂（避免类外 this 捕获问题）
        this.socket.on(EVENTS.CANDIDATE, (p) => this._onRemoteCandidate(p && p.data));
      });
    }

    _newPc() {
      const pc = new RTCPeerConnection(this.rtcConfig);
      this.pc = pc;
      pc.onicecandidate = (e) => {
        if (e.candidate) this._send(EVENTS.CANDIDATE, { candidate: e.candidate });
      };
      pc.ontrack = (e) => this.emitLocal('track', e.streams[0]);
      return pc;
    }

    async _onRemoteCandidate(data) {
      if (!data || !data.candidate || !this.pc) return;
      try { await this.pc.addIceCandidate(data.candidate); } catch (e) { console.error('addIceCandidate', e); }
    }

    // 主控：发 offer（localStream 可选，用于反向音视频/无则仅数据通道）
    async startController(localStream) {
      const pc = this._newPc();
      if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      this._dataChannel = pc.createDataChannel('stelarith-ctrl');
      this._wireDataChannel();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this._send(EVENTS.OFFER, { sdp: pc.localDescription });
      return pc;
    }

    // 被控：收到 offer → 回 answer，并发送桌面流
    async startControlled(remoteOffer, desktopStream) {
      const pc = this._newPc();
      if (desktopStream) desktopStream.getTracks().forEach((t) => pc.addTrack(t, desktopStream));
      pc.ondatachannel = (e) => { this._dataChannel = e.channel; this._wireDataChannel(); };
      await pc.setRemoteDescription(remoteOffer.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._send(EVENTS.ANSWER, { sdp: pc.localDescription });
      return pc;
    }

    // 主控收到 answer
    async acceptAnswer(remoteAnswer) {
      if (this.pc && remoteAnswer && remoteAnswer.sdp) {
        await this.pc.setRemoteDescription(remoteAnswer.sdp);
      }
    }

    _wireDataChannel() {
      const dc = this._dataChannel;
      if (!dc) return;
      dc.onopen = () => this.emitLocal('dataOpen', dc);
      dc.onmessage = (e) => this.emitLocal('data', e.data);
    }

    // 主控下发键鼠控制（billdDeskBehavior，与数据通道互补）
    sendBehavior(behavior) {
      this._send(EVENTS.BEHAVIOR, behavior);
    }

    sendData(msg) {
      if (this._dataChannel && this._dataChannel.readyState === 'open') this._dataChannel.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }

    close() {
      try { this.pc && this.pc.close(); } catch (e) {}
      try { this.socket && this.socket.disconnect(); } catch (e) {}
    }
  }

  // 同时支持 ESM（export）与 CommonJS（require）
  global.StelarithP2P = StelarithP2P;
  if (typeof module !== 'undefined' && module.exports) module.exports = StelarithP2P;
})(typeof window !== 'undefined' ? window : globalThis);

// ESM 具名导出（面板 api.js / 演示页 `import { StelarithP2P }` 用）
export const StelarithP2P = globalThis.StelarithP2P;
