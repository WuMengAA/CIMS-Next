/*
 * 星集控 P2P 信令桥（面板 api.js 接入点 · 方案2）
 * ----------------------------------------------------------------
 * 让现有零依赖面板（api.js/app.js）也能一行拿到信令配置并发起远控，
 * 无需构建步骤：动态 import 连接器（浏览器原生 ESM）。
 *
 * 用法（经典脚本，挂 window.P2PSignal）：
 *   P2PSignal.getConfig(uid)        → { signalUrl, roomId, secret }
 *   P2PSignal.createController(uid) → 已连接并发起 offer 的 StelarithP2P 实例
 * SvelteKit 迁移后可直接 `import { P2PSignal } from './p2p.js'`。
 */
(function (global) {
  'use strict';

  async function getConfig(uid) {
    const r = await fetch(`/api/console/ext/p2p-signal?uid=${encodeURIComponent(uid)}`);
    if (!r.ok) throw new Error('获取信令配置失败：' + r.status);
    return r.json();
  }

  async function createController(uid, opts) {
    const cfg = await getConfig(uid);
    const mod = await import('./p2p-connector.js');
    const StelarithP2P = mod.StelarithP2P || mod.default;
    const p2p = new StelarithP2P({
      signalUrl: cfg.signalUrl,
      deviceUid: uid,
      secret: cfg.secret,
      roomId: cfg.roomId,
    });
    // 兑现上面注释里的契约：「已连接并发起 offer」。
    // ⚠️ 若调用方需要先挂 onTrack/on('startRemote') 再协商，请改用
    //    getConfig() + 自建实例，不要把本函数当构造器用（会与协商竞态）。
    await p2p.connect();
    await p2p.startController(opts && opts.localStream ? opts.localStream : null);
    return p2p;
  }

  const P2PSignal = { getConfig, createController };
  global.P2PSignal = P2PSignal;
  if (typeof module !== 'undefined' && module.exports) module.exports = P2PSignal;
})(typeof window !== 'undefined' ? window : globalThis);
