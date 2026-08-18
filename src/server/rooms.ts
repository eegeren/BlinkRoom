import { db } from "@/src/lib/db";
import { roomChannel } from "./realtime";
import { storage } from "./storage";
import type { Prisma } from "@prisma/client";

export async function acquireRoomLock(tx: Pick<Prisma.TransactionClient, "$executeRaw">, roomId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}))`; }

export async function refreshRoomStatus(slug: string) {
  const room = await db.room.findUnique({ where: { slug }, include: { items: { orderBy: { createdAt: "asc" } } } });
  if (room?.status === "ACTIVE" && room.expiresAt <= new Date()) {
    const expired = await db.room.update({ where: { id: room.id }, data: { status: "EXPIRED", cleanupStatus: "PENDING", cleanupLastError: null, cleanupUpdatedAt: new Date() }, include: { items: true } });
    roomChannel.expired(slug); return expired;
  }
  return room;
}
export async function destroyRoomFiles(slug: string) { await storage.deleteRoomObjects(slug); }
export const publicRoom = (room: NonNullable<Awaited<ReturnType<typeof refreshRoomStatus>>>) => ({
  slug: room.slug, status: room.status, expiresAt: room.expiresAt.toISOString(), encryptedVerifier: room.status === "ACTIVE" ? room.encryptedVerifier : null, encryptionVersion: room.encryptionVersion,
  items: room.status === "ACTIVE" ? room.items.map((i) => ({ id: i.id, senderId: i.senderId, type: i.type, encryptedPayload: i.encryptedPayload, encryptedMetadata: i.encryptedMetadata, encryptionVersion: i.encryptionVersion, encryptedSize: i.encryptedSize, availability: i.availability, createdAt: i.createdAt.toISOString() })) : [],
});
