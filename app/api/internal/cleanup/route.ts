import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { storage } from "@/src/server/storage";
import { cleanupRoomStorage } from "@/src/server/storage/cleanup";
import { roomChannel } from "@/src/server/realtime";

export async function POST(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${env.CLEANUP_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date(); const rooms = await db.room.findMany({ where: { OR: [{ status: "ACTIVE", expiresAt: { lte: now } }, { status: { in: ["EXPIRED", "DESTROYED"] }, OR: [{ items: { some: {} } }, { uploadSessions: { some: {} } }] }] }, select: { id: true, slug: true, status: true }, take: env.CLEANUP_BATCH_SIZE, orderBy: { expiresAt: "asc" } }); let cleaned = 0, failed = 0;
  for (const room of rooms) { try { if (room.status === "ACTIVE") { const changed = await db.room.updateMany({ where: { id: room.id, status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } }); if (changed.count) roomChannel.expired(room.slug); } await cleanupRoomStorage(room.id, room.slug); cleaned++; } catch { failed++; } }
  const staleBefore = new Date(now.getTime() - env.MULTIPART_STALE_HOURS * 3_600_000); const stale = await db.uploadSession.findMany({ where: { status: { in: ["PENDING", "UPLOADING", "FAILED"] }, OR: [{ createdAt: { lte: staleBefore } }, { expiresAt: { lte: now } }] }, take: env.CLEANUP_BATCH_SIZE }); for (const session of stale) { try { if (session.multipartUploadId) await storage.abortMultipartUpload(session.storageKey, session.multipartUploadId); await storage.delete(session.storageKey); await db.uploadSession.delete({ where: { id: session.id } }); } catch { failed++; } }
  let providerMultipartAborted = 0; try { providerMultipartAborted = await storage.abortStaleMultipartUploads(staleBefore); } catch { failed++; }
  return NextResponse.json({ cleaned, staleUploads: stale.length, providerMultipartAborted, failed });
}
