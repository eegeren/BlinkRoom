import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/src/lib/db";
import { rateLimiter } from "@/src/server/rate-limit";
import { refreshRoomStatus } from "@/src/server/rooms";
import { roomChannel } from "@/src/server/realtime";

const envelope = z.string().min(40).max(100_000).refine((value) => { try { const parsed = JSON.parse(value); return parsed.version === 1 && parsed.algorithm === "AES-GCM" && typeof parsed.iv === "string" && typeof parsed.ciphertext === "string"; } catch { return false; } });
const schema = z.object({ itemId: z.string().uuid(), senderId: z.string().uuid(), type: z.enum(["IMAGE", "FILE"]), encryptionVersion: z.literal(1), encryptedMetadata: envelope, encryptedSize: z.number().int().positive() }).strict();
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const input = schema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid direct item" }, { status: 400 });
  if (!rateLimiter.check(`direct:${input.data.senderId}`, 40, 60_000)) return NextResponse.json({ error: "Slow down" }, { status: 429 });
  const room = await refreshRoomStatus(slug); if (!room || room.status !== "ACTIVE") return NextResponse.json({ error: "Room unavailable" }, { status: 410 });
  const item = await db.roomItem.create({ data: { id: input.data.itemId, roomId: room.id, senderId: input.data.senderId, type: input.data.type, encryptedMetadata: input.data.encryptedMetadata, encryptionVersion: 1, encryptedSize: input.data.encryptedSize, availability: "DIRECT" } });
  const output = { id: item.id, senderId: item.senderId, type: item.type, encryptedPayload: null, encryptedMetadata: item.encryptedMetadata, encryptionVersion: item.encryptionVersion, encryptedSize: item.encryptedSize, availability: item.availability, createdAt: item.createdAt.toISOString() };
  roomChannel.itemCreated(slug, output); return NextResponse.json(output, { status: 201 });
}
