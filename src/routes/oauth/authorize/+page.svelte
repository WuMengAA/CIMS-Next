<script lang="ts">
	export let data: {
		authed: boolean;
		user: { username: string; displayName: string; role: string } | null;
		error: string | null;
		client_id: string;
		redirect_uri: string;
		state: string;
		response_type: string;
	};
	export let form: { error?: string } | null = null;

	const errMap: Record<string, string> = {
		unsupported_response_type: "不支持的 response_type",
		unauthorized_client: "未授权的客户端",
		invalid_redirect_uri: "非法的回拨地址（必须为 http://127.0.0.1 的 /oauth-callback）"
	};

	$: shownError = form?.error ?? data.error;
</script>

<svelte:head>
	<title>星集控 · 授权登录</title>
</svelte:head>

<div class="wrap">
	<div class="card">
		<h1>星集控 · 授权登录</h1>
		<p class="sub">桌面集控端请求使用你的 Stelarith 网站账号登录</p>

		{#if shownError}
			<div class="err">{errMap[shownError] ?? shownError}</div>
		{/if}

		{#if !data.authed}
			<!-- 未登录：在此登录（登录后即网站会话）。用原生提交，确保登录成功后 303 回跳被浏览器跟随 -->
			<form method="POST" action="?/login">
				<input type="hidden" name="client_id" value={data.client_id} />
				<input type="hidden" name="redirect_uri" value={data.redirect_uri} />
				<input type="hidden" name="state" value={data.state} />
				<label>用户名 / 邮箱
					<input name="username" autocomplete="username" required />
				</label>
				<label>密码
					<input name="password" type="password" autocomplete="current-password" required />
				</label>
				<button type="submit">登录并继续</button>
			</form>
		{:else}
			<!-- 已登录：展示同意。原生提交，使 302 回拨到桌面端本地端口被浏览器跟随 -->
			<p class="who">
				当前登录：<b>{data.user?.displayName ?? data.user?.username}</b>
				<span class="role">（{data.user?.role}）</span>
			</p>
			<p class="ask">是否授权「星集控桌面集控端」访问你的集控权限？</p>
			<form method="POST" action="?/consent">
				<input type="hidden" name="client_id" value={data.client_id} />
				<input type="hidden" name="redirect_uri" value={data.redirect_uri} />
				<input type="hidden" name="state" value={data.state} />
				<button type="submit" class="primary">授权并登录桌面端</button>
			</form>
			<p class="hint">授权后浏览器会跳回本地桌面端（http://127.0.0.1），你可关闭此页面。</p>
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
