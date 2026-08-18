import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createUploadsPost } from "../app/api/rooms/[slug]/uploads/route";

const encryptedMetadata = JSON.stringify({ version: 1, algorithm: "AES-GCM", iv: "a".repeat(16), ciphertext: "b".repeat(40) });

test("successful mocked multipart initialization returns an upload session instead of 503", async () => {
  let initializedKey = "", persistedUploadId = "";
  const post = createUploadsPost({
    storageKind: "r2",
    checkRateLimit: () => true,
    getRoom: async () => ({ id: "room-id", slug: "KJR8-ML", status: "ACTIVE", expiresAt: new Date(Date.now() + 60_000), items: [] }) as never,
    reserveSession: async (_room, _input, storageKey, uploadToken) => ({ id: "session-id", storageKey, uploadToken, action: "initialize" }),
    createMultipartUpload: async (storageKey) => { initializedKey = storageKey; return "mock-r2-upload-id"; },
    markUploading: async (_sessionId, uploadId) => { persistedUploadId = uploadId; },
    markFailed: async () => { throw new Error("should not mark a successful session failed"); },
    abortMultipartUpload: async () => { throw new Error("should not abort a successful multipart upload"); },
    deleteObject: async () => { throw new Error("should not delete an object during successful initialization"); },
  });
  const request = new NextRequest("http://localhost/api/rooms/KJR8-ML/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: "62de1f85-7666-4eb6-9ea6-81559ba00f97", senderId: "725f33ae-f18f-4f0a-8db7-322aafbd91b0", type: "FILE", encryptionVersion: 1, encryptedMetadata, encryptedSize: 12_000_000, directDelivered: false }) });
  const response = await post(request, { params: Promise.resolve({ slug: "KJR8-ML" }) });
  assert.equal(response.status, 201);
  assert.match(initializedKey, /^rooms\/KJR8-ML\/[0-9a-f-]{36}\.bin$/);
  assert.equal(persistedUploadId, "mock-r2-upload-id");
  assert.equal((await response.json()).partCount, 2);
});
