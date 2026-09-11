import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { publicRoom, refreshRoomStatus } from "../src/server/rooms";
import { toJsonBytes } from "../src/server/storage/quota";

// RoomItem.encryptedSize used to be a 32-bit Postgres integer (max ~2.147 GB).
// A file between ~2 GB and the 5 GB cap would silently overflow it. These
// tests guard the BigInt migration end to end: the DB accepts the value, and
// every JSON response path (which cannot serialize a raw bigint) converts it
// back to a safe number instead of throwing or truncating.

test("toJsonBytes converts bigint sizes to safe numbers and preserves null", () => {
  assert.equal(toJsonBytes(null), null);
  assert.equal(toJsonBytes(BigInt(5 * 1024 * 1024 * 1024)), 5 * 1024 * 1024 * 1024);
});

test("a RoomItem above the 32-bit int range round-trips through publicRoom without throwing", async () => {
  const room = await db.room.create({
    data: {
      slug: `T${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`,
      expiresAt: new Date(Date.now() + 3_600_000),
      ownerTokenHash: randomUUID(),
    },
  });
  const largeSize = 4 * 1024 * 1024 * 1024 + 12345; // > 2^31, within the 5 GB cap
  try {
    await db.roomItem.create({
      data: {
        roomId: room.id,
        senderId: randomUUID(),
        type: "FILE",
        encryptedMetadata: "encrypted",
        encryptedSize: BigInt(largeSize),
        storageKey: `rooms/${room.slug}/${randomUUID()}.bin`,
        availability: "STORED",
      },
    });
    const refreshed = await refreshRoomStatus(room.slug);
    assert.ok(refreshed);
    const snapshot = publicRoom(refreshed!);
    assert.equal(snapshot.items[0]?.encryptedSize, largeSize);
    assert.doesNotThrow(() => JSON.stringify(snapshot));
  } finally {
    await db.room.delete({ where: { id: room.id } });
  }
});
