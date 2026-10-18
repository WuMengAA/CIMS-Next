# 云端部署 · PostgreSQL 后端 Parity 验证报告

> 目标：证明站点在「SQLite（当前生产）→ PostgreSQL（云端目标）」切换时，
> 数据与查询行为一致，为云端割接提供证据。
>
> 验证日期：2026-10-19
> 工程：`D:\Stelarith\Stelarith-website\stelarith`（唯一改动对象）

---

## 一、结论

**Parity 全部通过。**

| 维度 | 结果 |
| --- | --- |
| 表结构（表数量） | ✅ 42 / 42（与 SQLite 生产库一致） |
| 表数据（逐表行数 + 逐行内容多重集） | ✅ 42 / 42，共 2817 行，零差异 |
| 复杂查询（5 条 app 真实 SQL，经 `translateToPg` 在 PG 执行） | ✅ 5 / 5 |
| 类型检查（`pnpm check`） | ✅ 改动文件 0 错误（总量 73 = 既有基线，均为 Svelte 5 `$state` 历史债，与本次无关） |

---

## 二、环境事实

- **生产库 = SQLite `content/stelarith.db`**（1.2MB + WAL），由运行中的本地服务
  （`build/index.js` / `src/index.js`，均经 `loadenv.cjs` 加载 `.env`）承载。
- `.env` **未设置 `DB_BACKEND`** → 默认 `sqlite`，因此这些服务走 SQLite，
  **不写 PG**。所以 `stelarith` PG 库不是活库，可安全用于验证。
- PG 库 `stelarith`（角色 `stelarith_app`）仅存种子数据（1 admin / 1 activity / 1 session），
  不承载生产数据；`stelarith_app` **无 `CREATEDB` 权限**，无法新建库。
- **验证采用隔离 schema**：在 `stelarith` 库内建 `parity` schema（全新、零破坏），
  所有验证表与数据落在此，完全不触碰现有 `public` 及任何其它库（cims / voicehub_dev 等一律不碰）。

---

## 三、验证方法（可复现）

三个可复用脚本已固化到 `scripts/`（割接时直接复用）：

| 脚本 | 职责 | 安全约束 |
| --- | --- | --- |
| `scripts/pg-bootstrap.mjs` | 从 `db.ts`/`class8-db.ts`/`login-guard.ts` **抽取与 app 完全一致的 DDL**，套用同一套 `transformSchemaToPg`，在 `parity` schema 建全 42 表 | 只建 `parity` schema；`CREATE IF NOT EXISTS` 幂等 |
| `scripts/pg-migrate.mjs` | **只读**打开活 SQLite，把 42 表数据灌入 `parity` | `readOnly:true` 绝不写活库；临时 DROP/重建 FK 避免顺序问题；`ON CONFLICT DO NOTHING` 幂等 |
| `scripts/pg-parity.mjs` | 逐表 COUNT + 逐行内容多重集比对 + 5 条复杂查询结果比对 | 全 SELECT 只读；含 `translateToPg` 逐字复刻，直接验证方言层 |

执行序列：`bootstrap → migrate → parity`（重跑前 `DROP SCHEMA parity CASCADE` 重建，属本沙盒自建、无生产数据）。

关键设计：
- **多重集比对**（不是按索引配对）：消除「无单主键表（device_bindings/sessions）行物理序不同」导致的假阳。
- **忠实 DDL**：直接抽源码文本，避免手抄漂移；class8 的 `quote/subtitle/emoji/photos` 由
  `ensureClass8Schema` 末尾 `ensureColumn` 的 ALTER 补齐，bootstrap 已复刻这 4 个 ALTER。
- **`translateToPg` 逐字复刻**进 parity 脚本：等于直接用生产方言层跑查询，而非另写等价 SQL。

---

## 四、验证中定位并修复的问题

### 1. PG 主 `ensure()` 缺 `login_attempts`（真实缺口，已修）
- 现象：PG schema 比 SQLite 少 1 表（41 vs 42）。
- 根因：`login_attempts` 历史上由 `login-guard.ts` 运行时懒建，未纳入 PG 主 `ensure()`，
  首次失败登录才建表，部署后不稳定。
- 修复：`src/lib/server/db.ts` 的 `PgBackend.ensure()` 补建 `login_attempts`
  （DDL 与 `login-guard.ts:19` 一致），使 PG 后端 schema 自包含。

### 2. `topActiveUsers` 并列名次非确定（已修）
- 现象：并列 `count` 时 `LIMIT 8` 的边界用户 SQLite 与 PG 不一致。
- 根因：`ORDER BY count DESC` 无次级排序，并列时两端各取不同 8 名。
- 修复：`src/lib/server/activity.ts` `topActiveUsers` 改为
  `ORDER BY count DESC, username ASC`，两端稳定一致。

### 3. bootstrap 曾漏 class8 4 列（脚手架问题，非 app bug）
- 现象：`class8_events.photos`/`class8_groups.emoji`/`class8_profile.quote|subtitle` 在 PG 缺列。
- 根因：bootstrap 只跑了基础 `CLASS8_SCHEMA`，漏了 `ensureClass8Schema` 末尾的 `ensureColumn` ALTER。
  **app 在 PG 上运行时能正确加列**（`PRAGMA table_info` 已被翻译成 `information_schema`）。
- 修复：bootstrap 补齐 4 个 `ADD COLUMN IF NOT EXISTS`，与 app 行为对齐。

---

## 五、已知非问题（记录在案，不影响使用）

- **`onlineUsers` 的 `ips` 原串**：`GROUP_CONCAT`（SQLite）与 `string_agg`（PG）对空串排序不同，
  原串形如 `127.0.0.1,` vs `,127.0.0.1`。但 app 端 `onlineUsers` 消费时用
  `String(r.ips||"").split(",").filter(Boolean)`，空串被过滤，**两端最终输出完全一致**。
  parity 已按 app 实际用法归一化后比对通过。

---

## 六、业务内容不进 PG（澄清）

`posts`/`comments`/`forum-*`/`pages`/`projects` 等博客/论坛内容**不在 PG，也不在 SQLite**，
而是以 JSON 文件存于 `content/`（如 `content/posts/`、`forum-threads.json`、`nav.json`）。
SQLite 与 PG 仅承载结构化数据（账号/会话/活动/看板/设备/通知/class8 等）。云端部署时这些
JSON 目录走 R2 / 对象存储，与 PG 数据层正交。

---

## 七、割接提示（正式上线时）

1. 生产 PG 库（届时应为独立库，`DB_BACKEND=pg` + `DATABASE_URL`）需先由 app `ensure()` 建全 schema。
2. 用 `scripts/pg-migrate.mjs` 做一次性数据迁移（届时目标改为生产 PG，去掉 `parity` schema 限定）。
3. 迁移窗口期建议停写（或采用双写/回填策略），避免 WAL 竞态。
4. 迁移后重跑 `scripts/pg-parity.mjs` 复核。

---

## 附：改动文件清单

- `src/lib/server/db.ts`：PG `ensure()` 补建 `login_attempts`。
- `src/lib/server/activity.ts`：`topActiveUsers` 加 `username` 次级排序。
- `scripts/pg-bootstrap.mjs`（新增）：隔离 schema 忠实建 42 表。
- `scripts/pg-migrate.mjs`（新增）：活 SQLite 只读 → parity 数据迁移。
- `scripts/pg-parity.mjs`（新增）：数据 + 查询 parity 验证。
- `docs/CLOUD-PARITY-REPORT.md`（本文件）。
