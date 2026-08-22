import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { tokenHash } from "../src/lib/security";
import { GET as getRoom } from "../app/api/rooms/[slug]/route";
import { POST as rotateRoom } from "../app/api/rooms/[slug]/rotate/route";
import { GET as getDownload } from "../app/api/rooms/[slug]/items/[itemId]/download/route";

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

function ownerRequest(slug: string, token: string) {
  return new NextRequest(`http://localhost/api/rooms/${slug}/rotate`, {
    method: "POST",
    headers: { cookie: `blinkroom_owner_${slug}=${token}` },
  });
}

test("emergency lock rotates access while preserving the room, owner, files, and expiry", async () => {
  const oldSlug = `A${randomUUID().replaceAll("-", "").slice(0, 3).toUpperCase()}-${randomUUID().replaceAll("-", "").slice(0, 2).toUpperCase()}`;
  const ownerToken = randomUUID();
  const expiresAt = new Date(Date.now() + 3_600_000);
  const ownerParticipantId = randomUUID();
  const participantId = randomUUID();
  const itemId = randomUUID();
  const pendingItemId = randomUUID();
  const room = await db.room.create({
    data: {
      slug: oldSlug,
      cryptoContext: oldSlug,
      expiresAt,
      ownerTokenHash: tokenHash(ownerToken),
      presences: {
        create: [
          { socketId: `owner-${randomUUID()}`, participantId: ownerParticipantId, isOwner: true, expiresAt },
          { socketId: `guest-${randomUUID()}`, participantId, isOwner: false, expiresAt },
        ],
      },
      items: {
        create: {
          id: itemId,
          senderId: participantId,
          type: "FILE",
          encryptedMetadata: "encrypted-file-metadata",
          encryptedSize: 128,
          storageKey: `rooms/${oldSlug}/${itemId}.bin`,
          availability: "STORED",
        },
      },
      uploadSessions: {
        create: [
          {
            itemId,
            senderId: participantId,
            itemType: "FILE",
            storageKey: `rooms/${oldSlug}/${itemId}.bin`,
            provider: "local",
            uploadTokenHash: tokenHash(randomUUID()),
            encryptedMetadata: "encrypted-file-metadata",
            encryptedSize: BigInt(128),
            status: "COMPLETED",
            completedAt: new Date(),
            expiresAt,
          },
          {
            itemId: pendingItemId,
            senderId: participantId,
            itemType: "FILE",
            storageKey: `rooms/${oldSlug}/${pendingItemId}.bin`,
            provider: "local",
            uploadTokenHash: tokenHash(randomUUID()),
            encryptedMetadata: "pending-encrypted-metadata",
            encryptedSize: BigInt(256),
            status: "UPLOADING",
            expiresAt,
          },
        ],
      },
    },
  });

  try {
    // CODE-A represents the participant's current room/invite link before lock.
    assert.equal((await getRoom(new NextRequest(`http://localhost/api/rooms/${oldSlug}`), ctx(oldSlug))).status, 200);

    const response = await rotateRoom(ownerRequest(oldSlug, ownerToken), ctx(oldSlug));
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { slug: string; accessVersion: number };
    const newSlug = payload.slug;
    assert.notEqual(newSlug, oldSlug);
    assert.equal(payload.accessVersion, 2);

    const rotated = await db.room.findUniqueOrThrow({
      where: { id: room.id },
      include: { items: true, presences: true, uploadSessions: true },
    });
    assert.equal(rotated.slug, newSlug);
    assert.equal(rotated.cryptoContext, oldSlug, "existing ciphertext keeps its immutable AAD context");
    assert.equal(rotated.expiresAt.getTime(), expiresAt.getTime());
    assert.equal(rotated.items.length, 1);
    assert.equal(rotated.items[0]?.id, itemId);
    assert.deepEqual(rotated.presences.map((presence) => presence.participantId), [ownerParticipantId]);
    assert.equal(rotated.presences[0]?.isOwner, true);
    assert.equal(rotated.uploadSessions.find((session) => session.itemId === itemId)?.status, "COMPLETED");
    assert.equal(rotated.uploadSessions.find((session) => session.itemId === pendingItemId)?.status, "ABORTED");

    // Old room codes and old invite links share the same path and reveal nothing.
    const oldRoomResponse = await getRoom(new NextRequest(`http://localhost/r/${oldSlug}`), ctx(oldSlug));
    assert.equal(oldRoomResponse.status, 404);
    assert.equal((await oldRoomResponse.json()).error, "Room not found");
    assert.equal((await getDownload(new Request(`http://localhost/api/rooms/${oldSlug}/items/${itemId}/download`), {
      params: Promise.resolve({ slug: oldSlug, itemId }),
    })).status, 404);

    // CODE-B is the same room, exposes the retained file, and produces current invite/download state.
    const newRoomResponse = await getRoom(new NextRequest(`http://localhost/r/${newSlug}`), ctx(newSlug));
    assert.equal(newRoomResponse.status, 200);
    const publicRoom = (await newRoomResponse.json()) as { slug: string; items: Array<{ id: string }>; accessVersion: number };
    assert.equal(publicRoom.slug, newSlug);
    assert.equal(publicRoom.accessVersion, 2);
    assert.deepEqual(publicRoom.items.map((item) => item.id), [itemId]);
    assert.equal((await getDownload(new Request(`http://localhost/api/rooms/${newSlug}/items/${itemId}/download`), {
      params: Promise.resolve({ slug: newSlug, itemId }),
    })).status, 200);

    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`blinkroom_owner_${newSlug}=`));
    assert.match(setCookie, new RegExp(`blinkroom_owner_${oldSlug}=`));
    assert.equal((await rotateRoom(ownerRequest(oldSlug, ownerToken), ctx(oldSlug))).status, 404);
  } finally {
    await db.room.delete({ where: { id: room.id } }).catch(() => undefined);
  }
});

test("simultaneous emergency lock requests produce only one authoritative room code", async () => {
  const oldSlug = `R${randomUUID().replaceAll("-", "").slice(0, 3).toUpperCase()}-${randomUUID().replaceAll("-", "").slice(0, 2).toUpperCase()}`;
  const ownerToken = randomUUID();
  const room = await db.room.create({
    data: { slug: oldSlug, cryptoContext: oldSlug, expiresAt: new Date(Date.now() + 3_600_000), ownerTokenHash: tokenHash(ownerToken) },
  });
  try {
    const responses = await Promise.all([
      rotateRoom(ownerRequest(oldSlug, ownerToken), ctx(oldSlug)),
      rotateRoom(ownerRequest(oldSlug, ownerToken), ctx(oldSlug)),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const successful = responses.find((response) => response.status === 200)!;
    const { slug: authoritativeSlug } = (await successful.json()) as { slug: string };
    assert.equal(await db.room.count({ where: { id: room.id, slug: authoritativeSlug, accessVersion: 2 } }), 1);
    assert.equal(await db.room.count({ where: { slug: oldSlug } }), 0);
  } finally {
    await db.room.delete({ where: { id: room.id } }).catch(() => undefined);
  }
});
