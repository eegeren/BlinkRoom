import { GCM_IV_BYTES, ROOM_KEY_BYTES } from "./constants";
import { asArrayBuffer, base64UrlToBytes, bytesToBase64Url, utf8, utf8Decode } from "./encoding";
import { decryptJson, parseEnvelope } from "./payload";

const METADATA_INFO = "blinkroom-metadata-v1";
const METADATA_SALT = "blinkroom-metadata-salt-v1";

export interface ProtectedFileMetadata {
  filename: string;
  mimeType?: string;
  lastModified?: number;
  fileSize?: number;
  senderName?: string;
}

export interface MetadataEnvelope {
  version: 1;
  algorithm: "AES-GCM";
  keyDerivation: "HKDF-SHA-256";
  iv: string;
  ciphertext: string;
}

export function isMetadataProtectedEnvelope(serializedEnvelope: string): boolean {
  try {
    const parsed = JSON.parse(serializedEnvelope) as Partial<MetadataEnvelope>;
    return parsed.keyDerivation === "HKDF-SHA-256" && parsed.version === 1;
  } catch {
    return false;
  }
}

export async function deriveMetadataKey(roomSecret: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(roomSecret);
  if (raw.byteLength !== ROOM_KEY_BYTES) throw new Error("Invalid room secret");
  const source = await crypto.subtle.importKey("raw", asArrayBuffer(raw), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: utf8.encode(METADATA_SALT), info: utf8.encode(METADATA_INFO) },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptFileMetadata(key: CryptoKey, metadata: ProtectedFileMetadata, aad: string): Promise<MetadataEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8.encode(aad) },
    key,
    utf8.encode(JSON.stringify(metadata)),
  );
  return { version: 1, algorithm: "AES-GCM", keyDerivation: "HKDF-SHA-256", iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)) };
}

export async function decryptFileMetadata(
  metadataKey: CryptoKey,
  legacyRoomKey: CryptoKey,
  serializedEnvelope: string,
  aad: string,
): Promise<ProtectedFileMetadata> {
  const parsed = JSON.parse(serializedEnvelope) as Partial<MetadataEnvelope>;
  if (parsed.keyDerivation !== "HKDF-SHA-256") {
    const legacy = await decryptJson<{ fileName?: string; filename?: string; mimeType?: string; lastModified?: number; fileSize?: number; senderName?: string }>(
      legacyRoomKey,
      parseEnvelope(serializedEnvelope),
      aad,
    );
    return { ...legacy, filename: legacy.filename ?? legacy.fileName ?? "" };
  }
  if (parsed.version !== 1 || parsed.algorithm !== "AES-GCM" || typeof parsed.iv !== "string" || typeof parsed.ciphertext !== "string") {
    throw new Error("Invalid metadata envelope");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(base64UrlToBytes(parsed.iv)), additionalData: utf8.encode(aad) },
    metadataKey,
    asArrayBuffer(base64UrlToBytes(parsed.ciphertext)),
  );
  return JSON.parse(utf8Decode.decode(plaintext)) as ProtectedFileMetadata;
}
