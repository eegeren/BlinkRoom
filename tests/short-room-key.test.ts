import test from "node:test";
import assert from "node:assert/strict";
import { generateRoomKey, importRoomKey, roomKeyBytes, roomKeyFromFragment } from "../src/lib/crypto/room-key";
import { asArrayBuffer, bytesToBase64Url, utf8 } from "../src/lib/crypto/encoding";
import { deriveMetadataKey, encryptFileMetadata, decryptFileMetadata } from "../src/lib/crypto/metadata";
import { encryptJson, decryptJson } from "../src/lib/crypto/payload";
import { encryptFileChunks, decryptFileChunks } from "../src/lib/crypto/file";

test("existing links decrypt content, files and protected metadata created with the legacy key derivation", async () => {
  const raw = new Uint8Array(32).fill(37), secret = bytesToBase64Url(raw);
  const legacyKey = await crypto.subtle.importKey("raw", asArrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  const source = await crypto.subtle.importKey("raw", asArrayBuffer(raw), "HKDF", false, ["deriveKey"]);
  const legacyMetadataKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: utf8.encode("blinkroom-metadata-salt-v1"), info: utf8.encode("blinkroom-metadata-v1") }, source, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const envelope = await encryptJson(legacyKey, { content: "existing room" }, "aad");
  const metadata = await encryptFileMetadata(legacyMetadataKey, { filename: "old.zip" }, "meta");
  const file = await encryptFileChunks(legacyKey, new Blob(["old file"]), "room", "item");
  const key = await importRoomKey(roomKeyFromFragment(`#${secret}`)!);
  assert.deepEqual(await roomKeyBytes(secret), raw);
  assert.deepEqual(await decryptJson(key, envelope, "aad"), { content: "existing room" });
  assert.equal((await decryptFileMetadata(await deriveMetadataKey(secret), key, JSON.stringify(metadata), "meta")).filename, "old.zip");
  assert.equal(await (await decryptFileChunks(key, file, "room", "item", "text/plain")).text(), "old file");
});

test("new short links reopen with identical content and metadata keys", async () => {
  const secret = generateRoomKey();
  assert.equal(secret.length, 25);
  const key = await importRoomKey(secret);
  const envelope = await encryptJson(key, "new room", "aad");
  assert.equal(await decryptJson(await importRoomKey(secret), envelope, "aad"), "new room");
  const metadata = await encryptFileMetadata(await deriveMetadataKey(secret), { filename: "new.zip" }, "meta");
  assert.equal((await decryptFileMetadata(await deriveMetadataKey(secret), key, JSON.stringify(metadata), "meta")).filename, "new.zip");
});

test("short fragments reject missing, malformed and unsupported versions", async () => {
  for (const value of ["s1.", "s1.AAAA", "s2.AAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAA", "s1.AAAAAAAAAAAAAAAAAAAAAB"]) {
    await assert.rejects(importRoomKey(value));
    await assert.rejects(deriveMetadataKey(value));
  }
});
