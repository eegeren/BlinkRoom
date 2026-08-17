import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { ephemeralRequestKey, ownerToken, tokenHash } from "@/src/lib/security";
import { rateLimiter } from "@/src/server/rate-limit";
import { refreshRoomStatus } from "@/src/server/rooms";
import { storage } from "@/src/server/storage";
import { storageObjectKey, validateStorageQuota } from "@/src/server/storage/quota";

const envelope = z.string().min(40).max(100_000).refine((value) => { try { const parsed = JSON.parse(value); return parsed.version === 1 && parsed.algorithm === "AES-GCM" && typeof parsed.iv === "string" && typeof parsed.ciphertext === "string"; } catch { return false; } });
const schema = z.object({ itemId: z.string().uuid(), senderId: z.string().uuid(), type: z.enum(["IMAGE", "FILE"]), encryptionVersion: z.literal(1), encryptedMetadata: envelope, encryptedSize: z.number().int().positive(), directDelivered: z.boolean().default(false) }).strict();
const messages = { FILE_TOO_LARGE: "This file is too large.", ROOM_STORAGE_LIMIT: "This room has reached its temporary storage limit.", ROOM_ITEM_LIMIT: "This room has reached its item limit.", TOO_MANY_UPLOADS: "Too many uploads are already in progress." } as const;
class QuotaError extends Error { constructor(public code: keyof typeof messages) { super(code); } }

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (storage.kind !== "r2") return NextResponse.json({ error: "Direct storage upload is disabled" }, { status: 404 }); const { slug } = await params; const input = schema.safeParse(await req.json().catch(() => null)); if (!input.success) return NextResponse.json({ error: "Invalid encrypted upload" }, { status: 400 });
  const requestKey = ephemeralRequestKey([slug, input.data.senderId, env.TRUST_PROXY_HEADERS ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null]); if (!rateLimiter.check(`upload-session:${requestKey}`, 20, 60_000)) return NextResponse.json({ error: "Slow down" }, { status: 429 });
  const room = await refreshRoomStatus(slug); if (!room || room.status !== "ACTIVE") return NextResponse.json({ error: "Room unavailable" }, { status: 410 }); if (room.items.some((item) => item.id === input.data.itemId)) return NextResponse.json({ error: "Item already exists" }, { status: 409 });
  const storageKey = storageObjectKey(slug), uploadToken = ownerToken(); let sessionId = "";
  try { const session = await db.$transaction(async (tx) => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${room.id}))`; const [stored, pending, itemCount] = await Promise.all([tx.roomItem.aggregate({ where: { roomId: room.id, storageKey: { not: null } }, _sum: { encryptedSize: true } }), tx.uploadSession.aggregate({ where: { roomId: room.id, status: { in: ["PENDING", "UPLOADING"] } }, _sum: { encryptedSize: true }, _count: true }), tx.roomItem.count({ where: { roomId: room.id } })]); const quota = validateStorageQuota({ encryptedSize: input.data.encryptedSize, storedBytes: Number(stored._sum.encryptedSize ?? 0) + Number(pending._sum.encryptedSize ?? BigInt(0)), storedItems: itemCount, pendingUploads: pending._count, maxFileBytes: env.MAX_FILE_SIZE_MB * 1024 * 1024, maxRoomBytes: env.MAX_ROOM_STORAGE_MB * 1024 * 1024, maxItems: env.MAX_ROOM_ITEMS, maxConcurrent: env.MAX_CONCURRENT_UPLOADS }); if (!quota.ok) throw new QuotaError(quota.code); return tx.uploadSession.create({ data: { roomId: room.id, itemId: input.data.itemId, senderId: input.data.senderId, itemType: input.data.type, storageKey, provider: storage.kind, uploadTokenHash: tokenHash(uploadToken), encryptedMetadata: input.data.encryptedMetadata, encryptedSize: BigInt(input.data.encryptedSize), directDelivered: input.data.directDelivered, status: "PENDING", expiresAt: room.expiresAt } }); }); sessionId = session.id;
    const uploadId = await storage.createMultipartUpload(storageKey); await db.uploadSession.update({ where: { id: session.id }, data: { multipartUploadId: uploadId, status: "UPLOADING" } }); return NextResponse.json({ sessionId: session.id, uploadToken, partSize: 10 * 1024 * 1024, partCount: Math.ceil(input.data.encryptedSize / (10 * 1024 * 1024)) }, { status: 201 });
  } catch (error) { if (sessionId) await db.uploadSession.updateMany({ where: { id: sessionId, status: "PENDING" }, data: { status: "FAILED" } }); if (error instanceof QuotaError) return NextResponse.json({ error: messages[error.code] }, { status: 413 }); return NextResponse.json({ error: "Temporary storage is unavailable right now." }, { status: 503 }); }
}
