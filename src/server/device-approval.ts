import { db } from "@/src/lib/db";
import { ownerToken, tokenHash } from "@/src/lib/security";

export const deviceCookie = (slug: string) => `blinkroom_device_${slug}`;
export const deviceSessionCookie = (slug: string) => `blinkroom_device_session_${slug}`;

function cookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function isRoomOwner(req: Request, slug: string, ownerTokenHash: string) {
  const raw = cookie(req, `blinkroom_owner_${slug}`);
  return Boolean(raw && tokenHash(raw) === ownerTokenHash);
}

export async function authorizeRoomDevice(req: Request, room: {
  id: string; slug: string; ownerTokenHash: string; deviceApprovalRequired: boolean;
  accessVersion: number; status: string; expiresAt: Date;
}) {
  const now = new Date();
  if (room.status !== "ACTIVE" || room.expiresAt <= now) return { authorized: false, owner: false, reason: "room_unavailable" as const };
  if (isRoomOwner(req, room.slug, room.ownerTokenHash)) return { authorized: true, owner: true };
  if (!room.deviceApprovalRequired) return { authorized: true, owner: false };
  const deviceId = cookie(req, deviceCookie(room.slug));
  const session = cookie(req, deviceSessionCookie(room.slug));
  if (!deviceId || !session) return { authorized: false, owner: false, reason: "approval_required" as const };
  const approved = await db.roomDevice.findUnique({
    where: { roomId_deviceIdHash: { roomId: room.id, deviceIdHash: tokenHash(deviceId) } },
  });
  const authorized = Boolean(approved && approved.status === "APPROVED" &&
    approved.accessVersion === room.accessVersion && approved.expiresAt > now &&
    approved.sessionTokenHash === tokenHash(session));
  return authorized ? { authorized: true, owner: false, deviceId: approved!.id } : { authorized: false, owner: false, reason: "approval_required" as const };
}

export function safeDeviceLabels(userAgent: string | null) {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const platform = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Device";
  return { browser, platform };
}

export function newCapability() { return ownerToken(); }
