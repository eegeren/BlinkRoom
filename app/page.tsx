import type { Metadata } from "next";
import { HomePage } from "@/src/components/home-page";

export const metadata: Metadata = { alternates: { canonical: "/" } };
const schemas = [
  { "@context": "https://schema.org", "@type": "WebApplication", name: "BlinkRoom", url: "https://blinkroom.org", applicationCategory: "UtilitiesApplication", operatingSystem: "Web", offers: { "@type": "Offer", price: 0, priceCurrency: "USD" } },
  { "@context": "https://schema.org", "@type": "WebSite", name: "BlinkRoom", url: "https://blinkroom.org" },
];
const safeJsonLd = JSON.stringify(schemas).replace(/</g, "\\u003c");

export default function Home() { return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd }} /><HomePage /></>; }
