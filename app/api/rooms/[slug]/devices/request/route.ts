import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { rateLimiter } from "@/src/server/rate-limit";
import { deviceCookie, deviceSessionCookie, newCapability, safeDeviceLabels } from "@/src/server/device-approval";
import { tokenHash } from "@/src/lib/security";
import { roomChannel } from "@/src/server/realtime";

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const room = await db.room.findUnique({ where: { slug }, select: { id: true, status: true, expiresAt: true, accessVersion: true, deviceApprovalRequired: true } });
  if (!room || room.status !== "ACTIVE" || room.expiresAt <= new Date()) return NextResponse.json({ error: "Room unavailable" }, { status: 404 });
  if (!room.deviceApprovalRequired) return NextResponse.json({ status: "NOT_REQUIRED" });
  let deviceId = req.cookies.get(deviceCookie(slug))?.value;
  if (!deviceId) deviceId = newCapability();
  const deviceIdHash = tokenHash(deviceId);
  if (!rateLimiter.check(`device-request:${room.id}:${deviceIdHash}`, 6, 60_000)) return NextResponse.json({ error: "Please wait" }, { status: 429 });
  const labels = safeDeviceLabels(req.headers.get("user-agent"));
  const session = newCapability();
  const requestExpiresAt = new Date(Math.min(room.expiresAt.getTime(), Date.now() + 15 * 60_000));
  const existing = await db.roomDevice.findUnique({ where: { roomId_deviceIdHash: { roomId: room.id, deviceIdHash } } });
  const device = existing
    ? await db.roomDevice.update({ where: { id: existing.id }, data: existing.accessVersion === room.accessVersion && existing.status === "APPROVED" ? {} : { status: "PENDING", accessVersion: room.accessVersion, sessionTokenHash: tokenHash(session), browserLabel: labels.browser, platformLabel: labels.platform, expiresAt: requestExpiresAt, approvedAt: null, deniedAt: null, revokedAt: null } })
    : await db.roomDevice.create({ data: { roomId: room.id, deviceIdHash, sessionTokenHash: tokenHash(session), accessVersion: room.accessVersion, browserLabel: labels.browser, platformLabel: labels.platform, expiresAt: requestExpiresAt } });
  if (device.status === "PENDING") roomChannel.deviceApprovalRequested(slug, { id: device.id, browser: device.browserLabel, platform: device.platformLabel, createdAt: device.createdAt.toISOString() });
  const response = NextResponse.json({ status: device.status, requestId: device.id });
  response.cookies.set(deviceCookie(slug), deviceId, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: room.expiresAt });
  if (device.status !== "APPROVED") response.cookies.set(deviceSessionCookie(slug), session, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires: room.expiresAt });
  return response;
}
