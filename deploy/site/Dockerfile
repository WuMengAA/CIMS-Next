# Stelarith 站点云端镜像（SvelteKit adapter-node + PostgreSQL 运行时）
# ─────────────────────────────────────────────────────────────────────────
# 多阶段、隔离构建：产物只含「构建结果 + 生产依赖」，不掺宿主 .env / .dev-data /
# dev node_modules / 旧 build 备份 / 其它工程（见上下文根 .dockerignore）。
#
# 运行期数据库：DB_BACKEND=pg（由 .env / compose 注入 DATABASE_URL）。
# 运行时数据：STELARITH_DATA_ROOT=/data（content + uploads 平级于此），挂卷提供。
#
# 选 bookworm-slim 而非 alpine：sharp 0.34 的图片管线在 glibc 预编译上更稳，
# 云端优先可靠性（镜像体积让位于 sharp 可用）。
#
# ⚠️ 未在真实 Docker 环境构建验证（本机无 Docker）。落地前请在目标机跑一次
#    `docker compose build` 冒烟，再上线。

# ── 阶段 1：构建（含 dev 依赖）──────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH RAYON_NUM_THREADS=1 CI=true
RUN corepack enable
WORKDIR /app
# 先装依赖（lock 不变则命中层缓存）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# 拷源码并构建（adapter-node 输出到 build/，见 svelte.config.js）
COPY . .
# 版本标识：保证 client/server hydration 一致（绝不能用 Date.now()，见 svelte.config.js 注释）
ARG BUILD_ID
ENV BUILD_ID=${BUILD_ID}
RUN pnpm build

# ── 阶段 2：仅生产依赖 ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS prod-deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ── 阶段 3：运行 ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=8090 \
    HOST=0.0.0.0 \
    DB_BACKEND=pg \
    STELARITH_DATA_ROOT=/data
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/build       ./build
COPY package.json ./
# content / uploads 不打进镜像，由 /data 卷在运行期提供（避免把生产数据烤进镜像）
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8090)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "build/index.js"]
