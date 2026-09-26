import type { LayoutDoc } from "./types";
import { createCard } from "./util";

/**
 * 首次进入编辑器、且本地无草稿时的示例布局。
 * 刻意铺一点内容（标题/文本/卡片/图片/按钮/列表/分割线），让画布不是空白劝退，
 * 也顺带演示每种卡片长什么样。
 */
export function sampleDoc(): LayoutDoc {
	const heading = createCard("heading", { x: 60, y: 48 }, 1);
	heading.props = { text: "星璃 · 个人技术博客", level: "h1" };
	heading.style = { fontSize: 36, fontWeight: 700, color: "#faf9f5", textAlign: "left" };
	heading.w = 560;
	heading.h = 56;

	const intro = createCard("text", { x: 60, y: 120 }, 2);
	intro.props = {
		content: "代码、校园与热爱，都留在这里。这是用可视化编辑器搭出来的示例布局——拖一拖、改一改，右边导出 JSON 就能拿走。"
	};
	intro.w = 560;
	intro.h = 80;

	const about = createCard("card", { x: 60, y: 230 }, 3);
	about.props = { title: "关于本站" };
	about.w = 320;
	about.h = 200;

	const img = createCard("image", { x: 410, y: 230 }, 4);
	img.w = 320;
	img.h = 200;

	const divider = createCard("divider", { x: 60, y: 470 }, 5);
	divider.w = 670;
	divider.props = { thickness: 2, color: "#3a3a36" };

	const btn = createCard("button", { x: 60, y: 510 }, 6);
	btn.props = { label: "访问 GitHub", href: "https://github.com", variant: "primary" };

	const list = createCard("list", { x: 410, y: 510 }, 7);
	list.props = { items: "技术笔记\n开源项目\n校园集控实践" };
	list.w = 320;
	list.h = 120;

	return {
		version: 1,
		name: "示例布局",
		canvas: { width: 1024, height: 720, background: "#161614" },
		cards: [heading, intro, about, img, divider, btn, list]
	};
}
