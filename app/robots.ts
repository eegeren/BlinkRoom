import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (process.env.NODE_ENV !== "production") return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/r/"] }, sitemap: "https://blinkroom.org/sitemap.xml", host: "https://blinkroom.org" };
}
