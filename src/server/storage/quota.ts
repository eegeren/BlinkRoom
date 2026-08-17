import { randomUUID } from "node:crypto";
export type QuotaInput = { encryptedSize: number; storedBytes: number; storedItems: number; pendingUploads: number; maxFileBytes: number; maxRoomBytes: number; maxItems: number; maxConcurrent: number };
export type QuotaResult = { ok: true } | { ok: false; code: "FILE_TOO_LARGE" | "ROOM_STORAGE_LIMIT" | "ROOM_ITEM_LIMIT" | "TOO_MANY_UPLOADS" };
export function validateStorageQuota(input: QuotaInput): QuotaResult { if (!Number.isSafeInteger(input.encryptedSize) || input.encryptedSize <= 0 || input.encryptedSize > input.maxFileBytes) return { ok: false, code: "FILE_TOO_LARGE" }; if (input.storedBytes + input.encryptedSize > input.maxRoomBytes) return { ok: false, code: "ROOM_STORAGE_LIMIT" }; if (input.storedItems >= input.maxItems) return { ok: false, code: "ROOM_ITEM_LIMIT" }; if (input.pendingUploads >= input.maxConcurrent) return { ok: false, code: "TOO_MANY_UPLOADS" }; return { ok: true }; }
export const storageObjectKey = (roomSlug: string) => `rooms/${roomSlug}/${randomUUID()}.bin`;
export const isStaleMultipart = (createdAt: Date, staleHours: number, now = new Date()) => createdAt.getTime() <= now.getTime() - staleHours * 3_600_000;
export const canCreateUpload = (status: string, expiresAt: Date, now = new Date()) => status === "ACTIVE" && expiresAt > now;
export const canAuthorizeStoredDownload = (roomStatus: string, roomExpiresAt: Date, itemRoomId: string, requestedRoomId: string, now = new Date()) => roomStatus === "ACTIVE" && roomExpiresAt > now && itemRoomId === requestedRoomId;
