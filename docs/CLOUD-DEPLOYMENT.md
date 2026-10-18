# Stelarith 站点云端部署蓝图 —— 前后端分离 · 动静结合

> 定稿：2026-10-18。范围：**仅网站前台+后台**（CIMS 留校园内网，经站点 cloud-ws 中继上报）。
> 硬前置：`feat/site-pg` 迁移完成（数据层切 PostgreSQL）后才落地。

## 一、总原则

- **动静结合**：静态流量全部卸到边缘/CDN，源站只接动态请求；Vercel 继续当边缘层。
- **前后端分离**：后台 API / WebSocket 是独立"后端"（源站容器 + PG）；前台浏览是"前端"（边缘缓存 + 预渲染）。
- **不上 Vercel Serverless**：WebSocket 长连、sharp/AVIF 转码 CPU、定时广播常驻任务、国内访问四条硬约束（见 VERCEL-DEPLOYMENT.md）。

## 二、动静划分

| 类别 | 内容 | 承载方 | 策略 |
|---|---|---|---|
| 静 | `/_app/immutable/*` 构建产物 | Vercel 边缘 | `immutable` 长缓存（已配） |
| 静 | `/uploads/*` 用户图片 | R2 + 自定义域 CDN（目标态）| 上传直写 R2，外链换 CDN 域；过渡期源站 + 边缘缓存 7 天（已配） |
| 静 | 前台文章页 / 首页 / 项目页 | Vercel 边缘缓存（s-maxage+stale-while-revalidate）| 动态 SSR 但边缘可缓存；后台发文后可刷新 |
| 动 | `/admin` 后台 + 全部写 API | 源站容器 | 不缓存，直连 |
| 动 | class8 cloud-ws、OAuth、评论提交 | 源站容器 | 长连接 / 会话，不可边缘化 |
| 动 | 集控心跳、guard/control、文件传输 | 源站容器 | 同上 |

## 三、目标架构

```
用户 → Vercel 边缘（静态缓存/安全头）
     → 源站（国内轻量云 2C4G）：Nginx TLS → Docker
         ├─ 网站容器（adapter-node，PORT=8090 等价）
         ├─ PostgreSQL 容器（数据卷 pgdata）
         └─ uploads 数据卷（过渡期本地，目标态 R2 双写）
     → Openlist 多盘容灾：每 30 分钟备份 DB dump + uploads 增量
```

## 四、交付物清单（PG 迁移完成后产出）

1. `deploy/site/Dockerfile`（node:22-alpine 多阶段构建，隔离构建）
2. `deploy/site/docker-compose.yml`（网站 + PG + Nginx，卷挂载 pgdata/uploads）
3. `deploy/site/nginx.conf`（TLS 反代 + 动静分流：immutable/uploads 直接命中缓存头）
4. `scripts/backup-cloud.mjs`（30 分钟周期：pg_dump + uploads 增量 → R2 / Openlist 多盘）
5. 路由边缘缓存头下发（`+layout.server.ts` / hooks 统一设 `Cache-Control: s-maxage=…`，仅限匿名可缓存页）
6. R2 直写上传（image-pipeline 出 AVIF 后推 R2，`R2_PUBLIC_URL` 换外链域）

## 五、实施顺序

1. **[进行中]** `feat/site-pg` Phase 1：async 门面 + 全调用点 await 化（`pnpm check` 回到 79 基线）
2. Phase 2：PgBackend + SCHEMA_PG + staging 双跑数据 parity
3. 上面的部署包 1–4（不依赖 R2 直写，可先上）
4. 增强 5–6（边缘缓存 + R2 直写，二次迭代）
