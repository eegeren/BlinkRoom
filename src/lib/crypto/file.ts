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
