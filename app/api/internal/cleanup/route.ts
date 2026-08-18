import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { storage } from "@/src/server/storage";
import { cleanupRoomStorage, markRoomExpiredForCleanup } from "@/src/server/storage/cleanup";
import { roomChannel } from "@/src/server/realtime";

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env.CLEANUP_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const rooms = await db.room.findMany({
    where: { OR: [{ status: "ACTIVE", expiresAt: { lte: now } }, { status: { in: ["EXPIRED", "DESTROYED"] }, cleanupStatus: { not: "COMPLETED" } }] },
    select: { id: true, slug: true, status: true }, take: env.CLEANUP_BATCH_SIZE, orderBy: { expiresAt: "asc" },
  });
  let cleaned = 0, failed = 0, skipped = 0;
  for (const room of rooms) {
    try {
      if (room.status === "ACTIVE") {
        const changed = await markRoomExpiredForCleanup(room.id, now);
        if (!changed.count) { skipped++; continue; }
        roomChannel.expired(room.slug);
      }
      const result = await cleanupRoomStorage(room.id, room.slug);
      if (result.completed) cleaned++; else skipped++;
    } catch { failed++; }
  }

  const staleBefore = new Date(now.getTime() - env.MULTIPART_STALE_HOURS * 3_600_000);
  const stale = await db.uploadSession.findMany({ where: { status: { in: ["PENDING", "UPLOADING", "FAILED", "ABORTED"] }, createdAt: { lte: staleBefore }, room: { status: "ACTIVE", expiresAt: { gt: now } } }, take: env.CLEANUP_BATCH_SIZE, orderBy: { createdAt: "asc" } });
  let staleUploads = 0;
  for (const session of stale) {
    try {
      await db.uploadSession.updateMany({ where: { id: session.id, status: { in: ["PENDING", "UPLOADING"] } }, data: { status: "ABORTED" } });
      if (session.multipartUploadId) { await storage.abortMultipartUpload(session.storageKey, session.multipartUploadId); console.info("[MULTIPART_ABORTED]", { roomId: session.roomId, count: 1, status: "ABORTED" }); }
      await storage.deleteObject(session.storageKey);
      await db.uploadSession.deleteMany({ where: { id: session.id, status: { in: ["ABORTED", "FAILED"] } } });
      staleUploads++;
    } catch { failed++; }
  }

  let providerMultipartAborted = 0;
  try { providerMultipartAborted = await storage.abortStaleMultipartUploads(staleBefore); if (providerMultipartAborted) console.info("[MULTIPART_ABORTED]", { roomId: "provider-orphan-scan", count: providerMultipartAborted, status: "ABORTED" }); }
  catch { failed++; }
  return NextResponse.json({ rooms: rooms.length, cleaned, skipped, staleUploads, providerMultipartAborted, failed });
}
