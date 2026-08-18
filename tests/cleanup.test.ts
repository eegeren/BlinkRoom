import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { StorageProvider } from "../src/server/storage/types";
import { db } from "../src/lib/db";
import { cleanupRoomStorage, markRoomExpiredForCleanup } from "../src/server/storage/cleanup";

function fakeStorage(failFirstDelete = false) {
  const objects = new Set<string>(), multiparts = new Set<string>(); let deleteAttempts = 0, aborts = 0;
  const provider: StorageProvider = {
    kind: "r2", upload: async () => { throw new Error("unused"); },
    deleteObject: async (key) => { objects.delete(key); },
    deleteObjects: async (keys) => { deleteAttempts++; if (failFirstDelete && deleteAttempts === 1) throw new Error("temporary R2 delete failure"); keys.forEach((key) => objects.delete(key)); },
    deleteRoomObjects: async (slug) => { for (const key of objects) if (key.startsWith(`rooms/${slug}/`)) objects.delete(key); },
    getPublicOrSignedUrl: async (key) => { if (!objects.has(key)) throw new Error("NoSuchKey"); return `https://signed.invalid/${key}`; },
    createReadStream: async () => { throw new Error("unused"); }, createMultipartUpload: async () => "unused", signUploadPart: async () => "unused", completeMultipartUpload: async () => undefined,
    abortMultipartUpload: async (_key, uploadId) => { multiparts.delete(uploadId); aborts++; }, headSize: async () => 0, abortStaleMultipartUploads: async () => 0,
  };
  return { provider, objects, multiparts, get deleteAttempts() { return deleteAttempts; }, get aborts() { return aborts; } };
}

async function fixture(status: "ACTIVE" | "EXPIRED" | "DESTROYED", expiresAt = new Date(Date.now() + 60_000)) {
  const slug = `C${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
  const room = await db.room.create({ data: { slug, status, expiresAt, ownerTokenHash: randomUUID() } });
  const itemKey = `rooms/${slug}/${randomUUID()}.bin`, uploadKey = `rooms/${slug}/${randomUUID()}.bin`;
  await db.roomItem.create({ data: { roomId: room.id, senderId: randomUUID(), type: "FILE", encryptedMetadata: "encrypted", encryptedSize: 10, storageKey: itemKey, availability: "STORED" } });
  await db.uploadSession.create({ data: { roomId: room.id, itemId: randomUUID(), senderId: randomUUID(), itemType: "FILE", storageKey: uploadKey, provider: "r2", multipartUploadId: "multipart-id", uploadTokenHash: randomUUID(), encryptedMetadata: "encrypted", encryptedSize: 10, status: "UPLOADING", expiresAt } });
  return { room, slug, itemKey, uploadKey };
}

test("destroyed room cleanup aborts multipart, deletes objects and removes temporary metadata", async () => {
  const data = await fixture("DESTROYED"), storage = fakeStorage(); storage.objects.add(data.itemKey); storage.objects.add(data.uploadKey); storage.multiparts.add("multipart-id");
  try {
    const result = await cleanupRoomStorage(data.room.id, data.slug, storage.provider);
    assert.equal(result.completed, true); assert.equal(storage.objects.size, 0); assert.equal(storage.multiparts.size, 0); assert.equal(storage.aborts, 1);
    assert.equal(await db.roomItem.count({ where: { roomId: data.room.id } }), 0); assert.equal(await db.uploadSession.count({ where: { roomId: data.room.id } }), 0);
    const room = await db.room.findUniqueOrThrow({ where: { id: data.room.id } }); assert.equal(room.status, "DESTROYED"); assert.equal(room.cleanupStatus, "COMPLETED");
    await assert.rejects(storage.provider.getPublicOrSignedUrl(data.itemKey));
  } finally { await db.room.deleteMany({ where: { id: data.room.id } }); }
});

test("failed object deletion leaves room inaccessible and a later cleanup retries to completion", async () => {
  const data = await fixture("DESTROYED"), storage = fakeStorage(true); storage.objects.add(data.itemKey); storage.objects.add(data.uploadKey); storage.multiparts.add("multipart-id");
  try {
    await assert.rejects(cleanupRoomStorage(data.room.id, data.slug, storage.provider), /temporary R2 delete failure/);
    const partial = await db.room.findUniqueOrThrow({ where: { id: data.room.id } }); assert.equal(partial.status, "DESTROYED"); assert.equal(partial.cleanupStatus, "PARTIAL");
    const retried = await cleanupRoomStorage(data.room.id, data.slug, storage.provider); assert.equal(retried.completed, true); assert.equal(storage.deleteAttempts, 2);
    const completed = await db.room.findUniqueOrThrow({ where: { id: data.room.id } }); assert.equal(completed.status, "DESTROYED"); assert.equal(completed.cleanupStatus, "COMPLETED"); assert.equal(completed.cleanupAttempts, 2);
  } finally { await db.room.deleteMany({ where: { id: data.room.id } }); }
});

test("authoritative expiration transitions ACTIVE to EXPIRED before physical cleanup", async () => {
  const data = await fixture("ACTIVE", new Date(Date.now() - 1000)), storage = fakeStorage(); storage.objects.add(data.itemKey); storage.objects.add(data.uploadKey); storage.multiparts.add("multipart-id");
  try {
    assert.equal((await markRoomExpiredForCleanup(data.room.id)).count, 1);
    assert.equal((await db.room.findUniqueOrThrow({ where: { id: data.room.id } })).status, "EXPIRED");
    await cleanupRoomStorage(data.room.id, data.slug, storage.provider);
    const completed = await db.room.findUniqueOrThrow({ where: { id: data.room.id } }); assert.equal(completed.status, "EXPIRED"); assert.equal(completed.cleanupStatus, "COMPLETED"); assert.equal(storage.objects.size, 0);
  } finally { await db.room.deleteMany({ where: { id: data.room.id } }); }
});
