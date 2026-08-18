import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { tokenHash } from "@/src/lib/security";
import { acquireRoomLock, publicRoom, refreshRoomStatus } from "@/src/server/rooms";
import { roomChannel } from "@/src/server/realtime";
import { roomDurationSchema } from "@/src/lib/duration";
import { cleanupRoomStorage } from "@/src/server/storage/cleanup";

type Ctx = { params: Promise<{ slug: string }> };
export async function GET(_: NextRequest, { params }: Ctx) {
  const { slug } = await params; const room = await refreshRoomStatus(slug);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json(publicRoom(room));
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { slug } = await params; const token = req.cookies.get(`blinkroom_owner_${slug}`)?.value;
  const input = roomDurationSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid room duration" }, { status: 400 });
  const room = await db.room.findUnique({ where: { slug }, select: { id: true, ownerTokenHash: true, status: true, expiresAt: true } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!token || tokenHash(token) !== room.ownerTokenHash) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const now = new Date();
  if (room.status !== "ACTIVE" || room.expiresAt <= now) return NextResponse.json({ error: "Room is no longer active" }, { status: 410 });
  const expiresAt = new Date(now.getTime() + input.data.ttlHours * 3_600_000);
  const updated = await db.room.updateMany({ where: { id: room.id, status: "ACTIVE", expiresAt: { gt: now } }, data: { expiresAt } });
  if (updated.count !== 1) return NextResponse.json({ error: "Room is no longer active" }, { status: 409 });
  const expiresAtIso = expiresAt.toISOString(); roomChannel.expirationUpdated(slug, expiresAtIso);
  const res = NextResponse.json({ expiresAt: expiresAtIso });
  res.cookies.set(`blinkroom_owner_${slug}`, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
  return res;
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { slug } = await params; const token = req.cookies.get(`blinkroom_owner_${slug}`)?.value;
  const room = await db.room.findUnique({ where: { slug } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (!token || tokenHash(token) !== room.ownerTokenHash) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const destroyed = await db.$transaction(async (tx) => { await acquireRoomLock(tx, room.id); const current = await tx.room.findUnique({ where: { id: room.id }, select: { status: true, expiresAt: true } }); const now = new Date(); if (!current || current.status !== "ACTIVE" || current.expiresAt <= now) return false; await tx.room.update({ where: { id: room.id }, data: { status: "DESTROYED", destroyedAt: now, cleanupStatus: "PENDING", cleanupLastError: null, cleanupUpdatedAt: now } }); return true; });
  if (!destroyed) return NextResponse.json({ error: "Room is no longer active" }, { status: 410 });
  roomChannel.destroyed(slug); queueMicrotask(() => { void cleanupRoomStorage(room.id, slug).catch(() => undefined); });
  return NextResponse.json({ ok: true });
}
