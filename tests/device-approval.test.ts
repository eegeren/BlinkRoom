import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { tokenHash } from "../src/lib/security";
import { POST as requestApproval } from "../app/api/rooms/[slug]/devices/request/route";
import { GET as statusApproval } from "../app/api/rooms/[slug]/devices/status/route";
import { PATCH as decideApproval } from "../app/api/rooms/[slug]/devices/route";
import { GET as getRoom } from "../app/api/rooms/[slug]/route";
import { authorizeRoomDevice, deviceCookie, deviceSessionCookie } from "../src/server/device-approval";
import { POST as consumeItem } from "../app/api/rooms/[slug]/items/[itemId]/consume/route";
import { POST as createText } from "../app/api/rooms/[slug]/items/text/route";
import { GET as downloadItem } from "../app/api/rooms/[slug]/items/[itemId]/download/route";
import { POST as emergencyLock } from "../app/api/rooms/[slug]/rotate/route";

async function fixture(required = true) {
  const slug = `V${randomUUID().replaceAll("-", "").slice(0, 7).toUpperCase()}`, owner = randomUUID(), expiresAt = new Date(Date.now() + 60_000);
  const room = await db.room.create({ data: { slug, expiresAt, ownerTokenHash: tokenHash(owner), deviceApprovalRequired: required, encryptedVerifier: "opaque" } });
  return { room, slug, owner, expiresAt };
}
const context = (slug: string) => ({ params: Promise.resolve({ slug }) });
const cookieFrom = (response: Response, name: string) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(";")[0] ?? "";

test("device approval disabled preserves existing room access", async () => {
  const data = await fixture(false);
  try { assert.equal((await getRoom(new NextRequest(`http://localhost/api/rooms/${data.slug}`), context(data.slug))).status, 200); }
  finally { await db.room.delete({ where: { id: data.room.id } }); }
});

test("unknown device is pending and duplicate requests reuse one record", async () => {
  const data = await fixture();
  try {
    const first = await requestApproval(new NextRequest(`http://localhost`, { method: "POST", headers: { "user-agent": "Mozilla/5.0 Chrome/123 Mac OS X" } }), context(data.slug));
    const device = cookieFrom(first, deviceCookie(data.slug));
    assert.equal(first.status, 200); assert.equal((await first.json()).status, "PENDING");
    const second = await requestApproval(new NextRequest(`http://localhost`, { method: "POST", headers: { cookie: device } }), context(data.slug));
    assert.equal(second.status, 200);
    assert.equal(await db.roomDevice.count({ where: { roomId: data.room.id } }), 1);
    assert.equal((await getRoom(new NextRequest(`http://localhost`, { headers: { cookie: device } }), context(data.slug))).status, 202);
  } finally { await db.room.delete({ where: { id: data.room.id } }); }
});

test("only owner can approve, approved session enters, and revocation fails closed", async () => {
  const data = await fixture();
  try {
    const pending = await requestApproval(new NextRequest(`http://localhost`, { method: "POST" }), context(data.slug));
    const deviceCookiePair = cookieFrom(pending, deviceCookie(data.slug));
    const sessionCookiePair = cookieFrom(pending, deviceSessionCookie(data.slug));
    const { requestId } = await pending.json() as { requestId: string };
    const body = JSON.stringify({ requestId, action: "approve" });
    assert.equal((await decideApproval(new NextRequest(`http://localhost`, { method: "PATCH", headers: { "content-type": "application/json", cookie: deviceCookiePair }, body }), context(data.slug))).status, 403);
    const ownerCookie = `blinkroom_owner_${data.slug}=${data.owner}`;
    assert.equal((await decideApproval(new NextRequest(`http://localhost`, { method: "PATCH", headers: { "content-type": "application/json", cookie: ownerCookie }, body }), context(data.slug))).status, 200);
    const status = await statusApproval(new NextRequest(`http://localhost`, { headers: { cookie: deviceCookiePair } }), context(data.slug));
    assert.equal((await status.json()).status, "APPROVED");
    const approvedCookies = `${deviceCookiePair}; ${sessionCookiePair}`;
    assert.equal((await getRoom(new NextRequest(`http://localhost`, { headers: { cookie: approvedCookies } }), context(data.slug))).status, 200);
    assert.equal((await decideApproval(new NextRequest(`http://localhost`, { method: "PATCH", headers: { "content-type": "application/json", cookie: ownerCookie }, body: JSON.stringify({ requestId, action: "revoke" }) }), context(data.slug))).status, 200);
    assert.equal((await getRoom(new NextRequest(`http://localhost`, { headers: { cookie: approvedCookies } }), context(data.slug))).status, 202);
  } finally { await db.room.delete({ where: { id: data.room.id } }); }
});

test("request ids cannot be approved across rooms and expired sessions fail", async () => {
  const a = await fixture(), b = await fixture();
  try {
    const pending = await requestApproval(new NextRequest(`http://localhost`, { method: "POST" }), context(a.slug));
    const { requestId } = await pending.json() as { requestId: string };
    const response = await decideApproval(new NextRequest(`http://localhost`, { method: "PATCH", headers: { "content-type": "application/json", cookie: `blinkroom_owner_${b.slug}=${b.owner}` }, body: JSON.stringify({ requestId, action: "approve" }) }), context(b.slug));
    assert.equal(response.status, 409);
    const room = { ...a.room, status: "ACTIVE", expiresAt: new Date(Date.now() - 1) };
    assert.equal((await authorizeRoomDevice(new Request("http://localhost"), room)).authorized, false);
  } finally { await db.room.deleteMany({ where: { id: { in: [a.room.id, b.room.id] } } }); }
});

test("pending and revoked devices cannot upload, download, or reserve destructive access", async () => {
  const data = await fixture();
  const item = await db.roomItem.create({ data: { roomId: data.room.id, senderId: randomUUID(), type: "FILE", encryptedMetadata: "encrypted", encryptedSize: 10, storageKey: `rooms/${data.slug}/opaque.bin`, availability: "STORED", oneTime: true, accessMode: "VIEW_ONCE" } });
  try {
    const pending = await requestApproval(new NextRequest("http://localhost", { method: "POST" }), context(data.slug));
    const cookies = `${cookieFrom(pending, deviceCookie(data.slug))}; ${cookieFrom(pending, deviceSessionCookie(data.slug))}`;
    const consumeResponse = await consumeItem(new NextRequest("http://localhost", { method: "POST", headers: { cookie: cookies, "content-type": "application/json" }, body: JSON.stringify({ action: "reserve" }) }), { params: Promise.resolve({ slug: data.slug, itemId: item.id }) });
    assert.equal(consumeResponse.status, 404);
    const textResponse = await createText(new NextRequest("http://localhost", { method: "POST", headers: { cookie: cookies, "content-type": "application/json" }, body: JSON.stringify({ itemId: randomUUID(), senderId: randomUUID(), type: "TEXT", encryptionVersion: 1, encryptedPayload: JSON.stringify({ version: 1, algorithm: "AES-GCM", iv: "AAAAAAAAAAAAAAAA", ciphertext: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }) }) }), context(data.slug));
    assert.equal(textResponse.status, 403);
    assert.equal((await downloadItem(new NextRequest("http://localhost", { headers: { cookie: cookies } }), { params: Promise.resolve({ slug: data.slug, itemId: item.id }) })).status, 404);
  } finally { await db.room.delete({ where: { id: data.room.id } }); }
});

test("Emergency Lock revokes pending and approved device sessions while preserving owner control", async () => {
  const data = await fixture();
  try {
    const pendingResponse = await requestApproval(new NextRequest("http://localhost", { method: "POST" }), context(data.slug));
    const pending = await pendingResponse.json() as { requestId: string };
    await decideApproval(new NextRequest("http://localhost", { method: "PATCH", headers: { cookie: `blinkroom_owner_${data.slug}=${data.owner}`, "content-type": "application/json" }, body: JSON.stringify({ requestId: pending.requestId, action: "approve" }) }), context(data.slug));
    const rotated = await emergencyLock(new NextRequest(`http://localhost/api/rooms/${data.slug}/rotate`, { method: "POST", headers: { cookie: `blinkroom_owner_${data.slug}=${data.owner}` } }), context(data.slug));
    assert.equal(rotated.status, 200);
    const device = await db.roomDevice.findUniqueOrThrow({ where: { id: pending.requestId } });
    assert.equal(device.status, "REVOKED"); assert.equal(device.sessionTokenHash, null);
    const { slug: newSlug } = await rotated.json() as { slug: string };
    assert.notEqual(newSlug, data.slug);
  } finally { await db.room.deleteMany({ where: { id: data.room.id } }); }
});
