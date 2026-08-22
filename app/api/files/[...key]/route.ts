import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { db } from "@/src/lib/db";
import { storage } from "@/src/server/storage";
import { rateLimiter } from "@/src/server/rate-limit";
import { trackMetric } from "@/src/server/analytics";

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const analyticsStartedAt = Date.now();
  if (storage.kind === "r2") return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  const key = (await params).key.join("/"); if (!rateLimiter.check(`download:${key}`, 120, 60_000)) return NextResponse.json({ error: "Slow down" }, { status: 429 }); const item = await db.roomItem.findFirst({ where: { storageKey: key }, include: { room: true } });
  const url = new URL(req.url), roomCode = url.searchParams.get("room"), accessVersion = Number(url.searchParams.get("v"));
  if (!item || item.room.slug !== roomCode || item.room.accessVersion !== accessVersion || item.room.status !== "ACTIVE" || item.room.expiresAt <= new Date()) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  let stream: Readable; try { stream = await storage.createReadStream(key); } catch { await trackMetric("DOWNLOAD_FAILED"); return NextResponse.json({ error: "File unavailable" }, { status: 404 }); }
  // Local storage has no separate object host; a successfully opened stream is
  // the closest reliable server-side success point without buffering content.
  await trackMetric("DOWNLOAD_COMPLETED", { bytes: item.encryptedSize ?? 0, durationMs: Date.now() - analyticsStartedAt });
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(item.encryptedSize ?? ""), "Content-Disposition": "attachment; filename=encrypted.bin", "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" } });
}
