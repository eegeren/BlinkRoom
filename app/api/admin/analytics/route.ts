import { NextResponse } from "next/server";
import { isAnalyticsAdmin } from "@/src/server/admin-auth";
import { getAnalytics, type AnalyticsRange } from "@/src/server/analytics";
const ranges = new Set<AnalyticsRange>(["24h", "7d", "30d", "all"]);
export async function GET(req: Request) {
  if (!(await isAnalyticsAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const value = new URL(req.url).searchParams.get("range") ?? "7d";
  if (!ranges.has(value as AnalyticsRange)) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  return NextResponse.json(await getAnalytics(value as AnalyticsRange), { headers: { "Cache-Control": "no-store" } });
}
