import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/src/lib/db";

export type MetricEvent = "PAGE_VIEW" | "ROOM_CREATED" | "UPLOAD_COMPLETED" | "DOWNLOAD_COMPLETED" | "UPLOAD_FAILED" | "DOWNLOAD_FAILED" | "ROOM_DESTROYED";
export type AnalyticsRange = "24h" | "7d" | "30d" | "all";
type Device = "desktop" | "mobile" | "tablet";
type Browser = "chrome" | "safari" | "firefox" | "edge" | "other";
type Increment = { sessions?: bigint; pageViews?: bigint; roomsCreated?: bigint; filesUploaded?: bigint; filesDownloaded?: bigint; uploadBytes?: bigint; downloadBytes?: bigint; failedUploads?: bigint; failedDownloads?: bigint; uploadDurationMs?: bigint; downloadDurationMs?: bigint; desktopSessions?: bigint; mobileSessions?: bigint; tabletSessions?: bigint; chromeSessions?: bigint; safariSessions?: bigint; firefoxSessions?: bigint; edgeSessions?: bigint; otherBrowserSessions?: bigint };
type Bucket = Increment & { bucketStart: Date };

export const hourStart = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
const dayStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const ZERO = BigInt(0), ONE = BigInt(1), HUNDRED = BigInt(100);
const keys: (keyof Required<Increment>)[] = ["sessions","pageViews","roomsCreated","filesUploaded","filesDownloaded","uploadBytes","downloadBytes","failedUploads","failedDownloads","uploadDurationMs","downloadDurationMs","desktopSessions","mobileSessions","tabletSessions","chromeSessions","safariSessions","firefoxSessions","edgeSessions","otherBrowserSessions"];
const zeros = (): Required<Increment> => Object.fromEntries(keys.map((key) => [key, ZERO])) as Required<Increment>;
const eventLabels: Partial<Record<MetricEvent, string>> = { ROOM_CREATED: "Room Created", UPLOAD_COMPLETED: "File Uploaded", DOWNLOAD_COMPLETED: "File Downloaded", ROOM_DESTROYED: "Room Destroyed" };
const eventIncrement = (event: MetricEvent, bytes = 0, durationMs = 0): Increment => {
  const safeBytes = BigInt(Math.max(0, Math.trunc(bytes))), safeDuration = BigInt(Math.max(0, Math.trunc(durationMs)));
  switch (event) {
    case "PAGE_VIEW": return { pageViews: ONE };
    case "ROOM_CREATED": return { roomsCreated: ONE };
    case "UPLOAD_COMPLETED": return { filesUploaded: ONE, uploadBytes: safeBytes, uploadDurationMs: safeDuration };
    case "DOWNLOAD_COMPLETED": return { filesDownloaded: ONE, downloadBytes: safeBytes, downloadDurationMs: safeDuration };
    case "UPLOAD_FAILED": return { failedUploads: ONE };
    case "DOWNLOAD_FAILED": return { failedDownloads: ONE };
    case "ROOM_DESTROYED": return {};
  }
};
async function increment(values: Increment, now = new Date()) {
  const create = { bucketStart: hourStart(now), ...values };
  await db.analyticsHourly.upsert({ where: { bucketStart: create.bucketStart }, create, update: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { increment: value }])) });
}
export async function trackMetric(event: MetricEvent, options: { bytes?: number; durationMs?: number; now?: Date } = {}) {
  try {
    const now = options.now ?? new Date();
    await increment(eventIncrement(event, options.bytes, options.durationMs), now);
    const label = eventLabels[event];
    if (label) {
      await db.analyticsRecentEvent.create({ data: { event: label, createdAt: now } });
      await db.analyticsRecentEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
    }
  } catch { console.error("[ANALYTICS_ERROR] metric increment failed"); }
}

export function classifyClient(userAgent: string): { device: Device; browser: Browser } {
  const ua = userAgent.toLowerCase();
  const device: Device = /ipad|tablet|kindle|silk/.test(ua) ? "tablet" : /mobile|iphone|android/.test(ua) ? "mobile" : "desktop";
  const browser: Browser = /edg\//.test(ua) ? "edge" : /firefox|fxios/.test(ua) ? "firefox" : /chrome|crios/.test(ua) ? "chrome" : /safari/.test(ua) ? "safari" : "other";
  return { device, browser };
}
export async function trackSessionStarted(sessionId: string, now = new Date(), client: { device: Device; browser: Browser } = { device: "desktop", browser: "other" }) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(sessionId)) return;
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  try { await db.$transaction(async (tx) => {
    await tx.analyticsSessionDedupe.deleteMany({ where: { expiresAt: { lte: now } } });
    const inserted = await tx.$executeRaw`INSERT INTO "AnalyticsSessionDedupe" ("sessionHash", "expiresAt") VALUES (${sessionHash}, ${new Date(now.getTime() + 30 * 60_000)}) ON CONFLICT ("sessionHash") DO NOTHING`;
    if (inserted === 1) { const bucketStart = hourStart(now), values = { sessions: ONE, [`${client.device}Sessions`]: ONE, [`${client.browser}Sessions`]: ONE }; await tx.analyticsHourly.upsert({ where: { bucketStart }, create: { bucketStart, ...values }, update: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { increment: value }])) }); }
  }); } catch { console.error("[ANALYTICS_ERROR] session increment failed"); }
}

export function rangeStart(range: AnalyticsRange, now = new Date()) { const hours = range === "24h" ? 24 : range === "7d" ? 168 : range === "30d" ? 720 : 0; return hours ? new Date(now.getTime() - hours * 3_600_000) : undefined; }
function previousStart(range: AnalyticsRange, start: Date | undefined, now: Date) { return start ? new Date(start.getTime() - (now.getTime() - start.getTime())) : undefined; }
function sumRows(rows: Bucket[]) { return rows.reduce((sum, row) => { for (const key of keys) sum[key] += row[key] ?? ZERO; return sum; }, zeros()); }
export function aggregateTimeline(rows: Bucket[], range: AnalyticsRange) {
  const daily = range !== "24h", grouped = new Map<number, Required<Increment>>();
  for (const row of rows) { const time = (daily ? dayStart(row.bucketStart) : hourStart(row.bucketStart)).getTime(), target = grouped.get(time) ?? zeros(); for (const key of keys) target[key] += row[key] ?? ZERO; grouped.set(time, target); }
  return [...grouped].sort(([a], [b]) => a - b).map(([timestamp, value]) => ({ timestamp: new Date(timestamp).toISOString(), visits: Number(value.sessions), pageViews: Number(value.pageViews), roomsCreated: Number(value.roomsCreated), filesUploaded: Number(value.filesUploaded), filesDownloaded: Number(value.filesDownloaded), uploadBytes: value.uploadBytes.toString(), downloadBytes: value.downloadBytes.toString(), failedUploads: Number(value.failedUploads), failedDownloads: Number(value.failedDownloads) }));
}
const percent = (part: bigint, total: bigint) => total ? Math.round(Number(part * BigInt(10_000) / total)) / 100 : 0;
const change = (current: bigint, previous: bigint) => previous ? Math.round(Number((current - previous) * HUNDRED * HUNDRED / previous)) / 100 : current ? 100 : 0;
const comparison = (current: Required<Increment>, previous: Required<Increment>) => Object.fromEntries(keys.map((key) => [key, change(current[key], previous[key])])) as Record<keyof Increment, number>;

export async function getAnalytics(range: AnalyticsRange, now = new Date()) {
  const start = rangeStart(range, now), priorStart = previousStart(range, start, now);
  const allRows = await db.analyticsHourly.findMany({ where: priorStart ? { bucketStart: { gte: priorStart, lte: now } } : undefined, orderBy: { bucketStart: "asc" } });
  const rows = start ? allRows.filter((row) => row.bucketStart >= start) : allRows;
  const priorRows = start && priorStart ? allRows.filter((row) => row.bucketStart >= priorStart && row.bucketStart < start) : [];
  const total = sumRows(rows), previous = sumRows(priorRows), dateWhere = start ? { gte: start, lte: now } : { lte: now };
  const [activeRooms, expiredRooms, destroyedRooms, roomLifetimes, largestFile, fileTypes, recentActivity] = await Promise.all([
    db.room.count({ where: { status: "ACTIVE", destroyedAt: null, expiresAt: { gt: now } } }),
    db.room.count({ where: { status: "EXPIRED", expiresAt: dateWhere } }),
    db.room.count({ where: { status: "DESTROYED", destroyedAt: dateWhere } }),
    db.room.findMany({ where: { status: { in: ["EXPIRED", "DESTROYED"] }, OR: [{ destroyedAt: dateWhere }, { expiresAt: dateWhere }] }, select: { createdAt: true, destroyedAt: true, expiresAt: true } }),
    db.roomItem.aggregate({ where: { createdAt: dateWhere, encryptedSize: { not: null } }, _max: { encryptedSize: true } }),
    db.roomItem.groupBy({ by: ["type"], where: { createdAt: dateWhere }, _count: { _all: true } }),
    db.analyticsRecentEvent.findMany({ where: { createdAt: dateWhere }, orderBy: { createdAt: "desc" }, take: 24, select: { event: true, createdAt: true } }),
  ]);
  const averageLifetimeMs = roomLifetimes.length ? Math.round(roomLifetimes.reduce((sum, room) => sum + Math.max(0, (room.destroyedAt ?? room.expiresAt).getTime() - room.createdAt.getTime()), 0) / roomLifetimes.length) : 0;
  const uploadAttempts = total.filesUploaded + total.failedUploads, downloadAttempts = total.filesDownloaded + total.failedDownloads;
  const typeCount = Object.fromEntries(fileTypes.map((entry) => [entry.type, entry._count._all]));
  return {
    range, collectedFrom: rows[0]?.bucketStart.toISOString() ?? null,
    summary: { visits: Number(total.sessions), pageViews: Number(total.pageViews), roomsCreated: Number(total.roomsCreated), activeRooms, filesUploaded: Number(total.filesUploaded), filesDownloaded: Number(total.filesDownloaded), uploadBytes: total.uploadBytes.toString(), downloadBytes: total.downloadBytes.toString(), averageFileSize: (total.filesUploaded ? total.uploadBytes / total.filesUploaded : ZERO).toString(), failedUploads: Number(total.failedUploads), failedDownloads: Number(total.failedDownloads), conversionRate: percent(total.roomsCreated, total.sessions) },
    comparison: comparison(total, previous), hasComparison: Boolean(start),
    timeline: aggregateTimeline(rows, range),
    funnel: [{ label: "Visits", value: Number(total.sessions) }, { label: "Rooms Created", value: Number(total.roomsCreated) }, { label: "Files Uploaded", value: Number(total.filesUploaded) }, { label: "Files Downloaded", value: Number(total.filesDownloaded) }],
    rooms: { averageLifetimeMs, averageFilesPerRoom: total.roomsCreated ? Number(total.filesUploaded) / Number(total.roomsCreated) : 0, averageDownloadsPerRoom: total.roomsCreated ? Number(total.filesDownloaded) / Number(total.roomsCreated) : 0, expiredRooms, destroyedRooms, activeRooms },
    files: { averageFileSize: (total.filesUploaded ? total.uploadBytes / total.filesUploaded : ZERO).toString(), largestFile: String(largestFile._max.encryptedSize ?? 0), totalFiles: Number(total.filesUploaded), averageDownloadsPerFile: total.filesUploaded ? Number(total.filesDownloaded) / Number(total.filesUploaded) : 0, uploadBytes: total.uploadBytes.toString(), downloadBytes: total.downloadBytes.toString(), distribution: { Images: typeCount.IMAGE ?? 0, Videos: 0, Documents: 0, Archives: 0, Other: (typeCount.FILE ?? 0) + (typeCount.TEXT ?? 0) + (typeCount.LINK ?? 0) } },
    devices: { device: { Desktop: Number(total.desktopSessions), Mobile: Number(total.mobileSessions), Tablet: Number(total.tabletSessions) }, browser: { Chrome: Number(total.chromeSessions), Safari: Number(total.safariSessions), Firefox: Number(total.firefoxSessions), Edge: Number(total.edgeSessions), Other: Number(total.otherBrowserSessions) } },
    recentActivity: recentActivity.map((event) => ({ event: event.event, timestamp: event.createdAt.toISOString() })),
    health: { uploadSuccessRate: percent(total.filesUploaded, uploadAttempts), downloadSuccessRate: percent(total.filesDownloaded, downloadAttempts), failedUploads: Number(total.failedUploads), failedDownloads: Number(total.failedDownloads), averageUploadDurationMs: total.filesUploaded ? Number(total.uploadDurationMs / total.filesUploaded) : 0, transferVolume: (total.uploadBytes + total.downloadBytes).toString() },
  };
}

export function safeEqual(a: string, b: string) { const aa = createHash("sha256").update(a).digest(), bb = createHash("sha256").update(b).digest(); return timingSafeEqual(aa, bb); }
export const adminCookieValue = (token: string) => createHash("sha256").update(`blinkroom:analytics-admin:${token}`).digest("base64url");
