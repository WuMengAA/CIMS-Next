# Vercel 接入说明（保守版）

结论先行：**本站不整站迁上 Vercel Serverless**。本轮只把 Vercel 当作「边缘层（缓存头 / 安全头 / 静态资源）」来用，
运行时继续跑在自有机器上。下面是为什么，以及要迁移时必须先解决什么。

---

## 一、为什么不能整站迁

| # | 硬约束 | 后果 |
|---|--------|------|
| 1 | **SQLite 无法跨实例共享** | 数据层是 `node:sqlite`（`content/stelarith.db`，WAL 模式）。Serverless 每次冷起都是新实例、新文件系统，写操作立刻丢数据。要迁就必须换 D1 / Postgres / Turso —— 那是数据层重写，不是部署改动。 |
| 2 | **CPU 配额** | 图片转码（sharp / libvips）、AVIF 编码、OAuth 密钥重置这类活儿属于突发重 CPU。Serverless 的函数 CPU 时间被硬性摊薄，冷启动还要重付一次。**用户点一次上传卡十几秒是能感知的**。 |
| 3 | **后台常驻任务** | 集控面板轮询、状态心跳、自愈守护都是常驻长连接。Serverless 的函数实例会随时被回收，长连必然断。 |

所以这一版 `vercel.json` 里**没有 `buildCommand` / `outputDirectory`**：一旦填了，Vercel 会试图把你
的 `build/client` 当静态站托管，而本站几乎所有路由都是 SSR，深链会直接 404 —— 那是"配了但更糟"，不如不配。

---

## 二、这一版做了什么

`vercel.json` 只声明了三件事：

1. **缓存头** —— `/_app/immutable/*`（打包产物）设为 `max-age=31536000, immutable`；
   `/uploads/*`（用户上传的图片）与 `/docs/*` 设短缓存。
2. **安全头** —— `nosniff` / `Referrer-Policy` / `DNS-Prefetch`，全站兜底。
3. **静态目录重定向** —— `/static/*` → `/{path}`，兼容历史写法。

部署后 Vercel 就成了一个贴在本站前面的 CDN / 边缘配置层，动态请求照旧回源自有机器。

---

## 三、正确卸掉静态流量的姿势：Cloudflare，不是 Vercel

真正该交给边缘的是**二进制资源**：

- **图片 / 附件 / 头像 → Cloudflare R2**（本轮已接，见下节）
- R2 绑定自定义域名后，`R2_PUBLIC_URL` 一配，所有外链自动换域名，浏览器直接从 Cloudflare 边缘拉，
  本机机器不再背图片流量。

这正是「Vercel 只管边缘、Cloudflare 管存储」的分工。

---

## 四、Cloudflare R2 配置

在 Cloudflare 控制台：

1. **R2 → 创建存储桶**，记下桶名与 Account ID。
2. **R2 → 管理 API Tokens → 创建**，选择 `Object Read & Write`，记下 Access Key ID 与 Secret Access Key。
3. （可选）**绑定自定义域名**给桶，拿到 `https://cdn.example.com` 这样的公网地址。
4. **打开「公开访问」**（允许通过 `.r2.cloudflarestorage.com` 匿名读），否则上传的图片外链打不开。

然后在项目根目录 **`.env`** 里补齐：

```bash
R2_ACCOUNT_ID=你的账号ID
R2_BUCKET=你的桶名
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...

# 可选：绑定了自定义域名就填它，外链会换成你的域名
R2_PUBLIC_URL=https://cdn.example.com

# 可选：桶内统一前缀，多站点共桶时用
R2_PREFIX=
```

改完**重启服务**。没配齐时页面会明确告诉你缺哪几项，上传接口返回 503 而不是把文件悄悄存到别处。

> 签名是自己手写的 SigV4（`src/lib/server/storage/r2.ts`），**故意没装 `@aws-sdk/client-s3`** ——
> 那玩意儿是本站最重的依赖之一，为一次偶发上传付冷启动成本不划算。R2 是 S3 兼容协议，
> PUT / GET / HEAD / DELETE / LIST 用 fetch 加上签名全都能覆盖。

---

## 五、如果将来真要迁

顺序不能反，否则每走一步都要回滚：

1. 数据层先换掉（D1 / Turso / Postgres），把 `src/lib/server/db.ts` 的 `node:sqlite` 收口成一个适配器。
2. 后台常驻任务全部外置（Cron on Cloudflare / 一台常驻小机器）。
3. 重 CPU 的转码挪到 Cloudflare Workers 或队列消费者，Web 只留一个「提交任务」接口。
4. 静态资源全量走 CDN + R2。
5. 最后才动 adapter。

在那之前，`vercel.json` 就保持现在这样 —— 它做的是加分项，不是负担。
