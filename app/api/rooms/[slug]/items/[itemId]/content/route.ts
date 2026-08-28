import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { tokenHash } from "@/src/lib/security";
import { storage } from "@/src/server/storage";
import { authorizeRoomDevice } from "@/src/server/device-approval";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; itemId: string }> }) {
  const { slug, itemId } = await params;
  const now = new Date();
  const item = await db.roomItem.findFirst({
    where: { id: itemId, room: { slug } },
    include: { room: { select: { id: true, slug: true, ownerTokenHash: true, deviceApprovalRequired: true, accessVersion: true, status: true, expiresAt: true } } },
  });
  if (item && !(await authorizeRoomDevice(req, item.room)).authorized) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  const destructiveAuthorized = item && item.accessMode !== "STANDARD"
    ? item.oneTimeStatus === "RESERVED" && item.consumeReservedAt &&
      item.consumeReservedAt > new Date(now.getTime() - env.ONE_TIME_RESERVATION_SECONDS * 1000) &&
      item.consumeTokenHash === tokenHash(req.headers.get("x-consume-token") ?? "")
    : true;
  const valid = item && destructiveAuthorized && item.storageKey &&
    item.room.status === "ACTIVE" && item.room.expiresAt > now;
  if (!valid) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  try {
    const stream = await storage.createReadStream(item.storageKey!);
    return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(item.encryptedSize ?? ""),
        "Content-Disposition": "attachment; filename=encrypted.bin",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  }
}
