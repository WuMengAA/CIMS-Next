// 确定性封面合成（纯函数，无 DOM 依赖）。
// 同一组参数永远输出同一张 SVG，品牌风格：深炭黑底 + 陶土橙强调 + lucide 图标 + 星点。
// 同时被「服务端批量脚本」与「客户端封面生成器页面」复用，保证所见即所得。
import { COVER_ICONS } from "./cover-icons.mjs";

/** 放宽为可索引字典（COVER_ICONS 是字面量键对象，直接用 string 索引会报隐式 any） */
/** @type {Record<string, string>} */
const ICONS = COVER_ICONS;

/** 放宽为可索引字典：字面量键对象无法用 string 索引（svelte-check 会报隐式 any） */
/** @type {Record<string, [number, number]>} */
const RATIOS = {
	"16:9": [1200, 675],
	"4:3": [1200, 900],
	"1:1": [1000, 1000],
	"21:9": [1260, 540]
};

const FONT =
	"Inter, 'Noto Sans SC', 'Microsoft YaHei', 'PingFang SC', 'Source Han Sans SC', sans-serif";

/** @param {string} s */
function hashStr(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** @param {number} a */
function mulberry32(a) {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** @param {string} ch */
function isCJK(ch) {
	const c = ch.codePointAt(0) ?? 0;
	return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x30ff);
}

/** @param {string} ch
 * @param {number} fs */
function charWidth(ch, fs) {
	if (isCJK(ch)) return fs;
	if (/[A-Za-z0-9]/.test(ch)) return fs * 0.56;
	if (/\s/.test(ch)) return fs * 0.4;
	return fs * 0.5;
}

// 把文本按像素宽度换行（CJK 按字断、拉丁按词断），最多 maxLines 行，超出截断加省略号。
/** @param {string} text
 * @param {number} fs
 * @param {number} maxWidth
 * @param {number} maxLines
 * @returns {{ text: string, width: number }[]} */
function wrapText(text, fs, maxWidth, maxLines) {
	/** @type {{ text: string, width: number }[]} */
	const lines = [];
	let line = "";
	let width = 0;
	const pushLine = () => {
		lines.push({ text: line, width });
		line = "";
		width = 0;
	};
	// 先按空格切词，再逐字符测量
	const tokens = text.split(/(\s+)/);
	for (const tk of tokens) {
		if (tk === "") continue;
		if (/\s+/.test(tk)) {
			// 空格：若当前行非空则加一个空格宽度
			if (line && width + charWidth(" ", fs) <= maxWidth) {
				line += " ";
				width += charWidth(" ", fs);
			}
			continue;
		}
		let cur = "";
		let curW = 0;
		for (const ch of tk) {
			const w = charWidth(ch, fs);
			if (curW + w > maxWidth && cur) {
				// 当前词在当前行放不下 -> 换行
				if (lines.length + (line ? 1 : 0) >= maxLines) {
					// 截断
					lines.push({ text: (line ? line + " " : "") + cur.slice(0, Math.max(1, Math.floor(maxWidth / (fs * 0.5)))) + "…", width: maxWidth });
					return lines.slice(0, maxLines);
				}
				if (line) pushLine();
				cur = ch;
				curW = w;
			} else {
				cur += ch;
				curW += w;
			}
		}
		// 把当前词接入行（若超宽则先换行）
		if (line && width + curW > maxWidth) {
			if (lines.length + 1 >= maxLines) {
				lines.push({ text: line, width });
				lines.push({ text: cur.slice(0, Math.max(1, Math.floor(maxWidth / (fs * 0.5)))) + "…", width: maxWidth });
				return lines.slice(0, maxLines);
			}
			pushLine();
		}
		line += cur;
		width += curW;
	}
	if (line) {
		if (lines.length >= maxLines) {
			lines[maxLines - 1] = { text: line.slice(0, Math.max(1, Math.floor(maxWidth / (fs * 0.5)))) + "…", width: maxWidth };
		} else {
			lines.push({ text: line, width });
		}
	}
	return lines.slice(0, maxLines);
}

/** 放宽为可索引字典（正则仅匹配这 5 个字符，索引恒有值，行为与原内联字面量一致） */
/** @type {Record<string, string>} */
const XML_ESCAPES = { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" };

/** @param {unknown} s */
function escapeXml(s) {
	return String(s).replace(/[<>&'"]/g, (c) => XML_ESCAPES[c]);
}

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.subtitle]
 * @param {string} [opts.category]
 * @param {string} [opts.icon]  COVER_ICONS 的键
 * @param {string} [opts.ratio] '16:9' | '4:3' | '1:1' | '21:9'
 * @param {string} [opts.accent]
 * @param {string} [opts.bg]
 * @param {string} [opts.bg2]
 * @param {'card'|'art'} [opts.variant] card（默认）=带标题文字的卡片；art=纯头图，不烘字
 *   —— 文章详情页已改成通栏头图，标题由页面渲染。若封面里再烘一遍标题，两者会重影，
 *   且烘死的字随图片缩放，窄屏上小到看不清。故详情页用 art，社交卡片用 card。
 */
export function buildCoverSvg(opts = {}) {
	const title = opts.title || "Untitled";
	const subtitle = opts.subtitle || "";
	const category = opts.category || "";
	const iconKey = typeof opts.icon === "string" && ICONS[opts.icon] ? opts.icon : "image";
	const accent = opts.accent || "#cc785c";
	const bg = opts.bg || "#1b1b19";
	const bg2 = opts.bg2 || "#141413";
	const ratioKey = typeof opts.ratio === "string" ? opts.ratio : "";
	const [W, H] = RATIOS[ratioKey] || RATIOS["16:9"];
	const textless = opts.variant === "art";

	const seed = hashStr(title + "|" + (category || ""));
	const rng = mulberry32(seed);
	const glowHue = seed % 360;

	// 标题字号自适应：保证 ≤3 行
	let fs = title.length > 16 ? 60 : 76;
	let lines = wrapText(title, fs, W - 220, 3);
	while (lines.length > 3 && fs > 40) {
		fs -= 6;
		lines = wrapText(title, fs, W - 220, 3);
	}
	const lineH = fs * 1.22;

	// 星点
	const starCount = 80;
	let stars = "";
	for (let i = 0; i < starCount; i++) {
		const x = rng() * W;
		const y = rng() * H;
		const r = rng() * 1.6 + 0.4;
		const op = (rng() * 0.22 + 0.04).toFixed(3);
		stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#ffffff" opacity="${op}" />`;
	}

	// 图标：card = 右上角（留白给标题）；art = 居中（宽屏头图会被 object-cover 裁上下，居中最经得住裁）
	const icon = ICONS[iconKey];
	const S = Math.round(Math.min(W, H) * (textless ? 0.28 : 0.22));
	const s = S / 24;
	const ix = W - S - 72;
	const iy = 64;
	const iconCx = textless ? W / 2 : ix + S / 2;
	const iconCy = textless ? H / 2 : iy + S / 2;
	const iconX = iconCx - S / 2;
	const iconY = iconCy - S / 2;
	const ringR = S * (textless ? 0.95 : 0.82);
	const iconMarkup = `<g transform="translate(${iconX.toFixed(1)} ${iconY.toFixed(1)}) scale(${s.toFixed(4)})" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="${textless ? 0.5 : 0.92}">${icon}</g>`;
	// art 的外层同心环：构图读起来像“涟漪/信号”，被裁掉一侧也不失衡
	const artRings = textless
		? `<circle cx="${iconCx}" cy="${iconCy}" r="${(ringR * 1.5).toFixed(1)}" fill="none" stroke="${accent}" stroke-opacity="0.12" stroke-width="2" />
  <circle cx="${iconCx}" cy="${iconCy}" r="${(ringR * 2.1).toFixed(1)}" fill="none" stroke="${accent}" stroke-opacity="0.06" stroke-width="2" />`
		: "";
	const glowCx = textless ? 0.5 : 0.82;
	const glowCy = textless ? 0.46 : 0.18;

	// 文字块位置
	const leftX = 84;
	const kickerY = 104;
	const titleTop = 168;
	const subY = titleTop + lines.length * lineH + 28;

	const kicker =
		category && !textless
			? `<text x="${leftX}" y="${kickerY}" font-family="${FONT}" font-size="30" font-weight="600" letter-spacing="2" fill="${accent}">${escapeXml(category.toUpperCase())}</text>
<rect x="${leftX}" y="${kickerY + 14}" width="54" height="4" rx="2" fill="${accent}" />`
			: "";

	const titleSpans = textless
		? ""
		: lines
				.map(
					(l, i) =>
						`<text x="${leftX}" y="${titleTop + i * lineH}" font-family="${FONT}" font-size="${fs}" font-weight="700" fill="#f5f3ef">${escapeXml(l.text)}</text>`
				)
				.join("\n");

	const sub =
		subtitle && !textless
			? `<text x="${leftX}" y="${subY}" font-family="${FONT}" font-size="30" fill="#b8b2a8">${escapeXml(subtitle)}</text>`
			: "";

	const wordmarkY = H - 54;
	const footer = textless
		? ""
		: `<line x1="${leftX}" y1="${wordmarkY - 22}" x2="${W - leftX}" y2="${wordmarkY - 22}" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1" />
<text x="${leftX}" y="${wordmarkY}" font-family="${FONT}" font-size="26" font-weight="700" fill="${accent}">Stelarith</text>
<text x="${leftX + 118}" y="${wordmarkY}" font-family="${FONT}" font-size="22" fill="#8c857a">· 无限音乐画布</text>`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg}" />
      <stop offset="1" stop-color="${bg2}" />
    </linearGradient>
    <radialGradient id="glow" cx="${glowCx}" cy="${glowCy}" r="0.7">
      <stop offset="0" stop-color="hsl(${glowHue} 55% 55%)" stop-opacity="0.30" />
      <stop offset="1" stop-color="hsl(${glowHue} 55% 55%)" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  <rect width="${W}" height="${H}" fill="url(#glow)" />
  ${stars}
  ${artRings}
  <circle cx="${iconCx}" cy="${iconCy}" r="${ringR}" fill="${accent}" fill-opacity="0.10" />
  <circle cx="${iconCx}" cy="${iconCy}" r="${ringR}" fill="none" stroke="${accent}" stroke-opacity="0.28" stroke-width="2" />
  ${iconMarkup}
  ${kicker}
  ${titleSpans}
  ${sub}
  ${footer}
</svg>`;
}

export { RATIOS };
