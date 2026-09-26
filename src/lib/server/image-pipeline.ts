/**
 * 图片处理管线 —— 水印 + 压缩（avif / webp / 原图）+ 原图留存。
 *
 * 依赖 sharp（libvips 预编译二进制，AVIF 编码由 libheif 提供）。
 * sharp 在本机是**可选依赖**，缺失时不整个站崩，而是在真正用到图片处理时给出一条
 * 明确的安装提示（见 ImagePipelineUnavailableError）——宁可报错也不要"悄悄存了没压缩的原图"
 * 让用户的配额被 JPEG 吃掉。
 *
 * 管线顺序（顺序不能随意调）：
 *   读尺寸 → 缩到 maxEdge 以内 → 画水印 → 编码成目标格式
 * 把「缩」放在「压」前面：水印是按最终像素画的，若先压缩再加水印，水印会被再次编码而糊掉半截。
 */
import type { Buffer as NodeBuffer } from "node:buffer";

export type TargetFormat = "avif" | "webp" | "original";

export interface ImageProcessOptions {
	/** 目标格式。original = 一律不转码，只做缩放 + 水印。 */
	format: TargetFormat;
	/** 是否加水印（默认开）。只对图片生效。 */
	watermark: boolean;
	/** 水印文字，默认取站点名「Stelarith」。 */
	watermarkText?: string;
	/** 允许的最大边长（等宽缩放），默认 2560。0/null 表示不限。 */
	maxEdge?: number | null;
	/** 编码质量 1~100，默认 80；avif 默认稍低（同画质体积小很多）。 */
	quality?: number;
	/** 一键压缩时是否同时留一份原图（original_key / original_bytes）。 */
	keepOriginal?: boolean;
}

export interface ImageProcessResult {
	buffer: Uint8Array;
	mime: string;
	ext: string;
	width: number;
	height: number;
	bytes: number;
	/** 保留原图时：原图另存的键与体积（由调用方决定存到哪，这里只回传信息）。 */
	originalBytes: number;
	/** 实际生效的编码格式名，回显给用户（可能因为源格式不支持而回落）。 */
	appliedFormat: TargetFormat | "jpeg" | "png";
}

export class ImagePipelineUnavailableError extends Error {
	constructor() {
		super(
			"图片处理组件（sharp）未安装，无法压缩或加水印。请先在项目目录执行 " +
				"`npm install sharp`，确认 node_modules/sharp 存在后重启服务。"
		);
		this.name = "ImagePipelineUnavailableError";
	}
}

/**
 * sharp 的调用入口本身（`sharp(input)`），而不是模块命名空间对象。
 * sharp 是 CJS 包，ESM 下拿到的模块对象上才有 `.default`；
 * 这里在唯一一处把「命名空间 → 可调用函数」的转换做完，下游就只管当函数用，
 * 不用在每个调用点再跟 `.default` 的类型打架。
 */
type SharpFn = typeof import("sharp");

/** 懒加载 sharp：模块顶层 require 会让"没装 sharp"变成整站启动失败。 */
async function loadSharp(): Promise<SharpFn> {
	try {
		// sharp 是 `export =` 的 CJS 包：ESM 里 import 得到的是命名空间对象（default 才是函数），
		// 而 TS 眼里它本身就是那个函数。两种可能都接住，取能调用的那个。
		const mod = (await import("sharp")) as unknown as { default?: SharpFn } & SharpFn;
		return mod.default ?? mod;
	} catch {
		throw new ImagePipelineUnavailableError();
	}
}

const MIME_BY_EXT: Record<string, string> = {
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
	avif: "image/avif",
	gif: "image/gif",
};

export function mimeFromExtension(ext: string): string {
	return MIME_BY_EXT[ext.toLowerCase()] ?? "image/jpeg";
}

/** 只读元信息（宽高/格式），不解码整图，成本极低——上传预检用这个。 */
export async function probeImage(
	input: Uint8Array
): Promise<{ width: number; height: number; format: string } | null> {
	let sharp: SharpFn;
	try {
		sharp = await loadSharp();
	} catch {
		return null; // 没装 sharp 就退化成"无法探测"，由调用方放行原始体积
	}
	try {
		const meta = await sharp(input, { failOn: "none" }).metadata();
		if (!meta.width || !meta.height) return null;
		return { width: meta.width, height: meta.height, format: String(meta.format ?? "") };
	} catch {
		return null;
	}
}

/** 估算水印文字宽度：中日韩字符按 1 个字宽、其他按 0.55。 */
function textWidth(text: string, fontSize: number): number {
	let units = 0;
	for (const ch of text) units += /[　-鿿＀-￯]/.test(ch) ? 1 : 0.55;
	return Math.ceil(units * fontSize);
}

/**
 * 水印离边缘的内边距（与字号挂钩，小图不会顶到边）。
 */
function watermarkInset(fontSize: number): number {
	return Math.max(6, Math.round(fontSize * 0.6));
}

interface WatermarkAsset {
	buffer: NodeBuffer;
	width: number;
	height: number;
	inset: number;
}

/**
 * 生成水印图层（半透明底衬 + 白字，任何亮暗底图上都能看清）。
 *
 * ⚠️ 定位不用 `gravity`：实测 sharp 里 `gravity: "southeast"` 再给 left/top 偏移时，
 * 偏移被当成**绝对坐标**处理，水印会跳到左上角；而 gravity 的合法值也不接受
 * "bottom-right" 这种连字符写法（直接抛 Expected valid gravity）。
 * 所以这里改成自己算绝对坐标，谁来读都不会有歧义。
 */
function watermarkSvg(text: string, width: number, height: number): WatermarkAsset {
	const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.032));
	const padX = Math.round(fontSize * 0.7);
	const barH = Math.round(fontSize * 1.75);
	const tw = textWidth(text || "Stelarith", fontSize);
	const barW = tw + padX * 2;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${barW}" height="${barH}">
  <rect x="0" y="0" width="${barW}" height="${barH}" rx="${Math.round(barH / 2)}"
        fill="rgba(0,0,0,0.42)"/>
  <text x="${barW / 2}" y="${barH / 2}" fill="#ffffff" fill-opacity="0.9"
        font-family="system-ui,-apple-system,Segoe UI,Noto Sans SC,sans-serif"
        font-size="${fontSize}" font-weight="500"
        text-anchor="middle" dominant-baseline="central">${escapeXml(text || "Stelarith")}</text>
</svg>`;
	return { buffer: Buffer.from(svg), width: barW, height: barH, inset: watermarkInset(fontSize) };
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** 目标格式 → sharp 编码参数。 */
function encodeOptions(format: TargetFormat, quality: number) {
	if (format === "webp") return { format: "webp" as const, quality, effort: 4 };
	if (format === "avif") return { format: "avif" as const, quality: Math.min(quality, 55), effort: 3 };
	return null; // original：不编码
}

const EXT_BY_FORMAT: Record<string, string> = {
	avif: "avif",
	webp: "webp",
	jpeg: "jpg",
	png: "png",
	original: "bin",
};

/**
 * 处理一张图。返回的 buffer 就是最终要上传的内容。
 * @param input 原始图片字节
 * @param opts  处理选项
 */
export async function processImage(
	input: Uint8Array,
	opts: ImageProcessOptions
): Promise<ImageProcessResult> {
	const sharp = await loadSharp();
	const quality = Math.min(100, Math.max(1, opts.quality ?? 80));
	let pipeline = sharp(input, { failOn: "none" });

	let meta: Awaited<ReturnType<typeof pipeline.metadata>> | null = null;
	try {
		meta = await pipeline.metadata();
	} catch (err) {
		throw new Error(`无法解析这张图片：${(err as Error).message}`);
	}
	const width = meta?.width ?? 0;
	const height = meta?.height ?? 0;
	const srcFormat = String(meta?.format ?? "");

	// 1) 缩放（先缩放再画水印，所以这里只缩不画）
	const maxEdge = opts.maxEdge && opts.maxEdge > 0 ? opts.maxEdge : null;
	// 水印坐标必须按**缩放后**的画布算：拿原尺寸去定位，大图缩过之后水印会甩到画外。
	let outW = width;
	let outH = height;
	if (maxEdge && height > 0 && (width > maxEdge || height > maxEdge)) {
		const scale = maxEdge / Math.max(width, height);
		outW = Math.max(1, Math.round(width * scale));
		outH = Math.max(1, Math.round(height * scale));
		pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
	}

	// 2) 水印（绝对坐标贴右下角；见 watermarkSvg 上方关于 gravity 的说明）
	const doWatermark = opts.watermark && outW > 0 && outH > 0;
	if (doWatermark) {
		const wm = watermarkSvg(opts.watermarkText ?? "Stelarith", outW, outH);
		pipeline = pipeline.composite([
			{
				input: wm.buffer,
				left: Math.max(0, outW - wm.width - wm.inset),
				top: Math.max(0, outH - wm.height - wm.inset)
			}
		]);
	}

	// 3) 编码
	const enc = encodeOptions(opts.format, quality);
	if (enc) {
		pipeline = pipeline[enc.format]({ quality: enc.quality, effort: enc.effort });
	}

	const buffer = (await pipeline.toBuffer()) as unknown as NodeBuffer;

	// 原图留存体积（供调用方写 original_key 时的元信息）
	const originalBytes = input.byteLength;

	// 回显实际格式：若源图不是 jpeg/png 而用户要 original，就把扩展名按源格式落，
	// 避免出现 .bin 这种没法在浏览器里直接显示的附件。
	let applied: ImageProcessResult["appliedFormat"] = enc
		? (enc.format as ImageProcessResult["appliedFormat"])
		: (srcFormat as "jpeg" | "png" | "original") || "original";

	let ext = EXT_BY_FORMAT[String(applied)] ?? (srcFormat === "png" ? "png" : srcFormat === "jpeg" ? "jpg" : "bin");
	let mime = MIME_BY_EXT[ext];

	// 编码后重新取一次真实尺寸（缩放可能改变了宽高）
	let finalMeta = meta;
	if (finalMeta && finalMeta.width && finalMeta.height) {
		// 尺寸在 pipeline 里被改过，重新取一次成本很低（不解码像素）
		try {
			const m2 = await sharp(buffer, { failOn: "none" }).metadata();
			if (m2.width && m2.height) finalMeta = m2 as typeof meta;
		} catch {
			/* 保持原尺寸即可 */
		}
	}

	return {
		buffer: new Uint8Array(buffer),
		mime: mime || "image/jpeg",
		ext,
		width: finalMeta?.width ?? width,
		height: finalMeta?.height ?? height,
		bytes: buffer.byteLength,
		originalBytes,
		appliedFormat: applied,
	};
}

/** 一键压缩：同一个文件按目标格式重跑一次，返回新字节（原图字节由调用方另存）。 */
export async function recompress(
	input: Uint8Array,
	format: "avif" | "webp",
	opts: { watermark?: boolean; watermarkText?: string; maxEdge?: number | null; quality?: number } = {}
): Promise<{ buffer: Uint8Array; bytes: number; ext: string; mime: string; width: number; height: number }> {
	const res = await processImage(input, {
		format,
		watermark: opts.watermark ?? true,
		watermarkText: opts.watermarkText,
		maxEdge: opts.maxEdge ?? null,
		quality: opts.quality ?? 80,
	});
	return {
		buffer: res.buffer,
		bytes: res.bytes,
		ext: res.ext,
		mime: res.mime,
		width: res.width,
		height: res.height,
	};
}
