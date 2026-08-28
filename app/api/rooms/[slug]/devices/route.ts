import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { isRoomOwner } from "@/src/server/device-approval";
import { disconnectUnapprovedRoomDevices, roomChannel } from "@/src/server/realtime";

const mutation = z.object({ requestId: z.string().uuid(), action: z.enum(["approve", "deny", "revoke"]) }).strict();
async function ownerRoom(req: NextRequest, slug: string) {
  const room = await db.room.findUnique({ where: { slug }, select: { id: true, ownerTokenHash: true, status: true, expiresAt: true, accessVersion: true } });
  return room && isRoomOwner(req, slug, room.ownerTokenHash) ? room : null;
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params, room = await ownerRoom(req, slug);
  if (!room) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const devices = await db.roomDevice.findMany({ where: { roomId: room.id, accessVersion: room.accessVersion, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" }, select: { id: true, status: true, browserLabel: true, platformLabel: true, createdAt: true, approvedAt: true, expiresAt: true } });
  return NextResponse.json({ devices });
}
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params, room = await ownerRoom(req, slug), input = mutation.safeParse(await req.json().catch(() => null));
  if (!room) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  if (!input.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const now = new Date(), targetStatus = input.data.action === "approve" ? "APPROVED" : input.data.action === "deny" ? "DENIED" : "REVOKED";
  const changed = await db.roomDevice.updateMany({ where: { id: input.data.requestId, roomId: room.id, accessVersion: room.accessVersion, expiresAt: { gt: now }, ...(input.data.action === "revoke" ? { status: "APPROVED" } : { status: "PENDING" }) }, data: { status: targetStatus, sessionTokenHash: targetStatus === "APPROVED" ? undefined : null, expiresAt: targetStatus === "APPROVED" ? room.expiresAt : undefined, approvedAt: targetStatus === "APPROVED" ? now : null, deniedAt: targetStatus === "DENIED" ? now : null, revokedAt: targetStatus === "REVOKED" ? now : null } });
  if (changed.count !== 1) return NextResponse.json({ error: "Request unavailable" }, { status: 409 });
  roomChannel.deviceDecision(slug, input.data.requestId, targetStatus);
  if (targetStatus === "REVOKED") await disconnectUnapprovedRoomDevices(slug);
  return NextResponse.json({ status: targetStatus });
}
