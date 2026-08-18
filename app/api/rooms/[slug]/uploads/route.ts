import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { encryptedFileSize } from "@/src/lib/crypto/file";
import { ephemeralRequestKey, ownerToken, retryUploadToken, tokenHash } from "@/src/lib/security";
import { rateLimiter } from "@/src/server/rate-limit";
import { acquireRoomLock, refreshRoomStatus } from "@/src/server/rooms";
import { storage } from "@/src/server/storage";
import { storageObjectKey, validateStorageQuota } from "@/src/server/storage/quota";

const envelope = z.string().min(40).max(100_000).refine((value) => { try { const parsed = JSON.parse(value); return parsed.version === 1 && parsed.algorithm === "AES-GCM" && typeof parsed.iv === "string" && typeof parsed.ciphertext === "string"; } catch { return false; } });
const schema = z.object({ itemId: z.string().uuid(), senderId: z.string().uuid(), type: z.enum(["IMAGE", "FILE"]), encryptionVersion: z.literal(1), encryptedMetadata: envelope, encryptedSize: z.number().int().positive(), directDelivered: z.boolean().default(false) }).strict();
type UploadInput = z.infer<typeof schema>;
type RoomSnapshot = NonNullable<Awaited<ReturnType<typeof refreshRoomStatus>>>;
type ReservedSession = { id: string; storageKey: string; uploadToken: string; action: "initialize" | "reuse" | "replace"; replacedMultipart?: { storageKey: string; uploadId: string } };
const messages = { FILE_TOO_LARGE: "This file is too large.", ROOM_STORAGE_LIMIT: "This room has reached its temporary storage limit.", ROOM_ITEM_LIMIT: "This room has reached its item limit.", TOO_MANY_UPLOADS: "Too many uploads are already in progress." } as const;
class QuotaError extends Error { constructor(public code: keyof typeof messages) { super(code); } }
class UploadConflictError extends Error { constructor(public kind: "item" | "initializing") { super(kind); } }

function logUploadError(tag: string, error: unknown, context: Record<string, string>) {
  console.error(tag, { ...context, name: error instanceof Error ? error.name : "Unknown", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
}

export const acquireRoomUploadLock = acquireRoomLock;

export async function reserveUploadSession(room: RoomSnapshot, input: UploadInput, storageKey: string, uploadToken: string): Promise<ReservedSession> {
  return db.$transaction(async (tx) => {
    await acquireRoomUploadLock(tx, room.id);
    const now = new Date(), existingItem = await tx.roomItem.findUnique({ where: { id: input.itemId }, select: { id: true } });
    if (existingItem) throw new UploadConflictError("item");
    const existing = await tx.uploadSession.findUnique({ where: { itemId: input.itemId } });
    if (existing && (existing.roomId !== room.id || existing.senderId !== input.senderId || existing.itemType !== input.type || Number(existing.encryptedSize) !== input.encryptedSize)) throw new UploadConflictError("item");
    if (existing?.status === "COMPLETED") throw new UploadConflictError("item");
    if (existing?.status === "UPLOADING" && existing.multipartUploadId && existing.expiresAt > now) {
      const reusableToken = retryUploadToken(existing.id, env.CLEANUP_SECRET);
      await tx.uploadSession.update({ where: { id: existing.id }, data: { uploadTokenHash: tokenHash(reusableToken), encryptedMetadata: input.encryptedMetadata, directDelivered: existing.directDelivered || input.directDelivered } });
      return { id: existing.id, storageKey: existing.storageKey, uploadToken: reusableToken, action: "reuse" };
    }
    const initializationIsFresh = existing?.status === "PENDING" && existing.createdAt.getTime() > now.getTime() - 60_000;
    if (initializationIsFresh) throw new UploadConflictError("initializing");
    const [stored, pending, itemCount] = await Promise.all([
      tx.roomItem.aggregate({ where: { roomId: room.id, storageKey: { not: null } }, _sum: { encryptedSize: true } }),
      tx.uploadSession.aggregate({ where: { roomId: room.id, itemId: { not: input.itemId }, status: { in: ["PENDING", "UPLOADING"] } }, _sum: { encryptedSize: true }, _count: true }),
      tx.roomItem.count({ where: { roomId: room.id } }),
    ]);
    const quota = validateStorageQuota({ encryptedSize: input.encryptedSize, storedBytes: Number(stored._sum.encryptedSize ?? 0) + Number(pending._sum.encryptedSize ?? BigInt(0)), storedItems: itemCount, pendingUploads: pending._count, maxFileBytes: encryptedFileSize(env.MAX_FILE_SIZE_MB * 1024 * 1024), maxRoomBytes: env.MAX_ROOM_STORAGE_MB * 1024 * 1024, maxItems: env.MAX_ROOM_ITEMS, maxConcurrent: env.MAX_CONCURRENT_UPLOADS });
    if (!quota.ok) throw new QuotaError(quota.code);
    if (!existing) {
      const created = await tx.uploadSession.create({ data: { roomId: room.id, itemId: input.itemId, senderId: input.senderId, itemType: input.type, storageKey, provider: storage.kind, uploadTokenHash: tokenHash(uploadToken), encryptedMetadata: input.encryptedMetadata, encryptedSize: BigInt(input.encryptedSize), directDelivered: input.directDelivered, status: "PENDING", expiresAt: room.expiresAt } });
      return { id: created.id, storageKey, uploadToken, action: "initialize" };
    }
    const replacedMultipart = existing.multipartUploadId ? { storageKey: existing.storageKey, uploadId: existing.multipartUploadId } : undefined;
    await tx.uploadSession.update({ where: { id: existing.id }, data: { storageKey, provider: storage.kind, multipartUploadId: null, uploadTokenHash: tokenHash(uploadToken), encryptedMetadata: input.encryptedMetadata, encryptedSize: BigInt(input.encryptedSize), directDelivered: input.directDelivered, status: "PENDING", createdAt: now, completedAt: null, expiresAt: room.expiresAt } });
    return { id: existing.id, storageKey, uploadToken, action: "replace", replacedMultipart };
  });
}

type UploadRouteDependencies = {
  storageKind: "local" | "r2";
  checkRateLimit: (key: string) => boolean;
  getRoom: (slug: string) => Promise<RoomSnapshot | null>;
  reserveSession: (room: RoomSnapshot, input: UploadInput, storageKey: string, uploadToken: string) => Promise<ReservedSession>;
  createMultipartUpload: (storageKey: string) => Promise<string>;
  markUploading: (sessionId: string, uploadId: string) => Promise<void>;
  markFailed: (sessionId: string) => Promise<void>;
  abortMultipartUpload: (storageKey: string, uploadId: string) => Promise<void>;
  deleteObject: (storageKey: string) => Promise<void>;
};

const defaultDependencies: UploadRouteDependencies = {
  storageKind: storage.kind,
  checkRateLimit: (key) => rateLimiter.check(key, 20, 60_000),
  getRoom: refreshRoomStatus,
  reserveSession: reserveUploadSession,
  createMultipartUpload: (storageKey) => storage.createMultipartUpload(storageKey),
  markUploading: async (sessionId, uploadId) => { await db.uploadSession.update({ where: { id: sessionId }, data: { multipartUploadId: uploadId, status: "UPLOADING" } }); },
  markFailed: async (sessionId) => { await db.uploadSession.updateMany({ where: { id: sessionId, status: "PENDING" }, data: { status: "FAILED" } }); },
  abortMultipartUpload: (storageKey, uploadId) => storage.abortMultipartUpload(storageKey, uploadId),
  deleteObject: (storageKey) => storage.deleteObject(storageKey),
};

export function createUploadsPost(dependencies: UploadRouteDependencies = defaultDependencies) {
  return async function uploadsPost(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    if (dependencies.storageKind !== "r2") return NextResponse.json({ error: "Direct storage upload is disabled" }, { status: 404 });
    const { slug } = await params;
    const input = schema.safeParse(await req.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "Invalid encrypted upload" }, { status: 400 });
    const requestKey = ephemeralRequestKey([slug, input.data.senderId, env.TRUST_PROXY_HEADERS ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null]);
    if (!dependencies.checkRateLimit(`upload-session:${requestKey}`)) return NextResponse.json({ error: "Slow down" }, { status: 429 });
    const room = await dependencies.getRoom(slug);
    if (!room || room.status !== "ACTIVE") return NextResponse.json({ error: "Room unavailable" }, { status: 410 });
    if (room.items.some((item) => item.id === input.data.itemId)) return NextResponse.json({ error: "Item already exists" }, { status: 409 });

    const storageKey = storageObjectKey(slug), uploadToken = ownerToken();
    let session: ReservedSession;
    try {
      session = await dependencies.reserveSession(room, input.data, storageKey, uploadToken);
    } catch (error) {
      if (error instanceof QuotaError) return NextResponse.json({ error: messages[error.code] }, { status: 413 });
      if (error instanceof UploadConflictError) return NextResponse.json({ error: error.kind === "item" ? "Item already exists" : "Upload initialization is already in progress." }, { status: 409 });
      logUploadError("[UPLOAD_SESSION_RESERVATION_FAILED]", error, { roomId: room.id, storageProvider: dependencies.storageKind });
      return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 });
    }

    if (session.action === "reuse") {
      console.info("[UPLOAD_SESSION_REUSED]", { roomId: room.id, sessionId: session.id, storageProvider: dependencies.storageKind });
      const partSize = 10 * 1024 * 1024;
      return NextResponse.json({ sessionId: session.id, uploadToken: session.uploadToken, partSize, partCount: Math.ceil(input.data.encryptedSize / partSize) }, { status: 200 });
    }
    if (session.action === "replace") console.info("[UPLOAD_SESSION_REPLACED]", { roomId: room.id, sessionId: session.id, storageProvider: dependencies.storageKind });
    if (session.replacedMultipart) {
      try { await dependencies.abortMultipartUpload(session.replacedMultipart.storageKey, session.replacedMultipart.uploadId); await dependencies.deleteObject(session.replacedMultipart.storageKey); }
      catch (error) {
        logUploadError("[R2_MULTIPART_ABORT_FAILED]", error, { roomId: room.id, sessionId: session.id });
        await dependencies.markFailed(session.id).catch((cleanupError) => logUploadError("[UPLOAD_SESSION_CLEANUP_FAILED]", cleanupError, { roomId: room.id, sessionId: session.id }));
        return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 });
      }
    }

    let uploadId: string;
    try {
      uploadId = await dependencies.createMultipartUpload(session.storageKey);
    } catch (error) {
      logUploadError("[R2_UPLOAD_INIT_FAILED]", error, { roomId: room.id, sessionId: session.id, storageProvider: dependencies.storageKind });
      await dependencies.markFailed(session.id).catch((cleanupError) => logUploadError("[UPLOAD_SESSION_CLEANUP_FAILED]", cleanupError, { roomId: room.id, sessionId: session.id }));
      return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 });
    }

    try {
      await dependencies.markUploading(session.id, uploadId);
    } catch (error) {
      logUploadError("[UPLOAD_SESSION_UPDATE_FAILED]", error, { roomId: room.id, sessionId: session.id, storageProvider: dependencies.storageKind });
      await dependencies.abortMultipartUpload(session.storageKey, uploadId).catch((cleanupError) => logUploadError("[R2_MULTIPART_ABORT_FAILED]", cleanupError, { roomId: room.id, sessionId: session.id }));
      await dependencies.markFailed(session.id).catch((cleanupError) => logUploadError("[UPLOAD_SESSION_CLEANUP_FAILED]", cleanupError, { roomId: room.id, sessionId: session.id }));
      return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 });
    }

    const partSize = 10 * 1024 * 1024;
    return NextResponse.json({ sessionId: session.id, uploadToken: session.uploadToken, partSize, partCount: Math.ceil(input.data.encryptedSize / partSize) }, { status: 201 });
  };
}

export const POST = createUploadsPost();
