import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { roomSlug, tokenHash } from "@/src/lib/security";
import { acquireRoomLock } from "@/src/server/rooms";
import { rateLimiter } from "@/src/server/rate-limit";
import { rotateRealtimeAccess } from "@/src/server/realtime";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const token = req.cookies.get(`blinkroom_owner_${slug}`)?.value;
  const room = await db.room.findUnique({
    where: { slug },
    select: { id: true, ownerTokenHash: true, status: true, expiresAt: true },
  });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!token || tokenHash(token) !== room.ownerTokenHash)
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  if (!rateLimiter.check(`room-rotate:${room.id}`, 3, 60_000))
    return NextResponse.json({ error: "Please wait before locking again" }, { status: 429 });

  let newSlug = roomSlug();
  while (await db.room.findUnique({ where: { slug: newSlug }, select: { id: true } })) newSlug = roomSlug();
  const rotated = await db.$transaction(async (tx) => {
    await acquireRoomLock(tx, room.id);
    const current = await tx.room.findUnique({
      where: { id: room.id },
      select: { slug: true, status: true, expiresAt: true },
    });
    const now = new Date();
    if (!current || current.slug !== slug || current.status !== "ACTIVE" || current.expiresAt <= now) return null;
    const updated = await tx.room.update({
      where: { id: room.id },
      data: { slug: newSlug, accessVersion: { increment: 1 }, autoDestroyEmptySince: null },
      select: { slug: true, expiresAt: true, accessVersion: true },
    });
    await tx.roomPresence.deleteMany({ where: { roomId: room.id, isOwner: false } });
    await tx.uploadSession.updateMany({
      where: { roomId: room.id, status: { in: ["PENDING", "UPLOADING", "FAILED"] } },
      data: { status: "ABORTED" },
    });
    return updated;
  });
  if (!rotated) return NextResponse.json({ error: "Room is no longer available" }, { status: 409 });

  await rotateRealtimeAccess(slug, rotated.slug);
  const res = NextResponse.json({ slug: rotated.slug, expiresAt: rotated.expiresAt.toISOString(), accessVersion: rotated.accessVersion });
  res.cookies.set(`blinkroom_owner_${rotated.slug}`, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: rotated.expiresAt,
  });
  res.cookies.set(`blinkroom_owner_${slug}`, "", {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0,
  });
  return res;
}
