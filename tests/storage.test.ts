import test from "node:test";
import assert from "node:assert/strict";
import { createStorageProvider } from "../src/server/storage";
import { canAuthorizeStoredDownload, canCreateUpload, isStaleMultipart, storageObjectKey, validateStorageQuota } from "../src/server/storage/quota";
import { MemoryRateLimitProvider } from "../src/server/rate-limit";
import { MAX_FILE_SIZE, maxFileSizeBytes, requireR2Config, resolveStorageRuntimeConfig } from "../src/lib/env";

const baseQuota = { encryptedSize: 10, storedBytes: 20, storedItems: 1, pendingUploads: 0, maxFileBytes: 100, maxRoomBytes: 100, maxItems: 5, maxConcurrent: 2 };
test("storage provider selection keeps local as an explicit provider", () => assert.equal(createStorageProvider("local").kind, "local"));
test("runtime storage config disables direct upload for local", () => { const config = resolveStorageRuntimeConfig({ STORAGE_PROVIDER: " local " }); assert.equal(config.directUpload, false); assert.equal(config.maxFileSize, 5_368_709_120); });
test("runtime storage config enables R2 only with all credentials", () => { const config = resolveStorageRuntimeConfig({ STORAGE_PROVIDER: " R2 ", R2_ACCOUNT_ID: "account", R2_ACCESS_KEY_ID: "access", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET_NAME: "blinkroom-files" }); assert.equal(config.directUpload, true); assert.equal(config.maxFileSize, 5_368_709_120); assert.equal(requireR2Config(config).endpoint, "https://account.r2.cloudflarestorage.com"); });
test("R2 selection fails clearly when credentials are missing", () => assert.throws(() => resolveStorageRuntimeConfig({ STORAGE_PROVIDER: "r2", R2_ACCOUNT_ID: "account" }), /requires R2_ACCOUNT_ID/));
test("object keys are opaque, random, and contain no filename", () => { const a = storageObjectKey("ABCD-EF"), b = storageObjectKey("ABCD-EF"); assert.match(a, /^rooms\/ABCD-EF\/[0-9a-f-]{36}\.bin$/); assert.notEqual(a, b); assert.ok(!a.includes("contract.pdf")); });
test("quota accepts a valid reservation", () => assert.deepEqual(validateStorageQuota(baseQuota), { ok: true }));
test("quota rejects file, room, item, and concurrent limits", () => { assert.deepEqual(validateStorageQuota({ ...baseQuota, encryptedSize: 101 }).ok, false); assert.deepEqual(validateStorageQuota({ ...baseQuota, storedBytes: 95 }).ok, false); assert.deepEqual(validateStorageQuota({ ...baseQuota, storedItems: 5 }).ok, false); assert.deepEqual(validateStorageQuota({ ...baseQuota, pendingUploads: 2 }).ok, false); });
test("expired and destroyed rooms reject upload creation", () => { assert.equal(canCreateUpload("ACTIVE", new Date(Date.now() - 1)), false); assert.equal(canCreateUpload("EXPIRED", new Date(Date.now() + 1000)), false); assert.equal(canCreateUpload("DESTROYED", new Date(Date.now() + 1000)), false); });
test("signed download authorization binds active room and item", () => { const future = new Date(Date.now() + 1000); assert.equal(canAuthorizeStoredDownload("ACTIVE", future, "room-a", "room-a"), true); assert.equal(canAuthorizeStoredDownload("ACTIVE", future, "room-a", "room-b"), false); assert.equal(canAuthorizeStoredDownload("DESTROYED", future, "room-a", "room-a"), false); });
test("local deletion is idempotent", async () => { const provider = createStorageProvider("local"); const key = `test/${crypto.randomUUID()}.bin`; await provider.deleteObject(key); await provider.deleteObject(key); });
test("stale multipart detection respects configured age", () => { const now = new Date("2026-01-02T12:00:00Z"); assert.equal(isStaleMultipart(new Date("2026-01-02T05:59:59Z"), 6, now), true); assert.equal(isStaleMultipart(new Date("2026-01-02T07:00:01Z"), 6, now), false); });
test("memory rate limit resets and rejects excess attempts", () => { const limiter = new MemoryRateLimitProvider(); assert.equal(limiter.check("opaque", 2, 1000), true); assert.equal(limiter.check("opaque", 2, 1000), true); assert.equal(limiter.check("opaque", 2, 1000), false); });
test("the upload cap is exactly 5 GB and cannot be configured above it", () => {
  assert.equal(MAX_FILE_SIZE, 5 * 1024 * 1024 * 1024);
  assert.equal(maxFileSizeBytes, MAX_FILE_SIZE);
  assert.throws(() => resolveStorageRuntimeConfig({ STORAGE_PROVIDER: "local", MAX_FILE_SIZE_MB: "5121" }));
  assert.equal(resolveStorageRuntimeConfig({ STORAGE_PROVIDER: "local", MAX_FILE_SIZE_MB: "5120" }).maxFileSize, MAX_FILE_SIZE);
});
test("quota rejects a file one byte over the 5 GB cap and accepts one at the cap", () => {
  const quota = { storedBytes: 0, storedItems: 0, pendingUploads: 0, maxFileBytes: MAX_FILE_SIZE, maxRoomBytes: Number.MAX_SAFE_INTEGER, maxItems: 500, maxConcurrent: 6 };
  assert.equal(validateStorageQuota({ ...quota, encryptedSize: MAX_FILE_SIZE + 1 }).ok, false);
  assert.equal(validateStorageQuota({ ...quota, encryptedSize: MAX_FILE_SIZE }).ok, true);
});
