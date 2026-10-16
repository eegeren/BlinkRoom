import { ROOM_KEY_BYTES } from "./constants";
import { asArrayBuffer, base64UrlToBytes, bytesToBase64Url, utf8 } from "./encoding";

const SHORT_PREFIX = "s1.";
const SHORT_SECRET_BYTES = 16;

export function generateRoomKey(): string {
  return SHORT_PREFIX + bytesToBase64Url(crypto.getRandomValues(new Uint8Array(SHORT_SECRET_BYTES)));
}

// Legacy fragments are raw AES keys: never derive or rewrite them.
export async function roomKeyBytes(serialized: string): Promise<Uint8Array> {
  if (!serialized.startsWith(SHORT_PREFIX)) {
    const raw = base64UrlToBytes(serialized);
    if (raw.byteLength !== ROOM_KEY_BYTES) throw new Error("Invalid room key");
    return raw;
  }
  const encoded = serialized.slice(SHORT_PREFIX.length);
  const seed = base64UrlToBytes(encoded);
  if (seed.byteLength !== SHORT_SECRET_BYTES || bytesToBase64Url(seed) !== encoded)
    throw new Error("Invalid room key");
  const source = await crypto.subtle.importKey("raw", asArrayBuffer(seed), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: utf8.encode("blinkroom-short-room-salt-v1"), info: utf8.encode("blinkroom-short-room-key-v1") },
    source,
    256,
  );
  return new Uint8Array(bits);
}

export async function importRoomKey(serialized: string): Promise<CryptoKey> {
  const raw = await roomKeyBytes(serialized);
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export function roomKeyFromFragment(hash: string): string | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  return value || null;
}
