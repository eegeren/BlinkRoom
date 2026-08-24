export const trafficSources = ["google", "reddit", "x", "instagram", "product_hunt", "hacker_news", "direct", "other"] as const;
export type TrafficSource = (typeof trafficSources)[number];

const classify = (value: string): TrafficSource => {
  const source = value.toLowerCase().replace(/^www\./, "").replace(/[\s-]+/g, "_");
  if (source.includes("google")) return "google";
  if (source.includes("reddit")) return "reddit";
  if (source === "x" || source.includes("twitter") || source === "t.co") return "x";
  if (source.includes("instagram")) return "instagram";
  if (source.includes("producthunt") || source.includes("product_hunt")) return "product_hunt";
  if (source.includes("hackernews") || source.includes("ycombinator") || source === "hn") return "hacker_news";
  return "other";
};

export function normalizeTrafficSource(utmSource?: string | null, referrer?: string | null, origin?: string): TrafficSource {
  if (utmSource?.trim()) return classify(utmSource.trim());
  if (!referrer) return "direct";
  try {
    const referrerHost = new URL(referrer).hostname;
    if (origin && referrerHost === new URL(origin).hostname) return "direct";
    return classify(referrerHost);
  } catch { return "other"; }
}

export const trafficSourceLabels: Record<TrafficSource, string> = {
  google: "Google", reddit: "Reddit", x: "X / Twitter", instagram: "Instagram",
  product_hunt: "Product Hunt", hacker_news: "Hacker News", direct: "Direct", other: "Other",
};
