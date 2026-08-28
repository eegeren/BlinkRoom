import { NextRequest, NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { ephemeralRequestKey, ownerToken, roomSlug, tokenHash } from "@/src/lib/security";
import { env } from "@/src/lib/env";
import { rateLimiter } from "@/src/server/rate-limit";
import { roomDurationSchema } from "@/src/lib/duration";
import { trackMetric } from "@/src/server/analytics";
import { recordProductEvent } from "@/src/server/analytics";
import { z } from "zod";

export async function POST(req: NextRequest) {
  let body: unknown;
  try { const raw = await req.text(); body = raw ? JSON.parse(raw) : { ttlHours: 24 }; }
  catch { return NextResponse.json({ error: "Invalid room duration" }, { status: 400 }); }
  const input = roomDurationSchema.extend({ clientId: z.string().uuid(), deviceApprovalRequired: z.boolean().default(false) }).safeParse(body);
  if (!input.success) return NextResponse.json({ error: "Invalid room duration" }, { status: 400 });
  const proxyIp = env.TRUST_PROXY_HEADERS ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null; const requestKey = ephemeralRequestKey([proxyIp, req.headers.get("user-agent"), req.headers.get("accept-language")]);
  if (!rateLimiter.check(`create:${requestKey}`, 10, 60_000)) return NextResponse.json({ error: "Too many rooms" }, { status: 429 });
  const token = ownerToken(); let slug = roomSlug();
  while (await db.room.findUnique({ where: { slug }, select: { id: true } })) slug = roomSlug();
  const createdAt = new Date();
  const room = await db.room.create({ data: { slug, cryptoContext: slug, createdAt, ownerTokenHash: tokenHash(token), deviceApprovalRequired: input.data.deviceApprovalRequired, expiresAt: new Date(createdAt.getTime() + input.data.ttlHours * 3_600_000) } });
  await trackMetric("ROOM_CREATED");
  await recordProductEvent({ eventType: "ROOM_CREATED", clientId: input.data.clientId, roomId: room.id, dedupeId: room.id, now: createdAt });
  const res = NextResponse.json({ slug: room.slug });
  res.cookies.set(`blinkroom_owner_${slug}`, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: `/`, expires: room.expiresAt });
  return res;
}
