import test from "node:test";
import assert from "node:assert/strict";
import { createDownloadGet } from "../app/api/rooms/[slug]/items/[itemId]/download/route";
import { fetchEncryptedFile } from "../src/lib/storage/download";
import { decryptFileChunks, encryptFileChunks } from "../src/lib/crypto/file";
import { generateRoomKey, importRoomKey } from "../src/lib/crypto/room-key";

const future = () => new Date(Date.now() + 60_000);
const record = (status: "ACTIVE" | "EXPIRED" | "DESTROYED" = "ACTIVE") => ({ id: "item-id", roomId: "room-id", storageKey: "rooms/ROOM-CODE/opaque-id.bin", availability: "STORED" as const, room: { status, expiresAt: future() }, uploadSession: { status: "COMPLETED" as const, storageKey: "rooms/ROOM-CODE/opaque-id.bin" } });
const call = (get: ReturnType<typeof createDownloadGet>) => get(new Request("http://localhost"), { params: Promise.resolve({ slug: "ROOM-CODE", itemId: "item-id" }) });

test("local stored download returns the provider-aware encrypted route", async () => {
  const get = createDownloadGet({ storageKind: "local", checkRateLimit: () => true, findItem: async () => record(), createUrl: async () => "/api/files/ROOM-CODE/item-id" });
  const response = await call(get);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, "/api/files/ROOM-CODE/item-id");
});

test("R2 stored download returns a signed URL and never the legacy file route", async () => {
  const signed = "https://example.r2.cloudflarestorage.com/object?X-Amz-Signature=redacted";
  const get = createDownloadGet({ storageKind: "r2", checkRateLimit: () => true, findItem: async () => record(), createUrl: async () => signed });
  const response = await call(get), payload = await response.json() as { url: string; expiresIn: number };
  assert.equal(response.status, 200);
  assert.equal(payload.url, signed);
  assert.ok(!payload.url.includes("/api/files/"));
  assert.ok(payload.expiresIn <= 300);
});

test("R2 download requires a completed matching upload session", async () => {
  const incomplete = { ...record(), uploadSession: { status: "UPLOADING" as const, storageKey: "rooms/ROOM-CODE/opaque-id.bin" } };
  const get = createDownloadGet({ storageKind: "r2", checkRateLimit: () => true, findItem: async () => incomplete, createUrl: async () => "should-not-run" });
  assert.equal((await call(get)).status, 404);
});

test("expired and destroyed rooms cannot obtain signed URLs", async () => {
  for (const status of ["EXPIRED", "DESTROYED"] as const) {
    let signed = false;
    const get = createDownloadGet({ storageKind: "r2", checkRateLimit: () => true, findItem: async () => record(status), createUrl: async () => { signed = true; return "should-not-run"; } });
    assert.equal((await call(get)).status, 404);
    assert.equal(signed, false);
  }
});

test("browser helper obtains download info then fetches the encrypted R2 blob", async () => {
  const requested: string[] = [], encrypted = new Blob([new Uint8Array([1, 2, 3])]);
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input); requested.push(url);
    if (url.startsWith("/api/rooms/")) return Response.json({ url: "https://signed-r2.example/object" });
    return new Response(encrypted, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }) as typeof fetch;
  const result = await fetchEncryptedFile("ROOM-CODE", "item-id", fetcher);
  assert.deepEqual(requested, ["/api/rooms/ROOM-CODE/items/item-id/download", "https://signed-r2.example/object"]);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test("reloaded client decrypts signed-source data with the room key and rejects a wrong key", async () => {
  const slug = "ROOM-CODE", itemId = "item-id", plaintext = new TextEncoder().encode("private file");
  const correctKey = await importRoomKey(generateRoomKey()), wrongKey = await importRoomKey(generateRoomKey());
  const encrypted = await encryptFileChunks(correctKey, new Blob([plaintext]), slug, itemId);
  const fetcher = (async (input: string | URL | Request) => String(input).startsWith("/api/rooms/") ? Response.json({ url: "https://signed-r2.example/reloaded-object" }) : new Response(encrypted)) as typeof fetch;
  const downloaded = await fetchEncryptedFile(slug, itemId, fetcher);
  const decrypted = await decryptFileChunks(correctKey, downloaded, slug, itemId, "application/octet-stream");
  assert.deepEqual(new Uint8Array(await decrypted.arrayBuffer()), plaintext);
  await assert.rejects(decryptFileChunks(wrongKey, downloaded, slug, itemId, "application/octet-stream"));
});
