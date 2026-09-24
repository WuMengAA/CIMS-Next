# ops-backup —— 运维脚本的异地备份快照

> ⚠️ **这里是备份，不是真源。** 不要在本目录里改脚本然后期待生效。

## 为什么存在

2026-09-24 盘点发现：`D:\Stelarith\_tools\` 与 `D:\Stelarith\loadenv.cjs` **不在任何 git 仓库内** ——
磁盘上只此一份、无版本历史、无异地备份。而其中多个是**被计划任务直接调用**的载重件：

| 脚本 | 被谁调用 |
|---|---|
| `tools/selfcheck-2h.mjs` | 计划任务 `Stelarith-Selfcheck-2H`（`--fix`） |
| `tools/selfcheck-2h.ps1` | 计划任务 `Stelarith-2H-Selfcheck` |
| `tools/sync-console.mjs` | 面板静态件同步（改完 `static/console` 必跑） |
| `tools/run-cloudflared.cmd` | 计划任务 `Cloudflared-Stelarith-Tunnel` |
| `loadenv.cjs` | 网站 8090 启动：`node -r D:\Stelarith\loadenv.cjs build/index.js` |
| `run-prod.bat` ⚠️ | 计划任务 `StelarithServer` 的动作本体（网站 8090 启动器 + 自愈循环） |

丢一块磁盘 = 整套自检/隧道/同步链路归零。所以在这里放一份**只读快照**。

## 真源与同步

- **真源**：`D:\Stelarith\_tools\`、`D:\Stelarith\loadenv.cjs`，以及**仓库根**的 `stelarith\run-prod.bat`
  （计划任务里写的是绝对路径，**不能移动**）
- **本快照**：`ops-backup/tools/`、`ops-backup/loadenv.cjs`、`ops-backup/run-prod.bat`

从真源刷新快照（在本仓库根目录执行）：

```bash
S=/d/Stelarith; D=.  ; # 或 D 指向本目录
cp -r "$S/_tools/." ops-backup/tools/
rm -rf ops-backup/tools/mdump/bin ops-backup/tools/mdump/obj   # 排除构建产物
cp "$S/loadenv.cjs" ops-backup/loadenv.cjs
cp run-prod.bat ops-backup/run-prod.bat
```

> ⚠️ **`run-prod.bat` 为什么也要进快照**：它被 `.gitignore:85`（`/run-prod.bat`）**有意排除**，
> 既是机器本地文件、又没有版本历史。2026-09-24 给它加崩溃护栏时才发现：
> 「以为改坏了能 `git checkout` 回退，其实根本不能」——磁盘上也没有任何旧版备份。
> 它与 `_tools/` 属于**同一类零版本控制载重件**，所以用同一套办法兜住。

**改动过 `_tools/` 里任何脚本后，请重跑上面的命令并提交**，否则快照会静默过期。
（本目录**未**纳入任何自动化**同步**，这是有意的：避免再制造一个"看起来会自动同步、其实会漂移"的假象。）

### 但漂移现在会被**自动检测**（2026-09-24 新增）

不自动同步 ≠ 可以不发现。因为存在一条**很难察觉的连锁**：

> CI 门禁 `scripts/check-console-assets.mjs` 验证的**正是本目录这份快照**的同步逻辑
> （CI 跑在 Linux 上，根本看不到 `D:\Stelarith\_tools\`）。
> 所以快照一旦过期，CI 就会**去校验一份生产根本没在跑的逻辑**并判绿 —— 一张空头支票。

而"请记得重跑命令"这种约束在本项目已经被证明不可靠（`sync-console.mjs` 的允许列表
就因为"每次新增文件类型都要记得回来改"而**连踩两次**同一形态的 bug）。
所以 `_tools/selfcheck-2h.mjs`（计划任务 `Stelarith-Selfcheck-2H`，每 2 小时）新增了
`tool-snapshot` 检查项：把 `_tools/` 与 `loadenv.cjs` 和本快照**逐文件比对**，
不一致就报 **WARN**，并把上面那条刷新命令原样贴在告警里。

几点设计取舍（别"顺手优化"掉）：

- **只警告，不自动修**（不放进 `--fix`）：`--fix` 由计划任务以服务账户运行，
  擅自改写 git 工作区会和并行开发互相打架。漂移是"人忘了提交"，不是"服务坏了"，
  所以归警告，退出码仍为 0。
- **比对前统一行尾**：本仓 `core.autocrlf=true`，git 检出时会把 LF 还原成 CRLF。
  逐字节比 md5 会把**同一份脚本**误报成漂移（实测：一次 `git checkout --` 之后
  `stelarith_task.pub` 的 md5 立刻对不上）。含 NUL 的真二进制不做归一化。
- **检测在自检里，不在 CI 里**：CI 看不到 `_tools/`，硬加一个只会永远 skip 的门禁
  等于再造一个"绿得没意义"的假信号。

## 内容

- `tools/` —— `D:\Stelarith\_tools\` 的镜像（**已排除** `mdump/bin`、`mdump/obj` 等构建产物）
- `tools/mdump/` —— 只保留 `Program.cs` 与 `mdump.csproj`（C# 调试小工具）
- `loadenv.cjs` —— 网站启动用的环境加载器（读 `.env` 注入 `process.env`）
- `run-prod.bat` —— 网站 8090 的启动器与自愈循环（`.gitignore` 排除了原文件，故此处为其唯一留档）

## 安全说明

入库前已扫描明文凭据（`sk-*` / `ghp_*` / `github_pat_*` / `token=` / `PRIVATE KEY` / 高熵字面量），
**未发现硬编码密钥**。Cloudflare 隧道 token 存放于仓库外的 `C:\ProgramData\cloudflared\token`，
本目录只有读取该文件的路径，没有 token 本身。
`stelarith_task.pub` 是**公钥**（SPKI PEM），公开无风险。
