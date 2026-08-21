import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    ["", 1],
    ["/encrypted-file-sharing", 0.8],
    ["/temporary-file-sharing", 0.8],
    ["/send-files-without-signup", 0.9],
    ["/private-file-sharing", 0.8],
    ["/secure-file-sharing", 0.8],
  ] as const;
  return pages.map(([path, priority]) => ({ url: `https://blinkroom.org${path}`, changeFrequency: "weekly" as const, priority }));
}
