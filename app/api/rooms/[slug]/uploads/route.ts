import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { encryptedFileSize } from "@/src/lib/crypto/file";
import { ephemeralRequestKey, ownerToken, tokenHash } from "@/src/lib/security";
import { rateLimiter } from "@/src/server/rate-limit";
import { refreshRoomStatus } from "@/src/server/rooms";
import { storage } from "@/src/server/storage";
import { storageObjectKey, validateStorageQuota } from "@/src/server/storage/quota";

const envelope = z.string().min(40).max(100_000).refine((value) => { try { const parsed = JSON.parse(value); return parsed.version === 1 && parsed.algorithm === "AES-GCM" && typeof parsed.iv === "string" && typeof parsed.ciphertext === "string"; } catch { return false; } });
const schema = z.object({ itemId: z.string().uuid(), senderId: z.string().uuid(), type: z.enum(["IMAGE", "FILE"]), encryptionVersion: z.literal(1), encryptedMetadata: envelope, encryptedSize: z.number().int().positive(), directDelivered: z.boolean().default(false) }).strict();
type UploadInput = z.infer<typeof schema>;
type RoomSnapshot = NonNullable<Awaited<ReturnType<typeof refreshRoomStatus>>>;
type PendingSession = { id: string };
const messages = { FILE_TOO_LARGE: "This file is too large.", ROOM_STORAGE_LIMIT: "This room has reached its temporary storage limit.", ROOM_ITEM_LIMIT: "This room has reached its item limit.", TOO_MANY_UPLOADS: "Too many uploads are already in progress." } as const;
class QuotaError extends Error { constructor(public code: keyof typeof messages) { super(code); } }

function logUploadError(tag: string, error: unknown, context: Record<string, string>) {
  console.error(tag, { ...context, name: error instanceof Error ? error.name : "Unknown", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
}

type LockTransaction = Pick<Prisma.TransactionClient, "$executeRaw">;
export async function acquireRoomUploadLock(tx: LockTransaction, roomId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roomId}))`;
}

export async function reserveUploadSession(room: RoomSnapshot, input: UploadInput, storageKey: string, uploadToken: string): Promise<PendingSession> {
  return db.$transaction(async (tx) => {
    await acquireRoomUploadLock(tx, room.id);
    const [stored, pending, itemCount] = await Promise.all([
      tx.roomItem.aggregate({ where: { roomId: room.id, storageKey: { not: null } }, _sum: { encryptedSize: true } }),
      tx.uploadSession.aggregate({ where: { roomId: room.id, status: { in: ["PENDING", "UPLOADING"] } }, _sum: { encryptedSize: true }, _count: true }),
      tx.roomItem.count({ where: { roomId: room.id } }),
    ]);
    const quota = validateStorageQuota({ encryptedSize: input.encryptedSize, storedBytes: Number(stored._sum.encryptedSize ?? 0) + Number(pending._sum.encryptedSize ?? BigInt(0)), storedItems: itemCount, pendingUploads: pending._count, maxFileBytes: encryptedFileSize(env.MAX_FILE_SIZE_MB * 1024 * 1024), maxRoomBytes: env.MAX_ROOM_STORAGE_MB * 1024 * 1024, maxItems: env.MAX_ROOM_ITEMS, maxConcurrent: env.MAX_CONCURRENT_UPLOADS });
    if (!quota.ok) throw new QuotaError(quota.code);
    return tx.uploadSession.create({ data: { roomId: room.id, itemId: input.itemId, senderId: input.senderId, itemType: input.type, storageKey, provider: storage.kind, uploadTokenHash: tokenHash(uploadToken), encryptedMetadata: input.encryptedMetadata, encryptedSize: BigInt(input.encryptedSize), directDelivered: input.directDelivered, status: "PENDING", expiresAt: room.expiresAt } });
  });
}

type UploadRouteDependencies = {
  storageKind: "local" | "r2";
  checkRateLimit: (key: string) => boolean;
  getRoom: (slug: string) => Promise<RoomSnapshot | null>;
  reserveSession: (room: RoomSnapshot, input: UploadInput, storageKey: string, uploadToken: string) => Promise<PendingSession>;
  createMultipartUpload: (storageKey: string) => Promise<string>;
  markUploading: (sessionId: string, uploadId: string) => Promise<void>;
  markFailed: (sessionId: string) => Promise<void>;
  abortMultipartUpload: (storageKey: string, uploadId: string) => Promise<void>;
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
    let session: PendingSession;
    try {
      session = await dependencies.reserveSession(room, input.data, storageKey, uploadToken);
    } catch (error) {
      if (error instanceof QuotaError) return NextResponse.json({ error: messages[error.code] }, { status: 413 });
      logUploadError("[UPLOAD_SESSION_RESERVATION_FAILED]", error, { roomId: room.id, storageProvider: dependencies.storageKind });
      return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 });
    }

    let uploadId: string;
    try {
      uploadId = await dependencies.createMultipartUpload(storageKey);
    } catch (error) {
      logUploadError("[R2_UPLOAD_INIT_FAILED]", error, { roomId: room.id, sessionId: session.id, storageProvider: dependencies.storageKind });
      await dependencies.markFailed(session.id).catch((cleanupError) => logUploadError("[UPLOAD_SESSION_CLEANUP_FAILED]", cleanupError, { roomId: room.id, sessionId: session.id }));
      return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 });
    }

    try {
      await dependencies.markUploading(session.id, uploadId);
    } catch (error) {
      logUploadError("[UPLOAD_SESSION_UPDATE_FAILED]", error, { roomId: room.id, sessionId: session.id, storageProvider: dependencies.storageKind });
      await dependencies.abortMultipartUpload(storageKey, uploadId).catch((cleanupError) => logUploadError("[R2_MULTIPART_ABORT_FAILED]", cleanupError, { roomId: room.id, sessionId: session.id }));
      await dependencies.markFailed(session.id).catch((cleanupError) => logUploadError("[UPLOAD_SESSION_CLEANUP_FAILED]", cleanupError, { roomId: room.id, sessionId: session.id }));
      return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 });
    }

    const partSize = 10 * 1024 * 1024;
    return NextResponse.json({ sessionId: session.id, uploadToken, partSize, partCount: Math.ceil(input.data.encryptedSize / partSize) }, { status: 201 });
  };
}

export const POST = createUploadsPost();
