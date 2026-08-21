import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePagePath, sizeBucket } from "../src/lib/analytics";
import { aggregateTimeline, hourStart, rangeStart, safeEqual } from "../src/server/analytics";
test("room analytics paths never contain room ids, query values, or fragments", () => { assert.equal(sanitizePagePath("/r/ABCD-12?token=nope#SECRET"), "/r/[room]"); assert.equal(sanitizePagePath("/#SECRET"), "/"); });
test("file sizes are reduced to coarse non-identifying buckets", () => { assert.equal(sizeBucket(1), "lt_10mb"); assert.equal(sizeBucket(20 * 1024 ** 2), "10_100mb"); assert.equal(sizeBucket(6 * 1024 ** 3), "gt_5gb"); });
test("analytics buckets use UTC hours and range boundaries", () => { const now = new Date("2026-08-21T12:34:56.000Z"); assert.equal(hourStart(now).toISOString(), "2026-08-21T12:00:00.000Z"); assert.equal(rangeStart("24h", now)?.toISOString(), "2026-08-20T12:34:56.000Z"); assert.equal(rangeStart("all", now), undefined); });
test("daily timeline aggregation combines atomic hourly counters", () => { const rows = [{ bucketStart: new Date("2026-08-20T01:00:00Z"), sessions: BigInt(2), pageViews: BigInt(3), uploadBytes: BigInt(10) }, { bucketStart: new Date("2026-08-20T22:00:00Z"), sessions: BigInt(1), pageViews: BigInt(4), uploadBytes: BigInt(20) }]; const timeline = aggregateTimeline(rows, "7d"); assert.equal(timeline.length, 1); assert.equal(timeline[0].visits, 3); assert.equal(timeline[0].pageViews, 7); assert.equal(timeline[0].uploadBytes, "30"); });
test("admin secret comparisons are content-safe", () => { assert.equal(safeEqual("same", "same"), true); assert.equal(safeEqual("short", "a-different-length"), false); });
