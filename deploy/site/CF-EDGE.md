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

Cloudflare Free **没有中国大陆节点**，国内访客默认落到 HK/SG/Tokyo 等边缘，且部分 CF IP 在大陆连通性差。
**优选 = 让解析走到国内连通性更好的 Cloudflare 边缘 IP**，提升速度与可用性。参考文章（用户提供）：https://2x.nz/blog/cf-fastip/

> ⚠️ **已排除 SaaS 优选**：CF「自定义主机名 / SaaS」需付费计划，你明确无预算，已排除。下文只走免费路线。

### 先定一件事：优选有「谁来做」的区别
- **给自己 / 内网 / 公司固定访客用** → 走 **CloudflareST 本地选 IP + hosts / 路由器 DNS**：完全自掌控、零信任成本、最稳。✅ 首选。
- **给全体公开访客用（陌生人）** → 免费下只有 **社区优选域名 CNAME** 一条路，但依赖第三方、有信任 / 可用性风险；或接受「默认 anycast，慢但不宕机」作底线。
- **想彻底解决国内速度** → 必须上**国内 CDN**（腾讯云 / 阿里云），不是免费的。

---

### 5.1 CloudflareST 本地优选（推荐，免费、自掌控）
工具：https://github.com/XIU2/CloudflareSpeedTest （单文件，跨平台，无需安装）

> **关键前提**：你的域名是自己的 CF zone、橙云代理。免费档**服务端无法替访客挑边缘**（CF anycast 决定落点）。
> 本方法的原理是：**访客侧**把域名解析手动指到手选的 CF 边缘 IP；请求仍带你自己的 SNI/Host 打到 CF 边缘，
> CF 照常按 Host 路由到你的源站 / Tunnel——**代理、WAF、缓存都不丢**，只是"走哪台边缘 IP"由你定。
> 这是免费下唯一自掌控、且不牺牲 CF 代理的优选方式。

1. 在**你要提速的那个网络里**跑（⚠️ 必须在目标网络测，如中国家里/公司网；在服务器或国外跑测出的"快 IP"对你无用）。
2. 取**延迟最低、下载速度最好**的 1–3 个 IP（结果在 `result.csv`，默认也打印 Top）。
3. 改解析（二选一）：
   - **本机 hosts**（单人）：`C:\Windows\System32\drivers\etc\hosts`（Win）或 `/etc/hosts`（macOS/Linux）对每个用到的子域各加一行：`优选IP   你的域名`、 `优选IP   子域.你的域名`；
   - **全家 / 公司统一**（推荐）：路由器 / 旁路由（OpenWrt 等）dnsmasq 用**通配**一行覆盖主域 + 全部子域，避免主站走优选 IP、WebSocket / 子域却走默认 anycast 造成不一致：
     ```
     address=/.你的域名/优选IP
     ```
     （例：本站用了 `demo-class.你的域名` 作 WebSocket 子域，通配能一并覆盖 `@` / `www` / `demo-class`。）
4. 验证：`ping 你的域名` 应解析到优选 IP；浏览器 DevTools 看首包延迟、CF 边缘城市（`CF-RAY` 后缀）是否变优。
5. 优选 IP 会漂移（CF 调整 / IP 被限速），建议 **每月重跑一次** 更新。
6. **给全体访客、不用他们动手？** 免费档做不到。只有：社区优选域名 CNAME（信任 / 可用性 / 证书链风险，不推荐当主线）或付费 SaaS / 国内 CDN。

---

### 5.2 社区优选域名 CNAME（给全体访客，免费但信任第三方）
- 找一个**当前仍在维护**的公益优选域名（社区常见如 `cf.090227.xyz` 等，需自己甄别可用性与口碑）。
- DNS 处把 `你的域名` 做 **CNAME → 社区优选域名**，且**不开橙云**（CNAME 到第三方域名无法同时开 CF 代理；优选域名自身已橙云优化）。
- 生效后用国内三网分别 `ping` / `curl -w` 测延迟对比。
- ⚠️ 风险：第三方随时停服 / 被墙 / 作恶（中间人），免费无 SLA；且走别人域名会引入证书与信任链问题，**务必小流量验证并保留回退默认 anycast 的开关**。仅建议作「懒人 / 临时」方案。

---

### 5.3 Worker 路由反代（CF 免费额度，作缓存 / 回源层，不是访客线路优选）
```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = '你的tunnel域名或优选域名';   // 反代到源站 / tunnel
    return fetch(new Request(url, request), { cf: { cacheTtlByStatus: { '200-299': 86400 } } });
  }
};
```
- ⚠️ 关键点：访客访问你的 Worker 域名时，访客 → Worker 边缘这段**仍是默认 anycast**。Worker 的价值是「回源可控 + 边缘缓存」，**不直接优选访客那一段**；要真优选需让访客用优选 IP 访问（回到 5.1 / 5.2）。Free 档 Worker 限 10 万次请求 / 天 + CPU 限制，正经站点仅作兜底。

---

### 5.4 源站连通（Tunnel，免费，隐藏 IP，必做但非优选）
- Zero Trust → Networks → Tunnels → Create → 取名 → 源站装 `cloudflared` 跑命令 → 加 Public Hostname：`你的域名 → http://127.0.0.1:8090`（指向源站 `site` 容器，见 §8 端口说明）。
- 源站**不开放 443/80 入站**，只出网，IP 隐藏。TLS 由 CF 边缘终止，源站跑明文 HTTP 即可，无需放证书。

---

### 推荐落地（零预算）
1. 源站先跑 **Tunnel**（5.4）连通 + 隐藏 IP，保底可用。
2. 你自己 / 内网用 **CloudflareST**（5.1）提速，零信任成本。
3. （可选）若想给全体访客提速，小流量试 **社区优选域名**（5.2），不稳立即回退默认 anycast。
4. **免费方案底线：慢但不宕机。** 优选只缓解、不保证；要稳快请上国内 CDN（付费）。

---

## 6. 国内站点的硬限制（必须知道）

- CF Free 在**大陆没有 PoP**，优选只优化「访客→CF 边缘」这一段；「CF 边缘→国内源站」这一跳仍要跨境（GFW），可能慢/不稳。
- 若**大陆速度是要害**，正解是叠加**国内 CDN**（腾讯云/阿里云 CDN）作主加速，CF 仅负责海外 + 安全；但国内 CDN 不是免费的。
- 部分 CF IP/域名在大陆会被限速，优选能缓解但不保证。

---

## 8. 部署到 CF 实操清单（按序执行）

> 目标：把现有自托管 Docker 源站（site:8090 + postgres + nginx）经 Cloudflare Tunnel 接入 CF 边缘。**应用代码不改**；CF 只负责免费 SSL / 缓存 / WAF / 隐藏源站 IP。

### 8.1 前置安全（公网暴露前必做）
- **`ORIGIN`**：源站运行所用的**真实 `.env`** 必须是正式域名 `https://www.245959623.xyz`（仓库内 `.env.example` 已是该值，但真实 `.env` 在源站、不入库，需你自行确认；若为 `https://localhost` 会导致绝对 URL / 重定向错，且与下面的 `checkOrigin: true` 冲突致全站 POST 403）。
- **`csrf.checkOrigin`**：`svelte.config.js` 已由 `false` 改回 **`true`**（2026-10-20 公网安全收口，Tunnel 接入公网后开启 CSRF origin 校验）。前置硬条件：运行时 `ORIGIN` 与浏览器实际访问域名完全一致，否则所有表单/POST 被判跨站 403。
- Tunnel 模式下源站**不对外开 80/443**，证书（Origin CA）也不需要。

### 8.2 Tunnel 下的 compose 微调（隐藏源站 IP）
当前 `docker-compose.yml`：`nginx` 对外映射 80/443，`site` 仅 `expose 8090`。Tunnel 模式建议：
- `site`：把 `expose: "8090"` 改为 `ports: ["127.0.0.1:8090:8090"]`（只本机可达，cloudflared 才能连）。
- `nginx`：**去掉 `ports: 80/443` 的公网映射**（Tunnel 下不需要公网 443；TLS 由 CF 终止）。或直接删掉 `nginx` 服务，让 Tunnel 直连 `site:8090`（CF Cache Rules 兜底缓存，WebSocket 经 Tunnel 原生支持）。
- 保留 nginx 也行，但那样源站仍开公网 443 = 没隐藏 IP，与 Tunnel 初衷冲突。
- ⚠️ 若删 nginx：原 `client_max_body_size 220m` 的上传上限改由应用层 / CF（免费档约 100MB）承接，大文件上传需另行确认。

### 8.3 执行步骤（CF 侧 + 源站侧）
1. **加站点**：CF 控制台 → 添加站点 `your-domain.example`，按提示把 NS 改到 CF（或仅 DNS 托管）。
2. **SSL 模式**：SSL/TLS → Overview → **Full (Strict)**；Always Use HTTPS 开；Brotli 开。
3. **建 Tunnel**：Zero Trust → Networks → Tunnels → Create Tunnel → 取名（如 `stelarith-site`）→ 选源站系统，复制安装 + 运行命令。
4. **源站装 cloudflared**：在跑 Docker 的源站主机装 `cloudflared`，粘贴第 3 步 token 跑：`cloudflared tunnel --token <TOKEN>`（或用 `cloudflared/config.yml` + `cloudflared tunnel run`，配置文件已置于 `deploy/site/cloudflared/`）。
5. **挂 Public Hostname**：Tunnel 内 Add a public hostname：`your-domain.example` → `http://127.0.0.1:8090`（类型 HTTP）。
6. **DNS 自动**：加 Public Hostname 时 CF 自动建 CNAME 指向 tunnel，**代理由 Tunnel 接管，无需手动橙云**。
7. **Cache Rules**：按 §4 建（`/_app/immutable` 长缓存、`/uploads` 月缓存、`/api|/admin|/console` Bypass）。
8. **验证**：
   - `curl -fsS https://your-domain.example/` 返回站点 HTML；
   - 响应头 `server: cloudflare` + `cf-cache-status`（HIT/MISS）确认走 CF 边缘；
   - `docker compose ps` 与 `docker compose logs -f site` 看 `[boot]` / `[db] PostgreSQL 后端就绪`。
9. **优选（可选）**：按 §5 跑 CloudflareST / 试社区优选域名；不稳回退默认 anycast。

### 8.4 我做不到、需你动手的部分
- 登录你的 CF 账号、改 NS/DNS、建 Tunnel —— 要在 CF 控制台 / 你的终端执行。本环境**无 CF 凭证、也连不到你的源站 VPS**，无法代操作。
- 配置文件 `cloudflared/config.yml` 已就绪，落到源站 `/root/.cloudflared/` 即可用。
- **真正「上线切换流量」这一步由你拍板**（Danger-0：公网生产部署需你明确授权，我不会擅自动线上）。

---

## 7. 待办 / 未验证
- [ ] 吊销并重发已暴露的 Origin CA 私钥（若走橙云回源才需要；Tunnel 模式可省）。
- [ ] 源站搭建 Cloudflare Tunnel（Zero Trust Free），域名挂 Public Hostname → `127.0.0.1:8090`。
- [x] 公网安全收口（2026-10-20）：`svelte.config.js` 的 `csrf.checkOrigin` 已改回 `true`；`ORIGIN` 须为正式域名（源站真实 `.env` 自行确认）。
- [ ] 域名 SSL 模式 Full (Strict) + Cache Rules 按 §4 配置，验 `cf-cache-status`。
- [ ] （推荐）CloudflareST 本地优选：跑测速取 Top IP，改 hosts / 路由器 DNS，每月重选。
- [ ] （可选）社区优选域名 CNAME 实测（国内三网延迟对比），不稳则回退默认 anycast。
- [ ] 目标机 `docker compose build` 冒烟（compose/Dockerfile 为蓝图，本机无 Docker 未验证）。
- [ ] 与 R2 绑卡后的异地备份（`BACKUP_OFFSITE_CMD`）对接（绑卡前用本地轮转）。
