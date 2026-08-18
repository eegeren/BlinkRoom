import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { roomChannel } from "@/src/server/realtime";
import { storage } from "@/src/server/storage";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string; itemId: string }> }) {
  const { slug, itemId } = await params; const senderId = req.headers.get("x-participant-id");
  const item = await db.roomItem.findFirst({ where: { id: itemId, room: { slug } } });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  const room = await db.room.findUnique({ where: { slug } }); const token = req.cookies.get(`blinkroom_owner_${slug}`)?.value;
  const { tokenHash } = await import("@/src/lib/security"); const isOwner = Boolean(token && room && tokenHash(token) === room.ownerTokenHash);
  if (item.senderId !== senderId && !isOwner) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  await db.roomItem.delete({ where: { id: item.id } }); if (item.storageKey) await storage.deleteObject(item.storageKey);
  roomChannel.itemDeleted(slug, item.id); return NextResponse.json({ ok: true });
}
