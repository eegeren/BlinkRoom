import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { refreshRoomStatus } from "@/src/server/rooms";
import { roomChannel } from "@/src/server/realtime";
import { rateLimiter } from "@/src/server/rate-limit";

const envelope = z.string().min(40).max(100_000).refine((value) => { try { const item = JSON.parse(value) as Record<string, unknown>; return item.version === 1 && item.algorithm === "AES-GCM" && typeof item.iv === "string" && typeof item.ciphertext === "string"; } catch { return false; } }, "Invalid encrypted payload");
const input = z.object({ itemId: z.string().uuid(), senderId: z.string().uuid(), type: z.enum(["TEXT", "LINK"]), encryptionVersion: z.literal(1), encryptedPayload: envelope }).strict();
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid encrypted item" }, { status: 400 });
  if (!rateLimiter.check(`item:${parsed.data.senderId}`, 40, 60_000)) return NextResponse.json({ error: "Slow down" }, { status: 429 });
  const room = await refreshRoomStatus(slug); if (!room || room.status !== "ACTIVE") return NextResponse.json({ error: "Room unavailable" }, { status: 410 });
  const item = await db.roomItem.create({ data: { id: parsed.data.itemId, roomId: room.id, senderId: parsed.data.senderId, type: parsed.data.type, encryptedPayload: parsed.data.encryptedPayload, encryptionVersion: parsed.data.encryptionVersion, encryptedSize: Buffer.byteLength(parsed.data.encryptedPayload) } });
  const output = { id: item.id, senderId: item.senderId, type: item.type, encryptedPayload: item.encryptedPayload, encryptedMetadata: item.encryptedMetadata, encryptionVersion: item.encryptionVersion, encryptedSize: item.encryptedSize, availability: item.availability, createdAt: item.createdAt.toISOString() };
  roomChannel.itemCreated(slug, output); return NextResponse.json(output, { status: 201 });
}
