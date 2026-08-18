import { db } from "@/src/lib/db";
import type { StorageProvider } from "./types";
import { storage } from ".";
import { acquireRoomLock } from "@/src/server/rooms";

const errorDetails = (error: unknown) => ({ name: error instanceof Error ? error.name : "Unknown", message: error instanceof Error ? error.message : String(error) });

export async function markRoomExpiredForCleanup(roomId: string, now = new Date()) {
  return db.$transaction(async (tx) => { await acquireRoomLock(tx, roomId); return tx.room.updateMany({ where: { id: roomId, status: "ACTIVE", expiresAt: { lte: now } }, data: { status: "EXPIRED", cleanupStatus: "PENDING", cleanupLastError: null, cleanupUpdatedAt: now } }); });
}

export async function cleanupRoomStorage(roomId: string, slug: string, provider: StorageProvider = storage) {
  const now = new Date(), abandonedClaim = new Date(now.getTime() - 10 * 60_000);
  const claim = await db.room.updateMany({
    where: { id: roomId, status: { in: ["EXPIRED", "DESTROYED"] }, OR: [{ cleanupStatus: { in: ["PENDING", "PARTIAL"] } }, { cleanupStatus: "IN_PROGRESS", cleanupUpdatedAt: { lt: abandonedClaim } }] },
    data: { cleanupStatus: "IN_PROGRESS", cleanupAttempts: { increment: 1 }, cleanupLastError: null, cleanupUpdatedAt: now },
  });
  if (!claim.count) return { claimed: false, completed: false, objects: 0, sessions: 0 };

  console.info("[ROOM_CLEANUP_STARTED]", { roomId, status: "IN_PROGRESS" });
  let stage: "load" | "multipart" | "objects" | "metadata" = "load";
  try {
    const [items, sessions] = await Promise.all([
      db.roomItem.findMany({ where: { roomId, storageKey: { not: null } }, select: { storageKey: true } }),
      db.uploadSession.findMany({ where: { roomId }, select: { id: true, status: true, storageKey: true, multipartUploadId: true } }),
    ]);
    await db.uploadSession.updateMany({ where: { roomId, status: { in: ["PENDING", "UPLOADING"] } }, data: { status: "ABORTED" } });

    stage = "multipart";
    let aborted = 0;
    for (const session of sessions) if (session.status !== "COMPLETED" && session.multipartUploadId) { await provider.abortMultipartUpload(session.storageKey, session.multipartUploadId); aborted++; }
    if (aborted) console.info("[MULTIPART_ABORTED]", { roomId, count: aborted, status: "ABORTED" });

    stage = "objects";
    const keys = [...new Set([...items.flatMap((item) => item.storageKey ? [item.storageKey] : []), ...sessions.map((session) => session.storageKey)])];
    await provider.deleteObjects(keys);
    await provider.deleteRoomObjects(slug);

    stage = "metadata";
    await db.$transaction([
      db.roomItem.deleteMany({ where: { roomId } }),
      db.uploadSession.deleteMany({ where: { roomId } }),
      db.room.update({ where: { id: roomId }, data: { encryptedVerifier: null, cleanupStatus: "COMPLETED", cleanupLastError: null, cleanupUpdatedAt: new Date() } }),
    ]);
    console.info("[ROOM_CLEANUP_COMPLETED]", { roomId, count: keys.length, status: "COMPLETED" });
    return { claimed: true, completed: true, objects: keys.length, sessions: sessions.length };
  } catch (error) {
    const details = errorDetails(error);
    if (stage === "objects") console.error("[R2_OBJECT_DELETE_FAILED]", { roomId, status: "PARTIAL", ...details });
    await db.room.updateMany({ where: { id: roomId, status: { in: ["EXPIRED", "DESTROYED"] } }, data: { cleanupStatus: "PARTIAL", cleanupLastError: `${details.name}: ${details.message}`.slice(0, 500), cleanupUpdatedAt: new Date() } });
    console.error("[ROOM_CLEANUP_PARTIAL]", { roomId, status: "PARTIAL", ...details });
    throw error;
  }
}
