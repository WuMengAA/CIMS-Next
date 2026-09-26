/**
 * 运行时数据路径 —— 全工程**唯一**允许出现 "content" / "uploads" 字面量的地方。
 *
 * ── 为什么需要这个文件（2026-09-26 立）────────────────────────────────────────
 * 在这之前，`path.resolve("content")` 散落在 **11 个**模块里，各自拼自己的子目录：
 *
 *   db.ts                 content/stelarith.db、content/users.json
 *   content-store.ts      content/**  +  uploads/**
 *   changelog.ts          content/changelog.json
 *   project-board.ts      content/project-boards.json
 *   rss.ts                content/**
 *   oauth-clients.ts      content/oauth-clients.json
 *   console-ext.ts        content/captures
 *   file-transfer.ts      content/files
 *   api/project-board/upload    uploads/
 *   api/project-board/download  uploads/
 *   routes/uploads/[filename]   uploads/
 *
 * 后果不是"不好看"，而是**环境隔离做不干净**：想给开发环境换一个数据目录，
 * 就得记得改 11 处；**漏掉任何一处，那部分数据都会悄悄写进生产目录**——
 * 而且不会有任何报错，只有事后对不上账时才发现（典型如"dev 传的图跑到了线上图床"）。
 *
 * ── 它做什么 ────────────────────────────────────────────────────────────────
 * ① 收口：路径的推导只写一次，子目录在这里定义好，调用方 import 即可；
 * ② 外置：数据根由 `STELARITH_DATA_ROOT` 决定。
 *
 * ── 缺省即生产，既有部署零变更（命名原则②：缺省态不写出来）─────────────────
 * 不配 `STELARITH_DATA_ROOT` 时，数据根就是工程根，于是：
 *
 *     CONTENT_DIR = <工程根>/content      ← 与历史完全一致
 *     UPLOADS_DIR = <工程根>/uploads      ← 与历史完全一致
 *
 * 开发环境只需把它指向别处（`.env.dev` 里 `STELARITH_DATA_ROOT=.dev-data`），
 * **content 与 uploads 会一起搬过去** —— 一个变量管两个目录，
 * 不会出现"库换了、上传目录没换"这种半搬状态。
 *
 * ⚠️ 铁律：任何模块要读写运行时数据，一律从此处 import。
 *    自检标准很直白 —— 如果你正打算手打第二个 "content" 字面量，那就是漏了。
 */
import path from "node:path";

/**
 * 数据根。缺省 `.`（工程根）。
 *
 * 之所以让它同时承载 content 与 uploads，而不是只指 content：
 * 这两者在本仓库里是**平级的顶层目录**（`content/` 与 `uploads/`），
 * 若只外置 content，uploads 就成了唯一还写死在工程根下的运行时数据 ——
 * 那正是"半搬状态"，也正是本文件要消灭的东西。
 */
export const DATA_ROOT: string = path.resolve(process.env.STELARITH_DATA_ROOT || ".");

/** 内容目录：Markdown / JSON / 以及 SQLite 数据库本体。 */
export const CONTENT_DIR: string = path.join(DATA_ROOT, "content");

/** 上传目录：媒体库 / 项目板上传件（历史遗留为顶层目录，非 content 子目录）。 */
export const UPLOADS_DIR: string = path.join(DATA_ROOT, "uploads");

/** SQLite 主库。文件名在各环境下**恒定**，环境差异由 DATA_ROOT 承载。 */
export const DB_FILE: string = path.join(CONTENT_DIR, "stelarith.db");

/** 首次启动的一次性用户迁移源（users 表为空时才读）。 */
export const USERS_JSON: string = path.join(CONTENT_DIR, "users.json");

/**
 * 本文件**刻意只收"根与顶层目录"**，不收各模块私有的子路径
 * （如 `content/captures`、`content/files`、`content/cache`、`content/archive`）。
 *
 * 理由：环境隔离所需的最小充分集就是 DATA_ROOT 一个变量，
 * 加上由它推导的 CONTENT_DIR / UPLOADS_DIR 两个目录。
 * 其余子目录都由模块自己 `path.join(CONTENT_DIR, "…")` 拼 —— 只要 CONTENT_DIR 是唯一的，
 * 那些子目录就自动跟着走，无需逐个登记。
 *
 * 把每个文件名都登记进来，只会让这个文件慢慢长成"所有路径大全"，
 * 反而没人愿意维护。收口的价值在**根唯一**，不在"清单完整"。
 */

/**
 * 启动标识行。用途见 docs/架构评估与落地路线.md 第 5.6 节：
 * 「一次启动只允许一个环境标识」——把实际读的数据根打出来，
 * 才能在事后回答"这条记录到底是哪个环境写的"。
 *
 * ⚠️ 环境标识**只认 STELARITH_ENV，不做推断**。
 * 早先的写法是"没设就按 NODE_ENV 猜 prod/dev"，那比留空更糟：
 * 日志上会理直气壮地写着 `env=prod`，而实际上从没配过这个变量 ——
 * 一旦哪天有人绕过 run-prod.bat 直接起进程，日志反而会给出**错误的证据**。
 * 宁可显示"未设置"，也不要猜。生产由 run-prod.bat 显式 set，dev 由 .env.dev 提供。
 */
export function describeDataLayout(): string {
	const env = process.env.STELARITH_ENV || "(STELARITH_ENV unset)";
	return `[boot] env=${env} data-root=${DATA_ROOT} db=${DB_FILE} uploads=${UPLOADS_DIR}`;
}
