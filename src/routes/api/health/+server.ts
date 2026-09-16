import { json } from "@sveltejs/kit";
import { probeServices } from "$lib/server/health.js";

export async function GET() {
	const services = await probeServices();
	return json({ services, checkedAt: new Date().toISOString() });
}
