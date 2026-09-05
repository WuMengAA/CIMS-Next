import type { PageLoad } from "./$types";

// 用户列表在导航期加载；event.fetch 会自动携带登录 cookie
export const load: PageLoad = async ({ fetch }) => {
	const res = await fetch("/api/auth");
	if (!res.ok) return { users: [], current: "" };
	const data = await res.json();
	return { users: (data.users || []) as any[], current: (data.current || "") as string };
};
