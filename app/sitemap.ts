import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: "https://blinkroom.org", changeFrequency: "weekly", priority: 1 }];
}
