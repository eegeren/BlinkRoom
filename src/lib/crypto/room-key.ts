import { ROOM_KEY_BYTES } from "./constants";
import { asArrayBuffer, base64UrlToBytes, bytesToBase64Url } from "./encoding";
export function generateRoomKey(): string { const raw = crypto.getRandomValues(new Uint8Array(ROOM_KEY_BYTES)); return bytesToBase64Url(raw); }
export async function importRoomKey(serialized: string): Promise<CryptoKey> { const raw = base64UrlToBytes(serialized); if (raw.byteLength !== ROOM_KEY_BYTES) throw new Error("Invalid room key"); return crypto.subtle.importKey("raw", asArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
export function roomKeyFromFragment(hash: string): string | null { const value = hash.startsWith("#") ? hash.slice(1) : hash; return value || null; }
