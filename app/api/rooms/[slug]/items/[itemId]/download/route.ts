import { NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { env } from "@/src/lib/env";
import { rateLimiter } from "@/src/server/rate-limit";
import { storage } from "@/src/server/storage";
import { canAuthorizeStoredDownload } from "@/src/server/storage/quota";
import { tokenHash } from "@/src/lib/security";
import { authorizeRoomDevice } from "@/src/server/device-approval";

type DownloadRecord = {
  id: string;
  roomId: string;
  storageKey: string | null;
  availability: "DIRECT" | "STORED" | "HYBRID";
  oneTime?: boolean;
  accessMode?: "STANDARD" | "VIEW_ONCE" | "BURN_AFTER_DOWNLOAD";
  oneTimeStatus?: "AVAILABLE" | "RESERVED" | "CONSUMED";
  consumeTokenHash?: string | null;
  consumeReservedAt?: Date | null;
  room: { id?: string; slug?: string; ownerTokenHash?: string; deviceApprovalRequired?: boolean; status: "ACTIVE" | "EXPIRED" | "DESTROYED"; expiresAt: Date; accessVersion?: number };
  uploadSession: {
    status: "PENDING" | "UPLOADING" | "COMPLETED" | "ABORTED" | "FAILED";
    storageKey: string;
  } | null;
  encryptedSize?: number | null;
};
type Dependencies = {
  storageKind: "local" | "r2";
  checkRateLimit: (key: string) => boolean;
  findItem: (slug: string, itemId: string) => Promise<DownloadRecord | null>;
  createUrl: (storageKey: string) => Promise<string>;
  authorizeDevice?: (req: Request, item: DownloadRecord) => Promise<boolean>;
};

const defaultDependencies: Dependencies = {
  storageKind: storage.kind,
  checkRateLimit: (key) => rateLimiter.check(key, 120, 60_000),
  findItem: async (slug, itemId) => {
    const item = await db.roomItem.findFirst({
      where: { id: itemId, room: { slug } },
      select: {
        id: true,
        roomId: true,
        storageKey: true,
        availability: true,
        oneTime: true,
        accessMode: true,
        oneTimeStatus: true,
        consumeTokenHash: true,
        consumeReservedAt: true,
        encryptedSize: true,
        room: { select: { id: true, slug: true, ownerTokenHash: true, deviceApprovalRequired: true, status: true, expiresAt: true, accessVersion: true } },
      },
    });
    if (!item) return null;
    const uploadSession = await db.uploadSession.findUnique({
      where: { itemId },
      select: { status: true, storageKey: true },
    });
    return { ...item, uploadSession };
  },
  createUrl: (storageKey) => storage.getPublicOrSignedUrl(storageKey),
  authorizeDevice: async (req, item) => (await authorizeRoomDevice(req, { id: item.room.id!, slug: item.room.slug!, ownerTokenHash: item.room.ownerTokenHash!, deviceApprovalRequired: Boolean(item.room.deviceApprovalRequired), accessVersion: item.room.accessVersion ?? 1, status: item.room.status, expiresAt: item.room.expiresAt })).authorized,
};

export function createDownloadGet(
  dependencies: Dependencies = defaultDependencies,
) {
  return async function downloadGet(
    req: Request,
    { params }: { params: Promise<{ slug: string; itemId: string }> },
  ) {
    const { slug, itemId } = await params;
    if (!dependencies.checkRateLimit(`download-info:${slug}:${itemId}`))
      return NextResponse.json({ error: "Slow down" }, { status: 429 });
    const item = await dependencies.findItem(slug, itemId),
      now = new Date();
    if (item && dependencies.authorizeDevice && !(await dependencies.authorizeDevice(req, item))) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
    const consumeToken = req.headers.get("x-consume-token");
    const destructive = item ? Boolean(item.oneTime || (item.accessMode && item.accessMode !== "STANDARD")) : false;
    const oneTimeAuthorized =
      !item || !destructive ||
      (item.oneTimeStatus === "RESERVED" &&
        item.consumeReservedAt &&
        item.consumeReservedAt >
          new Date(now.getTime() - env.ONE_TIME_RESERVATION_SECONDS * 1000) &&
        tokenHash(consumeToken ?? "") === item.consumeTokenHash);
    const authorized =
      item &&
      oneTimeAuthorized &&
      item.storageKey &&
      item.availability !== "DIRECT" &&
      canAuthorizeStoredDownload(
        item.room.status,
        item.room.expiresAt,
        item.roomId,
        item.roomId,
        now,
      );
    const completedR2Upload =
      dependencies.storageKind !== "r2" ||
      (item?.uploadSession?.status === "COMPLETED" &&
        item.uploadSession.storageKey === item.storageKey);
    if (!authorized || !completedR2Upload)
      return NextResponse.json({ error: "File unavailable" }, { status: 404 });
    try {
      const source = destructive || item.room.deviceApprovalRequired
        ? `/api/rooms/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/content`
        : await dependencies.createUrl(item.storageKey!);
      const url = dependencies.storageKind === "local"
        ? `${source}${source.includes("?") ? "&" : "?"}room=${encodeURIComponent(slug)}&v=${item.room.accessVersion ?? 1}`
        : source;
      return NextResponse.json(
        {
          url,
          expiresIn: Math.min(env.STORAGE_SIGNED_URL_TTL_SECONDS, 300),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json({ error: "File unavailable" }, { status: 404 });
    }
  };
}

export const GET = createDownloadGet();
