import { NextResponse } from "next/server";
import { classifyClient, trackDownloadAction, trackMetric, trackSessionStarted } from "@/src/server/analytics";
import { trafficSources } from "@/src/lib/analytics-acquisition";

const obviousBot = (ua: string) => /bot|crawler|spider|headless|preview|facebookexternalhit|slurp/i.test(ua);
export async function POST(req: Request) {
  if (obviousBot(req.headers.get("user-agent") ?? "")) return new NextResponse(null, { status: 204 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !["SESSION_STARTED", "PAGE_VIEW", "DOWNLOAD_COMPLETED", "DOWNLOAD_FAILED"].includes(String(body.event))) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  if (body.event === "SESSION_STARTED") {
    if (typeof body.sessionId !== "string" || typeof body.visitorId !== "string" || !trafficSources.includes(body.source as never)) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    await trackSessionStarted(body.sessionId, body.visitorId, body.source as typeof trafficSources[number], new Date(), classifyClient(req.headers.get("user-agent") ?? ""));
  } else if (body.event === "PAGE_VIEW") await trackMetric("PAGE_VIEW");
  else {
    if (![body.actionId, body.roomSlug, body.itemId, body.participantId].every(value => typeof value === "string" && value.length >= 8)) return NextResponse.json({ error: "Invalid download" }, { status: 400 });
    await trackDownloadAction({ successful: body.event === "DOWNLOAD_COMPLETED", actionId: body.actionId as string, roomSlug: body.roomSlug as string, itemId: body.itemId as string, participantId: body.participantId as string, durationMs: typeof body.durationMs === "number" ? body.durationMs : 0 });
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
