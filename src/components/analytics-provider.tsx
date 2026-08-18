"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isAnalyticsEnabled, trackPageView } from "@/src/lib/analytics";
export function AnalyticsProvider({ measurementId }: { measurementId?: string }) {
  const pathname = usePathname(), enabled = isAnalyticsEnabled() && Boolean(measurementId);
  const lastPath = useRef("");
  useEffect(() => {
    if (!enabled || !measurementId) return;
    if (!window.gtag) {
      window.dataLayer = window.dataLayer ?? [];
      window.gtag = (...args: unknown[]) => { window.dataLayer?.push(args); };
      window.gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 });
      window.gtag("js", new Date());
      window.gtag("config", measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, anonymize_ip: true });
    }
    if (!document.getElementById("blinkroom-ga4-loader")) { const script = document.createElement("script"); script.id = "blinkroom-ga4-loader"; script.async = true; script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`; document.head.appendChild(script); }
    if (lastPath.current !== pathname) { lastPath.current = pathname; trackPageView(pathname); }
  }, [enabled, measurementId, pathname]);
  return null;
}
