import {
  CRYPTO_VERSION,
  FILE_CHUNK_BYTES,
  FILE_MAGIC,
  GCM_IV_BYTES,
} from "./constants";
import { utf8 } from "./encoding";
const u32 = (value: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};
const readU32 = async (blob: Blob, offset: number) =>
  new DataView(await blob.slice(offset, offset + 4).arrayBuffer()).getUint32(0);
const aad = (room: string, item: string, index: number) =>
  utf8.encode(`${room}:${item}:${index}:v${CRYPTO_VERSION}`);
export async function encryptFileChunks(
  key: CryptoKey,
  file: Blob,
  room: string,
  item: string,
  onProgress?: (value: number) => void,
): Promise<Blob> {
  const count = Math.ceil(file.size / FILE_CHUNK_BYTES);
  const parts: BlobPart[] = [FILE_MAGIC, u32(FILE_CHUNK_BYTES), u32(count)];
  for (let index = 0; index < count; index++) {
    const plain = await file
      .slice(
        index * FILE_CHUNK_BYTES,
        Math.min(file.size, (index + 1) * FILE_CHUNK_BYTES),
      )
      .arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(room, item, index) },
      key,
      plain,
    );
    parts.push(iv, u32(encrypted.byteLength), encrypted);
    onProgress?.(Math.round(((index + 1) / count) * 100));
  }
  return new Blob(parts, { type: "application/octet-stream" });
}
export const encryptedFileSize = (plainSize: number) =>
  12 +
  plainSize +
  Math.ceil(plainSize / FILE_CHUNK_BYTES) * (GCM_IV_BYTES + 4 + 16);
export async function* encryptFileMultipart(
  key: CryptoKey,
  file: Blob,
  room: string,
  item: string,
  partSize: number,
  onProgress?: (value: number) => void,
): AsyncGenerator<Blob> {
  const count = Math.ceil(file.size / FILE_CHUNK_BYTES);
  const queued: Uint8Array[] = [FILE_MAGIC, u32(FILE_CHUNK_BYTES), u32(count)];
  let queuedBytes = 12;
  const emit = (size: number) => {
    const output = new Uint8Array(size);
    let written = 0;
    while (written < size) {
      const head = queued[0],
        take = Math.min(head.byteLength, size - written);
      output.set(head.subarray(0, take), written);
      written += take;
      queuedBytes -= take;
      if (take === head.byteLength) queued.shift();
      else queued[0] = head.subarray(take);
    }
    return new Blob([output], { type: "application/octet-stream" });
  };
  for (let index = 0; index < count; index++) {
    const plain = await file
      .slice(
        index * FILE_CHUNK_BYTES,
        Math.min(file.size, (index + 1) * FILE_CHUNK_BYTES),
      )
      .arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(room, item, index) },
      key,
      plain,
    );
    const record = [iv, u32(encrypted.byteLength), new Uint8Array(encrypted)];
    queued.push(...record);
    queuedBytes += record.reduce((sum, value) => sum + value.byteLength, 0);
    while (queuedBytes >= partSize) yield emit(partSize);
    onProgress?.(Math.round(((index + 1) / count) * 100));
  }
  if (queuedBytes) yield emit(queuedBytes);
}
export async function decryptFileChunks(
  key: CryptoKey,
  encrypted: Blob,
  room: string,
  item: string,
  mimeType: string,
): Promise<Blob> {
  const header = new Uint8Array(await encrypted.slice(0, 12).arrayBuffer());
  if (!FILE_MAGIC.every((byte, index) => header[index] === byte))
    throw new Error("Invalid encrypted file");
  const chunkSize = new DataView(header.buffer).getUint32(4);
  const count = new DataView(header.buffer).getUint32(8);
  if (chunkSize !== FILE_CHUNK_BYTES || count > 100000)
    throw new Error("Invalid encrypted file header");
  let offset = 12;
  const parts: BlobPart[] = [];
  for (let index = 0; index < count; index++) {
    const iv = new Uint8Array(
      await encrypted.slice(offset, offset + GCM_IV_BYTES).arrayBuffer(),
    );
    offset += GCM_IV_BYTES;
    const length = await readU32(encrypted, offset);
    offset += 4;
    const ciphertext = await encrypted
      .slice(offset, offset + length)
      .arrayBuffer();
    offset += length;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad(room, item, index) },
      key,
      ciphertext,
    );
    parts.push(plain);
  }
  if (offset !== encrypted.size)
    throw new Error("Encrypted file length mismatch");
  return new Blob(parts, { type: mimeType });
}

// Read only one authenticated record at a time, even when network frames split it.
export async function decryptFileStream(
  key: CryptoKey,
  stream: ReadableStream<Uint8Array>,
  room: string,
  item: string,
  write: (chunk: Uint8Array) => Promise<void>,
  onProgress?: (bytes: number) => void,
): Promise<void> {
  const reader = stream.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let position = 0, written = 0;
  const read = async (size: number): Promise<Uint8Array<ArrayBuffer>> => {
    const output = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      if (position === pending.length) {
        const next = await reader.read();
        if (next.done) throw new Error("Encrypted file truncated");
        pending = next.value;
        position = 0;
      }
      const take = Math.min(size - offset, pending.length - position);
      output.set(pending.subarray(position, position + take), offset);
      position += take;
      offset += take;
    }
    return output;
  };
  try {
    const header = await read(12);
    const view = new DataView(header.buffer);
    const count = view.getUint32(8);
    if (!FILE_MAGIC.every((byte, index) => header[index] === byte) ||
        view.getUint32(4) !== FILE_CHUNK_BYTES || count > 100000)
      throw new Error("Invalid encrypted file header");
    for (let index = 0; index < count; index++) {
      const iv = await read(GCM_IV_BYTES);
      const length = new DataView((await read(4)).buffer).getUint32(0);
      if (length < 16 || length > FILE_CHUNK_BYTES + 16)
        throw new Error("Invalid encrypted chunk length");
      const ciphertext = await read(length);
      const plain = new Uint8Array(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad(room, item, index) }, key, ciphertext,
      ));
      await write(plain);
      written += plain.length;
      onProgress?.(written);
    }
    if (position !== pending.length || !(await reader.read()).done)
      throw new Error("Encrypted file length mismatch");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
