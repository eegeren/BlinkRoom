import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { env } from "../src/lib/env";
import { acquireRoomUploadLock, reserveUploadSession } from "../app/api/rooms/[slug]/uploads/route";

function input() {
  return { itemId: randomUUID(), senderId: randomUUID(), type: "FILE" as const, encryptionVersion: 1 as const, encryptedMetadata: JSON.stringify({ version: 1, algorithm: "AES-GCM", iv: "a".repeat(16), ciphertext: "b".repeat(40) }), encryptedSize: 1024, directDelivered: false };
}

async function roomFixture() {
  const room = await db.room.create({ data: { slug: `T${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`, expiresAt: new Date(Date.now() + 3_600_000), ownerTokenHash: randomUUID() }, include: { items: true } });
  return room;
}

test("PostgreSQL advisory reservation lock does not deserialize void and creates a session", async () => {
  const room = await roomFixture();
  try {
    const created = await reserveUploadSession(room, input(), `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID());
    assert.ok(created.id);
    assert.equal(await db.uploadSession.count({ where: { roomId: room.id } }), 1);
  } finally { await db.room.delete({ where: { id: room.id } }); }
});

test("same item retry reuses a resumable multipart session without a duplicate row", async () => {
  const room = await roomFixture(), upload = input();
  try {
    const first = await reserveUploadSession(room, upload, `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID());
    await db.uploadSession.update({ where: { id: first.id }, data: { status: "UPLOADING", multipartUploadId: "existing-r2-upload" } });
    const retried = await reserveUploadSession(room, { ...upload, encryptedMetadata: input().encryptedMetadata }, `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID());
    assert.equal(retried.action, "reuse");
    assert.equal(retried.id, first.id);
    assert.equal(await db.uploadSession.count({ where: { itemId: upload.itemId } }), 1);
  } finally { await db.room.delete({ where: { id: room.id } }); }
});

test("failed session is reset in place and counted as one reservation", async () => {
  const room = await roomFixture(), upload = input(), firstKey = `rooms/${room.slug}/${randomUUID()}.bin`;
  try {
    const first = await reserveUploadSession(room, upload, firstKey, randomUUID());
    await db.uploadSession.update({ where: { id: first.id }, data: { status: "FAILED", multipartUploadId: "abandoned-r2-upload" } });
    const replacementKey = `rooms/${room.slug}/${randomUUID()}.bin`;
    const replaced = await reserveUploadSession(room, upload, replacementKey, randomUUID());
    assert.equal(replaced.action, "replace");
    assert.equal(replaced.id, first.id);
    assert.deepEqual(replaced.replacedMultipart, { storageKey: firstKey, uploadId: "abandoned-r2-upload" });
    assert.equal(await db.uploadSession.count({ where: { itemId: upload.itemId } }), 1);
    assert.equal(await db.uploadSession.count({ where: { roomId: room.id, status: "PENDING" } }), 1);
  } finally { await db.room.delete({ where: { id: room.id } }); }
});

test("concurrent initialization for the same item creates exactly one reservation", async () => {
  const room = await roomFixture(), upload = input();
  try {
    const results = await Promise.allSettled([
      reserveUploadSession(room, upload, `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID()),
      reserveUploadSession(room, upload, `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID()),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(await db.uploadSession.count({ where: { itemId: upload.itemId } }), 1);
  } finally { await db.room.delete({ where: { id: room.id } }); }
});

test("completed item cannot initialize another upload session", async () => {
  const room = await roomFixture(), upload = input();
  try {
    await db.roomItem.create({ data: { id: upload.itemId, roomId: room.id, senderId: upload.senderId, type: upload.type, encryptedMetadata: upload.encryptedMetadata, encryptedSize: upload.encryptedSize, availability: "STORED" } });
    await assert.rejects(reserveUploadSession(room, upload, `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID()), /item/);
    assert.equal(await db.uploadSession.count({ where: { itemId: upload.itemId } }), 0);
  } finally { await db.room.delete({ where: { id: room.id } }); }
});

test("room lock serializes concurrent reservations at the configured quota", async () => {
  const room = await roomFixture();
  try {
    for (let index = 0; index < env.MAX_CONCURRENT_UPLOADS - 1; index++) await reserveUploadSession(room, input(), `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID());
    const results = await Promise.allSettled([
      reserveUploadSession(room, input(), `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID()),
      reserveUploadSession(room, input(), `rooms/${room.slug}/${randomUUID()}.bin`, randomUUID()),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(await db.uploadSession.count({ where: { roomId: room.id, status: { in: ["PENDING", "UPLOADING"] } } }), env.MAX_CONCURRENT_UPLOADS);
  } finally { await db.room.delete({ where: { id: room.id } }); }
});

test("a transaction rollback leaves no upload reservation", async () => {
  const room = await roomFixture(), upload = input();
  try {
    await assert.rejects(db.$transaction(async (tx) => {
      await acquireRoomUploadLock(tx, room.id);
      await tx.uploadSession.create({ data: { roomId: room.id, itemId: upload.itemId, senderId: upload.senderId, itemType: upload.type, storageKey: `rooms/${room.slug}/${randomUUID()}.bin`, provider: "r2", uploadTokenHash: randomUUID(), encryptedMetadata: upload.encryptedMetadata, encryptedSize: BigInt(upload.encryptedSize), status: "PENDING", expiresAt: room.expiresAt } });
      throw new Error("ROLLBACK_TEST");
    }), /ROLLBACK_TEST/);
    assert.equal(await db.uploadSession.count({ where: { roomId: room.id } }), 0);
  } finally { await db.room.delete({ where: { id: room.id } }); }
});
