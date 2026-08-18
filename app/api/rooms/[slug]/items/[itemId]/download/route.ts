import { NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { rateLimiter } from "@/src/server/rate-limit";
import { storage } from "@/src/server/storage";
import { canAuthorizeStoredDownload } from "@/src/server/storage/quota";

type DownloadRecord = { id: string; roomId: string; storageKey: string | null; availability: "DIRECT" | "STORED" | "HYBRID"; room: { status: "ACTIVE" | "EXPIRED" | "DESTROYED"; expiresAt: Date }; uploadSession: { status: "PENDING" | "UPLOADING" | "COMPLETED" | "ABORTED" | "FAILED"; storageKey: string } | null };
type Dependencies = {
  storageKind: "local" | "r2";
  checkRateLimit: (key: string) => boolean;
  findItem: (slug: string, itemId: string) => Promise<DownloadRecord | null>;
  createUrl: (storageKey: string) => Promise<string>;
};

const defaultDependencies: Dependencies = {
  storageKind: storage.kind,
  checkRateLimit: (key) => rateLimiter.check(key, 120, 60_000),
  findItem: async (slug, itemId) => {
    const item = await db.roomItem.findFirst({ where: { id: itemId, room: { slug } }, select: { id: true, roomId: true, storageKey: true, availability: true, room: { select: { status: true, expiresAt: true } } } });
    if (!item) return null;
    const uploadSession = await db.uploadSession.findUnique({ where: { itemId }, select: { status: true, storageKey: true } });
    return { ...item, uploadSession };
  },
  createUrl: (storageKey) => storage.getPublicOrSignedUrl(storageKey),
};

export function createDownloadGet(dependencies: Dependencies = defaultDependencies) {
  return async function downloadGet(_: Request, { params }: { params: Promise<{ slug: string; itemId: string }> }) {
    const { slug, itemId } = await params;
    if (!dependencies.checkRateLimit(`download-info:${slug}:${itemId}`)) return NextResponse.json({ error: "Slow down" }, { status: 429 });
    const item = await dependencies.findItem(slug, itemId), now = new Date();
    const authorized = item && item.storageKey && item.availability !== "DIRECT" && canAuthorizeStoredDownload(item.room.status, item.room.expiresAt, item.roomId, item.roomId, now);
    const completedR2Upload = dependencies.storageKind !== "r2" || (item?.uploadSession?.status === "COMPLETED" && item.uploadSession.storageKey === item.storageKey);
    if (!authorized || !completedR2Upload) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
    try { return NextResponse.json({ url: await dependencies.createUrl(item.storageKey!), expiresIn: Math.min(env.STORAGE_SIGNED_URL_TTL_SECONDS, 300) }, { headers: { "Cache-Control": "no-store" } }); }
    catch { return NextResponse.json({ error: "File unavailable" }, { status: 404 }); }
  };
}

export const GET = createDownloadGet();
