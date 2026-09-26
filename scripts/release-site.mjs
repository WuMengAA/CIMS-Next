#!/usr/bin/env node
/**
 * 原子发布（atomic release）—— 消灭"构建中恰好重启 → 连崩几分钟"这个窗口。
 *
 * 背景（2026-09-24 判据）：
 *   旧流程 `vite build` 直接写 `build/`，会先清空重建。构建期间若 node 重启，
 *   入口 `build/index.js` 缺失/半成品 → 进程 0.15 秒即退出 → 启动器 10s 退避重试
 *   → 实测连崩 22 次 / 24 次 = 各 3~4 分钟完全打不开。
 *   另一后果：`.svelte-kit/output` 被重写时，运行中的进程抱着旧 manifest hash
 *   → 所有动态路由 500（见 stelarith-build-oom-fix 技能 §6.3）。
 *
 * 本脚本的做法：**新版本一律构到旁路目录 `build.next`，全程不碰正在服务的 `build/`**，
 * 构建成功且校验通过后，才在"服务已停"的窗口内做两次改名完成切换。
 * 因为最终仍然叫 `build/`，`sync-console.mjs` / 自检 / 门禁全部无需改动。
 *
 * 用法：
 *   node scripts/release-site.mjs build     构建到 build.next（安全，不影响线上）
 *   node scripts/release-site.mjs switch    切换 + 重启 + 验收；验收失败自动回滚
 *   node scripts/release-site.mjs status    打印当前状态
 *   node scripts/release-site.mjs selftest  用假目录验证改名/回滚逻辑（不碰生产）
 *
 * 退出码：0 成功 / 1 失败（switch 失败时已尽力回滚）
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = path.join(ROOT, "build");
const STAGING = path.join(ROOT, "build.next");
const LOG_DIR = path.resolve(ROOT, "..", "..", "_logs");
const BUILD_LOG = path.join(LOG_DIR, "release-build.log");
const PORT = Number(process.env.PORT || 8090);
const TASK = "StelarithServer";
const KEEP_OLD = 2;

fs.mkdirSync(LOG_DIR, { recursive: true });

const ts = () => new Date().toLocaleString("sv-SE").replace(" ", " ");
const log = (m) => console.log(`[${ts()}] ${m}`);
const stamp = () => Math.floor(Date.now() / 1000);

function hr(title) {
	console.log("\n" + "=".repeat(72));
	console.log(title);
	console.log("=".repeat(72));
}

// ── 删目录：必须走 node 的 fs.rmSync，且必须回读校验 ─────────────────────────
// 沙箱的 safe-delete 垫片 patch 了 fs.rmSync；未设 CODEBUDDY_SAFE_DELETE_ENABLED=0
// 时删除会**静默失败**（退出码 0、无输出、目录原样）。shell 的 rm 同样被静默拦。
function rmrf(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch (e) {
		/* 下面用存在性回读判定 */
	}
	const gone = !fs.existsSync(dir);
	if (!gone) throw new Error(`删除失败（垫片可能拦下了）：${dir}`);
	return gone;
}

// ── 找 8090 的监听者 ─────────────────────────────────────────────────────────
function listenerPid(port = PORT) {
	try {
		const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
		const hits = out
			.split(/\r?\n/)
			.filter((l) => l.includes(`:${port} `) && /LISTENING/i.test(l));
		if (!hits.length) return null;
		return Number(hits[hits.length - 1].trim().split(/\s+/).pop());
	} catch {
		return null;
	}
}

function killPid(pid) {
	if (!pid) return;
	try {
		execFileSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
	} catch {
		/* 可能已死 */
	}
}

function httpCode(url, timeoutMs = 6000) {
	return new Promise((resolve) => {
		const req = http.get(url, { timeout: timeoutMs }, (res) => {
			res.resume();
			resolve(res.statusCode);
		});
		req.on("timeout", () => {
			req.destroy();
			resolve(0);
		});
		req.on("error", () => resolve(0));
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 服务控制 ─────────────────────────────────────────────────────────────────
function taskCtl(verb) {
	// /end 停实例（含 cmd 循环），/run 重新拉起。任务不在跑时 /end 会报错，忽略。
	try {
		execFileSync("schtasks", [verb, "/tn", TASK], { stdio: "ignore" });
	} catch {
		/* 忽略 */
	}
}

function stopService() {
	taskCtl("/end");
	let pid = listenerPid();
	if (pid) {
		log(`杀掉 8090 监听者 pid=${pid}`);
		killPid(pid);
	}
	return waitPortFree();
}

async function waitPortFree(maxMs = 20000) {
	const until = Date.now() + maxMs;
	while (Date.now() < until) {
		if (!listenerPid()) return true;
		await sleep(500);
	}
	return !listenerPid();
}

function startService() {
	log(`启动计划任务 ${TASK}`);
	taskCtl("/run");
}

/**
 * 保证服务一定被拉起来：先靠计划任务，若 30s 内端口仍未监听就自己直接起启动器。
 * 没有这条兜底，"切换成功但没人拉起"会把站点留在停机状态 —— 那是最糟的失败模式。
 */
async function startServiceOrFallback() {
	startService();
	const until = Date.now() + 30000;
	while (Date.now() < until) {
		if (listenerPid()) {
			log("计划任务已拉起服务。");
			return true;
		}
		await sleep(1000);
	}
	log("⚠️ 计划任务未在 30s 内拉起，改用直接启动 run-prod.bat（脱离父进程）…");
	const bat = path.join(ROOT, "run-prod.bat");
	if (!fs.existsSync(bat)) {
		log(`启动器不存在：${bat}`);
		return false;
	}
	const r = spawnSync("cmd.exe", ["/c", "start", "", "/min", bat], {
		cwd: ROOT,
		detached: true,
		stdio: "ignore"
	});
	log(`已发起 run-prod.bat（spawn status=${r.status ?? r.error?.message ?? "?"}）`);
	const until2 = Date.now() + 40000;
	while (Date.now() < until2) {
		if (listenerPid()) {
			log("备用启动方式已拉起服务。");
			return true;
		}
		await sleep(1000);
	}
	log("备用启动也未生效，需人工介入。");
	return false;
}

// ── 验收 ─────────────────────────────────────────────────────────────────────
async function verify(maxMs = 120000) {
	const until = Date.now() + maxMs;
	const targets = [
		[`http://127.0.0.1:${PORT}/`, [200]],
		[`http://127.0.0.1:${PORT}/console/`, [200]]
	];
	const last = {};
	while (Date.now() < until) {
		let allOk = true;
		for (const [url, ok] of targets) {
			const c = await httpCode(url);
			last[url] = c;
			if (!ok.includes(c)) allOk = false;
		}
		if (allOk) return { ok: true, last };
		await sleep(2000);
	}
	return { ok: false, last };
}

// ── 构建 ─────────────────────────────────────────────────────────────────────
function validateStaging() {
	const need = [
		path.join(STAGING, "index.js"),
		path.join(STAGING, "client"),
		path.join(STAGING, "server")
	];
	const missing = need.filter((p) => !fs.existsSync(p));
	if (missing.length) {
		throw new Error(
			`旁路产物不完整，缺少：${missing.map((m) => path.relative(ROOT, m)).join(", ")}`
		);
	}
}

function doBuild(maxAttempts = 4) {
	hr(`构建到旁路目录 ${path.relative(ROOT, STAGING)}（线上 build/ 全程不被触碰）`);
	const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
	if (!fs.existsSync(viteBin)) throw new Error(`找不到 vite：${viteBin}`);

	const env = {
		...process.env,
		STELLARITH_BUILD_OUT: path.basename(STAGING),
		CODEBUDDY_SAFE_DELETE_ENABLED: "0",
		RAYON_NUM_THREADS: "1",
		// ⚠️ 追加而不是整体覆盖：NODE_OPTIONS 里原有 safe-delete/language 垫片的 --require
		// 堆上限可用 STELLARITH_BUILD_HEAP_MB 调小：本机瓶颈是**提交量(commit)**不是 V8 堆，
		// 把 V8 堆压低能给 rolldown 的 Rust 侧留出提交额度（实测 rolldown 报
		// `memory allocation of N bytes failed` 时，降堆往往能救回来）。
		NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=${
			process.env.STELLARITH_BUILD_HEAP_MB || 3072
		}`.trim()
	};

	for (let i = 1; i <= maxAttempts; i++) {
		log(`清空旁路目录…`);
		rmrf(STAGING);

		log(`第 ${i}/${maxAttempts} 次构建…`);
		const r = spawnSync(process.execPath, [viteBin, "build"], {
			cwd: ROOT,
			env,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			timeout: 900000
		});
		const out = `${r.stdout || ""}${r.stderr || ""}`;
		fs.appendFileSync(
			BUILD_LOG,
			`\n\n===== attempt ${i} @ ${ts()}  exit=${r.status} =====\n${out}`
		);

		const oom = /memory allocation|heap out of memory|Fatal process out of memory/i.test(out);
		let stagingOk = true;
		try {
			validateStaging();
		} catch {
			stagingOk = false;
		}

		if (r.status === 0 && stagingOk && !oom) {
			log(`构建成功（exit=0，旁路产物完整）`);
			return true;
		}
		log(
			`构建未通过：exit=${r.status} 产物完整=${stagingOk} OOM迹象=${oom}` +
				`（日志 ${path.relative(process.cwd(), BUILD_LOG)}）`
		);
		if (oom) {
			log("检出真·内存不足：重试无用，需要先腾出提交量（commit）。停止重试。");
			return false;
		}
		log("无内存迹象 → 按「偶发中断」原样重试。");
	}
	return false;
}

// ── 切换 ─────────────────────────────────────────────────────────────────────
function pruneOld() {
	const olds = fs
		.readdirSync(ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && d.name.startsWith("build.old-"))
		.map((d) => ({ name: d.name, t: Number(d.name.slice("build.old-".length)) || 0 }))
		.sort((a, b) => b.t - a.t);
	for (const o of olds.slice(KEEP_OLD)) {
		try {
			rmrf(path.join(ROOT, o.name));
			log(`清理旧版本目录 ${o.name}`);
		} catch (e) {
			log(`清理 ${o.name} 失败（忽略）：${e.message}`);
		}
	}
}

async function doSwitch() {
	hr("切换");
	try {
		validateStaging();
	} catch (e) {
		log(`旁路产物不可用：${e.message}`);
		log("先跑 `node scripts/release-site.mjs build`。");
		return false;
	}

	const oldDir = path.join(ROOT, `build.old-${stamp()}`);
	const failedDir = path.join(ROOT, `build.failed-${stamp()}`);
	const before = listenerPid();
	log(`切换前 8090 监听者 pid=${before ?? "(无)"}`);

	log("停服务（先 /end 任务避免启动器循环来抢，再杀监听者）…");
	const freed = await stopService();
	if (!freed) {
		log("⚠️ 端口仍被占用，放弃切换以免把线上弄成半成品。");
		await startServiceOrFallback();
		return false;
	}

	let swapped = false;
	try {
		if (fs.existsSync(LIVE)) {
			fs.renameSync(LIVE, oldDir);
			log(`旧版本移开 → ${path.basename(oldDir)}`);
		}
		fs.renameSync(STAGING, LIVE);
		swapped = true;
		log("新版本就位 → build/");
	} catch (e) {
		log(`改名失败：${e.message}`);
		if (!fs.existsSync(LIVE) && fs.existsSync(oldDir)) {
			fs.renameSync(oldDir, LIVE);
			log("已把旧版本移回原位。");
		}
		startService();
		return false;
	}

	await startServiceOrFallback();
	log("等待服务起来并验收（/ 与 /console/ 均需 200，最长 120s）…");
	const v = await verify();
	if (v.ok) {
		log(`✅ 切换成功：${JSON.stringify(v.last)}`);
		if (swapped) pruneOld();
		return true;
	}

	log(`❌ 验收失败：${JSON.stringify(v.last)} → 回滚`);
	await stopService();
	try {
		if (fs.existsSync(LIVE)) fs.renameSync(LIVE, failedDir);
		if (fs.existsSync(oldDir)) fs.renameSync(oldDir, LIVE);
		log("已回滚到旧版本。");
	} catch (e) {
		log(`回滚改名也失败：${e.message}（需人工介入）`);
	}
	await startServiceOrFallback();
	const v2 = await verify(90000);
	log(v2.ok ? `回滚后服务已恢复：${JSON.stringify(v2.last)}` : `⚠️ 回滚后仍未恢复：${JSON.stringify(v2.last)}`);
	return false;
}

// ── 状态 ─────────────────────────────────────────────────────────────────────
async function doStatus() {
	hr("状态");
	const pid = listenerPid();
	const entry = path.join(LIVE, "index.js");
	const st = fs.existsSync(entry) ? fs.statSync(entry) : null;
	log(`8090 监听者 pid=${pid ?? "(无)"}`);
	if (pid) {
		try {
			const ps = execFileSync(
				"powershell",
				[
					"-NoProfile",
					"-Command",
					`(Get-Process -Id ${pid}).StartTime.ToString('yyyy-MM-dd HH:mm:ss')`
				],
				{ encoding: "utf8" }
			).trim();
			log(`该进程启动于 ${ps}`);
		} catch {
			/* 忽略 */
		}
	}
	log(`build/index.js mtime=${st ? st.mtime.toLocaleString("sv-SE") : "(不存在)"}`);
	log(`旁路目录 build.next 存在=${fs.existsSync(STAGING)}`);
	log(`首页 HTTP=${await httpCode(`http://127.0.0.1:${PORT}/`)}`);
	log(`面板 HTTP=${await httpCode(`http://127.0.0.1:${PORT}/console/`)}`);
	for (const d of fs
		.readdirSync(ROOT, { withFileTypes: true })
		.filter((x) => x.isDirectory() && x.name.startsWith("build."))) {
		log(`  产物目录 ${d.name}`);
	}
	return true;
}

// ── 自测：用假目录验证"改名 + 回滚"逻辑（不碰生产） ──────────────────────────
function doSelftest() {
	hr("自测：假目录改名/回滚（不碰生产）");
	const box = path.join(ROOT, "_swap-selftest");
	let pass = 0;
	let fail = 0;
	const check = (name, cond) => {
		if (cond) {
			pass++;
			log(`  PASS ${name}`);
		} else {
			fail++;
			log(`  FAIL ${name}`);
		}
	};
	try {
		rmrf(box);
		fs.mkdirSync(path.join(box, "live"), { recursive: true });
		fs.mkdirSync(path.join(box, "next"), { recursive: true });
		fs.writeFileSync(path.join(box, "live", "marker"), "OLD");
		fs.writeFileSync(path.join(box, "next", "marker"), "NEW");

		// 正常切换
		fs.renameSync(path.join(box, "live"), path.join(box, "live.old"));
		fs.renameSync(path.join(box, "next"), path.join(box, "live"));
		check(
			"切换后 live 内容为新版",
			fs.readFileSync(path.join(box, "live", "marker"), "utf8") === "NEW"
		);
		check("旧版被保留为 live.old", fs.existsSync(path.join(box, "live.old", "marker")));
		check("next 已不存在", !fs.existsSync(path.join(box, "next")));

		// 回滚
		fs.renameSync(path.join(box, "live"), path.join(box, "live.failed"));
		fs.renameSync(path.join(box, "live.old"), path.join(box, "live"));
		check(
			"回滚后 live 内容为旧版",
			fs.readFileSync(path.join(box, "live", "marker"), "utf8") === "OLD"
		);

		// 回读校验：本项目 build/ 里文件多，改名必须能处理非空目录
		fs.mkdirSync(path.join(box, "deep", "a", "b"), { recursive: true });
		for (let i = 0; i < 200; i++) {
			fs.writeFileSync(path.join(box, "deep", "a", "b", `f${i}.txt`), "x".repeat(1024));
		}
		fs.renameSync(path.join(box, "deep"), path.join(box, "deep.moved"));
		check(
			"非空深层目录改名可行（200 文件）",
			fs.existsSync(path.join(box, "deep.moved", "a", "b", "f199.txt"))
		);
	} catch (e) {
		fail++;
		log(`  FAIL 抛异常：${e.message}`);
	} finally {
		try {
			rmrf(box);
		} catch {
			log(`  (清理 ${path.relative(ROOT, box)} 失败，请手工删)`);
		}
	}
	log(`自测结果：PASS=${pass} FAIL=${fail}`);
	return fail === 0;
}

// ── 入口 ─────────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || "status";
let ok = false;
if (cmd === "build") {
	ok = doBuild();
	if (ok) {
		try {
			validateStaging();
			log("旁路产物校验通过。确认无误后跑 `switch` 上线。");
		} catch (e) {
			log(`校验失败：${e.message}`);
			ok = false;
		}
	}
} else if (cmd === "switch") {
	ok = await doSwitch();
} else if (cmd === "status") {
	ok = await doStatus();
} else if (cmd === "selftest") {
	ok = doSelftest();
} else {
	log(`未知命令：${cmd}`);
	log("可用：build | switch | status | selftest");
}
process.exit(ok ? 0 : 1);
