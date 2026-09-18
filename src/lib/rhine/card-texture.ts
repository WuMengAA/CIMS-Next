/**
 * 卡片表面纹理 —— 用 Canvas2D 把档案信息（编号 / 标题 / 摘要 / 分组 / 日期）
 * 烘成贴图，再由 Three.js 贴到卡片正面。
 *
 * 为什么不用 CSS3DRenderer 或 HTML 叠加层：
 *   卡片要参与透视、雾化、光照与景深，HTML 层做不到被卡片自身遮挡，
 *   一旦旋转视角就会穿帮。烘成纹理是唯一能保持「真三维」观感的做法。
 *
 * 中文字体注意：canvas 里的 font 必须给完整 fallback 链，
 * 本机无 Noto Sans SC，靠系统「微软雅黑」兜底。
 */
import * as THREE from "three";

export type CardPalette = {
	/** 卡面底色（磨砂玻璃的透光部分） */
	paper: string;
	/** 卡面上的主文字 */
	ink: string;
	/** 次级说明文字 */
	muted: string;
	/** 分隔线与边框 */
	line: string;
	/** 强调色（编号、选中态） */
	accent: string;
	/** 卡片半透明区更暗的渐变端 */
	shade: string;
};

export const LIGHT_PALETTE: CardPalette = {
	paper: "#eae5e1",
	ink: "#080a08",
	muted: "#77756d",
	line: "#aaa59a",
	accent: "#9b7247",
	shade: "#d8d2cb"
};

export const DARK_PALETTE: CardPalette = {
	paper: "#202a2f",
	ink: "#e0e3dc",
	muted: "#a6b0b1",
	line: "#536166",
	accent: "#c5a16b",
	shade: "#161e22"
};

export type CardContent = {
	serial: number;
	title: string;
	excerpt?: string;
	group: string;
	date?: string;
	category?: string;
};

export type CardTextureOptions = {
	content: CardContent;
	palette: CardPalette;
	/** 选中态会点亮边框与编号 */
	active?: boolean;
};

/** 纹理分辨率。卡片世界尺寸 5 × 3.7，2048 宽约合 410 dpi，凑近看仍锐利 */
const TEX_WIDTH = 2048;
const TEX_HEIGHT = Math.round((TEX_WIDTH * 3.7) / 5);

const FONT_STACK =
	'ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", sans-serif';

/** 单行截断，超出补省略号 */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return text.slice(0, lo) + "…";
}

/** 按宽度把文本折成最多 maxLines 行 */
function wrapLines(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	maxLines: number
): string[] {
	const chars = [...text];
	const lines: string[] = [];
	let line = "";

	for (const ch of chars) {
		const probe = line + ch;
		if (ctx.measureText(probe).width <= maxWidth) {
			line = probe;
			continue;
		}
		lines.push(line);
		line = ch;
		if (lines.length === maxLines) break;
	}
	if (lines.length < maxLines && line) lines.push(line);

	if (lines.length === maxLines) {
		// 最后一行若还有余量，做截断
		const last = lines[maxLines - 1];
		const rest = chars.slice(lines.slice(0, -1).join("").length + last.length);
		if (rest.length > 0) {
			ctx.font = ctx.font; // 保持当前字号用于测量
			lines[maxLines - 1] = ellipsize(ctx, last + rest.join(""), maxWidth);
		}
	}
	return lines;
}

/** 圆角矩形路径（roundRect 在旧 Safari 上缺失，这里手写保证一致） */
function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
) {
	const radius = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + w - radius, y);
	ctx.arcTo(x + w, y, x + w, y + radius, radius);
	ctx.lineTo(x + w, y + h - radius);
	ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
	ctx.lineTo(x + radius, y + h);
	ctx.arcTo(x, y + h, x, y + h - radius, radius);
	ctx.lineTo(x, y + radius);
	ctx.arcTo(x, y, x + radius, y, radius);
	ctx.closePath();
}

/**
 * 绘制卡面。这个函数也被「选中态」复用 —— 切换选中时重绘同一张画布，
 * 再置 texture.needsUpdate = true，避免重建纹理对象。
 */
export function paintCard(
	ctx: CanvasRenderingContext2D,
	{ content, palette, active = false }: CardTextureOptions
) {
	const W = TEX_WIDTH;
	const H = TEX_HEIGHT;
	const pad = W * 0.055;

	ctx.clearRect(0, 0, W, H);

	// ── 底板：竖向微渐变，模拟磨砂玻璃的厚度感 ──────────────────────
	const bg = ctx.createLinearGradient(0, 0, 0, H);
	bg.addColorStop(0, palette.paper);
	bg.addColorStop(1, palette.shade);
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, W, H);

	// ── 顶部信号带：选中时点亮成强调色 ─────────────────────────────
	ctx.fillStyle = active ? palette.accent : palette.line;
	ctx.globalAlpha = active ? 1 : 0.55;
	ctx.fillRect(0, 0, W, Math.round(H * 0.012));
	ctx.globalAlpha = 1;

	// ── 编号区（左上）：等宽数字 + 细横线 ───────────────────────────
	ctx.font = `600 ${Math.round(H * 0.075)}px ${FONT_STACK}`;
	ctx.textBaseline = "top";
	ctx.fillStyle = active ? palette.accent : palette.muted;
	const serial = String(content.serial).padStart(3, "0");
	ctx.fillText(serial, pad, pad);

	// 编号右侧的横向细线，一直拉到右上角
	const lineY = pad + H * 0.045;
	const lineX = pad + ctx.measureText(serial).width + W * 0.02;
	ctx.strokeStyle = palette.line;
	ctx.lineWidth = Math.max(1, W * 0.0012);
	ctx.globalAlpha = active ? 0.9 : 0.5;
	ctx.beginPath();
	ctx.moveTo(lineX, lineY);
	ctx.lineTo(W - pad, lineY);
	ctx.stroke();
	ctx.globalAlpha = 1;

	// ── 分组名（右上），右对齐 ────────────────────────────────────
	ctx.font = `500 ${Math.round(H * 0.058)}px ${FONT_STACK}`;
	ctx.textAlign = "right";
	ctx.fillStyle = palette.muted;
	ctx.fillText(ellipsize(ctx, content.group, W * 0.34), W - pad, pad + H * 0.008);
	ctx.textAlign = "left";

	// ── 主标题：视觉主体，占据卡片中部 ─────────────────────────────
	// 莱茵卡片的字阶逻辑：标题是唯一的大字，其余元素一律压到 10% 以下，
	// 这样在相机距离约 33、卡片约占屏幕 40% 宽时，只有标题还读得清 ——
	// 正是我们想要的层级。0.175 是实测下限：再小在 1600px 宽的窗口里
	// 就已经糊成灰块了。
	const titleSize = Math.round(H * 0.175);
	ctx.font = `600 ${titleSize}px ${FONT_STACK}`;
	ctx.fillStyle = palette.ink;
	// 标题区起点上移到 24%，让整块文字在卡面上垂直居中而不是沉在下半部
	const titleTop = H * 0.24;
	const titleLines = wrapLines(ctx, content.title, W - pad * 2, 3);
	const titleStep = titleSize * 1.2;
	titleLines.forEach((line, i) => {
		ctx.fillText(line, pad, titleTop + i * titleStep);
	});

	// ── 摘要：标题下方的次级信息，最多两行 ─────────────────────────
	if (content.excerpt) {
		const excerptSize = Math.round(H * 0.055);
		ctx.font = `400 ${excerptSize}px ${FONT_STACK}`;
		ctx.fillStyle = palette.muted;
		const excerptTop = titleTop + titleLines.length * titleStep + H * 0.055;
		const lines = wrapLines(ctx, content.excerpt, W - pad * 2, 2);
		lines.forEach((line, i) => {
			ctx.fillText(line, pad, excerptTop + i * excerptSize * 1.55);
		});
	}

	// ── 底栏：分类标签 + 日期 ─────────────────────────────────────
	const footerY = H - pad - H * 0.06;

	if (content.category) {
		ctx.font = `500 ${Math.round(H * 0.05)}px ${FONT_STACK}`;
		const label = content.category;
		const labelW = ctx.measureText(label).width + W * 0.028;
		const labelH = H * 0.082;
		ctx.strokeStyle = palette.line;
		ctx.lineWidth = Math.max(1, W * 0.0010);
		ctx.globalAlpha = 0.75;
		roundRect(ctx, pad, footerY, labelW, labelH, labelH / 2);
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillStyle = palette.muted;
		ctx.textBaseline = "middle";
		ctx.fillText(label, pad + W * 0.014, footerY + labelH / 2);
		ctx.textBaseline = "top";
	}

	if (content.date) {
		ctx.font = `400 ${Math.round(H * 0.05)}px ${FONT_STACK}`;
		ctx.textAlign = "right";
		ctx.fillStyle = palette.muted;
		ctx.textBaseline = "middle";
		ctx.fillText(content.date, W - pad, footerY + H * 0.041);
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
	}

	// ── 左下角的信号刻度：复刻莱茵界面的小方块阵列 ──────────────────
	const tickCount = 5;
	const tickSize = W * 0.008;
	const tickGap = W * 0.016;
	const tickY = footerY + H * 0.041 - tickSize / 2;
	for (let i = 0; i < tickCount; i++) {
		ctx.fillStyle = i < Math.min(tickCount, content.serial % 5 + 1) ? palette.accent : palette.line;
		ctx.globalAlpha = i < Math.min(tickCount, content.serial % 5 + 1) ? 0.9 : 0.4;
		ctx.fillRect(pad + i * (tickSize + tickGap), tickY, tickSize, tickSize);
	}
	ctx.globalAlpha = 1;

	// ── 外边框：选中时用强调色描一圈 ───────────────────────────────
	// 非选中态也要足够清楚：卡片是靠深色底上的亮边「分张」的，
	// 边框太淡就会糊成一整块墙，丢掉了阵列的读法。
	ctx.strokeStyle = active ? palette.accent : palette.line;
	ctx.lineWidth = active ? Math.max(2, W * 0.0035) : Math.max(1, W * 0.0022);
	ctx.globalAlpha = active ? 1 : 0.78;
	const inset = ctx.lineWidth / 2;
	ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
	ctx.globalAlpha = 1;

	// ── 内描边：距外框一点点画一圈更暗的细线，做出「卡有厚度」的错觉 ──
	ctx.strokeStyle = palette.shade;
	ctx.lineWidth = Math.max(1, W * 0.0014);
	ctx.globalAlpha = 0.5;
	const inset2 = W * 0.012;
	ctx.strokeRect(inset2, inset2, W - inset2 * 2, H - inset2 * 2);
	ctx.globalAlpha = 1;
}

/** 创建一张可复用的卡面纹理 */
export function createCardCanvas() {
	const canvas = document.createElement("canvas");
	canvas.width = TEX_WIDTH;
	canvas.height = TEX_HEIGHT;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas2D 不可用，无法生成卡片纹理");

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	// 卡片会被斜看，各向异性过滤能显著减少文字模糊
	texture.anisotropy = 8;
	texture.needsUpdate = true;

	return { canvas, ctx, texture };
}

/** 重绘一张已有画布并通知纹理刷新 */
export function repaintCard(
	target: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.Texture },
	options: CardTextureOptions
) {
	paintCard(target.ctx, options);
	target.texture.needsUpdate = true;
}

export const CARD_TEX_ASPECT = TEX_HEIGHT / TEX_WIDTH;
