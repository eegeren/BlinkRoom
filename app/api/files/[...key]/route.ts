import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { db } from "@/src/lib/db";
import { storage } from "@/src/server/storage";
import { rateLimiter } from "@/src/server/rate-limit";

export async function GET(_: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (storage.kind === "r2") return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  const key = (await params).key.join("/"); if (!rateLimiter.check(`download:${key}`, 120, 60_000)) return NextResponse.json({ error: "Slow down" }, { status: 429 }); const item = await db.roomItem.findFirst({ where: { storageKey: key }, include: { room: true } });
  if (!item || item.room.status !== "ACTIVE" || item.room.expiresAt <= new Date()) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  let stream: Readable; try { stream = await storage.createReadStream(key); } catch { return NextResponse.json({ error: "File unavailable" }, { status: 404 }); }
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(item.encryptedSize ?? ""), "Content-Disposition": "attachment; filename=encrypted.bin", "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" } });
}
