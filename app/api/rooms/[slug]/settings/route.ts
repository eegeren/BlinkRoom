import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { tokenHash } from "@/src/lib/security";
import { acquireRoomLock } from "@/src/server/rooms";
import { roomChannel } from "@/src/server/realtime";
const schema = z
  .object({
    autoDestroyWhenEmpty: z.boolean().optional(),
    directOnly: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => v.autoDestroyWhenEmpty !== undefined || v.directOnly !== undefined,
  );
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params,
    token = req.cookies.get(`blinkroom_owner_${slug}`)?.value,
    input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid room settings" },
      { status: 400 },
    );
  const room = await db.room.findUnique({ where: { slug } });
  if (!room)
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!token || tokenHash(token) !== room.ownerTokenHash)
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    await acquireRoomLock(tx, room.id);
    const current = await tx.room.findUnique({
      where: { id: room.id },
      include: {
        uploadSessions: {
          where: { status: { in: ["PENDING", "UPLOADING"] } },
          take: 1,
        },
        items: { where: { storageKey: { not: null } }, take: 1 },
      },
    });
    if (
      !current ||
      current.status !== "ACTIVE" ||
      current.expiresAt <= new Date()
    )
      return { unavailable: true as const };
    if (
      input.data.directOnly === true &&
      (current.uploadSessions.length || current.items.length)
    )
      return { conflict: true as const };
    return tx.room.update({
      where: { id: room.id },
      data: input.data,
      select: { autoDestroyWhenEmpty: true, directOnly: true },
    });
  });
  if ("unavailable" in result)
    return NextResponse.json({ error: "Room unavailable" }, { status: 410 });
  if ("conflict" in result)
    return NextResponse.json(
      { error: "Direct-only mode cannot be enabled while stored files exist" },
      { status: 409 },
    );
  roomChannel.settingsUpdated(slug, result);
  return NextResponse.json(result);
}
