# Stelarith CMS — 面板托管部署指南（宝塔 / 1Panel 通用）

适用：你已有面板（宝塔 / 1Panel 等），目标服务器可 SSH 或面板文件管理访问。
目标是让 `www.245959623.xyz` 反代到本机 `stelarith` 的 Node 服务（默认 3000 端口）。

> 本项目是**文件型 CMS**：内容在 `content/`、上传在 `uploads/`，后台会**写文件**。
> 因此 `content/` 与 `uploads/` 必须落在部署目录内并持久化，切勿放到临时/只读卷。

---

## 一、准备部署包（在本地 / 构建机完成）

把以下文件/目录打包上传（其余如 `src/`、`node_modules` 里 dev 依赖不需要）：

```
stelarith-deploy/
├── .svelte-kit/output/      # 构建产物（server/ + client/）★必须
├── package.json              # 运行依赖声明（adapter-node 已加入）
├── pnpm-lock.yaml           # 锁定版本（可选，便于重装）
├── content/                 # 内容（Markdown + users.json 等）★必须保留
├── uploads/                 # 媒体上传 ★必须保留
├── start.sh                 # 启动脚本（已提供）
└── .env                     # 环境变量（由 .env.example 复制修改）★必须
```

> 说明：`.svelte-kit/output` 已是 adapter-node 自包含产物，运行时只需 Node（>=18，建议 20/22）。
> 若服务器上仍想走 `pnpm install --prod` 拉运行依赖，带上 `package.json` + `pnpm-lock.yaml` 即可；
> 但最简做法是直接用 `.svelte-kit/output` 产物 + `node`，不依赖 node_modules。

`.env` 由 `.env.example` 复制并修改，至少设置：
```
ADMIN_PASSWORD=<强密码，务必改>
COOKIE_SECURE=true
ORIGIN=https://www.245959623.xyz
PUBLIC_SITE_URL=https://www.245959623.xyz
PORT=3000
HOST=0.0.0.0
```

---

## 二、上传与解压

1. 面板「文件」进入目标目录（如 `/www/wwwroot/stelarith` 或 `/opt/stelarith`）。
2. 上传 `stelarith-deploy.zip` 并解压到该目录，确保结构如上。
3. 确认 `content/`、`uploads/` 已就位（后台写入依赖它们）。

---

## 三、创建 Node 项目（面板通用步骤）

在面板「Node 项目 / 网站 → Node」中：

| 配置项 | 值 |
|---|---|
| 项目根目录 | 上面的部署目录（如 `/www/wwwroot/stelarith`） |
| 启动命令 | `bash start.sh`（或 `node .svelte-kit/output/server/index.js`） |
| 运行端口 | `3000`（与 start.sh / 环境变量一致） |
| Node 版本 | 选 20 或 22（>=18 即可） |
| 安装依赖 | 若未自带 node_modules，选「安装依赖」执行 `pnpm install --prod` 或忽略（产物自包含） |
| 环境变量 | 面板若提供Env UI，填 `ADMIN_PASSWORD`/`COOKIE_SECURE`/`ORIGIN` 等；否则用同目录 `.env`，start.sh 会自动加载 |

保存并启动，观察日志应出现监听 `0.0.0.0:3000`，无报错。

---

## 四、反向代理 + 域名

在面板「网站」中添加站点：

1. 域名填 `www.245959623.xyz`（若也要裸域，加 `245959623.xyz` 并设 301 到 www）。
2. 反向代理：目标 URL `http://127.0.0.1:3000`，发送域名 `$host`，开启 WebSocket（SvelteKit 用不到 WS，但开着无妨）。
3. 代理不缓存（`Cache-Control` 关闭），超时可适当调大。

验证：浏览器开 `http://服务器IP:3000` 应返回站点首页（200）；代理生效后经域名也应 200。

---

## 五、SSL（HTTPS）

面板「网站 → SSL」申请 Let's Encrypt 证书（需域名已解析到本机，见第七节），
勾选「强制 HTTPS」。申请后 `COOKIE_SECURE=true` 才会让登录 Cookie 标记 Secure，否则后台登录可能异常。

---

## 六、启动后验证

1. 访问 `https://www.245959623.xyz/` → 首页 200。
2. 访问 `https://www.245959623.xyz/admin` → 后台登录页。
3. 用 `ADMIN_PASSWORD` 登录，**立即在「用户管理」修改管理员密码**（源码有默认种子密码，必须覆盖）。
4. 后台「站点设置 → 数据备份」导出一次 JSON 存档。

---

## 七、DNS（你持有控制权）

在域名控制台把 `www.245959623.xyz` 的 **A 记录**指向目标服务器**公网 IP**。
若用 Cloudflare，代理模式（橙色云）可顺带加速/隐藏 IP；注意 Cloudflare 默认不转发部分端口，用 80/443 反代即可（已在第四节配好）。

---

## 八、更新流程

1. 本地/构建机 `pnpm build` 重新生成 `.svelte-kit/output`。
2. 仅覆盖服务器上的 `.svelte-kit/output/` 目录（保留 `content/`、`uploads/`、`.env` 不动）。
3. 面板重启 Node 项目。

> 切勿删除 `content/` 与 `uploads/`，否则内容/上传丢失。如需版本化，可对这两个目录单独做 Git/备份。

---

## 九、故障排查

- **启动报 `Cannot find module`**：产物非自包含，需在服务器 `pnpm install --prod` 或确认上传完整。
- **后台登录后跳回登录页 / Cookie 不生效**：检查 `COOKIE_SECURE=true` 且站点已 HTTPS；HTTP 下应设 `false`。
- **写文章/上传报权限错误**：`content/`、`uploads/` 目录权限需让 Node 进程可写（面板通常以 www 用户运行，确保属主/权限正确）。
- **/admin 404 或 500**：确认 `ADMIN_PASSWORD` 已设；查看 Node 项目运行日志。
- **内存不足构建失败**（仅构建机）：空闲内存需 >2GB，先停掉本地 dev server 再 build。
