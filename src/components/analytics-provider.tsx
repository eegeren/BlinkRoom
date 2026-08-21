"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isAnalyticsEnabled, trackPageView } from "@/src/lib/analytics";
export function AnalyticsProvider({ measurementId }: { measurementId?: string }) {
  const pathname = usePathname(), enabled = isAnalyticsEnabled() && Boolean(measurementId);
  const lastPath = useRef("");
  const metricsLastPath = useRef("");
  useEffect(() => {
    if (metricsLastPath.current === pathname) return;
    metricsLastPath.current = pathname;
    const now = Date.now(), idKey = "blinkroom_metrics_session", activityKey = "blinkroom_metrics_activity";
    let sessionId = sessionStorage.getItem(idKey); const lastActivity = Number(sessionStorage.getItem(activityKey) ?? 0);
    if (!sessionId || !lastActivity || now - lastActivity >= 30 * 60_000) { sessionId = crypto.randomUUID(); sessionStorage.setItem(idKey, sessionId); void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "SESSION_STARTED", sessionId }), keepalive: true }); }
    sessionStorage.setItem(activityKey, String(now));
    void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "PAGE_VIEW" }), keepalive: true });
  }, [pathname]);
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
