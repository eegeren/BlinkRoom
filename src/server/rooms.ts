import { db } from "@/src/lib/db";
import { roomChannel } from "./realtime";
import { storage } from "./storage";

export async function refreshRoomStatus(slug: string) {
  const room = await db.room.findUnique({ where: { slug }, include: { items: { orderBy: { createdAt: "asc" } } } });
  if (room?.status === "ACTIVE" && room.expiresAt <= new Date()) {
    const expired = await db.room.update({ where: { id: room.id }, data: { status: "EXPIRED" }, include: { items: true } });
    roomChannel.expired(slug); return expired;
  }
  return room;
}
export async function destroyRoomFiles(slug: string) { await storage.deleteRoomFiles(slug); }
export const publicRoom = (room: NonNullable<Awaited<ReturnType<typeof refreshRoomStatus>>>) => ({
  slug: room.slug, status: room.status, expiresAt: room.expiresAt.toISOString(), encryptedVerifier: room.encryptedVerifier, encryptionVersion: room.encryptionVersion,
  items: room.items.map((i) => ({ id: i.id, senderId: i.senderId, type: i.type, encryptedPayload: i.encryptedPayload, encryptedMetadata: i.encryptedMetadata, encryptionVersion: i.encryptionVersion, encryptedSize: i.encryptedSize, availability: i.availability, createdAt: i.createdAt.toISOString() })),
});
