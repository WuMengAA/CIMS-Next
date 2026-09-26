<script lang="ts">
	// 老师手机页二维码弹窗（T09 第二步 · 移动端套壳入口）。
	// 动态加载本地化 qrcodejs（static/console/vendor/qrcode.min.js，无外部依赖），
	// 二维码内容默认 = 局域网 IP 的 /teacher（老师手机与本机同 Wi-Fi 即可扫码直通），
	// 内容可编辑，改动即时重绘。host 页与老师页共用本组件。
	// 父组件 bind:open 打开/关闭（避免 $expose 在 rolldown 编译路径的兼容问题）。
	let { open = $bindable(false), lanHost = "" } = $props<{ open?: boolean; lanHost?: string }>();

	let url = $state("");
	let urlInput = $state("");
	let qrErr = $state("");
	let libReady = $state(false);
	let libSlow = $state(false);
	let container: HTMLDivElement | undefined = $state();

	// open 变 true 时初始化并渲染二维码（幂等）
	$effect(() => {
		if (!open) return;
		if (url === "") {
			url = defaultUrl();
			urlInput = url;
		}
		if (!libReady) {
			loadLib()
				.then(() => {
					libReady = true;
					renderQr();
				})
				.catch((e) => {
					qrErr = String((e as Error).message || e);
				});
			setTimeout(() => {
				if (!libReady && open) libSlow = true;
			}, 1200);
		} else {
			renderQr();
		}
	});

	function defaultUrl(): string {
		let host = "";
		let proto = "http:";
		let port = "";
		try {
			host = lanHost || location.hostname;
			proto = location.protocol;
			port = location.port ? ":" + location.port : "";
		} catch {
			host = lanHost || "127.0.0.1";
		}
		const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
		return `${proto}//${h}${port}/teacher`;
	}

	function loadLib(): Promise<void> {
		return new Promise((resolve, reject) => {
			if ((globalThis as any).QRCode) return resolve();
			const s = document.createElement("script");
			s.src = "/console/vendor/qrcode.min.js";
			s.onload = () => resolve();
			s.onerror = () =>
				reject(new Error("二维码库加载失败（离线环境缺失 static/console/vendor/qrcode.min.js）"));
			document.head.appendChild(s);
		});
	}

	function renderQr() {
		if (!container || !libReady) return;
		container.innerHTML = "";
		try {
			const QC = (globalThis as any).QRCode;
			new QC(container, {
				text: urlInput || url,
				width: 216,
				height: 216,
				colorDark: "#1c1b18",
				colorLight: "#ffffff",
				correctLevel: QC.CorrectLevel.M
			});
			qrErr = "";
		} catch (e) {
			qrErr = "二维码生成失败：" + String((e as Error).message || e);
		}
	}

	async function openDialog() {
		url = defaultUrl();
		urlInput = url;
		open = true;
	}

	function close() {
		open = false;
	}

	function onInput() {
		url = urlInput;
		renderQr();
	}
</script>

{#if open}
	<div
		class="qr-mask"
		onclick={(e) => {
			if (e.target === e.currentTarget) close();
		}}
	>
		<div class="qr-card" role="dialog" aria-label="老师手机页二维码">
			<div class="qr-head">
				<span>📱 老师手机页</span>
				<button type="button" class="qr-x" onclick={close} aria-label="关闭">✕</button>
			</div>
			<p class="qr-desc">
				手机与本机连接同一网络时扫码直达老师页；在手机浏览器里「添加到主屏幕」后即可像 App
				一样全屏打开（PWA 套壳）。
			</p>
			<div class="qr-box">
				<div class="qr-canvas" bind:this={container}></div>
				{#if !libReady}
					<div class="qr-wait">{libSlow ? "正在加载二维码组件…" : "准备中…"}</div>
				{/if}
				{#if qrErr}
					<div class="qr-err">{qrErr}</div>
				{/if}
			</div>
			<label class="qr-url-label">
				二维码内容（可改）
				<input class="qr-url" bind:value={urlInput} oninput={onInput} spellcheck="false" />
			</label>
			<div class="qr-foot">
				<a class="qr-link" href={url} target="_blank" rel="noopener">直接打开 →</a>
				<button type="button" class="qr-btn" onclick={close}>关闭</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.qr-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 3000;
		padding: 20px;
	}
	.qr-card {
		background: #fff;
		color: #1c1b18;
		border-radius: 14px;
		width: 100%;
		max-width: 340px;
		padding: 16px;
		box-shadow: 0 16px 60px rgba(0, 0, 0, 0.3);
		font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
	}
	.qr-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-weight: 700;
		font-size: 15px;
		margin-bottom: 6px;
	}
	.qr-x {
		border: none;
		background: none;
		font-size: 16px;
		cursor: pointer;
		color: #6b6962;
		padding: 4px 8px;
	}
	.qr-desc {
		font-size: 12px;
		color: #6b6962;
		line-height: 1.6;
		margin: 0 0 10px;
	}
	.qr-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		margin-bottom: 10px;
	}
	.qr-canvas {
		background: #fff;
		border-radius: 10px;
		border: 1px solid #e2e0d8;
		overflow: hidden;
		line-height: 0;
	}
	.qr-canvas :global(canvas),
	.qr-canvas :global(table) {
		display: block;
		border-radius: 10px;
	}
	.qr-wait {
		font-size: 12px;
		color: #6b6962;
	}
	.qr-err {
		font-size: 12px;
		color: #d94f3d;
		line-height: 1.5;
	}
	.qr-url-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #6b6962;
	}
	.qr-url {
		border: 1px solid #e2e0d8;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
		background: #fff;
		color: #1c1b18;
		font-family: ui-monospace, "Cascadia Mono", Consolas, monospace;
	}
	.qr-foot {
		display: flex;
		gap: 8px;
		margin-top: 12px;
	}
	.qr-link {
		flex: 1;
		text-align: center;
		background: #e8b23d;
		color: #3a2c08;
		font-weight: 700;
		font-size: 14px;
		padding: 9px 12px;
		border-radius: 10px;
		text-decoration: none;
	}
	.qr-btn {
		flex: 1;
		border: 1px solid #e2e0d8;
		background: #fff;
		color: #1c1b18;
		font-weight: 600;
		font-size: 14px;
		padding: 9px 12px;
		border-radius: 10px;
		cursor: pointer;
	}
</style>
