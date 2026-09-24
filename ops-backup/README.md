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

丢一块磁盘 = 整套自检/隧道/同步链路归零。所以在这里放一份**只读快照**。

## 真源与同步

- **真源**：`D:\Stelarith\_tools\` 与 `D:\Stelarith\loadenv.cjs`（计划任务里写的是绝对路径，**不能移动**）
- **本快照**：`ops-backup/tools/` 与 `ops-backup/loadenv.cjs`

从真源刷新快照（在本仓库根目录执行）：

```bash
S=/d/Stelarith; D=.  ; # 或 D 指向本目录
cp -r "$S/_tools/." ops-backup/tools/
rm -rf ops-backup/tools/mdump/bin ops-backup/tools/mdump/obj   # 排除构建产物
cp "$S/loadenv.cjs" ops-backup/loadenv.cjs
```

**改动过 `_tools/` 里任何脚本后，请重跑上面的命令并提交**，否则快照会静默过期。
（本目录**未**纳入任何自动化同步，这是有意的：避免再制造一个"看起来会自动同步、其实会漂移"的假象。）

## 内容

- `tools/` —— `D:\Stelarith\_tools\` 的镜像（**已排除** `mdump/bin`、`mdump/obj` 等构建产物）
- `tools/mdump/` —— 只保留 `Program.cs` 与 `mdump.csproj`（C# 调试小工具）
- `loadenv.cjs` —— 网站启动用的环境加载器（读 `.env` 注入 `process.env`）

## 安全说明

入库前已扫描明文凭据（`sk-*` / `ghp_*` / `github_pat_*` / `token=` / `PRIVATE KEY` / 高熵字面量），
**未发现硬编码密钥**。Cloudflare 隧道 token 存放于仓库外的 `C:\ProgramData\cloudflared\token`，
本目录只有读取该文件的路径，没有 token 本身。
`stelarith_task.pub` 是**公钥**（SPKI PEM），公开无风险。
