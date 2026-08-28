import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { POST as consume } from "../app/api/rooms/[slug]/items/[itemId]/consume/route";

async function fixture(accessMode: "STANDARD" | "VIEW_ONCE" | "BURN_AFTER_DOWNLOAD") {
  const slug = `D${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`;
  const room = await db.room.create({ data: { slug, expiresAt: new Date(Date.now() + 60_000), ownerTokenHash: randomUUID() } });
  const item = await db.roomItem.create({ data: { roomId: room.id, senderId: randomUUID(), type: "FILE", encryptedMetadata: "encrypted", encryptedSize: 10, availability: "DIRECT", oneTime: accessMode !== "STANDARD", accessMode } });
  return { room, item, slug };
}
const request = (slug: string, itemId: string, body: object) => consume(new NextRequest(`http://localhost/api/rooms/${slug}/items/${itemId}/consume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug, itemId }) });

test("normal files cannot enter destructive consumption", async () => {
  const data = await fixture("STANDARD");
  try { assert.equal((await request(data.slug, data.item.id, { action: "reserve" })).status, 404); }
  finally { await db.room.delete({ where: { id: data.room.id } }); }
});

test("simultaneous view-once reservations allow exactly one consumer", async () => {
  const data = await fixture("VIEW_ONCE");
  try {
    const responses = await Promise.all([request(data.slug, data.item.id, { action: "reserve" }), request(data.slug, data.item.id, { action: "reserve" })]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const winner = responses.find((response) => response.status === 200)!;
    const { consumeToken } = await winner.json() as { consumeToken: string };
    assert.equal((await request(data.slug, data.item.id, { action: "complete", consumeToken })).status, 200);
    assert.equal((await request(data.slug, data.item.id, { action: "reserve" })).status, 409);
    assert.equal((await db.roomItem.findUniqueOrThrow({ where: { id: data.item.id } })).oneTimeStatus, "CONSUMED");
  } finally { await db.room.delete({ where: { id: data.room.id } }); }
});

test("failed burn-after-download releases its reservation without consuming", async () => {
  const data = await fixture("BURN_AFTER_DOWNLOAD");
  try {
    const reserved = await request(data.slug, data.item.id, { action: "reserve" });
    const { consumeToken } = await reserved.json() as { consumeToken: string };
    assert.equal((await request(data.slug, data.item.id, { action: "release", consumeToken })).status, 200);
    const current = await db.roomItem.findUniqueOrThrow({ where: { id: data.item.id } });
    assert.equal(current.oneTimeStatus, "AVAILABLE"); assert.equal(current.consumedAt, null);
    assert.equal((await request(data.slug, data.item.id, { action: "reserve" })).status, 200);
  } finally { await db.room.delete({ where: { id: data.room.id } }); }
});

test("stale or replayed completion token cannot consume a file", async () => {
  const data = await fixture("VIEW_ONCE");
  try {
    assert.equal((await request(data.slug, data.item.id, { action: "complete", consumeToken: randomUUID() })).status, 409);
    assert.equal((await db.roomItem.findUniqueOrThrow({ where: { id: data.item.id } })).oneTimeStatus, "AVAILABLE");
  } finally { await db.room.delete({ where: { id: data.room.id } }); }
});
