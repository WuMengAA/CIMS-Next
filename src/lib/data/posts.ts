export interface Post {
	slug: string;
	title: string;
	date: string;
	category: string;
	tags: string[];
	words: number;
	pinned?: boolean;
	excerpt: string;
}

export const posts: Post[] = [
	{
		slug: "friend-group-guide",
		title: "加群向导",
		date: "2025-05-23",
		category: "杂谈",
		tags: ["Markdown"],
		words: 261,
		pinned: true,
		excerpt: "关于如何联系二叉树树~"
	},
	{
		slug: "20th-refactor-system",
		title: "第 20 次重构：七天，把一个网站重新做成一个系统",
		date: "2026-08-31",
		category: "开发",
		tags: ["AI", "开发"],
		words: 3471,
		excerpt: "对比三代旧前端与全新 SvelteKit 站点，复盘 Stelarith 如何用全站 HTML 直出、shadcn-svelte Design System 和七天细节打磨完成第 20 次重构。"
	},
	{
		slug: "ani-on-mi-tv",
		title: "把 Ani 装进小米电视：没有触屏，也能用手机当鼠标追番",
		date: "2026-08-31",
		category: "追番",
		tags: ["追番", "工具"],
		words: 1181,
		excerpt: "从手机投屏到直接在小米电视安装 Ani，再用 ADB 鼠标键盘解决遥控器无法操作的问题。"
	},
	{
		slug: "19th-refactor-astro",
		title: "上次迁到 Vuetify，这次又回到 Astro：第 19 次重构，把整个主站收进一个前端",
		date: "2026-08-26",
		category: "开发",
		tags: ["AI", "开发"],
		words: 9472,
		excerpt: "Vuetify 组件库很好用，但设计语言、特殊交互和 AI 时代的内容直出逼着我重新抉择架构，最后先选了 Astro，再让 AI 为交互部分选择了 React。"
	},
	{
		slug: "oauth-handoff-review",
		title: "从“回跳已过期”到安全交接：一次 OAuth 账号系统联调复盘",
		date: "2026-08-26",
		category: "开发",
		tags: ["开发", "安全", "OAuth"],
		words: 3807,
		excerpt: "记录一个真实账号系统从密码与通行密钥，到多家 OAuth、跨站回跳、安全审计和生产回归的完整联调过程。"
	},
	{
		slug: "ai-tts-prompt-windows",
		title: "让 AI 干完活自己喊一声：Windows 下给 Codex、Claude Code、OpenCode 加 TTS 提示",
		date: "2026-08-22",
		category: "开发",
		tags: ["AI", "Windows"],
		words: 2902,
		excerpt: "不用 Beep，也不额外维护 .ps1 文件，让三个终端 AI 工具在响应结束后用 PowerShell 内置 TTS 播报完成提示。"
	},
	{
		slug: "d1-test-accident",
		title: "测试不要碰生产数据库：一次 Cloudflare D1 清库事故复盘",
		date: "2026-08-21",
		category: "开发",
		tags: ["开发", "Cloudflare", "数据库"],
		words: 1969,
		excerpt: "从一次 Users 表异常、找回邮件失效，到定位测试配置误连生产 D1：我们为什么决定不再运行测试，只用静态代码审查和可回滚的小提交。"
	},
	{
		slug: "ssr-to-vuetify",
		title: "原 SSR 落幕之后：我用不到半天把主站从 React CSR 重构到 Vuetify",
		date: "2026-08-12",
		category: "开发",
		tags: ["开发", "Vue"],
		words: 4752,
		excerpt: "Oracle 停机逼出的紧急 CSR、手搓 UI 和 React SSR 埋下的……"
	}
];

export const categories = ["全部", "AI", "开发", "追番", "工具", "安全", "OAuth", "Windows", "Cloudflare", "数据库", "网络", "服务器", "杂谈", "Markdown"];
