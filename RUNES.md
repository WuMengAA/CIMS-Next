# Svelte 5 Runes 速查（本仓库约定）

本项目运行在 **Svelte 5 runes 模式**（vite.config.ts 强制开启）。与 Svelte 4 的差异和坑如下。

## 1. 状态声明

```ts
let count = $state(0);       // 可变状态
const doubled = $derived(count * 2); // 派生值（顶层声明）
let { title }: { title: string } = $props(); // 组件属性
```

## 2. 常见坑

### `$page` 不是 store
`$app/state` 导出的是 **rune**，不是 store。正确用法：

```ts
import { page } from "$app/state";
const path = $derived(page.url.pathname); // 不要写 $page.url.pathname
```

写 `$page.x` 会报 `store_invalid_shape`（SSR 时 500）。

### rune 不能用在普通函数内

```ts
// ❌ 错误：函数内用 rune
function isActive(url: string) {
	return $page.url.pathname === url;
}

// ✅ 正确：顶层 $derived，函数内用变量
const path = $derived(page.url.pathname);
function isActive(url: string) {
	return path === url;
}
```

### `$derived` 的返回值
`$derived(() => {...})` 返回的是信号引用，**不能**直接 `()` 调用。需要即时计算时用普通 IIFE 或函数调用。

## 3. 事件绑定

Svelte 5 用 `onclick={...}` 代替 `on:click`。拖拽事件同理：`ondragstart`、`ondragover`、`ondrop`。

## 4. 组件插槽

`<slot />` 已弃用，改用 snippet：

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	let { children }: { children?: Snippet } = $props();
</script>

{@render children()}
```

## 5. 内容文件编码

- 源码和 content/ 下的 .md 文件一律 **UTF-8**
- 用 PowerShell 写文件时避免用双引号 here-string 拼 Svelte 模板（反引号/花括号会转义出错），优先用仓库内的 write 工具或 Node 脚本