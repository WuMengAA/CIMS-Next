import fs from "node:fs";
import path from "node:path";

// 上传文件直出。
//
// 两个必须守住的点：
// 1) url.pathname 是 **percent-encoded** 的，中文/空格文件名（如「预览-123.png」）若不先
//    decodeURIComponent，path.resolve("uploads", "%E9%A2%84...") 必然找不到文件，
//    表现为上传成功但预览 404。
// 2) 解码后必须做目录穿越校验：`..%2F..%2Fetc` 之类会逃出 uploads/。
const UPLOAD_ROOT = path.resolve("uploads");

export async function GET({ url }) {
	let filename: string;
	try {
		filename = decodeURIComponent(url.pathname.replace("/uploads/", ""));
	} catch {
		// 非法百分号序列（如 "%zz"）会让 decodeURIComponent 抛 URIError
		return new Response("Bad request", { status: 400 });
	}
	if (!filename) return new Response("Not found", { status: 404 });

	const filePath = path.resolve(UPLOAD_ROOT, filename);
	// 必须仍在 uploads/ 目录内，且不是目录本身（防 ../ 穿越与目录读取）
	if (filePath !== UPLOAD_ROOT && !filePath.startsWith(UPLOAD_ROOT + path.sep)) {
		return new Response("Forbidden", { status: 403 });
	}
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		return new Response("Not found", { status: 404 });
	}

	const ext = path.extname(filename).toLowerCase();
	const mimeMap: Record<string, string> = {
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
		".avif": "image/avif", ".ico": "image/x-icon",
		".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
		".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		".csv": "text/csv", ".json": "application/json",
		".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska",
		".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac", ".m4a": "audio/mp4",
		".zip": "application/zip", ".rar": "application/vnd.rar", ".7z": "application/x-7z-compressed",
		".tar": "application/x-tar", ".gz": "application/gzip", ".apk": "application/vnd.android.package-archive",
		".vtt": "text/vtt", ".srt": "application/x-subrip", ".sub": "text/x-microdvd"
	};
	const contentType = mimeMap[ext] || "application/octet-stream";
	const stat = fs.statSync(filePath);
	const buffer = fs.readFileSync(filePath);
	return new Response(buffer, {
		headers: {
			"Content-Type": contentType,
			"Content-Length": String(stat.size),
			"Cache-Control": "public, max-age=86400"
		}
	});
}
