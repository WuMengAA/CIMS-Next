<script lang="ts">
	/**
	 * 登录授权 / API 管理页。分两层，上半是工具、下半是展示，别混着看：
	 *
	 *   ① 客户端管理 —— 增删改、启停、重置密钥。数据落在数据库表 oauth_clients，
	 *      真能改，所以这一层的表单是原生 POST action（服务端校验），不是纯前端草稿。
	 *   ② 接入速查 —— 把「本站作为授权服务器」的对外契约摊开给第三方对接。
	 *
	 * 视觉上刻意用普通表格/代码块，不做卡片墙 —— 这页是工具不是展示，
	 * 唯一的目标是「看得清、抄得准」。
	 */
	import { applyAction, enhance } from "$app/forms";
	import {
		KeyRound,
		Copy,
		Check,
		ShieldAlert,
		ExternalLink,
		Plus,
		Trash2,
		KeySquare,
		RefreshCw,
		Settings2,
		CircleCheck,
		TriangleAlert,
		Pencil,
		Loader2
	} from "@lucide/svelte";
	import Container from "$lib/components/container.svelte";
	import PageHeader from "$lib/components/page-header.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { Label } from "$lib/components/ui/label/index.js";
	import { confirmDelete } from "$lib/components/admin/confirm.svelte";

	interface ClientView {
		id: string;
		name: string;
		description: string;
		secretConfigured: boolean;
		loopback: boolean;
		enabled: boolean;
		builtin: boolean;
		scopes: string[];
		defaultScope: string;
		redirectUris: string[];
		updatedAt: string;
		authorizeUrl: string;
		tokenUrl: string;
		userInfoUrl: string;
	}

	let { data }: { data: { base: string; baseSource: "site-url" | "origin" | "request"; clients: ClientView[]; flash: any; flashSecret: string } } = $props();

	// 密钥默认打码，并且**首屏根本不下发**：HTML 里的页面数据是明文的，
	// 只做视觉打码等于把密钥摆在源码里。点「显示」时才单独取一次。
	let revealed = $state<Record<string, boolean>>({});
	let secrets = $state<Record<string, string>>({});
	let secretErr = $state<Record<string, string>>({});
	let copied = $state("");

	// 编辑中 / 新增中的表单。刻意用「只渲染一个表单」而不是把五个表单都铺在 DOM 里：
	// 同名 input 同时存在时，浏览器提交取到的是第一个，会串成别家的字段。
	let expanded = $state<string | null>(null);
	let creating = $state(false);
	let busy = $state(false);

	// 新增表单的初值（每个客户端的字段不共享，新建时给个空的）
	const blank = () => ({
		id: "",
		name: "",
		description: "",
		redirectUris: "",
		scopes: "profile",
		defaultScope: "profile",
		loopback: false,
		enabled: true
	});
	let draft = $state(blank());

	function startCreate() {
		draft = blank();
		creating = true;
		expanded = null;
	}

	function startEdit(c: ClientView) {
		draft = {
			id: c.id,
			name: c.name,
			description: c.description,
			redirectUris: c.redirectUris.join("\n"),
			scopes: (c.scopes.length ? c.scopes : ["profile"]).join("\n"),
			defaultScope: c.defaultScope || (c.scopes[0] ?? "profile"),
			loopback: c.loopback,
			enabled: c.enabled
		};
		creating = false;
		expanded = c.id;
	}

	async function reveal(id: string) {
		if (secrets[id] !== undefined) {
			revealed[id] = !revealed[id];
			return;
		}
		try {
			const res = await fetch(`/api/oauth-clients/${encodeURIComponent(id)}/secret`);
			const j = await res.json();
			if (!res.ok) throw new Error(j?.error || "取密钥失败");
			secrets[id] = j.secret ?? "";
			revealed[id] = true;
		} catch (e) {
			secretErr[id] = e instanceof Error ? e.message : "取密钥失败";
		}
	}

	async function copySecret(id: string) {
		if (secrets[id] === undefined) {
			await reveal(id);
			revealed[id] = true;
		}
		const v = secrets[id];
		if (v) await copy(v, id + ":secret");
	}

	async function copy(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// 非 https / 无剪贴板权限时退化为选中，由用户自己复制，总比静默失败好
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			ta.remove();
		}
		copied = key;
		setTimeout(() => (copied = copied === key ? "" : copied), 1500);
	}

	const flashText = $derived.by(() => {
		const f = data.flash;
		if (!f) return "";
		const who = f.id ? `「${f.id}」` : "";
		switch (f.kind) {
			case "saved":
				return `已保存${who}的配置`;
			case "reset":
				return `已重置${who}的密钥，新密钥见下方（只会显示这一次）`;
			case "enabled":
				return `已启用${who}`;
			case "disabled":
				return `已停用${who} —— 配置保留，暂不发放授权`;
			case "deleted":
				return `已删除客户端${who}`;
			case "error":
				return f.message ?? "操作失败";
			default:
				return "";
		}
	});

</script>

<svelte:head>
	<title>登录授权 / API | 管理后台</title>
</svelte:head>

<Container>
	<PageHeader
		title="登录授权 / API"
		description="本站作为授权服务器（IdP）。第三方站点可凭 Client ID + Secret 用你的 Stelarith 账号登录。"
	/>

	{#if flashText}
		<div
			class="mb-6 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm
				{data.flash?.kind === 'error'
				? 'border-destructive/40 bg-destructive/10 text-destructive'
				: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}"
		>
			{#if data.flash?.kind === "error"}
				<TriangleAlert class="size-4 shrink-0" />
			{:else}
				<CircleCheck class="size-4 shrink-0" />
			{/if}
			<span class="min-w-0 flex-1">{flashText}</span>
			{#if data.flash?.kind === "reset" && data.flashSecret}
				<code class="rounded bg-background/70 px-2 py-1 font-mono text-xs break-all">{data.flashSecret}</code>
				<Button variant="outline" size="sm" class="gap-1" onclick={() => copy(data.flashSecret, "flash:secret")}>
					{#if copied === "flash:secret"}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
					复制
				</Button>
			{/if}
		</div>
	{/if}

	<div class="mb-6 rounded-xl border border-border/60 bg-card p-5 text-sm text-muted-foreground">
		<p class="mb-2 text-foreground">
			<b>密钥存在数据库里</b>，改完立刻生效、不用重启；<code class="rounded bg-muted px-1">content/oauth-clients.json</code>
			只在库里还没有某个客户端时补播种一次，之后以数据库为准。
		</p>
		<p>
			本站对外根地址：<code class="rounded bg-muted px-1 text-foreground">{data.base}</code>
			{#if data.baseSource === "request"}
				<span class="text-amber-600 dark:text-amber-400">（PUBLIC_SITE_URL 与 ORIGIN 都没配，取的是本次访问地址 —— 生产环境应当显式配置）</span>
			{/if}
		</p>
	</div>

	<!-- ── 客户端管理 ───────────────────────────────────────────────────── -->
	<div class="mb-3 flex items-center justify-between gap-3">
		<h2 class="flex items-center gap-2 font-heading text-lg font-semibold">
			<KeySquare class="size-4 text-primary" /> 客户端管理
		</h2>
		{#if !creating}
			<Button variant="outline" size="sm" class="gap-1" onclick={startCreate}>
				<Plus class="size-3.5" /> 新增客户端
			</Button>
		{/if}
	</div>

	{#if creating}
		<section class="mb-6 rounded-xl border border-primary/40 bg-card p-5">
			<h3 class="mb-4 flex items-center gap-2 font-heading text-base font-semibold">
				<Settings2 class="size-4 text-primary" /> 新增客户端
			</h3>
			<form
				method="POST"
				action="?/save"
				use:enhance={() => {
					busy = true;
					return async ({ result }) => {
						await applyAction(result);
						busy = false;
						if (result.type === "success") {
							creating = false;
							draft = blank();
						}
					};
				}}
				class="flex flex-col gap-4"
			>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label for="new-id">Client ID</Label>
						<Input id="new-id" name="id" placeholder="voicehub" required bind:value={draft.id} />
						<p class="text-[11px] text-muted-foreground">对外公开的标识，小写字母数字与 - . _ ，2–64 位</p>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="new-name">显示名</Label>
						<Input id="new-name" name="name" placeholder="VoiceHub 校园广播" required bind:value={draft.name} />
						<p class="text-[11px] text-muted-foreground">同意页上给用户看的名字</p>
					</div>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="new-desc">说明</Label>
					<Textarea id="new-desc" name="description" rows={2} placeholder="这个客户端是做什么的" bind:value={draft.description} />
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label for="new-uris">允许的回拨地址</Label>
						<Textarea id="new-uris" name="redirectUris" rows={3} placeholder={"https://example.com/api/auth/oauth2/callback"} bind:value={draft.redirectUris} />
						<p class="text-[11px] text-muted-foreground">每行一个，必须与对方后台填的一字不差（结尾斜杠忽略）</p>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="new-scopes">允许的 Scope</Label>
						<Textarea id="new-scopes" name="scopes" rows={3} placeholder="profile&#10;email" bind:value={draft.scopes} />
						<p class="text-[11px] text-muted-foreground">每行一个；对方要多要都会被收敛掉</p>
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-3">
					<div class="flex flex-col gap-1.5">
						<Label for="new-default">默认 Scope</Label>
						<Input id="new-default" name="defaultScope" bind:value={draft.defaultScope} />
					</div>
					<div class="flex flex-col justify-end gap-1.5">
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" name="loopback" class="accent-primary" bind:checked={draft.loopback} />
							允许本机回拨
						</label>
						<p class="text-[11px] text-muted-foreground">桌面端用：http://127.0.0.1:&lt;任意端口&gt;/oauth-callback</p>
					</div>
					<div class="flex flex-col justify-end gap-1.5">
						<label class="flex items-center gap-2 text-sm">
							<input type="checkbox" name="enabled" class="accent-primary" checked />
							立即启用
						</label>
					</div>
				</div>
				<div class="flex items-center gap-2">
					<Button type="submit" size="sm" class="gap-1" disabled={busy}>
						{#if busy}<Loader2 class="size-3.5 animate-spin" />{:else}<Check class="size-3.5" />{/if}
						创建并生成密钥
					</Button>
					<Button type="button" variant="ghost" size="sm" onclick={() => (creating = false)}>取消</Button>
					<p class="text-[11px] text-muted-foreground">不填密钥会自动生成一枚，点保存后只显示这一次</p>
				</div>
			</form>
		</section>
	{/if}

	<div class="flex flex-col gap-6">
		{#each data.clients as c (c.id)}
			<section class="rounded-xl border border-border/60 bg-card">
				<header class="flex flex-wrap items-center gap-3 border-b border-border/40 px-5 py-4">
					<KeyRound class="size-4 text-primary" />
					<h2 class="font-heading text-base font-semibold">{c.name}</h2>
					<code class="rounded bg-muted px-1.5 py-0.5 text-xs">{c.id}</code>

					{#if !c.enabled}
						<Badge variant="secondary" class="text-xs">已停用</Badge>
					{:else if !c.secretConfigured}
						<Badge variant="secondary" class="gap-1 text-xs text-amber-600 dark:text-amber-400">
							<ShieldAlert class="size-3" /> 密钥未配置
						</Badge>
					{:else}
						<Badge variant="outline" class="gap-1 text-xs text-emerald-600 dark:text-emerald-400">
							<CircleCheck class="size-3" /> 运行中
						</Badge>
					{/if}
					{#if c.loopback}<Badge variant="outline" class="text-xs">原生应用回拨</Badge>{/if}
					{#if c.builtin}<Badge variant="outline" class="text-xs">内置</Badge>{/if}

					<div class="ml-auto flex flex-wrap items-center gap-1.5">
						<!-- 启停：配置保留，只掐断发放令牌。
							这里必须是 checkbox 而不是 hidden —— hidden 的值永远存在，
							服务端只能读到「有值」，点「停用」反而会被当成勾选。 -->
						<form method="POST" action="?/toggle" use:enhance class="contents">
							<input type="hidden" name="id" value={c.id} />
							<input type="checkbox" name="enabled" class="mr-1 accent-primary align-middle" checked={c.enabled} />
							<Button variant="outline" size="sm" class="gap-1" disabled={busy}>
								{#if busy}<Loader2 class="size-3.5 animate-spin" />{:else}<Settings2 class="size-3.5" />{/if}
								{c.enabled ? "停用" : "启用"}
							</Button>
						</form>
						<Button variant="outline" size="sm" class="gap-1" onclick={() => startEdit(c)}>
							<Pencil class="size-3.5" /> 编辑
						</Button>
						<form
							method="POST"
							action="?/resetSecret"
							use:enhance={() => {
								busy = true;
								return async ({ result }) => {
									await applyAction(result);
									busy = false;
								};
							}}
							class="contents"
						>
							<input type="hidden" name="id" value={c.id} />
							<Button variant="outline" size="sm" class="gap-1" disabled={busy}>
								<RefreshCw class="size-3.5" /> 重置密钥
							</Button>
						</form>
						<form
							method="POST"
							action="?/remove"
							use:enhance={() => {
								busy = true;
								return async ({ result }) => {
									await applyAction(result);
									busy = false;
								};
							}}
							class="contents"
							onsubmit={async (e) => {
								if (!(await confirmDelete(`删除客户端「${c.name}」`, `${c.id} 将立即无法登录。此操作不可恢复。`)))
									e.preventDefault();
							}}
						>
							<input type="hidden" name="id" value={c.id} />
							<Button variant="ghost" size="sm" class="gap-1 text-destructive hover:text-destructive" disabled={c.builtin || busy}>
								<Trash2 class="size-3.5" /> {c.builtin ? "内置不可删" : "删除"}
							</Button>
						</form>
					</div>
				</header>

				<div class="flex flex-col gap-4 px-5 py-4">
					{#if c.description}
						<p class="text-sm text-muted-foreground">{c.description}</p>
					{/if}

					{#if expanded === c.id}
						<form
							method="POST"
							action="?/save"
							use:enhance={() => {
								busy = true;
								return async ({ result }) => {
									await applyAction(result);
									busy = false;
									if (result.type === "success") expanded = null;
								};
							}}
							class="flex flex-col gap-4 rounded-xl border border-border/60 bg-muted/30 p-4"
						>
							<input type="hidden" name="id" value={c.id} />
							<div class="grid gap-4 sm:grid-cols-2">
								<div class="flex flex-col gap-1.5">
									<Label for={`name-${c.id}`}>显示名</Label>
									<Input id={`name-${c.id}`} name="name" required bind:value={draft.name} />
								</div>
								<div class="flex flex-col gap-1.5">
									<Label for={`desc-${c.id}`}>Client ID</Label>
									<Input id={`desc-${c.id}`} value={c.id} disabled />
									<p class="text-[11px] text-muted-foreground">标识建好之后不能改（改了对方后台要跟着改）</p>
								</div>
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for={`d-${c.id}`}>说明</Label>
								<Textarea id={`d-${c.id}`} name="description" rows={2} bind:value={draft.description} />
							</div>
							<div class="grid gap-4 sm:grid-cols-2">
								<div class="flex flex-col gap-1.5">
									<Label for={`u-${c.id}`}>允许的回拨地址</Label>
									<Textarea id={`u-${c.id}`} name="redirectUris" rows={4} bind:value={draft.redirectUris} />
								</div>
								<div class="flex flex-col gap-1.5">
									<Label for={`s-${c.id}`}>允许的 Scope</Label>
									<Textarea id={`s-${c.id}`} name="scopes" rows={4} bind:value={draft.scopes} />
								</div>
							</div>
							<div class="grid gap-4 sm:grid-cols-3">
								<div class="flex flex-col gap-1.5">
									<Label for={`ds-${c.id}`}>默认 Scope</Label>
									<Input id={`ds-${c.id}`} name="defaultScope" bind:value={draft.defaultScope} />
								</div>
								<label class="flex items-center gap-2 text-sm">
									<input type="checkbox" name="loopback" class="accent-primary" bind:checked={draft.loopback} />
									允许本机回拨
								</label>
								<label class="flex items-center gap-2 text-sm">
									<input type="checkbox" name="enabled" class="accent-primary" checked={c.enabled} />
									保存并保留启用状态
								</label>
							</div>
							<div class="flex flex-col gap-1.5">
								<Label for={`sec-${c.id}`}>指定密钥（可选）</Label>
								<Input id={`sec-${c.id}`} name="secret" placeholder="留空则不改动当前密钥" autocomplete="off" />
								<p class="text-[11px] text-muted-foreground">
									留空 = 保持原密钥。要换就填一个新随机串，并同步更新到对方后台。
								</p>
							</div>
							<div class="flex items-center gap-2">
								<Button type="submit" size="sm" class="gap-1" disabled={busy}>
									{#if busy}<Loader2 class="size-3.5 animate-spin" />{:else}<Check class="size-3.5" />{/if}
									保存
								</Button>
								<Button type="button" variant="ghost" size="sm" onclick={() => (expanded = null)}>取消</Button>
							</div>
						</form>
					{/if}

					{#if !c.secretConfigured}
						<div class="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
							还没配密钥：用上面的「重置密钥」生成一枚并复制过去填到对方后台。密钥为空时该客户端一律拒绝授权（不会是「看起来成功但其实登录不了」）。
						</div>
					{/if}

					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<tbody class="divide-y divide-border/40">
								<tr>
									<td class="w-32 py-2.5 pr-4 align-top text-muted-foreground">授权地址</td>
									<td class="py-2.5">
										<div class="flex items-center gap-2">
											<code class="min-w-0 flex-1 break-all text-xs">{c.authorizeUrl}</code>
											<Button variant="ghost" size="sm" class="shrink-0 gap-1" onclick={() => copy(c.authorizeUrl, c.id + ":authorize")}>
												{#if copied === c.id + ":authorize"}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
											</Button>
										</div>
									</td>
								</tr>
								<tr>
									<td class="w-32 py-2.5 pr-4 align-top text-muted-foreground">令牌地址</td>
									<td class="py-2.5">
										<div class="flex items-center gap-2">
											<code class="min-w-0 flex-1 break-all text-xs">{c.tokenUrl}</code>
											<Button variant="ghost" size="sm" class="shrink-0 gap-1" onclick={() => copy(c.tokenUrl, c.id + ":token")}>
												{#if copied === c.id + ":token"}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
											</Button>
										</div>
									</td>
								</tr>
								<tr>
									<td class="w-32 py-2.5 pr-4 align-top text-muted-foreground">用户信息地址</td>
									<td class="py-2.5">
										<div class="flex items-center gap-2">
											<code class="min-w-0 flex-1 break-all text-xs">{c.userInfoUrl}</code>
											<Button variant="ghost" size="sm" class="shrink-0 gap-1" onclick={() => copy(c.userInfoUrl, c.id + ":userinfo")}>
												{#if copied === c.id + ":userinfo"}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
											</Button>
										</div>
									</td>
								</tr>
								<tr>
									<td class="w-32 py-2.5 pr-4 align-top text-muted-foreground">Client ID</td>
									<td class="py-2.5">
										<div class="flex items-center gap-2">
											<code class="min-w-0 flex-1 text-xs">{c.id}</code>
											<Button variant="ghost" size="sm" class="shrink-0 gap-1" onclick={() => copy(c.id, c.id + ":id")}>
												{#if copied === c.id + ":id"}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
											</Button>
										</div>
									</td>
								</tr>
								<tr>
									<td class="w-32 py-2.5 pr-4 align-top text-muted-foreground">Client Secret</td>
									<td class="py-2.5">
										<div class="flex items-center gap-2">
											<code class="min-w-0 flex-1 break-all text-xs"
												>{revealed[c.id] ? secrets[c.id] ?? "（空）" : c.secretConfigured ? "••••••••••••" : "（未配置）"}</code
											>
											<Button
												variant="ghost"
												size="sm"
												class="shrink-0"
												disabled={!c.secretConfigured}
												onclick={() => reveal(c.id)}
											>
												{revealed[c.id] ? "隐藏" : "显示"}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												class="shrink-0 gap-1"
												disabled={!c.secretConfigured}
												onclick={() => copySecret(c.id)}
											>
												{#if copied === c.id + ":secret"}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
											</Button>
										</div>
										{#if secretErr[c.id]}
											<p class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{secretErr[c.id]}</p>
										{/if}
									</td>
								</tr>
								<tr>
									<td class="w-32 py-2.5 pr-4 align-top text-muted-foreground">Scope</td>
									<td class="py-2.5 text-xs">
										允许：{c.scopes.length ? c.scopes.join(" / ") : "不限"}
										{#if c.defaultScope}<span class="text-muted-foreground"> · 默认 {c.defaultScope}</span>{/if}
									</td>
								</tr>
								<tr>
									<td class="w-32 py-2.5 pr-4 align-top text-muted-foreground">允许的回拨地址</td>
									<td class="py-2.5 text-xs">
										{#if c.redirectUris.length === 0 && !c.loopback}
											<span class="text-amber-600 dark:text-amber-400">未登记任何地址 —— 这个客户端目前无法登录</span>
										{/if}
										{#each c.redirectUris as u (u)}
											<div class="flex items-center gap-2">
												<code class="min-w-0 flex-1 break-all">{u}</code>
												<Button variant="ghost" size="sm" class="shrink-0 gap-1" onclick={() => copy(u, c.id + u)}>
													{#if copied === c.id + u}<Check class="size-3.5" />{:else}<Copy class="size-3.5" />{/if}
												</Button>
											</div>
										{/each}
										{#if c.loopback}
											<code>http://127.0.0.1:&lt;任意端口&gt;/oauth-callback</code>
										{/if}
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					{#if c.id === "voicehub"}
						<details class="rounded-lg border border-border/60 bg-muted/30 px-4 py-3" open>
							<summary class="cursor-pointer text-sm font-medium">VoiceHub 后台怎么填（OAuth 配置）</summary>
							<ol class="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-xs text-muted-foreground">
								<li>打开 VoiceHub 管理后台 → 系统设置 → OAuth 配置，启用「自定义 OAuth2」。</li>
								<li>
									作者地址 / 令牌地址 / 用户信息地址依次填上面三行；Client ID 填 <code>{c.id}</code>；
									Client Secret 点上面的「显示」后复制过去。
								</li>
								<li>
									Scope 填 <code>{c.defaultScope || "profile"}</code>（VoiceHub 默认发的是
									<code>openid profile email</code>，本站会自动收敛成 <code>{(c.scopes || []).join(" ")}</code>）。
								</li>
								<li>
									显示名可填 <b>Stelarith</b>；<b>字段映射建议全部留空</b> —— 本站 userinfo 同时返回
									<code>id/sub</code>、<code>name/display_name</code>、<code>avatar/picture</code> 等别名，走对方的兜底探测即可。
								</li>
								<li>
									回调地址必须与本站登记的一模一样（VoiceHub 侧固定为
									<code>/api/auth/oauth2/callback</code>），差一个斜杠都会在授权第一步被拒。
								</li>
							</ol>
						</details>
					{/if}
				</div>
			</section>
		{/each}
	</div>

	<!-- ── 协议要点 ─────────────────────────────────────────────────────── -->
	<div class="mt-8 rounded-xl border border-border/60 bg-card p-5 text-xs text-muted-foreground">
		<p class="mb-2 font-medium text-foreground">协议要点</p>
		<ul class="flex list-disc flex-col gap-1.5 pl-5">
			<li>授权码流程：<code>GET /oauth/authorize?client_id&amp;redirect_uri&amp;response_type=code&amp;scope&amp;state</code> → 回拨 <code>?code&amp;state</code>。</li>
			<li>换令牌：<code>POST /oauth/token</code>（application/x-www-form-urlencoded，也支持 HTTP Basic 传凭据），返回 <code>access_token</code>。</li>
			<li>取用户：<code>GET /oauth/userinfo</code> + <code>Authorization: Bearer &lt;access_token&gt;</code>。</li>
			<li>授权码 5 分钟过期、单次使用，存在服务进程内存里 —— 换令牌必须落在同一进程（本站是单实例，正常情况无需关心）。</li>
			<li>
				拿到 access_token 只代表「这人是谁」，不代表有后台权限：真正的权限判定仍在各 API 端点（如
				<code>/api/console/cims/*</code>）。
			</li>
			<li>客户端被「停用」后，授权页与换令牌都会直接拒绝；已发出的令牌不受影响。</li>
		</ul>
		<p class="mt-3 flex items-center gap-1.5">
			<ExternalLink class="size-3" />
			入口页：<a class="text-primary hover:underline" href="/oauth/authorize" target="_blank">/oauth/authorize</a>
			（直接打开会提示缺少 client_id，属正常）
		</p>
	</div>
</Container>
