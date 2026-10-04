<script lang="ts">
	export let data: {
		authed: boolean;
		user: { username: string; displayName: string; role: string; avatar?: string } | null;
		client: { id: string; name: string; description?: string; loopback?: boolean; scopes?: string[] } | null;
		error: string | null;
		client_id: string;
		redirect_uri: string;
		state: string;
		scope: string;
		response_type: string;
	};
	export let form: { error?: string } | null = null;

	const errMap: Record<string, string> = {
		unsupported_response_type: "不支持的 response_type（本站只支持 authorization code）",
		unauthorized_client: "未授权的客户端（client_id 未在本站登记）",
		invalid_redirect_uri: "非法的回拨地址（该客户端未登记这个地址）",
		client_not_configured: "该客户端尚未配置密钥，请联系站长先在 .env 里补上",
		client_disabled: "该客户端已被站长停用（配置保留，暂不发放授权）"
	};

	// scope 的中文说明：让用户知道自己到底授权了什么，而不是看到一串英文缩写。
	const scopeLabels: Record<string, string> = {
		profile: "读取你的昵称与头像",
		email: "读取你的邮箱",
		cims: "以你的身份使用集控功能"
	};

	$: shownError = form?.error ?? data.error;
	$: clientName = data.client?.name ?? "第三方应用";
	$: granted = (data.scope || "").split(/[\s,]+/).filter(Boolean);
</script>

<svelte:head>
	<title>授权登录 | Stelarith</title>
</svelte:head>

<div class="wrap">
	<div class="card">
		<h1>授权登录</h1>
		<p class="sub">{data.client?.description ?? `${clientName} 请求使用你的 Stelarith 账号登录`}</p>

		{#if shownError}
			<div class="err">{errMap[shownError] ?? shownError}</div>
		{/if}

		{#if data.client}
			<div class="app">
				<span class="app-name">{clientName}</span>
				<span class="app-id">{data.client.id}</span>
			</div>
			{#if granted.length > 0}
				<ul class="scopes">
					{#each granted as s (s)}
						<li>{scopeLabels[s] ?? `访问 ${s}`}</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if !data.authed}
			<!-- 未登录：在此登录（登录后即网站会话）。用原生提交，确保登录成功后 303 回跳被浏览器跟随 -->
			<form method="POST" action="?/login">
				<input type="hidden" name="client_id" value={data.client_id} />
				<input type="hidden" name="redirect_uri" value={data.redirect_uri} />
				<input type="hidden" name="state" value={data.state} />
				<input type="hidden" name="scope" value={data.scope} />
				<label>用户名 / 邮箱
					<input name="username" autocomplete="username" required />
				</label>
				<label>密码
					<input name="password" type="password" autocomplete="current-password" required />
				</label>
				<button type="submit">登录并继续</button>
			</form>
		{:else}
			<!-- 已登录：展示同意。原生提交，使 302 回拨被浏览器跟随 -->
			<p class="who">
				{#if data.user?.avatar}
					<img class="avatar" src={data.user.avatar} alt="" />
				{/if}
				当前登录：<b>{data.user?.displayName ?? data.user?.username}</b>
				<span class="role">（{data.user?.role}）</span>
			</p>
			<p class="ask">是否授权「{clientName}」使用你的 Stelarith 账号登录？</p>
			<form method="POST" action="?/consent">
				<input type="hidden" name="client_id" value={data.client_id} />
				<input type="hidden" name="redirect_uri" value={data.redirect_uri} />
				<input type="hidden" name="state" value={data.state} />
				<input type="hidden" name="scope" value={data.scope} />
				<button type="submit" class="primary">授权并继续</button>
			</form>
			<p class="hint">
				{#if data.client?.loopback}
					授权后浏览器会跳回本地桌面端（http://127.0.0.1），你可关闭此页面。
				{:else}
					授权后浏览器会跳回 {clientName}，你可关闭此页面。
				{/if}
			</p>
		{/if}
	</div>
</div>

<style>
	.wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0f1115;
		font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
	}
	.card {
		width: 380px;
		max-width: 92vw;
		background: #171a21;
		color: #e8eaf0;
		border: 1px solid #262b36;
		border-radius: 14px;
		padding: 28px 26px;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
	}
	h1 {
		font-size: 20px;
		margin: 0 0 4px;
	}
	.sub {
		margin: 0 0 18px;
		color: #9aa3b2;
		font-size: 13px;
	}
	.err {
		background: #3a1d22;
		color: #ff9aa6;
		padding: 8px 10px;
		border-radius: 8px;
		font-size: 13px;
		margin-bottom: 14px;
	}
	.app {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		background: #10141b;
		border: 1px solid #232938;
		border-radius: 10px;
		padding: 10px 12px;
		margin-bottom: 12px;
	}
	.app-name {
		font-size: 14px;
		font-weight: 600;
	}
	.app-id {
		font-size: 11px;
		color: #6f7a8c;
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
	}
	.scopes {
		margin: 0 0 16px;
		padding-left: 18px;
		color: #9aa3b2;
		font-size: 12px;
		line-height: 1.7;
	}
	label {
		display: block;
		font-size: 13px;
		color: #c4cad6;
		margin-bottom: 12px;
	}
	input {
		width: 100%;
		margin-top: 6px;
		padding: 10px 12px;
		border-radius: 8px;
		border: 1px solid #2c3340;
		background: #0f1218;
		color: #e8eaf0;
		box-sizing: border-box;
	}
	button {
		width: 100%;
		padding: 11px;
		border-radius: 8px;
		border: 1px solid #2c3340;
		background: #222936;
		color: #e8eaf0;
		cursor: pointer;
		font-size: 14px;
	}
	button.primary {
		background: #4f7cff;
		border-color: #4f7cff;
		color: #fff;
	}
	.who {
		font-size: 14px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.avatar {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		object-fit: cover;
		margin: 0;
		padding: 0;
	}
	.role {
		color: #9aa3b2;
		font-size: 12px;
	}
	.ask {
		font-size: 14px;
		margin: 10px 0 16px;
	}
	.hint {
		font-size: 12px;
		color: #7c8696;
		margin-top: 12px;
	}
</style>
