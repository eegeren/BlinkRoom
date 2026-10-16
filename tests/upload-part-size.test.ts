import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { PATCH } from "../app/api/rooms/[slug]/uploads/[sessionId]/parts/route";
import { db } from "../src/lib/db";
import { tokenHash } from "../src/lib/security";

test("part acknowledgements support encrypted upload totals above 2 GiB and up to 5 GiB", async () => {
  const partSize = 10 * 1024 * 1024;
  const originals = { findFirst: db.uploadSession.findFirst, upsert: db.uploadPart.upsert, aggregate: db.uploadPart.aggregate, findMany: db.uploadPart.findMany };
  try {
  db.uploadSession.findFirst = (async () => ({
    id: "session", uploadTokenHash: tokenHash("token"), accessVersion: 1,
    totalParts: 513, partSize,
    room: { slug: "room", ownerTokenHash: "", deviceApprovalRequired: false,
      accessVersion: 1, status: "ACTIVE", directOnly: false, expiresAt: new Date(Date.now() + 60_000) },
  })) as unknown as typeof db.uploadSession.findFirst;
  db.uploadPart.upsert = (async () => ({})) as unknown as typeof db.uploadPart.upsert;
  db.uploadPart.aggregate = (async () => { throw new Error("Int aggregate overflow"); }) as unknown as typeof db.uploadPart.aggregate;
  for (const total of [2 ** 31 - 1, 2 ** 31 + 12345, 5 * 1024 ** 3 + 50000]) {
    const sizes = Array.from({ length: Math.ceil(total / partSize) }, (_, index) => ({ size: Math.min(partSize, total - index * partSize) }));
    db.uploadPart.findMany = (async () => sizes) as unknown as typeof db.uploadPart.findMany;
    const response = await PATCH(new NextRequest("http://localhost/api/rooms/room/uploads/session/parts", {
      method: "PATCH", headers: { "content-type": "application/json", "x-upload-token": "token" },
      body: JSON.stringify({ partNumber: sizes.length, etag: "etag", size: sizes.at(-1)!.size }),
    }), { params: Promise.resolve({ slug: "room", sessionId: "session" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { completedParts: sizes.length, uploadedBytes: total });

  }
  } finally {
    db.uploadSession.findFirst = originals.findFirst;
    db.uploadPart.upsert = originals.upsert;
    db.uploadPart.aggregate = originals.aggregate;
    db.uploadPart.findMany = originals.findMany;
  }
});
