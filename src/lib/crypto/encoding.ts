export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded); return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
export const utf8 = new TextEncoder();
export const utf8Decode = new TextDecoder("utf-8", { fatal: true });
export const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
