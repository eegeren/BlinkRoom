import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { deviceCookie } from "@/src/server/device-approval";
import { tokenHash } from "@/src/lib/security";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params, deviceId = req.cookies.get(deviceCookie(slug))?.value;
  const room = await db.room.findUnique({ where: { slug }, select: { id: true, status: true, expiresAt: true, accessVersion: true, deviceApprovalRequired: true } });
  if (!room || room.status !== "ACTIVE" || room.expiresAt <= new Date()) return NextResponse.json({ status: "EXPIRED" }, { status: 410 });
  if (!room.deviceApprovalRequired) return NextResponse.json({ status: "NOT_REQUIRED" });
  if (!deviceId) return NextResponse.json({ status: "UNKNOWN" }, { status: 404 });
  const device = await db.roomDevice.findUnique({ where: { roomId_deviceIdHash: { roomId: room.id, deviceIdHash: tokenHash(deviceId) } } });
  if (!device || device.accessVersion !== room.accessVersion || device.expiresAt <= new Date()) return NextResponse.json({ status: "EXPIRED" }, { status: 403 });
  return NextResponse.json({ status: device.status });
}
