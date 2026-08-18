import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePagePath, sizeBucket } from "../src/lib/analytics";
test("room analytics paths never contain room ids, query values, or fragments", () => { assert.equal(sanitizePagePath("/r/ABCD-12?token=nope#SECRET"), "/r/[room]"); assert.equal(sanitizePagePath("/#SECRET"), "/"); });
test("file sizes are reduced to coarse non-identifying buckets", () => { assert.equal(sizeBucket(1), "lt_10mb"); assert.equal(sizeBucket(20 * 1024 ** 2), "10_100mb"); assert.equal(sizeBucket(6 * 1024 ** 3), "gt_5gb"); });
