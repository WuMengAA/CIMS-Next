/**
 * 邮件发送（2026-09-27 新增邮箱注册验证配套）。
 * - 配置 SMTP（MAIL_HOST/PORT/USER/PASS/FROM）即真的发信；
 * - 未配置时返回 {delivered:false}，调用方回退为「前端直接显示验证链接」
 *   （校园自部署无邮件环境时的兜底，逻辑与现有 register 页回显一致）。
 * 依赖 node:smtp? 不存在 —— 用最简 SMTP 明文协议实现（仅支持自家 SMTP，
 * 不处理 TLS/认证之外的复杂情况；够内网/专业邮件服务用）。
 */
import { createConnection } from "node:net";
import tls from "node:tls";
import { env } from "$env/dynamic/private";

interface MailOptions {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

function smtpConfig(): { host: string; port: number; user: string; pass: string; from: string; tls: "ssl" | "starttls" | "none" } | null {
	const host = (env.MAIL_HOST || "").trim();
	if (!host) return null;
	const raw = (env.MAIL_TLS || "").trim().toLowerCase();
	const port = Number(env.MAIL_PORT || (raw === "ssl" ? 465 : raw === "starttls" ? 587 : 25));
	const tlsMode = raw === "ssl" || raw === "starttls" || raw === "none" ? raw : port === 465 ? "ssl" : port === 587 ? "starttls" : "none";
	return {
		host,
		port,
		user: (env.MAIL_USER || "").trim(),
		pass: (env.MAIL_PASS || "").trim(),
		from: (env.MAIL_FROM || env.MAIL_USER || "").trim(),
		tls: tlsMode,
	};
}

/** 是否配置了可用的邮件服务。 */
export function mailEnabled(): boolean {
	return !!smtpConfig()?.host;
}

// ── 极简 SMTP 客户端（无依赖，纯 net）──────────────────────────────────────
function smtpSend(cfg: NonNullable<ReturnType<typeof smtpConfig>>, opts: MailOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		// 状态机：0=等待横幅 1=EHLO 2=STARTTLS 3=重EHLO 4=AUTH 5=MAIL 6=RCPT 7=DATA 8=正文 9=QUIT
		let buf = "";
		let step = 0;
		let authed = false;
		const fail = (msg: string) => { try { sock.destroy(); } catch {} reject(new Error(msg)); };

		const sendline = (line: string) => { try { sock.write(line + "\r\n"); } catch (e) { fail("写入失败：" + (e as Error).message); } };

		function upgradeTls() {
			const raw = sock as import("node:net").Socket;
			const t = tls.connect({ socket: raw, servername: cfg.host });
			(sock as unknown) = t;
			t.on("data", onData);
			t.on("error", (e) => fail("TLS 错误：" + e.message));
			// TLS 握手完成后重新 EHLO
			t.on("secureConnect", () => { step = 3; sendline("EHLO localhost"); });
		}

		const onData = (chunk: Buffer) => {
			buf += chunk.toString("utf8");
			if (!buf.includes("\r\n")) return;
			const rawLines = buf.split("\r\n");
			buf = rawLines.pop() || "";
			for (const l of rawLines) {
				if (!l) continue;
				const codeNum = Number(l.slice(0, 3));
				const multi = l.length > 3 && l[3] === "-";
				if (multi) continue; // 多行响应中间行
				// 开始处理最终行
				step = handle(codeNum, step, l);
			}
		};

		function handle(codeNum: number, st: number, line: string): number {
			if (st === 0) { step = 1; sendline("EHLO localhost"); return 1; }
			// EHLO 后（1 或 3）：决定 AUTH 或 STARTTLS
			if ((st === 1 || st === 3) && codeNum === 250) {
				if (!authed && st === 1 && cfg.tls === "starttls") {
					step = 2; sendline("STARTTLS"); return 2;
				}
				if (cfg.user) {
					step = 4; sendline("AUTH LOGIN"); return 4;
				}
				step = 5; sendline("MAIL FROM:<" + cfg.from + ">"); return 5;
			}
			if (st === 2 && codeNum === 220) { upgradeTls(); return 3; } // STARTTLS 成功
			if (st === 2) fail("STARTTLS 被拒绝：" + line.slice(0, 100));
			if (st === 4 && codeNum === 334 && /VXNlcm5hbWU/i.test(line)) { sendline(Buffer.from(cfg.user, "utf8").toString("base64")); return 4; }
			if (st === 4 && codeNum === 334 && /UGFzc3dvcmQ/i.test(line)) { sendline(Buffer.from(cfg.pass, "utf8").toString("base64")); return 4; }
			if (st === 4 && codeNum === 235) { authed = true; step = 5; sendline("MAIL FROM:<" + cfg.from + ">"); return 5; }
			if (st === 4) fail("认证失败：" + line.slice(0, 100));
			if (st === 5 && codeNum === 250) { step = 6; sendline("RCPT TO:<" + opts.to + ">"); return 6; }
			if (st === 6 && codeNum === 250) { step = 7; sendline("DATA"); return 7; }
			if (st === 7 && codeNum === 354) {
				const body = (opts.html || opts.text || "").replace(/^\s*\./gm, "..");
				const data =
					"From: <" + cfg.from + ">\r\n" +
					"To: <" + opts.to + ">\r\n" +
					"Subject: " + opts.subject.replace(/[\r\n]/g, " ") + "\r\n" +
					"MIME-Version: 1.0\r\n" +
					"Content-Type: " + (opts.html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8") + "\r\n" +
					"Content-Transfer-Encoding: base64\r\n\r\n" +
					Buffer.from(body, "utf8").toString("base64") + "\r\n.\r\n";
				sendline(data); step = 8; return 8;
			}
			if (st === 8 && codeNum === 250) { sendline("QUIT"); step = 9; return 9; }
			if (st === 9) { try { sock.destroy(); } catch {} resolve(); return 9; }
			fail("SMTP 失败 [" + st + "]：" + line.slice(0, 120));
			return st;
		}

		// 建连：SSL 直连 vs 明文
		let sock: import("node:net").Socket | tls.TLSSocket;
		if (cfg.tls === "ssl") {
			sock = tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host });
			sock.on("secureConnect", () => { step = 1; sendline("EHLO localhost"); });
		} else {
			sock = createConnection(cfg.port, cfg.host);
			sock.on("connect", () => { step = 0; });
		}
		sock.on("data", onData);
		sock.on("error", (e) => fail("SMTP 连接错误：" + e.message));
		sock.setTimeout(15000, () => fail("SMTP 超时"));
	});
}
/** 发送邮件；未配置 SMTP 返回 delivered=false（调用方降级为链接回显）。 */
export async function sendMail(opts: MailOptions): Promise<{ delivered: boolean; error?: string }> {
	const cfg = smtpConfig();
	if (!cfg || !cfg.host) return { delivered: false, error: "未配置邮件服务" };
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.to)) return { delivered: false, error: "收件邮箱无效" };
	try {
		await smtpSend(cfg, opts);
		return { delivered: true };
	} catch (e) {
		return { delivered: false, error: (e as Error).message };
	}
}
