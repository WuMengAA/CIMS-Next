# Cloudflare Free 边缘层 + 国内源站 部署参考（含 IP 优选）

> 适用：本站点（SvelteKit adapter-node，源站 + PostgreSQL 在国内轻量云）。
> 目标：零/低成本的边缘缓存、免费 SSL、WAF/DDoS、隐藏源站 IP，并针对**国内访客**做 IP 优选。
> 状态：本文件为从架构认知重新起草（仓库源文件在本环境丢失，恢复仓库后归入 `deploy/site/`）。

---

## 0. 一句话结论

用 **Cloudflare Free 作边缘层**（取代 Vercel）：边缘缓存 + 免费 SSL + WAF/DDoS + 隐藏源站 IP，**全免费**。
**源站连通用 Cloudflare Tunnel（Zero Trust Free）**——源站不出网、不开放入站端口，IP 彻底隐藏，免费。
**国内访客提速用社区 优选域名（免费）**——把域名 CNAME 到社区维护的优选 CF 节点；**SaaS 优选（付费）你无预算，已排除**。
SSL：Tunnel 模式下 TLS 由 CF 端处理，源站 nginx 仅监听本地反代即可（若仍走橙云 A 记录回源，则按 §2 用 Origin CA）。

---

## 1. 架构（零预算版）

```
国内访客 ──DNS→ 社区优选域名(免费)→ 连通性好的 CF 边缘节点
                              │
                              ▼
                  Cloudflare 边缘（免费 SSL / 缓存静态 / WAF / DDoS）
                              │ 仅回源动态 + 缓存未命中
                              ▼ (Cloudflare Tunnel, 出站加密通道, 源站不开放入站端口)
                  国内 VPS: nginx(本机反代 :3000) ──▶ SvelteKit(node) ──▶ PostgreSQL
```

- 源站（Docker + PG）留在国内，DB 延迟低；边缘只扛静态与 TLS 卸载，**源站近乎零 CPU 处理缓存命中**。
- **Tunnel 是出站长连接**：源站只需能访问外网，不开放任何入站端口，源站真实 IP 对外不可见，天然抗直连扫描。
- R2 需绑卡订阅，本期不做；`uploads` 走源站卷、在边缘缓存（见 §4 ToS 红线）。

---

## 2. Origin CA 证书安装（你已经生成 ✅）

你粘贴的是 Cloudflare **Origin CA** 证书 + 私钥（CN=CloudFlare，签发者 Managed CA，有效期 10 年）。
它只用于 **Cloudflare ↔ 你的源站** 之间的 TLS，Cloudflare 信任自己的 Origin CA，所以能在 `Full (Strict)` 下校验通过。

> **零预算注意（Tunnel 模式下可省略本段）**：若采用 §5 推荐的 **Cloudflare Tunnel**，源站↔CF 的通道已由 tunnel 加密，源站**无需对外开放 443**，nginx 只监听 `127.0.0.1:3000` 纯反代即可，本段的 Origin CA 证书步骤可省。下方内容保留给"仍想走橙云 A 记录回源"的场景。

### ⚠️ 安全红线（务必读）
- **私钥已经出现在对话里 = 视为已暴露。** 正确做法：在 CF 后台 **Revoke（吊销）这一张，重新生成一张**，新密钥只落到源站、绝不进 git / .env / 任何聊天。
- 落地位置（仅源站本机）：
  - `/etc/nginx/ssl/<域名>.pem`（证书）
  - `/etc/nginx/ssl/<域名>.key`（私钥）
  - `chmod 600`、`chown root:root`，**绝不提交仓库**。
- 开启 **Authenticated Origin Pulls**（SSL/TLS → Origin Server → Authenticated Origin Pulls）：nginx 只接受带 CF 证书的回源连接，配合橙云隐藏源站 IP，彻底堵死直连源站。

### nginx 片段（Origin CA 终止 TLS，反代到 node）
```nginx
server {
    listen 443 ssl;
    server_name your.domain;

    ssl_certificate     /etc/nginx/ssl/your.domain.pem;   # Origin CA 证书
    ssl_certificate_key /etc/nginx/ssl/your.domain.key;   # Origin CA 私钥(600)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_trusted_certificate /etc/nginx/ssl/origin-pull-ca.pem; # CF 的 Authenticated Origin Pull CA
    ssl_verify_client on;                                  # 仅接受 CF 回源

    # 静态产物（SvelteKit _app/immutable 带 hash，可长缓存）
    location /_app/immutable/ {
        proxy_pass http://127.0.0.1:3000;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
> 注意：`ssl_verify_client on` + `ssl_trusted_certificate` 指 CF 的 *Authenticated Origin Pull* CA（在 CF 后台 Origin Server 页可下载），不是你的站点证书。

---

## 3. DNS / SSL 模式

- DNS：A/AAAA 指向源站 IP，**Proxy 状态 = 橙云（Proxied）**。这一步同时隐藏源站真实 IP。
- SSL/TLS → Overview → 模式设为 **Full (Strict)**。
- Always Use HTTPS：开。Brotli：开。

---

## 4. Cache Rules（Free 额度有限，花在刀刃上）

| 规则 | 匹配 | 动作 |
|---|---|---|
| 1 | `/_app/immutable/*` | Cache Everything，Edge TTL = 1 年（与 `immutable` 一致） |
| 2 | `/uploads/*`（图片类） | Cache Everything，Edge TTL = 1 个月 |
| 3 | `/api/*`、`/admin/*`、`/console/*` | **Bypass**（用户态/动态，绝不缓存） |
| 4 | HTML 默认 | 尊重源站头（nginx 给 `s-maxage` 短 TTL + `stale-while-revalidate`） |

### ⚠️ ToS 红线（Free/Pro）
Cloudflare Free/Pro **不允许"不成比例地"用带宽服务视频 / 大量大文件**，否则限速或封停。
普通博客/CMS/图片站点完全没问题；若有**大体积下载/视频**经 `/uploads`，要么别走 CF（直连源站），要么等 R2 绑卡后走 R2+CDN。

---

## 5. IP 优选（针对国内访客）—— 纯免费路径

Cloudflare Free **没有中国大陆节点**，国内访客默认会落到 HK/SG/Tokyo 等边缘，且部分 CF IP 在大陆连通性差。
**优选 = 把域名解析指向国内连通性更好的 Cloudflare IP/域名**，显著提升速度与可用性。

参考文章（用户提供）：https://2x.nz/blog/cf-fastip/

> ⚠️ **已排除 SaaS 优选**：CF 的「自定义主机名 / SaaS」功能需要付费计划（至少 Business，或 SaaS 单独计费），你明确无预算，故不在方案内。下面只走免费路线。

### 免费可用的四条路（按推荐顺序）

| 方案 | 费用 | 适合本架构 | 说明 |
|---|---|---|---|
| **Cloudflare Tunnel（Zero Trust Free）** | 免费 | ✅ 推荐（源站连通 + 隐藏 IP） | 源站不出网、不开放入站端口，IP 彻底隐藏；免费额度含 Tunnel。域名以 Public Hostname 挂到 tunnel 即可，**无需 SaaS**。 |
| **社区 优选域名 CNAME** | 免费（第三方） | ✅ 推荐（访客提速） | 最终域名 CNAME → 社区维护的优选域名（如 `cf.090227.xyz`），其 DNS 解析到国内连通性好的 CF IP。免费，但依赖第三方可用性，需自行监控。 |
| **默认 anycast（仅橙云，不优选）** | 免费 | ✅ 兜底 | 域名直接橙云，接受 CF 默认边缘 IP。零维护，但大陆速度/稳定性一般。 |
| Worker 路由反代 | 免费但有上限 | ⚠️ 不优先 | Free 档 Worker **10 万次请求/天** + 多一跳 + CPU 限制；低流量可，正经站点有风险，仅作兜底。 |

### 推荐落地（零预算）：Tunnel + 橙云 + 社区优选域名
1. **源站连通（Tunnel，必做）**：Zero Trust 后台建 Tunnel，源站跑 `cloudflared`，把你的域名作为 **Public Hostname** 指到本地 `http://localhost:3000`。源站**无需开放任何入站端口**。
2. **边缘缓存 / SSL**：该域名在 CF 侧仍走边缘（WAF / Cache Rules 生效）；TLS 由 CF↔tunnel 通道处理，源站 nginx 仅监听 `127.0.0.1:3000` 反代即可（§2 的 Origin CA 步骤可省）。
3. **访客提速（优选，可选）**：最终域名再做一条 **CNAME → 社区优选域名**（不开橙云那层），或把 DNS 智能线路指向优选 IP。先验证延迟再切流量。
4. **兜底**：若优选域名不稳，回退到默认 anycast 橙云，站点照常可用——**免费方案下"慢但不宕机"是底线**。

> 注意：Tunnel、社区优选域名都不需要 SaaS / 付费；优化效果取决于 CF 在大陆的连通性，优选只能缓解、不保证。

---

## 6. 国内站点的硬限制（必须知道）

- CF Free 在**大陆没有 PoP**，优选只优化「访客→CF 边缘」这一段；「CF 边缘→国内源站」这一跳仍要跨境（GFW），可能慢/不稳。
- 若**大陆速度是要害**，正解是叠加**国内 CDN**（腾讯云/阿里云 CDN）作主加速，CF 仅负责海外 + 安全；但国内 CDN 不是免费的。
- 部分 CF IP/域名在大陆会被限速，优选能缓解但不保证。

---

## 7. 待办 / 未验证
- [ ] 吊销并重发已暴露的 Origin CA 私钥（若走橙云回源才需要；Tunnel 模式可省）。
- [ ] 源站搭建 Cloudflare Tunnel（Zero Trust Free），域名挂 Public Hostname → `localhost:3000`。
- [ ] 域名橙云 + Cache Rules 按 §4 配置，验 `cf-cache-status`。
- [ ] （可选）社区优选域名 CNAME 实测（国内三网延迟对比），不稳则回退默认 anycast。
- [ ] 目标机 `docker compose build` 冒烟（compose/Dockerfile 为蓝图，本机无 Docker 未验证）。
- [ ] 与 R2 绑卡后的异地备份（`BACKUP_OFFSITE_CMD`）对接（绑卡前用本地轮转）。
