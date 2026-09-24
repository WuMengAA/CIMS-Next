"use strict";
/**
 * 星璃站点 · 崩溃护栏（Node preload）
 * ============================================================================
 * 为什么需要它（2026-09-24 实测诊断，证据在 stelarith.out.log / stelarith-launcher.log）：
 *
 *   站点由 `sirv` 服务 `build/client`。sirv 在**启动时**扫描一次目录、把文件名与
 *   size/mtime 存进 FILES 表，之后按请求名去开 ReadStream。而：
 *     · `pnpm build` 会**原地重写** `build/client`，`_app/immutable/**` 是带内容 hash
 *       的文件名 —— 构建后旧名字就不存在了；
 *     · `sync-console.mjs` 会**重写** `.br/.gz` 旁文件 —— 重写那一瞬旁文件是缺失的。
 *   于是浏览器请求一个"启动时快照里有、现在磁盘上没了"的文件时：
 *
 *       Error: ENOENT: no such file or directory, open '...\build\client\console\index.html'
 *       Emitted 'error' event on ReadStream instance
 *       node:events:486  throw er; // Unhandled 'error' event
 *
 *   ——**整个 node 进程当场退出**。注意这不是"某个响应坏掉"，而是**站点全灭**。
 *   启动器 `run-prod.bat` 10 秒后重拉；若此时构建还没完，`build/index.js` 也还不存在
 *   → `Cannot find module` → 再等 10 秒 → 于是一串连崩（实测连续 22 次 / 24 次），
 *   **用户那几分钟完全点不动**。
 *
 * 它做什么：
 *   安装一个 `uncaughtException` 处理器，**只**吞掉上面这一类"文件被构建/同步器换掉了"
 *   的瞬时错误（记日志后让服务继续跑）。其余任何未捕获异常**照旧退出**——
 *   否则会把真 bug 藏起来，那比崩一次更糟。
 *   （退出是安全的：启动器本来就有 10s 退避自愈循环。）
 *
 * 判定规则（刻意保守，宁可少吞不可多吞）：
 *   ① `code === 'ENOENT'` **且** `err.path` 落在 `build/client` 之内 → 吞。
 *      （Node 的 fs 错误一定带 path，所以不用"看栈猜"，避免误吞别处的 ENOENT，如数据库文件。）
 *   ② `ECONNRESET / EPIPE / ECONNABORTED` **且** 真正的**栈帧行**里看得出是 socket/读流中断 → 吞。
 *      客户端中途断开是正常现象，不该拖垮服务。栈帧里看不出来就不吞。
 *      ⚠️ 只看 `at ...` 栈帧行，**绝不看错误消息**——消息里出现 "socket" 不算证据。
 *      为此不能用"丢掉栈的第一行"来去消息：对 eval / code frame，Node 会在最前面
 *      贴出错的源码行与插入符，消息其实在第 3 行。自测时正是这条把冒牌错误放行了。
 *   ③ 其余一律 `exit(1)`，与不加护栏时的行为完全一致。
 *
 * 熔断：30 秒内吞超过 100 次 → 判定为"持续异常"而非"瞬时抖动"，主动 exit(1) 交还启动器。
 *
 * 用法（无需改代码，由 run-prod.bat 预载）：
 *   node -r <本文件> -r D:\Stelarith\loadenv.cjs build\index.js
 *
 * 日志：默认 <本文件同级>/stelarith-crashguard.log，超过 1MB 轮转一代。
 *   可用环境变量 `STELARITH_CRASHGUARD_LOG` 重定向——**这是为了让护栏本身可被测试**，
 *   否则验证一个规则就得往线上日志里灌人造错误（和 selfcheck 的 STELARITH_SELFCHECK_LOG_DIR 同一考虑）。
 *
 * ⚠️ 本文件由 node 同步 require（CJS），**绝不能**在加载期抛异常 —— 那会让站点起不来。
 *    所以全文包在 try/catch 里，且只做两件事：注册处理器 + 写一行加载标记。
 * ============================================================================
 */

const fs = require("node:fs");
const path = require("node:path");

try {
  const CLIENT_DIR = path.resolve(__dirname, "build", "client");
  const LOG = process.env.STELARITH_CRASHGUARD_LOG
    ? path.resolve(process.env.STELARITH_CRASHGUARD_LOG)
    : path.join(__dirname, "stelarith-crashguard.log");
  const MAX_LOG = 1024 * 1024;
  const WINDOW_MS = 30 * 1000;
  const MAX_SWALLOW = 100;

  function log(line) {
    try {
      if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX_LOG) {
        fs.renameSync(LOG, LOG + ".1"); // 只留一代，别把盘吃光
      }
      fs.appendFileSync(LOG, "[" + new Date().toLocaleString("zh-CN") + "] " + line + "\n", "utf8");
    } catch (_) {
      /* 写日志失败绝不能反过来把进程搞死 */
    }
  }

  function underClientDir(p) {
    if (typeof p !== "string" || !p) return false;
    let r;
    try {
      r = path.resolve(p).toLowerCase();
    } catch (_) {
      return false;
    }
    const base = CLIENT_DIR.toLowerCase();
    return r === base || r.startsWith(base + path.sep);
  }

  // 只取**真正的栈帧行**（`at ...`）。
  // ⚠️ 别用 "丢掉第一行 = 去掉消息" 这种写法 —— 2026-09-24 被它骗过一次：
  //   Node 对 eval / 带 code frame 的代码会在栈最前面**贴上出错的那行源码 + 插入符**，于是
  //     const e=new Error("not-a-socket-error");...   ← 第 0 行
  //                         ^                         ← 第 1 行
  //     (空行)                                        ← 第 2 行
  //     Error: not-a-socket-error                     ← 第 3 行：**消息还在**，slice(1) 根本删不掉
  //     at [eval]:1:9
  //   结果消息里的 "socket" 混进"栈帧"里，把冒牌错误当成了 socket 中断。
  //   过滤 `^\s*at\s` 同时对消息、code frame、空行免疫。
  function framesOnly(err) {
    return String((err && err.stack) || "")
      .split("\n")
      .filter(function (line) {
        return /^\s*at\s/.test(line);
      })
      .join("\n");
  }

  // 是不是「构建/同步器把正在服务的静态文件换掉了」这一类瞬时错误？
  function isTransientStaticMiss(err) {
    if (!err || typeof err !== "object") return false;
    const code = err.code;

    if (code === "ENOENT") {
      // 必须能确证是 build/client 之内的文件；看不出来就不吞（保守）
      return underClientDir(err.path);
    }

    if (code === "ECONNRESET" || code === "EPIPE" || code === "ECONNABORTED") {
      const frames = framesOnly(err);
      const matched = /onStreamRead|ReadStream|WriteStream|Socket|TCP/i.test(frames);
      // 只匹配**栈帧**，绝不匹配错误消息（消息里出现 "socket" 不算证据）
      if (process.env.STELARITH_CRASHGUARD_DEBUG) {
        log("[debug] code=" + code + " matched=" + matched + " frames=" + JSON.stringify(frames));
      }
      return matched;
    }

    return false;
  }

  let swallowTimes = [];

  process.on("uncaughtException", function (err) {
    try {
      if (isTransientStaticMiss(err)) {
        const now = Date.now();
        swallowTimes = swallowTimes.filter(function (t) {
          return now - t < WINDOW_MS;
        });
        swallowTimes.push(now);
        log(
          "[guard] 拦下瞬时错误 code=" +
            err.code +
            " path=" +
            (err.path || "-") +
            "（本窗口第 " +
            swallowTimes.length +
            " 次）· 服务继续运行"
        );
        if (swallowTimes.length > MAX_SWALLOW) {
          log("[guard] " + WINDOW_MS / 1000 + "s 内瞬时错误超过 " + MAX_SWALLOW + " 次，判定为持续异常 → 主动退出，交还启动器");
          process.exit(1);
        }
        return; // ← 不退出，这就是护栏的全部意义
      }
      log("[guard] 非瞬时未捕获异常，按原行为退出：\n" + (err && err.stack ? err.stack : String(err)));
    } catch (e) {
      try {
        log("[guard] 护栏自身异常（按原行为退出）：" + (e && e.stack ? e.stack : String(e)));
      } catch (_) {}
    }
    process.exit(1);
  });

  log("[guard] 已加载 pid=" + process.pid + " · 静态根=" + CLIENT_DIR + " · 日志=" + LOG);
} catch (e) {
  // 加载期出错也不能让站点起不来：放弃护栏，仅尽可能留个痕迹
  try {
    fs.appendFileSync(
      path.join(__dirname, "stelarith-crashguard.log"),
      "[" + new Date().toLocaleString("zh-CN") + "] [guard] 加载失败，已放弃护栏：" + (e && e.stack ? e.stack : String(e)) + "\n",
      "utf8"
    );
  } catch (_) {}
}
