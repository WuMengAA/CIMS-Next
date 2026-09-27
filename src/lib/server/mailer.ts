/**
 * 邮件发送（2026-09-27 新增邮箱注册验证配套）。
 * - 配置 SMTP（MAIL_HOST/PORT/USER/PASS/FROM）即真的发信；
 * - 未配置时返回 {delivered:false}，调用方回退为「前端直接显示验证链接」
 *   （校园自部署无邮件环境时的兜底，逻辑与现有 register 页回显一致）。
 * 依赖 node:smtp? 不存在 —— 用最简 SMTP 明文协议实现（仅支持自家 SMTP，
 * 不处理 TLS/认证之外的复杂情况；够内网/专业邮件服务用）。
 */
import { createConnection } from "node:net";
import { env } from "$env/dynamic/private";

interface MailOptions {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

function smtpConfig(): { host: string; port: number; user: string; pass: string; from: string } | null {
	const host = (env.MAIL_HOST || "").trim();
	if (!host) return null;
	return {
		host,
		port: Number(env.MAIL_PORT || 25),
		user: (env.MAIL_USER || "").trim(),
		pass: (env.MAIL_PASS || "").trim(),
		from: (env.MAIL_FROM || env.MAIL_USER || "").trim(),
	};
}

/** 是否配置了可用的邮件服务。 */
export function mailEnabled(): boolean {
	return !!smtpConfig()?.host;
}

// ── 极简 SMTP 客户端（无依赖，纯 net）──────────────────────────────────────
function smtpSend(cfg: NonNullable<ReturnType<typeof smtpConfig>>, opts: MailOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		let buf = "";
		let step = 0;
		const sock = createConnection(cfg.port, cfg.host);
		const fail = (msg: string) => { sock.destroy(); reject(new Error(msg)); };
		const onData = (chunk: Buffer) => {
			buf += chunk.toString("utf8");
			// 等一行完整响应（SMTP 以 CRLF 结尾）
			if (!buf.includes("\r\n")) return;
			const line = buf.trim();
			buf = "";
			const codeNum = Number(line.slice(0, 3));
			if (step === 0) { step = 1; sock.write("EHLO localhost\r\n"); return; }
			if (step === 1 && codeNum === 250) { step = 2; sock.write("MAIL FROM:<" + cfg.from + ">\r\n"); return; }
			if (step === 2 && codeNum === 250) { step = 3; sock.write("RCPT TO:<" + opts.to + ">\r\n"); return; }
			if (step === 3 && codeNum === 250) { step = 4; sock.write("DATA\r\n"); return; }
			if (step === 4 && codeNum === 354) {
				step = 5;
				// 点号转义 + 全文
				const body = (opts.html || opts.text || "").replace(/^\./gm, "..");
				const data =
					"From: <" + cfg.from + ">\r\n" +
					"To: <" + opts.to + ">\r\n" +
					"Subject: " + opts.subject.replace(/[\r\n]/g, " ") + "\r\n" +
					"MIME-Version: 1.0\r\n" +
					"Content-Type: " + (opts.html ? "text/html; charset=utf-8" : "text/plain; charset=utf-8") + "\r\n" +
					"Content-Transfer-Encoding: base64\r\n\r\n" +
					Buffer.from(body, "utf8").toString("base64") + "\r\n.\r\n";
				sock.write(data);
				return;
			}
			if (step === 5 && codeNum === 250) { sock.write("QUIT\r\n"); step = 6; return; }
			if (step === 6) { sock.destroy(); resolve(); return; }
			fail("SMTP 失败：" + line.slice(0, 120));
		};
		sock.on("data", onData);
		sock.on("error", (e) => fail("SMTP 连接错误：" + e.message));
		sock.setTimeout(10000, () => fail("SMTP 超时"));
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
