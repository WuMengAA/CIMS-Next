# Stelarith CMS 部署指南

本指南覆盖多种部署方式。项目基于 SvelteKit + adapter-auto，可针对目标平台切换 adapter。

## 重要：数据与部署模式

本项目是 **文件型 CMS**：
- 内容存储于 `content/` 目录（Markdown + JSON）
- 上传文件存储于 `uploads/` 目录
- 用户数据存储于 `content/users.json`

**这意味着需要服务端写文件能力**（Node 服务器、Docker、云函数均可）。纯静态托管（纯 CDN）不支持后台写入，仅能展示预生成内容。

---

## 方案一：Node.js 服务器（推荐自部署）

适用：VPS / 云服务器 / 家用 NAS

```bash
# 1. 安装依赖并构建
pnpm install
pnpm build

# 2. 切换 adapter-node（推荐，否则产物是 adapter-auto 探测结果）
pnpm add -D @sveltejs/adapter-node
# svelte.config.js 中 adapter 改为 node

# 3. 运行
node .svelte-kit/output/server/index.js
# 默认端口 3000，可用 PORT 环境变量修改
```

**环境变量**：
- `ADMIN_PASSWORD`：初始管理员兜底密码
- `PORT`：监听端口
- `COOKIE_SECURE`：设为 true（生产 HTTPS 时）

---

## 方案二：Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["node", ".svelte-kit/output/server/index.js"]
```

```yaml
# docker-compose.yml
services:
  stelarith:
    build: .
    ports: ["3000:3000"]
    environment:
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      COOKIE_SECURE: "true"
    volumes:
      # 持久化内容与上传（关键！）
      - ./content:/app/content
      - ./uploads:/app/uploads
    restart: unless-stopped
```

> 卷挂载 content 与 uploads 是必须的，否则容器重建会丢数据。

---

## 方案三：Vercel

1. 导入 GitHub 仓库
2. Framework Preset 选择 SvelteKit
3. 构建命令 pnpm build
4. 环境变量 ADMIN_PASSWORD
5. adapter-auto 自动检测 Vercel

> 注意：Vercel 无服务器函数文件系统只读（/tmp 可写）。若需完整后台写入，请使用 Vercel KV/Blob 或改走方案一。

---

## 方案四：Cloudflare Pages

1. 导入仓库，框架预设 SvelteKit
2. 构建命令 pnpm build
3. adapter-auto 检测到 Cloudflare 使用 adapter-cloudflare
4. 环境变量 ADMIN_PASSWORD

> 受平台无服务器限制，写入需要 D1/R2 或 KV 支持（本项目暂未接入，可后续扩展）。

---

## 方案五：Netlify

1. 导入仓库，构建命令 pnpm build
2. adapter-auto 检测到 Netlify
3. 环境变量 ADMIN_PASSWORD
4. Netlify Functions 支持部分写操作

---

## 部署前必做清单

- 设置 ADMIN_PASSWORD 环境变量（不要用默认值）
- 登录后台，在用户管理修改/添加管理员
- HTTPS 下设置 COOKIE_SECURE=true
- 确认 content/ 与 uploads/ 有持久化存储
- 定期使用后台数据备份导出 JSON 存档
- 不要将 content/users.json 提交到公开 Git 仓库

---

## 备份与恢复

备份：后台「站点设置 → 数据备份」或「账号 → 导出我的数据」。

恢复：将 JSON 内容按结构写回 content/ 目录（posts/projects/docs），重启服务。

Git 版本控制：content/ 默认在 Git 管理下（私有仓库时），每次内容变更可回滚。