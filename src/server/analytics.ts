import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/src/lib/db";
import type { TrafficSource } from "@/src/lib/analytics-acquisition";
import { trafficSourceLabels, trafficSources } from "@/src/lib/analytics-acquisition";

export type MetricEvent = "PAGE_VIEW" | "ROOM_CREATED" | "UPLOAD_COMPLETED" | "DOWNLOAD_COMPLETED" | "UPLOAD_FAILED" | "DOWNLOAD_FAILED" | "ROOM_DESTROYED";
export type AnalyticsRange = "24h" | "7d" | "30d" | "all";
type Device = "desktop" | "mobile" | "tablet";
type Browser = "chrome" | "safari" | "firefox" | "edge" | "other";
type Increment = { sessions?: bigint; pageViews?: bigint; roomsCreated?: bigint; filesUploaded?: bigint; filesDownloaded?: bigint; uploadBytes?: bigint; downloadBytes?: bigint; failedUploads?: bigint; failedDownloads?: bigint; uploadDurationMs?: bigint; downloadDurationMs?: bigint; desktopSessions?: bigint; mobileSessions?: bigint; tabletSessions?: bigint; chromeSessions?: bigint; safariSessions?: bigint; firefoxSessions?: bigint; edgeSessions?: bigint; otherBrowserSessions?: bigint };
type Bucket = Increment & { bucketStart: Date };

export const hourStart = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const productEventDedupeKey = (eventType: string, dedupeId: string) => digest(`v2:${eventType}:${dedupeId}`);
export const isCrossClientTransfer = (senderId: string, downloaderId: string) => digest(senderId) !== digest(downloaderId);
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

export type ProductEventType = "ROOM_CREATED" | "ROOM_OPENED" | "UPLOAD_STARTED" | "UPLOAD_COMPLETED" | "UPLOAD_FAILED" | "DOWNLOAD_STARTED" | "DOWNLOAD_COMPLETED" | "DOWNLOAD_FAILED";
type ProductEventInput = { eventType: ProductEventType; clientId?: string; sessionId?: string; roomId?: string; fileId?: string; attemptId?: string; bytes?: number; dedupeId: string; now?: Date };

async function diagnostic(field: "duplicateEvents" | "selfDownloadsExcluded" | "transferDeduplications", now: Date, tx?: Prisma.TransactionClient) {
  const values = { where: { bucketStart: hourStart(now) }, create: { bucketStart: hourStart(now), [field]: ONE }, update: { [field]: { increment: ONE } } };
  if (tx) await tx.analyticsDiagnosticsHourly.upsert(values); else await db.analyticsDiagnosticsHourly.upsert(values);
}

/** Inserts an analytics-v2 event exactly once. Raw identifiers never persist. */
export async function recordProductEvent(input: ProductEventInput) {
  const now = input.now ?? new Date(), dedupeKey = productEventDedupeKey(input.eventType, input.dedupeId);
  try {
    const inserted = await db.$executeRaw`INSERT INTO "AnalyticsProductEvent" ("id", "eventType", "occurredAt", "version", "clientHash", "sessionHash", "roomHash", "fileHash", "attemptHash", "bytes", "dedupeKey") VALUES (${randomUUID()}, ${input.eventType}, ${now}, 2, ${input.clientId ? digest(input.clientId) : null}, ${input.sessionId ? digest(input.sessionId) : null}, ${input.roomId ? digest(input.roomId) : null}, ${input.fileId ? digest(input.fileId) : null}, ${input.attemptId ? digest(input.attemptId) : null}, ${input.bytes == null ? null : BigInt(Math.max(0, Math.trunc(input.bytes)))}, ${dedupeKey}) ON CONFLICT ("dedupeKey") DO NOTHING`;
    if (inserted !== 1) await diagnostic("duplicateEvents", now);
    return inserted === 1;
  } catch { console.error("[ANALYTICS_ERROR] v2 event failed"); return false; }
}

export async function recordDownload(input: { eventType: "DOWNLOAD_STARTED" | "DOWNLOAD_COMPLETED" | "DOWNLOAD_FAILED"; actionId: string; roomSlug: string; itemId: string; clientId: string; durationMs?: number }, now = new Date()) {
  try { await db.$transaction(async (tx) => {
    const item = await tx.roomItem.findFirst({ where: { id: input.itemId, room: { slug: input.roomSlug } }, select: { id: true, roomId: true, senderId: true, encryptedSize: true } });
    if (!item) return;
    const roomHash = digest(item.roomId), fileHash = digest(item.id), clientHash = digest(input.clientId), attemptHash = digest(input.actionId);
    const dedupeKey = productEventDedupeKey(input.eventType, input.actionId);
    const inserted = await tx.$executeRaw`INSERT INTO "AnalyticsProductEvent" ("id", "eventType", "occurredAt", "version", "clientHash", "roomHash", "fileHash", "attemptHash", "bytes", "dedupeKey") VALUES (${randomUUID()}, ${input.eventType}, ${now}, 2, ${clientHash}, ${roomHash}, ${fileHash}, ${attemptHash}, ${input.eventType === "DOWNLOAD_COMPLETED" ? BigInt(Math.max(0, item.encryptedSize ?? 0)) : null}, ${dedupeKey}) ON CONFLICT ("dedupeKey") DO NOTHING`;
    if (inserted !== 1) { await diagnostic("duplicateEvents", now, tx); return; }
    if (input.eventType !== "DOWNLOAD_COMPLETED") return;
    if (!isCrossClientTransfer(item.senderId, input.clientId)) { await diagnostic("selfDownloadsExcluded", now, tx); return; }
    const transfer = await tx.$executeRaw`INSERT INTO "AnalyticsSuccessfulFile" ("fileHash", "roomHash", "completedAt") VALUES (${fileHash}, ${roomHash}, ${now}) ON CONFLICT ("fileHash") DO NOTHING`;
    if (transfer !== 1) await diagnostic("transferDeduplications", now, tx);
  }); } catch { console.error("[ANALYTICS_ERROR] v2 download failed"); }
}

export function classifyClient(userAgent: string): { device: Device; browser: Browser } {
  const ua = userAgent.toLowerCase();
  const device: Device = /ipad|tablet|kindle|silk/.test(ua) ? "tablet" : /mobile|iphone|android/.test(ua) ? "mobile" : "desktop";
  const browser: Browser = /edg\//.test(ua) ? "edge" : /firefox|fxios/.test(ua) ? "firefox" : /chrome|crios/.test(ua) ? "chrome" : /safari/.test(ua) ? "safari" : "other";
  return { device, browser };
}
export async function trackSessionStarted(sessionId: string, visitorId: string, source: TrafficSource, now = new Date(), client: { device: Device; browser: Browser } = { device: "desktop", browser: "other" }) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(sessionId) || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(visitorId) || !trafficSources.includes(source)) return;
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  const visitorHash = createHash("sha256").update(visitorId).digest("hex");
  try { await db.$transaction(async (tx) => {
    await tx.analyticsSessionDedupe.deleteMany({ where: { expiresAt: { lte: now } } });
    const inserted = await tx.$executeRaw`INSERT INTO "AnalyticsSessionDedupe" ("sessionHash", "expiresAt") VALUES (${sessionHash}, ${new Date(now.getTime() + 30 * 60_000)}) ON CONFLICT ("sessionHash") DO NOTHING`;
    const existing = await tx.analyticsVisitor.findUnique({ where: { visitorHash }, select: { firstSeen: true } });
    await tx.analyticsVisitor.upsert({ where: { visitorHash }, create: { visitorHash, firstSeen: now, lastSeen: now, firstSource: source }, update: { lastSeen: now } });
    await tx.analyticsVisitorDay.upsert({ where: { visitorHash_day: { visitorHash, day: dayStart(now) } }, create: { visitorHash, day: dayStart(now), returning: Boolean(existing && existing.firstSeen < dayStart(now)) }, update: {} });
    if (inserted === 1) {
      const bucketStart = hourStart(now), values = { sessions: ONE, [`${client.device}Sessions`]: ONE, [`${client.browser}Sessions`]: ONE }; await tx.analyticsHourly.upsert({ where: { bucketStart }, create: { bucketStart, ...values }, update: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { increment: value }])) });
    }
  }); } catch { console.error("[ANALYTICS_ERROR] session increment failed"); }
}

export async function trackDownloadAction(input: { successful: boolean; actionId: string; roomSlug: string; itemId: string; participantId: string; durationMs?: number }, now = new Date()) {
  const actionHash = createHash("sha256").update(input.actionId).digest("hex");
  try { await db.$transaction(async (tx) => {
    await tx.analyticsDownloadDedupe.deleteMany({ where: { expiresAt: { lte: now } } });
    const inserted = await tx.$executeRaw`INSERT INTO "AnalyticsDownloadDedupe" ("actionHash", "expiresAt") VALUES (${actionHash}, ${new Date(now.getTime() + 86_400_000)}) ON CONFLICT ("actionHash") DO NOTHING`;
    if (inserted !== 1) return;
    if (!input.successful) {
      const bucketStart = hourStart(now); await tx.analyticsHourly.upsert({ where: { bucketStart }, create: { bucketStart, failedDownloads: ONE }, update: { failedDownloads: { increment: ONE } } }); return;
    }
    const item = await tx.roomItem.findFirst({ where: { id: input.itemId, room: { slug: input.roomSlug } }, select: { roomId: true, senderId: true, encryptedSize: true } });
    if (!item) return;
    const bytes = BigInt(Math.max(0, item.encryptedSize ?? 0)), duration = BigInt(Math.max(0, Math.trunc(input.durationMs ?? 0))), bucketStart = hourStart(now);
    await tx.analyticsHourly.upsert({ where: { bucketStart }, create: { bucketStart, filesDownloaded: ONE, downloadBytes: bytes, downloadDurationMs: duration }, update: { filesDownloaded: { increment: ONE }, downloadBytes: { increment: bytes }, downloadDurationMs: { increment: duration } } });
    await tx.analyticsRecentEvent.create({ data: { event: "File Downloaded", createdAt: now } });
    if (item.senderId !== input.participantId) {
      const roomHash = createHash("sha256").update(item.roomId).digest("hex");
      await tx.analyticsSuccessfulTransfer.upsert({ where: { roomHash }, create: { roomHash, completedAt: now }, update: {} });
    }
  }); } catch { console.error("[ANALYTICS_ERROR] download action failed"); }
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

type AudienceRow = { uniqueVisitors: bigint; returningVisitors: bigint };
async function audienceFor(start: Date | undefined, end: Date) {
  const lower = start ? Prisma.sql`AND d."day" >= ${dayStart(start)}` : Prisma.empty;
  const [row] = await db.$queryRaw<AudienceRow[]>(Prisma.sql`
    SELECT COUNT(DISTINCT d."visitorHash")::bigint AS "uniqueVisitors",
      COUNT(DISTINCT d."visitorHash") FILTER (WHERE d."returning")::bigint AS "returningVisitors"
    FROM "AnalyticsVisitorDay" d WHERE d."day" <= ${dayStart(end)} ${lower}`);
  return row ?? { uniqueVisitors: ZERO, returningVisitors: ZERO };
}

async function trafficFor(start: Date | undefined, end: Date) {
  const lower = start ? Prisma.sql`AND d."day" >= ${dayStart(start)}` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ source: string; visitors: bigint }>>(Prisma.sql`
    SELECT v."firstSource" AS source, COUNT(DISTINCT d."visitorHash")::bigint AS visitors
    FROM "AnalyticsVisitorDay" d JOIN "AnalyticsVisitor" v ON v."visitorHash" = d."visitorHash"
    WHERE d."day" <= ${dayStart(end)} ${lower} GROUP BY v."firstSource"`);
  const result = Object.fromEntries(trafficSources.map(source => [trafficSourceLabels[source], 0])) as Record<string, number>;
  for (const row of rows) result[trafficSourceLabels[row.source as TrafficSource] ?? "Other"] += Number(row.visitors);
  return result;
}

type V2Stats = { roomsCreated: bigint; roomCreators: bigint; completedUploads: bigint; roomsWithUploads: bigint; recipientOpens: bigint; roomsWithRecipientOpens: bigint; downloadStarts: bigint; completedDownloads: bigint; downloadFailures: bigint; uploadFailures: bigint; uploadBytes: bigint; downloadBytes: bigint; successfulTransfers: bigint; successfulRooms: bigint; rawEvents: bigint };
async function v2Stats(start: Date | undefined, end: Date): Promise<V2Stats> {
  const lower = start ? Prisma.sql`AND "occurredAt" >= ${start}` : Prisma.empty;
  const [events] = await db.$queryRaw<Array<Omit<V2Stats, "successfulTransfers" | "successfulRooms">>>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE "eventType"='ROOM_CREATED')::bigint AS "roomsCreated",
      COUNT(DISTINCT "clientHash") FILTER (WHERE "eventType"='ROOM_CREATED')::bigint AS "roomCreators",
      COUNT(*) FILTER (WHERE "eventType"='UPLOAD_COMPLETED')::bigint AS "completedUploads",
      COUNT(DISTINCT "roomHash") FILTER (WHERE "eventType"='UPLOAD_COMPLETED')::bigint AS "roomsWithUploads",
      COUNT(*) FILTER (WHERE "eventType"='ROOM_OPENED')::bigint AS "recipientOpens",
      COUNT(DISTINCT "roomHash") FILTER (WHERE "eventType"='ROOM_OPENED')::bigint AS "roomsWithRecipientOpens",
      COUNT(*) FILTER (WHERE "eventType"='DOWNLOAD_STARTED')::bigint AS "downloadStarts",
      COUNT(*) FILTER (WHERE "eventType"='DOWNLOAD_COMPLETED')::bigint AS "completedDownloads",
      COUNT(*) FILTER (WHERE "eventType"='DOWNLOAD_FAILED')::bigint AS "downloadFailures",
      COUNT(*) FILTER (WHERE "eventType"='UPLOAD_FAILED')::bigint AS "uploadFailures",
      COALESCE(SUM("bytes") FILTER (WHERE "eventType"='UPLOAD_COMPLETED'),0)::bigint AS "uploadBytes",
      COALESCE(SUM("bytes") FILTER (WHERE "eventType"='DOWNLOAD_COMPLETED'),0)::bigint AS "downloadBytes",
      COUNT(*)::bigint AS "rawEvents"
    FROM "AnalyticsProductEvent" WHERE "version"=2 AND "occurredAt" <= ${end} ${lower}`);
  const transfers = await db.analyticsSuccessfulFile.findMany({ where: { completedAt: start ? { gte: start, lte: end } : { lte: end } }, select: { roomHash: true } });
  return { ...(events ?? { roomsCreated: ZERO, roomCreators: ZERO, completedUploads: ZERO, roomsWithUploads: ZERO, recipientOpens: ZERO, roomsWithRecipientOpens: ZERO, downloadStarts: ZERO, completedDownloads: ZERO, downloadFailures: ZERO, uploadFailures: ZERO, uploadBytes: ZERO, downloadBytes: ZERO, rawEvents: ZERO }), successfulTransfers: BigInt(transfers.length), successfulRooms: BigInt(new Set(transfers.map(x => x.roomHash)).size) };
}
async function v2Timeline(rows: Bucket[], range: AnalyticsRange, start: Date | undefined, end: Date) {
  const base = aggregateTimeline(rows, range), daily = range !== "24h";
  const map = new Map(base.map(point => [new Date(point.timestamp).getTime(), { ...point, roomsCreated: 0, filesUploaded: 0, filesDownloaded: 0, uploadBytes: "0", downloadBytes: "0", failedUploads: 0, failedDownloads: 0 }]));
  const events = await db.analyticsProductEvent.findMany({ where: { version: 2, occurredAt: start ? { gte: start, lte: end } : { lte: end } }, select: { occurredAt: true, eventType: true, bytes: true } });
  for (const event of events) {
    const key = (daily ? dayStart(event.occurredAt) : hourStart(event.occurredAt)).getTime();
    const point = map.get(key) ?? { timestamp: new Date(key).toISOString(), visits: 0, pageViews: 0, roomsCreated: 0, filesUploaded: 0, filesDownloaded: 0, uploadBytes: "0", downloadBytes: "0", failedUploads: 0, failedDownloads: 0 };
    if (event.eventType === "ROOM_CREATED") point.roomsCreated += 1;
    if (event.eventType === "UPLOAD_COMPLETED") { point.filesUploaded += 1; point.uploadBytes = (BigInt(point.uploadBytes) + (event.bytes ?? ZERO)).toString(); }
    if (event.eventType === "DOWNLOAD_COMPLETED") { point.filesDownloaded += 1; point.downloadBytes = (BigInt(point.downloadBytes) + (event.bytes ?? ZERO)).toString(); }
    if (event.eventType === "UPLOAD_FAILED") point.failedUploads += 1;
    if (event.eventType === "DOWNLOAD_FAILED") point.failedDownloads += 1;
    map.set(key, point);
  }
  return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function getAnalytics(range: AnalyticsRange, now = new Date()) {
  const start = rangeStart(range, now), priorStart = previousStart(range, start, now);
  const allRows = await db.analyticsHourly.findMany({ where: priorStart ? { bucketStart: { gte: priorStart, lte: now } } : undefined, orderBy: { bucketStart: "asc" } });
  const rows = start ? allRows.filter((row) => row.bucketStart >= start) : allRows;
  const priorRows = start && priorStart ? allRows.filter((row) => row.bucketStart >= priorStart && row.bucketStart < start) : [];
  const total = sumRows(rows), previous = sumRows(priorRows), dateWhere = start ? { gte: start, lte: now } : { lte: now };
  const [activeRooms, expiredRooms, destroyedRooms, roomLifetimes, largestFile, fileTypes, recentActivity, audience, priorAudience, trafficSourcesResult] = await Promise.all([
    db.room.count({ where: { status: "ACTIVE", destroyedAt: null, expiresAt: { gt: now } } }),
    db.room.count({ where: { status: "EXPIRED", expiresAt: dateWhere } }),
    db.room.count({ where: { status: "DESTROYED", destroyedAt: dateWhere } }),
    db.room.findMany({ where: { status: { in: ["EXPIRED", "DESTROYED"] }, OR: [{ destroyedAt: dateWhere }, { expiresAt: dateWhere }] }, select: { createdAt: true, destroyedAt: true, expiresAt: true } }),
    db.roomItem.aggregate({ where: { createdAt: dateWhere, encryptedSize: { not: null } }, _max: { encryptedSize: true } }),
    db.roomItem.groupBy({ by: ["type"], where: { createdAt: dateWhere }, _count: { _all: true } }),
    db.analyticsRecentEvent.findMany({ where: { createdAt: dateWhere }, orderBy: { createdAt: "desc" }, take: 24, select: { event: true, createdAt: true } }),
    audienceFor(start, now),
    start && priorStart ? audienceFor(priorStart, start) : Promise.resolve({ uniqueVisitors: ZERO, returningVisitors: ZERO }),
    trafficFor(start, now),
  ]);
  const averageLifetimeMs = roomLifetimes.length ? Math.round(roomLifetimes.reduce((sum, room) => sum + Math.max(0, (room.destroyedAt ?? room.expiresAt).getTime() - room.createdAt.getTime()), 0) / roomLifetimes.length) : 0;
  const [v2, priorV2, productTimeline, diagnosticRows] = await Promise.all([v2Stats(start, now), start && priorStart ? v2Stats(priorStart, start) : Promise.resolve(null), v2Timeline(rows, range, start, now), db.analyticsDiagnosticsHourly.findMany({ where: start ? { bucketStart: { gte: hourStart(start), lte: now } } : { bucketStart: { lte: now } } })]);
  const diagnostics = diagnosticRows.reduce((a, row) => ({ duplicateEvents: a.duplicateEvents + row.duplicateEvents, selfDownloadsExcluded: a.selfDownloadsExcluded + row.selfDownloadsExcluded, transferDeduplications: a.transferDeduplications + row.transferDeduplications }), { duplicateEvents: ZERO, selfDownloadsExcluded: ZERO, transferDeduplications: ZERO });
  const typeCount = Object.fromEntries(fileTypes.map((entry) => [entry.type, entry._count._all]));
  return {
    range, collectedFrom: rows[0]?.bucketStart.toISOString() ?? null,
    summary: { visits: Number(total.sessions), pageViews: Number(total.pageViews), roomsCreated: Number(v2.roomsCreated), activeRooms, filesUploaded: Number(v2.completedUploads), filesDownloaded: Number(v2.completedDownloads), recipientOpens: Number(v2.recipientOpens), successfulRooms: Number(v2.successfulRooms), uploadBytes: v2.uploadBytes.toString(), downloadBytes: v2.downloadBytes.toString(), averageFileSize: (v2.completedUploads ? v2.uploadBytes / v2.completedUploads : ZERO).toString(), failedUploads: Number(v2.uploadFailures), failedDownloads: Number(v2.downloadFailures), conversionRate: percent(v2.roomCreators, audience.uniqueVisitors) },
    comparison: { ...comparison(total, previous), roomsCreated: change(v2.roomsCreated, priorV2?.roomsCreated ?? ZERO), filesUploaded: change(v2.completedUploads, priorV2?.completedUploads ?? ZERO), filesDownloaded: change(v2.completedDownloads, priorV2?.completedDownloads ?? ZERO), uploadBytes: change(v2.uploadBytes, priorV2?.uploadBytes ?? ZERO), downloadBytes: change(v2.downloadBytes, priorV2?.downloadBytes ?? ZERO), uniqueVisitors: change(audience.uniqueVisitors, priorAudience.uniqueVisitors), returningVisitors: change(audience.returningVisitors, priorAudience.returningVisitors), successfulTransfers: change(v2.successfulTransfers, priorV2?.successfulTransfers ?? ZERO) }, hasComparison: Boolean(start),
    audience: { uniqueVisitors: Number(audience.uniqueVisitors), returningVisitors: Number(audience.returningVisitors), returningRate: percent(audience.returningVisitors, audience.uniqueVisitors) },
    successfulTransfers: { count: Number(v2.successfulTransfers), rate: percent(v2.successfulTransfers, v2.completedUploads), denominator: "completed uploaded files in the selected period" },
    conversions: { visitorToRoom: percent(v2.roomCreators, audience.uniqueVisitors), roomToUpload: percent(v2.roomsWithUploads, v2.roomsCreated), uploadToTransfer: percent(v2.successfulTransfers, v2.completedUploads), roomToTransfer: percent(v2.successfulRooms, v2.roomsCreated) },
    trafficSources: trafficSourcesResult,
    timeline: productTimeline,
    funnel: [{ label: "Unique Visitors", value: Number(audience.uniqueVisitors) }, { label: "Rooms Created", value: Number(v2.roomsCreated) }, { label: "Upload-Ready Rooms", value: Number(v2.roomsWithUploads) }, { label: "Recipient Opens", value: Number(v2.recipientOpens) }, { label: "Successful Transfers", value: Number(v2.successfulTransfers) }],
    rooms: { averageLifetimeMs, averageFilesPerRoom: v2.roomsCreated ? Number(v2.completedUploads) / Number(v2.roomsCreated) : 0, averageDownloadsPerRoom: v2.roomsCreated ? Number(v2.completedDownloads) / Number(v2.roomsCreated) : 0, expiredRooms, destroyedRooms, activeRooms },
    files: { averageFileSize: (v2.completedUploads ? v2.uploadBytes / v2.completedUploads : ZERO).toString(), largestFile: String(largestFile._max.encryptedSize ?? 0), totalFiles: Number(v2.completedUploads), averageDownloadsPerFile: v2.completedUploads ? Number(v2.completedDownloads) / Number(v2.completedUploads) : 0, uploadBytes: v2.uploadBytes.toString(), downloadBytes: v2.downloadBytes.toString(), distribution: { Images: typeCount.IMAGE ?? 0, Videos: 0, Documents: 0, Archives: 0, Other: (typeCount.FILE ?? 0) + (typeCount.TEXT ?? 0) + (typeCount.LINK ?? 0) } },
    devices: { device: { Desktop: Number(total.desktopSessions), Mobile: Number(total.mobileSessions), Tablet: Number(total.tabletSessions) }, browser: { Chrome: Number(total.chromeSessions), Safari: Number(total.safariSessions), Firefox: Number(total.firefoxSessions), Edge: Number(total.edgeSessions), Other: Number(total.otherBrowserSessions) } },
    recentActivity: recentActivity.map((event) => ({ event: event.event, timestamp: event.createdAt.toISOString() })),
    health: { uploadSuccessRate: percent(v2.completedUploads, v2.completedUploads + v2.uploadFailures), downloadSuccessRate: percent(v2.completedDownloads, v2.completedDownloads + v2.downloadFailures), failedUploads: Number(v2.uploadFailures), failedDownloads: Number(v2.downloadFailures), averageUploadDurationMs: 0, transferVolume: (v2.uploadBytes + v2.downloadBytes).toString() },
    diagnostics: { rawEvents: Number(v2.rawEvents), duplicateEventsDiscarded: Number(diagnostics.duplicateEvents), downloadStarts: Number(v2.downloadStarts), downloadCompletions: Number(v2.completedDownloads), selfDownloadsExcluded: Number(diagnostics.selfDownloadsExcluded), successfulTransferDeduplications: Number(diagnostics.transferDeduplications), uploadFailures: Number(v2.uploadFailures), downloadFailures: Number(v2.downloadFailures), analyticsVersion: 2 },
  };
}

export function safeEqual(a: string, b: string) { const aa = createHash("sha256").update(a).digest(), bb = createHash("sha256").update(b).digest(); return timingSafeEqual(aa, bb); }
export const adminCookieValue = (token: string) => createHash("sha256").update(`blinkroom:analytics-admin:${token}`).digest("base64url");
