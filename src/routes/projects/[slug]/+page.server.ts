import { getItem, renderMarkdown, getSiteUrl } from "$lib/server/content-store.js";
import { getBoard, listIssues, issueStats } from "$lib/server/project-board.js";
import { hasGithubToken } from "$lib/server/github.js";
import { fetchPublished, humanSize } from "$lib/server/downloads.js";
import { error } from "@sveltejs/kit";

export async function load({ params }) {
	const project = getItem("projects", params.slug);
	if (!project) throw error(404, "项目不存在");
	const rendered = renderMarkdown(project.body);

	// 展板是可选增强：没配置展板的项目仍能正常浏览正文，只是不显示活跃度/发行/进度。
	const board = getBoard(params.slug);

	// 装机卡片（仅星集控项目）：被控端/管理端版本实时取云端 ota（2026-10-06 从下载中心迁移至此）。
	// 与下载中心同源（/api/public/ota），发版只改云端一处。
	let downloads = null;
	if (project.slug === "xingjikong") {
		const [agent, viewer] = await Promise.all([
			await fetchPublished("agent"),
			await fetchPublished("viewer")
		]);
		downloads = [
			{
				key: "agent",
				name: "被控端 · 教室机",
				desc: "装完开机自启、常驻托盘：接收管理端指令（锁屏 / 全屏通知 / 音量 / 开关机）、定时任务、抓屏与文件收发，并支持 OTA 自更新。",
				published: agent.published,
				version: agent.published ? agent.latest.version : "",
				url: agent.published ? agent.latest.url : "",
				sha256: agent.published ? agent.latest.sha256 : "",
				sizeText: agent.published ? humanSize(agent.latest.size) : "-",
				error: agent.published ? "" : agent.error || ""
			},
			{
				key: "viewer",
				name: "管理端 · 老师机",
				desc: "老师看到的那个界面：设备列表、远程画面、发通知、推文件、定时任务、软件与媒体管控。绿色版免安装。",
				published: viewer.published,
				version: viewer.published ? viewer.latest.version : "",
				url: viewer.published ? viewer.latest.url : "",
				sha256: viewer.published ? viewer.latest.sha256 : "",
				sizeText: viewer.published ? humanSize(viewer.latest.size) : "-",
				error: viewer.published ? "" : viewer.error || ""
			}
		];
	}

	return {
		project,
		html: rendered.html,
		words: rendered.words,
		board,
		downloads,
		issues: await listIssues(params.slug, { state: "all" }),
		stats: await issueStats(params.slug),
		hasGithubToken: hasGithubToken(),
		// 供页面拼 JSON-LD 的绝对地址
		siteUrl: getSiteUrl()
	};
}
