import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTrafficSource } from "../src/lib/analytics-acquisition";

test("UTM source takes priority and is reduced to an allowed category", () => {
  assert.equal(normalizeTrafficSource("reddit", "https://google.com/search", "https://blinkroom.org"), "reddit");
  assert.equal(normalizeTrafficSource("newsletter", null, "https://blinkroom.org"), "other");
});

test("referrers are classified by hostname without returning their URL", () => {
  assert.equal(normalizeTrafficSource(null, "https://news.ycombinator.com/item?id=private", "https://blinkroom.org"), "hacker_news");
  assert.equal(normalizeTrafficSource(null, "https://blinkroom.org/security", "https://blinkroom.org"), "direct");
  assert.equal(normalizeTrafficSource(null, null, "https://blinkroom.org"), "direct");
});
