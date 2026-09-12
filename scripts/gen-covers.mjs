// 为 content/posts/*.md 生成确定性 SVG 封面，并最小改动地把 cover 字段写回 frontmatter。
// 用法：node scripts/gen-covers.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { buildCoverSvg } from "../src/lib/cover.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const postsDir = resolve(root, "content/posts");
const coversDir = resolve(root, "static/covers");
const liveDir = resolve(root, "build/client/covers");

const ICON_BY_SLUG = {
	"audio-metadata-scraping": "audio-lines",
	"dlna-airplay-cast": "cast",
	"dsh-plugin-architecture": "puzzle",
	"local-music-architecture": "layers",
	"multi-agent-dev": "bot",
	"on-device-playlist-curation": "list-music",
	"relay-protocol-design": "share-2",
	"riverpod-playback-queue": "list-ordered",
	"rss-classisland-broadcast": "rss",
	"voxel-ambient-experience": "box"
};
const ICON_BY_CAT = { 工程笔记: "sparkles", 体验设计: "palette" };

mkdirSync(coversDir, { recursive: true });
mkdirSync(liveDir, { recursive: true });

const list = readdirSync(postsDir).filter((f) => f.endsWith(".md"));

let count = 0;
for (const f of list) {
	const slug = f.replace(/\.md$/, "");
	const raw = readFileSync(resolve(postsDir, f), "utf-8");
	const { data, content } = matter(raw);
	const icon = ICON_BY_SLUG[slug] || ICON_BY_CAT[data.category] || "image";
	const subtitle = (data.excerpt || "").slice(0, 24);

	const svg = buildCoverSvg({
		title: data.title || slug,
		subtitle,
		category: data.category || "",
		icon,
		ratio: "16:9"
	});

	const outName = `${slug}.svg`;
	writeFileSync(resolve(coversDir, outName), svg, "utf-8");
	copyFileSync(resolve(coversDir, outName), resolve(liveDir, outName));
	count++;

	// 最小改动写回 cover 字段
	const coverLine = `cover: /covers/${outName}`;
	if (!/^\s*cover\s*:/m.test(raw)) {
		// 在结束的 --- 之前插入
		const idx = raw.indexOf("\n---", raw.indexOf("---") + 3);
		if (idx !== -1) {
			const newRaw = raw.slice(0, idx + 1) + coverLine + "\n" + raw.slice(idx + 1);
			writeFileSync(resolve(postsDir, f), newRaw, "utf-8");
		}
	}
	console.log(`✓ ${slug}  (icon=${icon})`);
}

console.log(`\n生成 ${count} 张封面 → static/covers + build/client/covers，并已写回 cover 字段。`);
