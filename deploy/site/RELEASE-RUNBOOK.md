# Stelarith v1.0.0 发布执行手册（人工侧 Runbook）

> 本文件是给**拥有源站访问权的人**照着敲的命令集。AI 在本沙箱内无法触达 VPS、
> 也无法推送 GitHub（SSH 被拦 + 无推送凭据），因此“代码出本机”和“源站部署”两步
> 必须由你（或水川）执行。以下内容已验证：本地仓库 4 个提交就绪、静态门禁全过。
>
> 发布 tag：`site-v1.0.0`（基于 `f863117`）。
> 前置硬条件（ORIGIN / COOKIE_SECURE / ADMIN_PASSWORD 等）见 `RELEASE-CHECKLIST.md` 第 0 节。

---

## 第 0 步：把发布提交推到 GitHub（在你自己的终端，沙箱内做不了）

本沙箱与源站/VPS 是气隙隔离的，以下命令请在你**有权限推送**的机器上、于本仓库目录执行：

```bash
cd <仓库根>/stelarith
git push origin main
git push origin site-v1.0.0        # 发布 tag
# 推送后 GitHub Actions 会自动跑 CI（构建 + 门禁）。
# 预期：website / static-gates 绿；agent-node 红——因为 ext/ 已删除，
#       该 job 依赖的 test/end2end.mjs 不存在。这是已知 benign 红，不影响站点。
```

---

## 第 1 步：判断源站用哪种部署架构

| 现象 | 用的是 |
|---|---|
| 源站跑 `docker compose -f deploy/site/docker-compose.yml` | **A. Docker 栈** |
| 源站是 Windows，有 `StelarithServer` 计划任务 + `run-prod.bat` | **B. 裸进程（release-site.mjs）** |

两条路径**只选一条**，别混。

---

## 第 A 步：Docker 栈部署（deploy/site）

```bash
cd <仓库根>/stelarith
git pull origin main

# ⚠️ 关键：Docker 构建容器内无 .git，必须显式注入 commit，否则页脚 “无 commit”、
#    更新提示条不启用。这是 b3174d9 修复过的坑。
export GIT_COMMIT=$(git rev-parse --short HEAD)

docker compose -f deploy/site/docker-compose.yml build
docker compose -f deploy/site/docker-compose.yml up -d

# 首次或 content/ 有变动时，把仓库内容播种进 sitedata 卷（含 6 篇文章 + beta 公告 + v1.0.0 changelog + class8 口号）
docker run --rm -v "$(pwd)/content:/src:ro" -v stelarith_sitedata:/data \
  alpine sh -c "cp -r /src/. /data/content 2>/dev/null || (mkdir -p /data/content && cp -r /src/. /data/content/)"
docker compose -f deploy/site/docker-compose.yml restart site
```

---

## 第 B 步：裸进程部署（Windows 源站，atomic release）

```bat
cd C:\<仓库根>\stelarith
git pull origin main
node scripts\release-site.mjs build     REM 构到 build.next，不碰线上 build/
node scripts\release-site.mjs switch    REM 停服→改名切换→验收→失败自动回滚
```
> 裸进程路径 git 在主机体可用，vite 直接拿到 commit，无需 GIT_COMMIT 注入。
> `switch` 含验收（/ 与 /console/ 均 200），失败会自动回滚到旧版本并重启，安全。

---

## 第 2 步：上线验证（逐项打钩，见 RELEASE-CHECKLIST.md 第 3 节）

- [ ] `curl -sI https://www.245959623.xyz/` → 200，响应头 `server: cloudflare`
- [ ] `curl -s https://www.245959623.xyz/api/version` → `site=1.0.0`，`commit` 不是 `dev`
- [ ] 无痕窗口登录一次 `/admin`（csrf.checkOrigin 实弹验证，ORIGIN 错会 403）
- [ ] 右上角出现「经典 / 终末地 BETA」两段切换（β 角标）
- [ ] `/announcements` 顶部有 beta 征询公告；`/changelog` 首条 `Stelarith v1.0.0`
- [ ] `/campus/2028/class8` 口号 = “励思笃行，八班同行，格物拓疆，聚力争强”，次考试 = 1
- [ ] 博客详情页右侧目录 + 文末上下篇正常
- [ ] 后台表单提交不 403（ORIGIN 硬伤的另一实弹点）

---

## 第 3 步：回滚（任一步出问题）

| 场景 | 动作 |
|---|---|
| Docker 站点 500/白屏 | `docker compose -f deploy/site/docker-compose.yml logs site`；回滚 = `git checkout <上一commit> -- .` 后重建 |
| 裸进程切坏 | `node scripts/release-site.mjs switch` 已自动回滚；若仍异常 `node scripts/release-site.mjs status` 看状态 |
| 表单全 403 | ORIGIN 错 → 改源站 `.env` 的 `ORIGIN=https://www.245959623.xyz`，Docker 侧 `docker compose up -d`（不 build）/ 裸进程侧 `node scripts/release-site.mjs switch` |
| 页脚 “无 commit” | 构建漏传 `GIT_COMMIT`（仅 Docker 路径）→ 带 `export GIT_COMMIT=$(git rev-parse --short HEAD)` 重 build |

---

## 已知遗留（不阻塞本次上线）

- remote 名 `WuMengAA/CIMS-Next`（与网站工程名不符）；push 到 main 触发 CI 的 agent-node 红（ext/ 已删），benign。
- R2 异地备份本期未做，本地卷 + pg_dump 过渡。
