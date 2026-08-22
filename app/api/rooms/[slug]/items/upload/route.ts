import { NextRequest, NextResponse } from "next/server";
import { Readable, Transform } from "node:stream";
import Busboy from "busboy";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { rateLimiter } from "@/src/server/rate-limit";
import { roomChannel } from "@/src/server/realtime";
import { acquireRoomLock, refreshRoomStatus } from "@/src/server/rooms";
import { storage } from "@/src/server/storage";
import { validateStorageQuota } from "@/src/server/storage/quota";
import { encryptedFileSize } from "@/src/lib/crypto/file";
import { trackMetric } from "@/src/server/analytics";

export const runtime = "nodejs";
const meta = z
  .object({
    itemId: z.string().uuid(),
    senderId: z.string().uuid(),
    type: z.enum(["IMAGE", "FILE"]),
    encryptionVersion: z.coerce.number().pipe(z.literal(1)),
    encryptedMetadata: z.string().min(40).max(100_000),
    directDelivered: z.enum(["true", "false"]).optional().default("false"),
  })
  .strict();
type ParsedUpload = {
  fields: Record<string, string>;
  size: number;
  storageKey: string;
  truncated: boolean;
};
const maxEncryptedFileBytes = () =>
  encryptedFileSize(env.MAX_FILE_SIZE_MB * 1024 * 1024);
async function parseUpload(
  req: NextRequest,
  slug: string,
): Promise<ParsedUpload> {
  if (!req.body) throw new Error("EMPTY_UPLOAD");
  const fields: Record<string, string> = {};
  let size = 0;
  let storageKey = "";
  let truncated = false;
  let uploadPromise: Promise<string> | null = null;
  const maxEncryptedBytes = maxEncryptedFileBytes();
  const parser = Busboy({
    headers: Object.fromEntries(req.headers),
    limits: { files: 1, fields: 8, fileSize: maxEncryptedBytes },
  });
  parser.on("field", (name, value) => {
    fields[name] = value;
  });
  parser.on("file", (_name, stream) => {
    const itemId = fields.itemId;
    if (!itemId || !z.string().uuid().safeParse(itemId).success) {
      stream.resume();
      return;
    }
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(null, chunk);
      },
    });
    stream.on("limit", () => {
      truncated = true;
    });
    uploadPromise = storage.upload({
      roomSlug: slug,
      itemId,
      filename: "encrypted.bin",
      stream: meter,
    });
    stream.pipe(meter);
  });
  await new Promise<void>((resolve, reject) => {
    parser.once("finish", resolve);
    parser.once("error", reject);
    Readable.fromWeb(req.body as import("node:stream/web").ReadableStream).pipe(
      parser,
    );
  });
  if (!uploadPromise || !size) throw new Error("EMPTY_UPLOAD");
  storageKey = await uploadPromise;
  return { fields, size, storageKey, truncated };
}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const analyticsStartedAt = Date.now();
  if (storage.kind !== "local")
    return NextResponse.json(
      { error: "Use direct encrypted upload" },
      { status: 404 },
    );
  const { slug } = await params;
  const initialRoom = await refreshRoomStatus(slug);
  if (!initialRoom || initialRoom.status !== "ACTIVE")
    return NextResponse.json({ error: "Room unavailable" }, { status: 410 });
  if (initialRoom.directOnly)
    return NextResponse.json(
      { error: "Storage uploads are disabled for this room" },
      { status: 409 },
    );
  let upload: ParsedUpload;
  try {
    upload = await parseUpload(req, slug);
  } catch {
    await trackMetric("UPLOAD_FAILED");
    return NextResponse.json(
      { error: "Invalid encrypted upload" },
      { status: 400 },
    );
  }
  const parsed = meta.safeParse(upload.fields);
  if (!parsed.success) {
    await storage.deleteObject(upload.storageKey);
    await trackMetric("UPLOAD_FAILED");
    return NextResponse.json(
      { error: "Invalid encrypted metadata" },
      { status: 400 },
    );
  }
  if (!rateLimiter.check(`upload:${parsed.data.senderId}`, 25, 60_000)) {
    await storage.deleteObject(upload.storageKey);
    return NextResponse.json({ error: "Slow down" }, { status: 429 });
  }
  if (upload.truncated) {
    await storage.deleteObject(upload.storageKey);
    await trackMetric("UPLOAD_FAILED");
    return NextResponse.json(
      { error: "Encrypted upload is too large" },
      { status: 413 },
    );
  }
  const room = await refreshRoomStatus(slug);
  if (!room || room.status !== "ACTIVE") {
    await storage.deleteObject(upload.storageKey);
    return NextResponse.json({ error: "Room unavailable" }, { status: 410 });
  }
  try {
    const result = await db.$transaction(async (tx) => {
      await acquireRoomLock(tx, room.id);
      const active = await tx.room.findUnique({
        where: { id: room.id },
        select: { status: true, expiresAt: true },
      });
      if (
        !active ||
        active.status !== "ACTIVE" ||
        active.expiresAt <= new Date()
      )
        return { error: "ROOM" as const };
      const [stored, itemCount] = await Promise.all([
        tx.roomItem.aggregate({
          where: {
            roomId: room.id,
            storageKey: { not: null },
            id: { not: parsed.data.itemId },
          },
          _sum: { encryptedSize: true },
        }),
        tx.roomItem.count({
          where: { roomId: room.id, id: { not: parsed.data.itemId } },
        }),
      ]);
      const quota = validateStorageQuota({
        encryptedSize: upload.size,
        storedBytes: Number(stored._sum.encryptedSize ?? 0),
        storedItems: itemCount,
        pendingUploads: 0,
        maxFileBytes: env.MAX_FILE_SIZE_MB * 1024 * 1024 + 2 * 1024 * 1024,
        maxRoomBytes: env.MAX_ROOM_STORAGE_MB * 1024 * 1024,
        maxItems: env.MAX_ROOM_ITEMS,
        maxConcurrent: env.MAX_CONCURRENT_UPLOADS,
      });
      if (!quota.ok)
        return {
          error: quota.code as
            | "FILE_TOO_LARGE"
            | "ROOM_STORAGE_LIMIT"
            | "ROOM_ITEM_LIMIT",
        };
      const existing = await tx.roomItem.findUnique({
        where: { id: parsed.data.itemId },
      });
      if (
        existing &&
        (existing.roomId !== room.id ||
          existing.senderId !== parsed.data.senderId ||
          existing.type !== parsed.data.type)
      )
        return { error: "CONFLICT" as const };
      const item = existing
        ? await tx.roomItem.update({
            where: { id: existing.id },
            data: {
              encryptedMetadata: parsed.data.encryptedMetadata,
              encryptedSize: upload.size,
              storageKey: upload.storageKey,
              availability:
                existing.availability === "DIRECT" ||
                parsed.data.directDelivered === "true"
                  ? "HYBRID"
                  : "STORED",
            },
          })
        : await tx.roomItem.create({
            data: {
              id: parsed.data.itemId,
              roomId: room.id,
              senderId: parsed.data.senderId,
              type: parsed.data.type,
              encryptedMetadata: parsed.data.encryptedMetadata,
              encryptionVersion: parsed.data.encryptionVersion,
              encryptedSize: upload.size,
              storageKey: upload.storageKey,
              availability:
                parsed.data.directDelivered === "true" ? "HYBRID" : "STORED",
            },
          });
      return { item, existing: Boolean(existing) };
    });
    if ("error" in result) {
      await storage.deleteObject(upload.storageKey);
      if (result.error === "ROOM")
        return NextResponse.json(
          { error: "Room unavailable" },
          { status: 410 },
        );
      if (result.error === "CONFLICT")
        return NextResponse.json({ error: "Item conflict" }, { status: 409 });
      const message =
        result.error === "FILE_TOO_LARGE"
          ? "This file is too large."
          : result.error === "ROOM_STORAGE_LIMIT"
            ? "This room has reached its temporary storage limit."
            : "This room has reached its item limit.";
      return NextResponse.json({ error: message }, { status: 413 });
    }
    const item = result.item,
      output = {
        id: item.id,
        senderId: item.senderId,
        type: item.type,
        encryptedPayload: item.encryptedPayload,
        encryptedMetadata: item.encryptedMetadata,
        encryptionVersion: item.encryptionVersion,
        encryptedSize: item.encryptedSize,
        availability: item.availability,
        createdAt: item.createdAt.toISOString(),
      };
    roomChannel.itemCreated(slug, output);
    await trackMetric("UPLOAD_COMPLETED", { bytes: upload.size, durationMs: Date.now() - analyticsStartedAt });
    return NextResponse.json(output, { status: result.existing ? 200 : 201 });
  } catch (error) {
    await storage.deleteObject(upload.storageKey);
    await trackMetric("UPLOAD_FAILED");
    throw error;
  }
}
