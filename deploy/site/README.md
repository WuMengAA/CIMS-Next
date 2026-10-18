# Stelarith 站点云端部署包（deploy/site）

网站前台 + 后台的源站部署：**网站容器（adapter-node）+ PostgreSQL + Nginx/TLS**。
静态流量由上游 Vercel 边缘 / CDN 卸载，源站只接动态请求与 WebSocket。

> **过渡态**：`uploads` 走本地卷；**不接 R2**（R2 需绑卡订阅，本期不做）。
> 目标态再把上传切 R2 直写 + CDN 外链域（见 `docs/CLOUD-DEPLOYMENT.md` 增强项 5–6）。
>
> ⚠️ **本包为未验证蓝图**：本机无 Docker，未做真实构建/联调。落地前务必在目标机
> 先 `docker compose build` 冒烟、再上线。构建/运行细节如与实物不符，以实测为准并回头修订本包。

## 目录

```
deploy/site/
├── Dockerfile          # 多阶段、隔离构建（node:22-bookworm-slim；sharp 走 glibc 预编译）
├── docker-compose.yml  # 网站 + postgres:17 + nginx
├── nginx.conf          # TLS 反代 + 动静分流 + WebSocket 升级
├── .env.example        # 环境变量模板（复制为 .env 编辑）
└── certs/              # 放 fullchain.pem / privkey.pem（自建）
```
上下文根的 `.dockerignore` 已排除 node_modules / build* / content / uploads / .env 等，构建不掺宿主数据。

## 前置

- 目标机（国内轻量云 2C4G 起）装 Docker + Compose 插件。
- 数据迁移来源：当前生产是 SQLite `content/stelarith.db`。**先用 `scripts/pg-migrate.mjs`
  的思路把数据灌进 PG**（届时不加 `parity` schema 限定，直接灌目标库），或先让站点空库
  起、再导入。parity 已验证 SQLite↔PG 等价（见 `docs/CLOUD-PARITY-REPORT.md`）。

## 步骤

1. **配置**
   ```bash
   cd deploy/site
   cp .env.example .env
   # 编辑 .env：POSTGRES_PASSWORD / ORIGIN（正式域名）/ ADMIN_PASSWORD
   ```

2. **证书**（没有正式证书可先自签或临时只暴露 80）
   ```bash
   mkdir -p certs
   # fullchain.pem / privkey.pem 放入 certs/
   ```

3. **构建并启动**
   ```bash
   docker compose up -d --build
   ```

4. **首次播种数据卷**（`sitedata` 卷空的话站点无文章）
   ```bash
   # 把宿主的 content/ 与 uploads/ 灌进 sitedata 卷（content 与 uploads 平级于 /data）
   docker run --rm \
     -v stelarith_sitedata:/data \
     -v "$PWD/../../content:/src/content:ro" \
     -v "$PWD/../../uploads:/src/uploads:ro" \
     alpine sh -c "mkdir -p /data && cp -rn /src/content /data/ 2>/dev/null; cp -rn /src/uploads /data/ 2>/dev/null; ls /data"
   docker compose restart site
   ```
   > 卷名以 `docker volume ls` 实际为准（通常 `<项目名>_sitedata`）。

5. **验收**
   ```bash
   docker compose ps
   curl -fsS http://127.0.0.1/            # 经 nginx 80→443；本地可 curl https://127.0.0.1/ -k
   docker compose logs -f site            # 看 [boot] 启动标识行与 [db] PostgreSQL 后端就绪
   ```

## 备份（30 分钟周期）

`scripts/backup-cloud.mjs`：`pg_dump` + `tar(content,uploads)` → `backups/cloud/<ts>/`，
按 `BACKUP_KEEP` 轮转；设了 `BACKUP_OFFSITE_CMD` 则异地拷贝（R2/Openlist 二选一，届时再配）。

需要 `pg_dump`（postgresql-client）与可达的 PG。推荐在 compose 网络内跑：
```bash
# 例：起一个带 pg 客户端的一次性容器，连 postgres 服务 dump
docker compose run --rm --entrypoint sh site -c "PGPASSWORD=$POSTGRES_PASSWORD pg_dump -h postgres -U $POSTGRES_USER $POSTGRES_DB | gzip > /data/backup.sql.gz"
# 或宿主机装 postgresql-client 后：node scripts/backup-cloud.mjs
```
定时：宿主 crontab `*/30 * * * *` 或 Windows 计划任务调用上面命令。

## 安全注意（公网暴露前必读）

- `svelte.config.js` 目前 `csrf.checkOrigin:false`（为内网多来源访问而设）。**直接上公网建议改回
  `checkOrigin:true` 并正确设 `ORIGIN`**，否则跨站表单防护是关的。
- `ORIGIN` 必须与对外域名 + 协议一致，否则部分绝对 URL / 重定向会错。
- PG 端口未对外（仅内网）；管理后台 `/admin` 建议再加一层网络层 ACL 或 Basic Auth。

## 与既有 CIMS/集控 deploy/ 的关系

仓库根的 `deploy/`（python/FastAPI/Redis 那套）属「学校多媒体统一集控方案包」，**与本网站部署无关**；
本包独立在 `deploy/site/`，两者互不影响。
