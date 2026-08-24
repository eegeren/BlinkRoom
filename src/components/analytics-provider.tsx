"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { isAnalyticsEnabled, trackPageView } from "@/src/lib/analytics";
import { normalizeTrafficSource } from "@/src/lib/analytics-acquisition";

const VISITOR_LIFETIME = 30 * 86_400_000;
function anonymousVisitor(now: number) {
  const key = "blinkroom_metrics_visitor_v1";
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as { id?: string; createdAt?: number } | null;
    if (stored?.id && stored.createdAt && now - stored.createdAt < VISITOR_LIFETIME) return stored.id;
  } catch { /* Replace malformed local-only state. */ }
  const id = crypto.randomUUID();
  localStorage.setItem(key, JSON.stringify({ id, createdAt: now }));
  return id;
}
export function AnalyticsProvider({ measurementId }: { measurementId?: string }) {
  const pathname = usePathname(), enabled = isAnalyticsEnabled() && Boolean(measurementId);
  const lastPath = useRef("");
  const metricsLastPath = useRef("");
  useEffect(() => {
    if (metricsLastPath.current === pathname) return;
    metricsLastPath.current = pathname;
    const now = Date.now(), idKey = "blinkroom_metrics_session", activityKey = "blinkroom_metrics_activity", visitorSessionKey = "blinkroom_metrics_visitor_session_v1";
    let sessionId = sessionStorage.getItem(idKey); const lastActivity = Number(sessionStorage.getItem(activityKey) ?? 0);
    if (!sessionId || !lastActivity || now - lastActivity >= 30 * 60_000) {
      sessionId = crypto.randomUUID(); sessionStorage.setItem(idKey, sessionId);
    }
    if (sessionStorage.getItem(visitorSessionKey) !== sessionId) {
      const visitorId = anonymousVisitor(now);
      const source = normalizeTrafficSource(new URLSearchParams(location.search).get("utm_source"), document.referrer, location.origin);
      void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "SESSION_STARTED", sessionId, visitorId, source }), keepalive: true });
      sessionStorage.setItem(visitorSessionKey, sessionId);
    }
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
