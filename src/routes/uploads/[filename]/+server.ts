import fs from "node:fs";
import path from "node:path";

export async function GET({ url }) {
	const filename = url.pathname.replace("/uploads/", "");
	const filePath = path.resolve("uploads", filename);
	if (!fs.existsSync(filePath)) return new Response("Not found", { status: 404 });
	const stat = fs.statSync(filePath);
	const ext = path.extname(filename).toLowerCase();
	const mimeMap: Record<string, string> = {
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
		".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
		".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
		".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg"
	};
	const contentType = mimeMap[ext] || "application/octet-stream";
	const buffer = fs.readFileSync(filePath);
	return new Response(buffer, {
		headers: {
			"Content-Type": contentType,
			"Content-Length": String(stat.size)
		}
	});
}