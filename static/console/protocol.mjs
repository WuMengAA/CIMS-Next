// 星集控 P2P 协议常量（单一事实源 · 方案2）
// ----------------------------------------------------------------
// 同时被 Node 信令边车 (server.mjs) 与浏览器连接器 (p2p-connector.js) 引用，
// 杜绝「事件名/信封格式在两端各写一份」的漂移风险。
//
// 完全对齐 billd-desk-server/src/types/websocket.ts 的 WsMsgTypeEnum。

/** billdDesk* 事件名 —— 全工程唯一出处 */
export const EVENTS = {
  JOIN: 'billdDeskJoin',
  JOINED: 'billdDeskJoined',
  START_REMOTE: 'billdDeskStartRemote',
  START_REMOTE_RESULT: 'billdDeskStartRemoteResult',
  OFFER: 'billdDeskOffer',
  ANSWER: 'billdDeskAnswer',
  CANDIDATE: 'billdDeskCandidate',
  BEHAVIOR: 'billdDeskBehavior',
  UPDATE_USER: 'billdDeskUpdateUser',
};

/** 需在房间内且已鉴权才转发的事件（JOIN/JOINED 除外） */
export const RELAY_EVENTS = [
  EVENTS.START_REMOTE,
  EVENTS.START_REMOTE_RESULT,
  EVENTS.OFFER,
  EVENTS.ANSWER,
  EVENTS.CANDIDATE,
  EVENTS.BEHAVIOR,
  EVENTS.UPDATE_USER,
];

/** 客户端 → 服务器 信封（对齐 billd-desk IReqWsFormat<T>） */
export function envelope(data, extra = {}) {
  return {
    request_id: extra.request_id || uid(),
    socket_id: extra.socket_id,
    time: Date.now(),
    data,
  };
}

/** 服务器 → 客户端 的 billdDesk 回执（{code,msg,data} 三件套） */
export function reply(code, msg, data = {}) {
  return { code, msg, data };
}

// 具名导出：p2p-connector.js 第 21 行 `import { ..., uid }` 直接依赖它。
// 少了这个 export 就是 **ESM 链接期**报错（"does not provide an export named 'uid'"），
// 整个连接器在浏览器里加载不了 —— 语法检查查不出来（node --check 不解析导入）。
// 末尾的 globalThis.StelarithP2PProtocol 也把它列为公开成员，两处必须一致。
export function uid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 房间名工厂（统一三方对“房名格式”的认知）。
 *
 * 设备码（deviceUid）→ 房间名（roomId）的映射只在协议层定义一次，
 * 信令边车、SvelteKit 接缝、浏览器连接器、被控端都调用 roomKey(uid)，
 * 避免 “room-<uid>” 这个字符串分散在四端各写一遍。
 */
export function roomKey(deviceUid) {
  return 'room-' + String(deviceUid);
}

// 经典 <script> 兜底：UMD 连接器在无打包环境下也能拿到常量
if (typeof globalThis !== 'undefined') {
  globalThis.StelarithP2PProtocol = { EVENTS, RELAY_EVENTS, envelope, reply, uid };
}
