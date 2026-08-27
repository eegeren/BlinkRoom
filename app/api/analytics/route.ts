import { NextResponse } from "next/server";
import { classifyClient, recordDownload, recordProductEvent, trackMetric, trackSessionStarted } from "@/src/server/analytics";
import { db } from "@/src/lib/db";
import { trafficSources } from "@/src/lib/analytics-acquisition";

const obviousBot = (ua: string) => /bot|crawler|spider|headless|preview|facebookexternalhit|slurp/i.test(ua);
export async function POST(req: Request) {
  if (obviousBot(req.headers.get("user-agent") ?? "")) return new NextResponse(null, { status: 204 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !["SESSION_STARTED", "PAGE_VIEW", "ROOM_OPENED", "DOWNLOAD_STARTED", "DOWNLOAD_COMPLETED", "DOWNLOAD_FAILED"].includes(String(body.event))) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  if (body.event === "SESSION_STARTED") {
    if (typeof body.sessionId !== "string" || typeof body.visitorId !== "string" || !trafficSources.includes(body.source as never)) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    await trackSessionStarted(body.sessionId, body.visitorId, body.source as typeof trafficSources[number], new Date(), classifyClient(req.headers.get("user-agent") ?? ""));
  } else if (body.event === "PAGE_VIEW") await trackMetric("PAGE_VIEW");
  else if (body.event === "ROOM_OPENED") {
    if (typeof body.roomSlug !== "string" || typeof body.clientId !== "string") return NextResponse.json({ error: "Invalid room open" }, { status: 400 });
    const room = await db.room.findUnique({ where: { slug: body.roomSlug }, select: { id: true } });
    if (room) {
      const creator = await db.analyticsProductEvent.findFirst({ where: { eventType: "ROOM_CREATED", roomHash: (await import("node:crypto")).createHash("sha256").update(room.id).digest("hex") }, select: { clientHash: true } });
      const clientHash = (await import("node:crypto")).createHash("sha256").update(body.clientId).digest("hex");
      if (creator?.clientHash && creator.clientHash !== clientHash) await recordProductEvent({ eventType: "ROOM_OPENED", clientId: body.clientId, roomId: room.id, dedupeId: `${room.id}:${body.clientId}` });
    }
  }
  else {
    if (![body.actionId, body.roomSlug, body.itemId, body.clientId].every(value => typeof value === "string" && value.length >= 8)) return NextResponse.json({ error: "Invalid download" }, { status: 400 });
    await recordDownload({ eventType: body.event as "DOWNLOAD_STARTED" | "DOWNLOAD_COMPLETED" | "DOWNLOAD_FAILED", actionId: body.actionId as string, roomSlug: body.roomSlug as string, itemId: body.itemId as string, clientId: body.clientId as string, durationMs: typeof body.durationMs === "number" ? body.durationMs : 0 });
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
