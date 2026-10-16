import test from "node:test";
import assert from "node:assert/strict";
import { decryptFileStream, encryptFileChunks } from "../src/lib/crypto/file";
import { FILE_CHUNK_BYTES } from "../src/lib/crypto/constants";
import { generateRoomKey, importRoomKey } from "../src/lib/crypto/room-key";

const room = "room", item = "item";
async function fixture() {
  const key = await importRoomKey(generateRoomKey());
  const plain = new Uint8Array(FILE_CHUNK_BYTES + 123).fill(42);
  return { key, plain, encrypted: await encryptFileChunks(key, new Blob([plain]), room, item) };
}

test("stream decrypt handles split records and awaits disk writes per chunk", async () => {
  const { key, plain, encrypted } = await fixture();
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
    if (offset === encrypted.size) { controller.close(); return; }
    const end = Math.min(encrypted.size, offset + 65537);
    controller.enqueue(new Uint8Array(await encrypted.slice(offset, end).arrayBuffer()));
    offset = end;
  } });
  const parts: Uint8Array[] = [], progress: number[] = [];
  await decryptFileStream(key, stream, room, item, async chunk => { await Promise.resolve(); parts.push(chunk); }, bytes => progress.push(bytes));
  assert.deepEqual(new Uint8Array(await new Blob(parts.map(part => new Uint8Array(part))).arrayBuffer()), plain);
  assert.deepEqual(progress, [FILE_CHUNK_BYTES, plain.length]);
});

test("stream decrypt rejects truncation, trailing bytes and wrong keys", async () => {
  const { key, encrypted } = await fixture();
  const wrongKey = await importRoomKey(generateRoomKey());
  for (const [candidate, data] of [[key, encrypted.slice(0, -1)], [key, new Blob([encrypted, new Uint8Array([0])])], [wrongKey, encrypted]] as const) {
    await assert.rejects(decryptFileStream(candidate, data.stream(), room, item, async () => {}));
  }
});

test("failed disk writes cancel the incoming download", async () => {
  const { key, encrypted } = await fixture();
  let cancelled = false;
  const bytes = new Uint8Array(await encrypted.arrayBuffer());
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); }, cancel() { cancelled = true; } });
  await assert.rejects(decryptFileStream(key, stream, room, item, async () => { throw new Error("Disk full"); }), /Disk full/);
  assert.equal(cancelled, true);
});
