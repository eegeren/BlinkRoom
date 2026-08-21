import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { tokenHash } from "@/src/lib/security";
import { roomChannel } from "@/src/server/realtime";
import { storage } from "@/src/server/storage";
import { acquireRoomLock } from "@/src/server/rooms";
import { trackMetric } from "@/src/server/analytics";
const completeSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            partNumber: z.number().int().min(1).max(10_000),
            etag: z.string().min(1).max(512),
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict();
type Ctx = { params: Promise<{ slug: string; sessionId: string }> };
export async function POST(req: NextRequest, { params }: Ctx) {
  const { slug, sessionId } = await params;
  const input = completeSchema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid upload completion" },
      { status: 400 },
    );
  const session = await db.uploadSession.findFirst({
    where: { id: sessionId, room: { slug }, status: "UPLOADING" },
    include: { room: true },
  });
  if (
    !session ||
    tokenHash(req.headers.get("x-upload-token") ?? "") !==
      session.uploadTokenHash
  )
    return NextResponse.json({ error: "Upload unavailable" }, { status: 403 });
  if (
    session.room.status !== "ACTIVE" ||
    session.room.expiresAt <= new Date() ||
    !session.multipartUploadId
  )
    return NextResponse.json({ error: "Upload unavailable" }, { status: 410 });
  const ordered = [...input.data.parts].sort(
    (a, b) => a.partNumber - b.partNumber,
  );
  if (ordered.some((part, index) => part.partNumber !== index + 1))
    return NextResponse.json({ error: "Missing upload part" }, { status: 400 });
  try {
    const result = await db.$transaction(
      async (tx) => {
        await acquireRoomLock(tx, session.roomId);
        const active = await tx.room.findUnique({
          where: { id: session.roomId },
          select: { status: true, expiresAt: true },
        });
        const current = await tx.uploadSession.findUnique({
          where: { id: session.id },
          select: { status: true, multipartUploadId: true },
        });
        if (
          !active ||
          active.status !== "ACTIVE" ||
          active.expiresAt <= new Date() ||
          current?.status !== "UPLOADING" ||
          current.multipartUploadId !== session.multipartUploadId
        )
          return { unavailable: true as const };
        await storage.completeMultipartUpload(
          session.storageKey,
          session.multipartUploadId!,
          ordered,
        );
        if (
          (await storage.headSize(session.storageKey)) !==
          Number(session.encryptedSize)
        ) {
          await storage.deleteObject(session.storageKey);
          await tx.uploadSession.update({
            where: { id: session.id },
            data: { status: "FAILED" },
          });
          return { sizeMismatch: true as const };
        }
        const item = await tx.roomItem.create({
          data: {
            id: session.itemId,
            roomId: session.roomId,
            senderId: session.senderId,
            type: session.itemType,
            encryptedMetadata: session.encryptedMetadata,
            encryptionVersion: 1,
            encryptedSize: Number(session.encryptedSize),
            storageKey: session.storageKey,
            availability: session.directDelivered ? "HYBRID" : "STORED",
            oneTime: session.oneTime,
          },
        });
        await tx.uploadSession.update({
          where: { id: session.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        return { item };
      },
      { timeout: 30_000 },
    );
    if ("unavailable" in result)
      { await trackMetric("UPLOAD_FAILED");
      return NextResponse.json(
        { error: "Upload unavailable" },
        { status: 410 },
      ); }
    if ("sizeMismatch" in result)
      { await trackMetric("UPLOAD_FAILED");
      return NextResponse.json(
        { error: "Encrypted upload size mismatch" },
        { status: 400 },
      ); }
    const item = result.item,
      output = {
        id: item.id,
        senderId: item.senderId,
        type: item.type,
        encryptedPayload: null,
        encryptedMetadata: item.encryptedMetadata,
        encryptionVersion: item.encryptionVersion,
        encryptedSize: item.encryptedSize,
        availability: item.availability,
        oneTime: item.oneTime,
        oneTimeStatus: item.oneTimeStatus,
        createdAt: item.createdAt.toISOString(),
      };
    roomChannel.itemCreated(slug, output);
    await trackMetric("UPLOAD_COMPLETED", { bytes: Number(session.encryptedSize) });
    return NextResponse.json(output);
  } catch {
    await db.uploadSession.updateMany({
      where: {
        id: session.id,
        status: "UPLOADING",
        room: { status: "ACTIVE" },
      },
      data: { status: "FAILED" },
    });
    await trackMetric("UPLOAD_FAILED");
    return NextResponse.json(
      { error: "Temporary storage is unavailable right now." },
      { status: 503 },
    );
  }
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { slug, sessionId } = await params;
  const session = await db.uploadSession.findFirst({
    where: {
      id: sessionId,
      room: { slug },
      status: { in: ["PENDING", "UPLOADING", "FAILED"] },
    },
  });
  if (!session) return NextResponse.json({ ok: true });
  if (
    tokenHash(req.headers.get("x-upload-token") ?? "") !==
    session.uploadTokenHash
  )
    return NextResponse.json({ error: "Upload unavailable" }, { status: 403 });
  if (session.multipartUploadId)
    await storage.abortMultipartUpload(
      session.storageKey,
      session.multipartUploadId,
    );
  await storage.deleteObject(session.storageKey).catch(() => undefined);
  await db.uploadSession.update({
    where: { id: session.id },
    data: { status: "ABORTED" },
  });
  return NextResponse.json({ ok: true });
}
