import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (process.env.NODE_ENV !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return productionRobots();
}
export function productionRobots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/r/", "/admin/", "/share-inbox", "/share-target"] }, sitemap: "https://blinkroom.org/sitemap.xml", host: "https://blinkroom.org" }; }
