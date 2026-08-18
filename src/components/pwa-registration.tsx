"use client";
import { useEffect } from "react";
import { trackEvent } from "@/src/lib/analytics";
export function PwaRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const installed = () => { const ua = navigator.userAgent.toLowerCase(); trackEvent("pwa_installed", { platform_bucket: ua.includes("android") ? "android" : matchMedia("(display-mode: standalone)").matches ? "desktop" : "other" }, "appinstalled"); };
    window.addEventListener("appinstalled", installed); return () => window.removeEventListener("appinstalled", installed);
  }, []);
  return null;
}
