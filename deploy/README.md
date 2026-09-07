# CIMS 校园集控 · Docker 部署

一条命令起 CIMS 集控后端（FastAPI + PostgreSQL 18 + Redis 7 + Nginx/TLS）。

## 目录约定

```
deploy/
├── docker-compose.yml   # 编排
├── Dockerfile           # 后端镜像（需复制到 cims-src/）
├── .env.example         # 环境变量模板
├── nginx.conf           # 反代 + TLS
├── certs/               # 放 TLS 证书 (fullchain.pem / privkey.pem)
└── cims-src/            # ← 放入 CIMS-backend 源码（含 pyproject.toml）
```

## 步骤

1. **准备源码**
   ```bash
   cp -r /path/to/CIMS-backend ./cims-src
   cp deploy/Dockerfile ./cims-src/Dockerfile
   ```

2. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env，至少修改：DB_PASSWORD / CIMS_SECRET_KEY / ADMIN_PASSWORD / 域名
   ```

3. **准备 TLS 证书**（内网可用自签；校 CA 更佳）
   ```bash
   mkdir -p certs
   # 将 fullchain.pem / privkey.pem 放入 certs/
   ```

4. **启动**
   ```bash
   docker compose up -d --build
   ```

5. **初始化（OOBE）**
   - 首次访问 Management 端口 → 完成 OOBE（生成 PGP 密钥、创建超管）
   - 或按 CIMS 文档用 CLI 初始化
   - 访问 `https://cims.example.edu/mgmt/` 使用管理前端

## 端口说明

| 端口 | 服务 | 暴露 |
|---|---|---|
| 8000 (client) | Client API（终端/ClassIsland 连接、Manifest） | 内网/经 nginx |
| 8001 (management) | Management API（账户/用户/邀请/配对） | 经 nginx `/mgmt/` |
| 8002 (admin) | Admin API（超管/2FA/OOBE） | 仅运维网络 |
| 27044 | gRPC（Cyrene_MSP） | 内网（客户端经 client 端口） |

## 运维

- 查看日志：`docker compose logs -f cims`
- 升级：`git -C cims-src pull && docker compose up -d --build`
- 备份：`docker compose exec postgres pg_dump -U $DB_USER $DB_NAME > backup.sql`

## 已知注意

- CIMS 依赖编译（pgpy/grpc/cryptography），首次 build 较慢。
- 客户端实时控制（重启/通知/强制同步）已通过 CIMS management 端口 HTTP 暴露：`/account/{acct}/client/{uid}/command/*`，面板直接调用即可。
- bidi 流在 grpcio 1.78 真实 socket 下有边界（评估报告 §2.10）；MVP 用 Manifest 拉取模式即可。
