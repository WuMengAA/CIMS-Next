# 集控面板 SSO 接入 stelarith-website（/console 路由 + 服务端代理）

> 目标：电教委员在网站登录后，直接进入集控面板；面板对 CIMS 的调用由**网站服务端代理**，浏览器不持有 CIMS 凭据。

## 一、为什么走服务端代理（安全）

直接在浏览器跑 `admin-console` 并填 CIMS Bearer Token，会把设备集控凭据暴露在前端，风险高。正确做法：

```
浏览器(网站已登录 admin_token)
   │  /console 页面（同源，共享 Cookie）
   ▼
SvelteKit 服务端路由 +page.server.ts / +server.ts
   │  校验网站角色 can(role,"viewConsole")
   │  服务端持 CIMS 凭据，代理调用 CIMS management API
   ▼
CIMS（设备命令 / 资源写 / 通知）
```

- 浏览器永远只和**同源网站**通信；CIMS 地址+令牌只在服务端配置（`$env` / `.env`）。
- RBAC 由网站 `can(role, action)` 强制；越权请求在服务端被拒。

## 二、新增路由（在 stelarith-website/stelarith 内）

### `src/routes/console/+page.svelte`
嵌入集控面板（把 `admin-console/src` 的 `index.html` 资源放到 `static/console/` 或直接 `/console` 下渲染 `<StelarithConsole />`）。

### `src/routes/console/+page.server.ts`
```ts
import { redirect } from "@sveltejs/kit";
import { verifyToken } from "$lib/server/auth.js";
import { can } from "$lib/permissions.js";

export function load({ cookies }) {
  const u = verifyToken(cookies.get("admin_token") ?? "");
  if (!u || !can(u.role, "viewConsole")) throw redirect(303, "/admin/login");
  // 把"当前用户能做什么"下发给面板，前端据此渲染菜单
  return { role: u.role, can: { control: can(u.role,"controlDevice"), remote: can(u.role,"remoteControl") } };
}
```

### `src/routes/api/console/cims/+server.ts`（代理 CIMS）
```ts
// 服务端代理：面板发 {path, method, body}，本路由补 CIMS 令牌后转发，回传结果。
// 仅放行白名单 path（/account/.../client/...、/account/.../write、/user/auth 等），防 SSRF。
import { json } from "@sveltejs/kit";
const CIMS = process.env.CIMS_MANAGEMENT_URL;
const TOKEN = process.env.CIMS_TOKEN; // 服务端预置，或使用 /user/auth 换取
export async function POST({ request }) {
  const { path, method = "GET", body } = await request.json();
  if (!/^\/account\//.test(path)) return json({ error: "forbidden" }, { status: 403 });
  const r = await fetch(CIMS + path, {
    method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return json(await r.json(), { status: r.status });
}
```

## 三、环境变量（服务端，不进 git）
```
CIMS_MANAGEMENT_URL=http://127.0.0.1:8081
CIMS_TOKEN=<服务端预置或启动时经 /user/auth 换取>
STELARITH_AGENT_SECRET=<与设备侧 StelarithAgent 一致的共享密钥>
```

## 四、联动小结
- **SSO**：复用网站 `admin_token`，一套账户/角色全站通用。
- **代理**：CIMS 凭据不出服务端，前端零敏感信息。
- **RBAC**：网站 `can(role, action)` 统一裁决，集控动作与 CMS 动作同源管控。
- **内容下发**：网站 CMS 改内容 → `sync-to-cims.mjs` → CIMS 资源写 → 设备 Manifest 自动生效（见 `sync-to-cims.mjs`）。
