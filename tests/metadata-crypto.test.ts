import test from "node:test";
import assert from "node:assert/strict";
import { generateRoomKey, importRoomKey } from "../src/lib/crypto/room-key";
import { encryptJson } from "../src/lib/crypto/payload";
import {
  decryptFileMetadata,
  deriveMetadataKey,
  encryptFileMetadata,
  isMetadataProtectedEnvelope,
  type ProtectedFileMetadata,
} from "../src/lib/crypto/metadata";

const aad = "ROOM:item-id:metadata:v1";
const sample: ProtectedFileMetadata = {
  filename: "contract.pdf",
  mimeType: "application/pdf",
  lastModified: 1_787_552_312_000,
  fileSize: 42,
  senderName: "Room owner",
};

async function keys(secret = generateRoomKey()) {
  return {
    secret,
    roomKey: await importRoomKey(secret),
    metadataKey: await deriveMetadataKey(secret),
  };
}

test("metadata encrypts and decrypts with a separately derived key", async () => {
  const { roomKey, metadataKey } = await keys();
  const encrypted = JSON.stringify(await encryptFileMetadata(metadataKey, sample, aad));
  assert.equal(isMetadataProtectedEnvelope(encrypted), true);
  assert.ok(!encrypted.includes(sample.filename));
  assert.ok(!encrypted.includes(sample.mimeType!));
  assert.deepEqual(await decryptFileMetadata(metadataKey, roomKey, encrypted, aad), sample);
});

test("metadata decryption fails with a wrong room secret", async () => {
  const a = await keys(), b = await keys();
  const encrypted = JSON.stringify(await encryptFileMetadata(a.metadataKey, sample, aad));
  await assert.rejects(() => decryptFileMetadata(b.metadataKey, b.roomKey, encrypted, aad));
});

test("tampered metadata ciphertext fails authentication", async () => {
  const { roomKey, metadataKey } = await keys();
  const envelope = await encryptFileMetadata(metadataKey, sample, aad);
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith("A") ? "B" : "A"}`;
  await assert.rejects(() => decryptFileMetadata(metadataKey, roomKey, JSON.stringify(envelope), aad));
});

test("metadata encryption uses a fresh IV and ciphertext", async () => {
  const { metadataKey } = await keys();
  const first = await encryptFileMetadata(metadataKey, sample, aad);
  const second = await encryptFileMetadata(metadataKey, sample, aad);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

for (const filename of [
  "sözleşme-şğüöçı.pdf",
  "signed-📄-✅.pdf",
  `${"çok-uzun-dosya-adı-".repeat(30)}.txt`,
]) {
  test(`metadata round-trip preserves filename: ${filename.slice(0, 24)}`, async () => {
    const { roomKey, metadataKey } = await keys();
    const value = { ...sample, filename };
    const encrypted = JSON.stringify(await encryptFileMetadata(metadataKey, value, aad));
    assert.equal((await decryptFileMetadata(metadataKey, roomKey, encrypted, aad)).filename, filename);
  });
}

test("legacy room-key metadata remains readable", async () => {
  const { roomKey, metadataKey } = await keys();
  const legacy = JSON.stringify(await encryptJson(roomKey, {
    fileName: "legacy.pdf",
    mimeType: "application/pdf",
    fileSize: 12,
    senderName: "Guest",
  }, aad));
  assert.equal(isMetadataProtectedEnvelope(legacy), false);
  const decrypted = await decryptFileMetadata(metadataKey, roomKey, legacy, aad);
  assert.equal(decrypted.filename, "legacy.pdf");
  assert.equal(decrypted.mimeType, "application/pdf");
});

test("new upload metadata payload contains no plaintext filename or MIME type", async () => {
  const { metadataKey } = await keys();
  const encryptedMetadata = JSON.stringify(await encryptFileMetadata(metadataKey, {
    ...sample,
    filename: "private-contract.pdf",
    mimeType: "image/png",
  }, aad));
  const requestBody = JSON.stringify({ itemId: crypto.randomUUID(), encryptedMetadata });
  assert.ok(!requestBody.includes("private-contract.pdf"));
  assert.ok(!requestBody.includes("image/png"));
});
