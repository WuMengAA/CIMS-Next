import { json } from "@sveltejs/kit";
import { uploadFile, listUploads, deleteUpload } from "$lib/server/content-store.js";
import { getApiUser } from "$lib/server/api-auth.js";


export async function GET() {
	return json(listUploads());
}

export async function POST({ request }) {
	const user = getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const formData = await request.formData();
	const file = formData.get("file") as File;
	if (!file) return json({ error: "no file" }, { status: 400 });
	const buffer = Buffer.from(await file.arrayBuffer());
	const result = uploadFile(file.name, buffer);
	if (result.error) return json({ error: result.error }, { status: 400 });
	return json({ url: result.url, filename: file.name });
}

export async function DELETE({ request }) {
	const user = getApiUser(request);
	if (!user) return json({ error: "未登录" }, { status: 401 });
	const { filename } = await request.json();
	const ok = deleteUpload(filename);
	return json({ ok });
}