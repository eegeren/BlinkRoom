import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { tokenHash } from "@/src/lib/security";
import { rateLimiter } from "@/src/server/rate-limit";
import { storage } from "@/src/server/storage";
const schema = z
  .object({ partNumber: z.number().int().min(1).max(10_000) })
  .strict();
const ackSchema = z
  .object({
    partNumber: z.number().int().min(1).max(10_000),
    etag: z.string().min(1).max(512),
    size: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
  })
  .strict();
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  const { slug, sessionId } = await params;
  const input = schema.safeParse(await req.json().catch(() => null));
  if (
    !input.success ||
    !rateLimiter.check(`upload-part:${sessionId}`, 1000, 60_000)
  )
    return NextResponse.json({ error: "Invalid upload part" }, { status: 400 });
  const session = await db.uploadSession.findFirst({
    where: { id: sessionId, room: { slug }, status: "UPLOADING" },
    include: { room: { select: { status: true, expiresAt: true, accessVersion: true } } },
  });
  if (
    !session ||
    tokenHash(req.headers.get("x-upload-token") ?? "") !==
      session.uploadTokenHash
  )
    return NextResponse.json({ error: "Upload unavailable" }, { status: 403 });
  if (
    session.accessVersion !== session.room.accessVersion ||
    session.room.status !== "ACTIVE" ||
    session.room.expiresAt <= new Date() ||
    !session.multipartUploadId
  )
    return NextResponse.json({ error: "Upload unavailable" }, { status: 410 });
  try {
    return NextResponse.json({
      url: await storage.signUploadPart(
        session.storageKey,
        session.multipartUploadId,
        input.data.partNumber,
      ),
    });
  } catch {
    return NextResponse.json(
      { error: "Temporary storage is unavailable right now." },
      { status: 503 },
    );
  }
}
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  const { slug, sessionId } = await params,
    input = ackSchema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ error: "Invalid upload part" }, { status: 400 });
  const session = await db.uploadSession.findFirst({
    where: { id: sessionId, room: { slug }, status: "UPLOADING" },
    include: {
      room: { select: { status: true, expiresAt: true, directOnly: true, accessVersion: true } },
    },
  });
  if (
    !session ||
    tokenHash(req.headers.get("x-upload-token") ?? "") !==
      session.uploadTokenHash
  )
    return NextResponse.json({ error: "Upload unavailable" }, { status: 403 });
  if (
    session.accessVersion !== session.room.accessVersion ||
    session.room.directOnly ||
    session.room.status !== "ACTIVE" ||
    session.room.expiresAt <= new Date() ||
    input.data.partNumber > session.totalParts ||
    input.data.size > session.partSize
  )
    return NextResponse.json({ error: "Upload unavailable" }, { status: 410 });
  await db.uploadPart.upsert({
    where: {
      sessionId_partNumber: { sessionId, partNumber: input.data.partNumber },
    },
    create: { sessionId, ...input.data },
    update: { etag: input.data.etag, size: input.data.size },
  });
  const aggregate = await db.uploadPart.aggregate({
    where: { sessionId },
    _sum: { size: true },
    _count: true,
  });
  return NextResponse.json({
    completedParts: aggregate._count,
    uploadedBytes: aggregate._sum.size ?? 0,
  });
}
