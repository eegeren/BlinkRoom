import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { ownerToken, tokenHash } from "@/src/lib/security";
import { acquireRoomLock } from "@/src/server/rooms";
import { roomChannel } from "@/src/server/realtime";
import { storage } from "@/src/server/storage";
import { authorizeRoomDevice } from "@/src/server/device-approval";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve") }).strict(),
  z
    .object({
      action: z.literal("complete"),
      consumeToken: z.string().min(32).max(256),
    })
    .strict(),
  z
    .object({
      action: z.literal("release"),
      consumeToken: z.string().min(32).max(256),
    })
    .strict(),
]);
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; itemId: string }> },
) {
  const { slug, itemId } = await params,
    input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { error: "Invalid consume request" },
      { status: 400 },
    );
  const item = await db.roomItem.findFirst({
    where: { id: itemId, room: { slug } },
    include: { room: { select: { id: true, slug: true, ownerTokenHash: true, deviceApprovalRequired: true, accessVersion: true, status: true, expiresAt: true } } },
  });
  if (item && !(await authorizeRoomDevice(req, item.room)).authorized)
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  if (!item || (!item.oneTime && item.accessMode === "STANDARD"))
    return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  if (input.data.action === "reserve") {
    const token = ownerToken(),
      now = new Date(),
      staleBefore = new Date(
        now.getTime() - env.ONE_TIME_RESERVATION_SECONDS * 1000,
      );
    const won = await db.$transaction(async (tx) => {
      await acquireRoomLock(tx, item.roomId);
      const current = await tx.roomItem.findUnique({
        where: { id: item.id },
        include: { room: { select: { status: true, expiresAt: true } } },
      });
      if (
        !current ||
        current.room.status !== "ACTIVE" ||
        current.room.expiresAt <= now ||
        current.oneTimeStatus === "CONSUMED" ||
        (current.oneTimeStatus === "RESERVED" &&
          current.consumeReservedAt &&
          current.consumeReservedAt > staleBefore)
      )
        return false;
      await tx.roomItem.update({
        where: { id: item.id },
        data: {
          oneTimeStatus: "RESERVED",
          consumeTokenHash: tokenHash(token),
          consumeReservedAt: now,
        },
      });
      return true;
    });
    return won
      ? NextResponse.json({
          consumeToken: token,
          reservationExpiresIn: env.ONE_TIME_RESERVATION_SECONDS,
        })
      : NextResponse.json({ error: "No longer available" }, { status: 409 });
  }
  if (input.data.action === "release") {
    const released = await db.roomItem.updateMany({
      where: {
        id: item.id,
        oneTimeStatus: "RESERVED",
        consumeTokenHash: tokenHash(input.data.consumeToken),
      },
      data: {
        oneTimeStatus: "AVAILABLE",
        consumeTokenHash: null,
        consumeReservedAt: null,
      },
    });
    return released.count === 1
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "No longer available" }, { status: 409 });
  }
  const consumeToken = input.data.consumeToken;
  const consumed = await db.$transaction(async (tx) => {
    await acquireRoomLock(tx, item.roomId);
    const now = new Date();
    const changed = await tx.roomItem.updateMany({
      where: {
        id: item.id,
        accessMode: { not: "STANDARD" },
        oneTimeStatus: "RESERVED",
        consumeTokenHash: tokenHash(consumeToken),
        consumeReservedAt: {
          gt: new Date(now.getTime() - env.ONE_TIME_RESERVATION_SECONDS * 1000),
        },
        room: { status: "ACTIVE", expiresAt: { gt: now } },
      },
      data: {
        oneTimeStatus: "CONSUMED",
        consumedAt: now,
        consumeTokenHash: null,
        consumeReservedAt: null,
      },
    });
    return changed.count === 1;
  });
  if (!consumed)
    return NextResponse.json({ error: "No longer available" }, { status: 409 });
  roomChannel.itemConsumed(slug, item.id);
  if (item.storageKey)
    queueMicrotask(
      () => void storage.deleteObject(item.storageKey!).catch((error) => console.error("destructive_cleanup_failed", { name: error instanceof Error ? error.name : "Unknown" })),
    );
  return NextResponse.json({ ok: true });
}
