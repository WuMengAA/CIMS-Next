# Stelarith 正式发行上线清单（Release Checklist）

> 本清单是「上线专用」：README.md 讲怎么部署，本文件讲**怎么安全地把 dev 代码转成正式发行**。
> 每一步都可独立验证；任何一步不过，停在上一步，不要带病推进。
> 生成时间：2026-10-23（终末地 BETA + 版本号体系重构批次）。

---

## 0. 硬前置（不满足则上线即事故）

| # | 项 | 要求值 | 在哪改 |
|---|---|---|---|
| 0.1 | **`ORIGIN`** | `https://www.245959623.xyz` | 源站 `.env`（**不是** `.env.example`）。当前已知 dev 机 `.env.dev` 是 `http://localhost:8091`；源站真实值必须确认。`csrf.checkOrigin: true` 下 ORIGIN 与浏览器访问域名不一致 → **全站表单/登录 403** |
| 0.2 | **`PUBLIC_SITE_URL`** | `https://www.245959623.xyz` | 源站 `.env`。影响 OG/sitemap/绝对 URL |
| 0.3 | **`COOKIE_SECURE`** | `true` | 源站 `.env`。HTTPS 下必须 true（http 下反而要 false，二选一别弄反） |
| 0.4 | **`ADMIN_PASSWORD`** | 强口令 | 源站 `.env`。源码 auth.ts 有默认种子值，**必须覆盖** |
| 0.5 | **`STELARITH_ENV`** | `prod` | compose 已默认 prod；裸进程部署由 run-prod.bat 设定 |
| 0.6 | **`DATABASE_URL`** | PG 连接串（口令非占位） | compose 已按 `POSTGRES_PASSWORD` 自动拼；裸进程部署须手改 `.env` |

> 验证 0.1 的方法：`curl -sI https://www.245959623.xyz/` 200 后，浏览器无痕窗口登录一次，
> 能进后台 = ORIGIN 对；登录按钮点了没反应/控制台 403 = ORIGIN 错。

## 1. 构建（含本次版本系统的新增项）

```bash
cd <仓库根>/stelarith
# GIT_COMMIT 必须显式注入：.dockerignore 排除 .git，构建容器内 git 不可用。
# 不注入 → CONTENT_COMMIT=dev → 页脚无 commit 段、更新提示条不启用（安全退化，但版本体系残废）。
export GIT_COMMIT=$(git rev-parse --short HEAD)
docker compose -f deploy/site/docker-compose.yml build
```

- 构建成功后本地冒烟：`docker compose -f deploy/site/docker-compose.yml up -d` →
  `curl -s http://127.0.0.1:8090/api/version` 应返回 `{"site":"1.0.0","commit":"<GIT_COMMIT>", ...}`
- 页面底部页脚应显示 `v1.0.0 · 内容 <commit>`（点击跳 /changelog）

## 2. 数据卷首次播种

```bash
# sitedata 卷为空则站点无文章/无公告（README「首次播种」）
docker run --rm -v "$(pwd)/content:/src:ro" -v stelarith_sitedata:/data \
  alpine sh -c "cp -r /src/. /data/content 2>/dev/null || (mkdir -p /data/content && cp -r /src/. /data/content/)"
# uploads 同理（如宿主有 uploads/）
docker compose -f deploy/site/docker-compose.yml restart site
```

> ⚠️ 本次内容变更（**beta 公告、v1.0.0 changelog、class8 口号/考试**）在仓库 `content/` 里，
> 必须随本次播种进卷，否则线上看不到公告、班级页口号不变。

## 3. 上线后验证（逐项打钩）

- [ ] `curl -sI https://www.245959623.xyz/` → 200，响应头 `server: cloudflare`
- [ ] `curl -s https://www.245959623.xyz/api/version` → `site=1.0.0`，`commit=<注入值>`（**不是** `dev`）
- [ ] 浏览器无痕打开首页：页脚显示 `© 2026 Stelarith · v1.0.0 · 内容 <commit> · 构建于 …`
- [ ] **登录一次**（csrf 硬前置的实弹验证）：能登进 /admin
- [ ] 主题切换器右上角出现「经典 / 终末地 BETA」两态分段（β 角标）
- [ ] /announcements 顶部有 beta 征询公告（pinned）
- [ ] /changelog 首条为 `Stelarith v1.0.0`
- [ ] 班级页 `/campus/2028/class8`：口号为「励思笃行，八班同行，格物拓疆，聚力争强」，hero「次考试 = 1」
- [ ] 博客详情页（有文章时）右侧目录 + 文末上下篇正常
- [ ] 后台 /admin 表单提交不 403（ORIGIN 硬伤的另一实弹点）

## 4. 可选降险项（不阻塞上线，但建议）

- 终端用户无感知前，先只让自己的网络访问验证半天（优选 hosts / Tunnel 灰度）
- 备份先行：上线前 `pg_dump` 一份（见 README 备份节），出问题 5 分钟回滚
- CF Cache Rules 确认 `/api/version` 不被缓存（响应已带 `no-store`，但 CF 侧规则别覆盖它）

## 5. 回滚预案

| 场景 | 动作 |
|---|---|
| 站点 500 / 白屏 | `docker compose -f deploy/site/docker-compose.yml logs site` 看 `[boot]`/`[db]` 行；回滚 = `git checkout <上一commit> -- .` 后重新构建（版本批次：`8932abd` 终末地 BETA / `0c75d1f` 版本重构） |
| 表单全 403 | ORIGIN 错 → 改 `.env` 的 `ORIGIN=https://www.245959623.xyz`，`docker compose up -d`（不用 build） |
| 页脚显示「无 commit」 | 构建漏传 `GIT_COMMIT` → 带 `export GIT_COMMIT=$(git rev-parse --short HEAD)` 重build |
| 数据卷被新播种覆盖坏 | 播种前先 `docker run --rm -v stelarith_sitedata:/data -v $(pwd):/bak alpine tar czf /bak/sitedata-pre.tgz -C /data .` |

## 6. 本清单未覆盖（已知遗留，不阻塞本次上线）

- remote 是 `WuMengAA/CIMS-Next.git`（仓库名与网站工程不符；`git push` 到 main 会触发 CI，
  其中 agent-node job 依赖已删除的 `ext/`，**CI 会红**——不影响站点运行，但别被红吓到）
- R2 异地备份（不付费，本期本地卷 + pg_dump 过渡）
- D1 UUID `19a95063-…` 用途未知，未动
