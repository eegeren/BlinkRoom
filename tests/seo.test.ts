import test from "node:test";
import assert from "node:assert/strict";
import sitemap from "../app/sitemap";
import { productionRobots } from "../app/robots";
import { metadata as roomMetadata } from "../app/r/[slug]/layout";
import { metadata as adminMetadata } from "../app/admin/analytics/page";
import { faqStructuredData } from "../src/components/seo-landing";
import { seoMetadata } from "../src/lib/seo";
import nextConfig from "../next.config";

const pages = [
  ["/encrypted-file-sharing", "Encrypted File Sharing", "Encrypted files before upload."],
  ["/temporary-file-sharing", "Temporary File Sharing", "Rooms expire on schedule."],
  ["/send-files-without-signup", "Send Files Without Signup", "No registration required."],
  ["/private-file-sharing", "Private File Sharing", "Privacy boundaries explained."],
  ["/secure-file-sharing", "Secure File Sharing", "Secure sharing through temporary rooms."],
] as const;

test("SEO landing metadata has unique titles, descriptions and self canonicals", () => {
  const metadata = pages.map(([path, title, description]) => seoMetadata(path, title, description));
  assert.equal(new Set(metadata.map((item) => item.title)).size, 5);
  assert.equal(new Set(metadata.map((item) => item.description)).size, 5);
  metadata.forEach((item, index) => assert.equal(item.alternates?.canonical, pages[index][0]));
});

test("sitemap contains public SEO pages and no private room routes", () => {
  const urls = sitemap().map((entry) => entry.url);
  for (const [path] of pages) assert.ok(urls.includes(`https://blinkroom.org${path}`));
  assert.equal(urls.includes("https://blinkroom.org/wetransfer-alternative"), false);
  assert.equal(urls.some((url) => url.includes("/r/")), false);
});

test("legacy comparison URL permanently redirects to secure file sharing", async () => {
  const redirects = await nextConfig.redirects?.();
  assert.ok(redirects?.some((redirect) => redirect.source === "/wetransfer-alternative" && redirect.destination === "/secure-file-sharing" && redirect.permanent));
});

test("production robots excludes private and internal surfaces", () => {
  const rules = productionRobots().rules;
  assert.ok(!Array.isArray(rules));
  assert.deepEqual(rules.disallow, ["/api/", "/r/", "/admin/", "/share-inbox", "/share-target"]);
});

test("room and admin metadata are noindex", () => {
  assert.equal(roomMetadata.robots && typeof roomMetadata.robots === "object" && roomMetadata.robots.index, false);
  assert.equal(adminMetadata.robots && typeof adminMetadata.robots === "object" && adminMetadata.robots.index, false);
});

test("FAQ structured data is valid and contains no fabricated ratings", () => {
  const schema = faqStructuredData([{ question: "Do I need an account?", answer: "No." }]);
  const serialized = JSON.stringify(schema);
  assert.equal(JSON.parse(serialized)["@type"], "FAQPage");
  assert.equal(serialized.includes("AggregateRating"), false);
});
