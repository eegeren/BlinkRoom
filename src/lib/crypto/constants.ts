export const CRYPTO_VERSION = 1 as const;
export const ROOM_KEY_BYTES = 32;
export const GCM_IV_BYTES = 12;
export const FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export const FILE_MAGIC = new Uint8Array([0x42, 0x52, 0x46, 0x31]); // BRF1
