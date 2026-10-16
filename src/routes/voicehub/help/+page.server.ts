import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

// 使用帮助同样归属 voicehub 正式域名体系，www 下不再承载，统一 301 跳转。
export const load: PageServerLoad = async () => {
	throw redirect(301, "https://voicehub.245959623.xyz");
};
