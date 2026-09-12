// 从 @lucide/svelte 的图标文件提取 iconNode，生成 cover-icons.mjs（内联 SVG 标记）。
// 用法：node scripts/extract-cover-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const iconsDir = resolve(root, "node_modules/@lucide/svelte/dist/icons");

const wanted = [
	"audio-lines", "cast", "puzzle", "layers", "bot", "list-music",
	"share-2", "list-ordered", "rss", "box", "image", "palette", "sparkles"
];

function serialize(node) {
	// node: [tag, attrs]
	const [tag, attrs] = node;
	const parts = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`);
	return `<${tag} ${parts.join(" ")} />`;
}

const out = {};
for (const name of wanted) {
	const file = resolve(iconsDir, `${name}.svelte`);
	let raw;
	try {
		raw = readFileSync(file, "utf-8");
	} catch {
		console.warn(`跳过缺失图标: ${name}`);
		continue;
	}
	const m = raw.match(/const iconNode = (\[[\s\S]*?\]);/);
	if (!m) {
		console.warn(`无法解析 iconNode: ${name}`);
		continue;
	}
	let nodes;
	try {
		nodes = JSON.parse(m[1]);
	} catch (e) {
		console.warn(`JSON 解析失败: ${name}`, e.message);
		continue;
	}
	out[name] = nodes.map(serialize).join("");
}

const header = `// 自动生成（scripts/extract-cover-icons.mjs），来源 @lucide/svelte v1.41.0 (ISC)。
// 每个条目是图标的「内联 SVG 子标记」，配合 buildCoverSvg 在 <g> 上设置 stroke 样式使用。
export const COVER_ICONS = {
${Object.entries(out).map(([k, v]) => `\t"${k}": ${JSON.stringify(v)}`).join(",\n")}
};

export const COVER_ICON_NAMES = Object.keys(COVER_ICONS);
`;

const target = resolve(root, "src/lib/cover-icons.mjs");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, header, "utf-8");
console.log(`已写入 ${target}，共 ${Object.keys(out).length} 个图标`);
