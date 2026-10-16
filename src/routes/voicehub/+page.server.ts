import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// voicehub 点歌站已迁至独立域名 voicehub.245959623.xyz。
// www 下的内嵌页不再承载内容，统一 301 跳转到正式域名，避免重复内容并集中 SEO 权重。
export const load: PageServerLoad = async () => {
	throw redirect(301, "https://voicehub.245959623.xyz");
};
