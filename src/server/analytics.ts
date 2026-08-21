import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/src/lib/db";

export type MetricEvent =
  | "PAGE_VIEW" | "ROOM_CREATED" | "UPLOAD_COMPLETED" | "DOWNLOAD_COMPLETED"
  | "UPLOAD_FAILED" | "DOWNLOAD_FAILED";
export type AnalyticsRange = "24h" | "7d" | "30d" | "all";
type Increment = { sessions?: bigint; pageViews?: bigint; roomsCreated?: bigint; filesUploaded?: bigint; filesDownloaded?: bigint; uploadBytes?: bigint; downloadBytes?: bigint; failedUploads?: bigint; failedDownloads?: bigint };
type Bucket = Increment & { bucketStart: Date };

export const hourStart = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
const dayStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const ZERO = BigInt(0), ONE = BigInt(1), TEN_THOUSAND = BigInt(10_000);
const zeros = (): Required<Increment> => ({ sessions: ZERO, pageViews: ZERO, roomsCreated: ZERO, filesUploaded: ZERO, filesDownloaded: ZERO, uploadBytes: ZERO, downloadBytes: ZERO, failedUploads: ZERO, failedDownloads: ZERO });
const eventIncrement = (event: MetricEvent, bytes = 0): Increment => {
  const safeBytes = BigInt(Math.max(0, Math.trunc(bytes)));
  switch (event) {
    case "PAGE_VIEW": return { pageViews: ONE };
    case "ROOM_CREATED": return { roomsCreated: ONE };
    case "UPLOAD_COMPLETED": return { filesUploaded: ONE, uploadBytes: safeBytes };
    case "DOWNLOAD_COMPLETED": return { filesDownloaded: ONE, downloadBytes: safeBytes };
    case "UPLOAD_FAILED": return { failedUploads: ONE };
    case "DOWNLOAD_FAILED": return { failedDownloads: ONE };
  }
};

async function increment(values: Increment, now = new Date()) {
  const create = { bucketStart: hourStart(now), ...values };
  await db.analyticsHourly.upsert({ where: { bucketStart: create.bucketStart }, create, update: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { increment: value }])) });
}

export async function trackMetric(event: MetricEvent, options: { bytes?: number; now?: Date } = {}) {
  try { await increment(eventIncrement(event, options.bytes), options.now); }
  catch { console.error("[ANALYTICS_ERROR] metric increment failed"); }
}

export async function trackSessionStarted(sessionId: string, now = new Date()) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(sessionId)) return;
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  try {
    await db.$transaction(async (tx) => {
      await tx.analyticsSessionDedupe.deleteMany({ where: { expiresAt: { lte: now } } });
      const inserted = await tx.$executeRaw`INSERT INTO "AnalyticsSessionDedupe" ("sessionHash", "expiresAt") VALUES (${sessionHash}, ${new Date(now.getTime() + 30 * 60_000)}) ON CONFLICT ("sessionHash") DO NOTHING`;
      if (inserted === 1) {
        const bucketStart = hourStart(now);
        await tx.analyticsHourly.upsert({ where: { bucketStart }, create: { bucketStart, sessions: ONE }, update: { sessions: { increment: ONE } } });
      }
    });
  } catch { console.error("[ANALYTICS_ERROR] session increment failed"); }
}

export function rangeStart(range: AnalyticsRange, now = new Date()) { const hours = range === "24h" ? 24 : range === "7d" ? 168 : range === "30d" ? 720 : 0; return hours ? new Date(now.getTime() - hours * 3_600_000) : undefined; }
export function aggregateTimeline(rows: Bucket[], range: AnalyticsRange) {
  const daily = range !== "24h", grouped = new Map<number, Required<Increment>>();
  for (const row of rows) { const time = (daily ? dayStart(row.bucketStart) : hourStart(row.bucketStart)).getTime(), target = grouped.get(time) ?? zeros(); for (const key of Object.keys(target) as (keyof Increment)[]) target[key] += row[key] ?? ZERO; grouped.set(time, target); }
  return [...grouped].sort(([a], [b]) => a - b).map(([timestamp, value]) => ({ timestamp: new Date(timestamp).toISOString(), visits: Number(value.sessions), pageViews: Number(value.pageViews), roomsCreated: Number(value.roomsCreated), filesUploaded: Number(value.filesUploaded), filesDownloaded: Number(value.filesDownloaded), uploadBytes: value.uploadBytes.toString(), downloadBytes: value.downloadBytes.toString(), failedUploads: Number(value.failedUploads), failedDownloads: Number(value.failedDownloads) }));
}
export async function getAnalytics(range: AnalyticsRange, now = new Date()) {
  const start = rangeStart(range, now), rows = await db.analyticsHourly.findMany({ where: start ? { bucketStart: { gte: start } } : undefined, orderBy: { bucketStart: "asc" } });
  const total = rows.reduce((sum, row) => { for (const key of Object.keys(sum) as (keyof Increment)[]) sum[key] += row[key]; return sum; }, zeros());
  const activeRooms = await db.room.count({ where: { status: "ACTIVE", destroyedAt: null, expiresAt: { gt: now } } });
  return { range, collectedFrom: rows[0]?.bucketStart.toISOString() ?? null, summary: { visits: Number(total.sessions), pageViews: Number(total.pageViews), roomsCreated: Number(total.roomsCreated), activeRooms, filesUploaded: Number(total.filesUploaded), filesDownloaded: Number(total.filesDownloaded), uploadBytes: total.uploadBytes.toString(), downloadBytes: total.downloadBytes.toString(), averageFileSize: (total.filesUploaded ? total.uploadBytes / total.filesUploaded : ZERO).toString(), failedUploads: Number(total.failedUploads), failedDownloads: Number(total.failedDownloads), conversionRate: total.sessions ? Math.round(Number(total.roomsCreated * TEN_THOUSAND / total.sessions)) / 100 : 0 }, timeline: aggregateTimeline(rows, range) };
}

export function safeEqual(a: string, b: string) { const aa = createHash("sha256").update(a).digest(), bb = createHash("sha256").update(b).digest(); return timingSafeEqual(aa, bb); }
export const adminCookieValue = (token: string) => createHash("sha256").update(`blinkroom:analytics-admin:${token}`).digest("base64url");
