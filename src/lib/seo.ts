import type { Metadata } from "next";
export const SITE_URL = "https://blinkroom.org";
export function seoMetadata(path: string, title: string, description: string): Metadata {
  const url = `${SITE_URL}${path}`;
  return { title, description, alternates: { canonical: path }, openGraph: { title: `${title} | BlinkRoom`, description, url, siteName: "BlinkRoom", type: "website" }, twitter: { card: "summary", title: `${title} | BlinkRoom`, description } };
}
