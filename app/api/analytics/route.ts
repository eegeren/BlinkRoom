import { NextResponse } from "next/server";
import { trackMetric, trackSessionStarted } from "@/src/server/analytics";

const obviousBot = (ua: string) => /bot|crawler|spider|headless|preview|facebookexternalhit|slurp/i.test(ua);
export async function POST(req: Request) {
  if (obviousBot(req.headers.get("user-agent") ?? "")) return new NextResponse(null, { status: 204 });
  const body = await req.json().catch(() => null) as { event?: unknown; sessionId?: unknown } | null;
  if (!body || (body.event !== "SESSION_STARTED" && body.event !== "PAGE_VIEW")) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  if (body.event === "SESSION_STARTED") {
    if (typeof body.sessionId !== "string") return NextResponse.json({ error: "Invalid session" }, { status: 400 });
    await trackSessionStarted(body.sessionId);
  } else await trackMetric("PAGE_VIEW");
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
