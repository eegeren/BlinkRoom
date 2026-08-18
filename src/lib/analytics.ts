export type SizeBucket = "lt_10mb" | "10_100mb" | "100_500mb" | "500mb_1gb" | "1_5gb" | "gt_5gb";
export type Transport = "p2p" | "r2";
export type ErrorCategory = "network" | "storage" | "encryption" | "cancelled" | "timeout" | "unknown";
type Events = {
  room_created: { room_mode: "standard" | "direct_only"; duration_bucket: "1h" | "6h" | "24h" | "custom"; auto_destroy_enabled: boolean };
  invite_copied: { method: "copy_link" | "native_share" | "qr" };
  item_shared: { item_type: "file" | "image" | "text" | "link"; transport: Transport; one_time: boolean; direct_only: boolean; size_bucket?: SizeBucket };
  file_upload_started: { transport_target: Transport; size_bucket: SizeBucket; direct_only: boolean };
  file_upload_completed: { transport: Transport; size_bucket: SizeBucket; resumed: boolean; one_time: boolean };
  file_upload_failed: { transport: Transport; size_bucket: SizeBucket; error_category: ErrorCategory };
  upload_resumed: { size_bucket: SizeBucket; resume_source: "reconnect" | "manual" | "reload" };
  file_download_started: { transport: Transport; size_bucket: SizeBucket; one_time: boolean };
  file_download_completed: { transport: Transport; size_bucket: SizeBucket; one_time: boolean };
  file_download_failed: { transport: Transport; size_bucket: SizeBucket; error_category: ErrorCategory };
  one_time_file_shared: { item_type: "file" | "image"; transport: Transport };
  one_time_file_consumed: { transport: Transport };
  direct_only_enabled: Record<string, never>;
  auto_destroy_enabled: Record<string, never>;
  room_destroyed: { reason: "owner" | "auto_empty" | "expiration"; room_lifetime_bucket: "lt_10m" | "10_60m" | "1_6h" | "6_24h" | "gt_24h" };
  pwa_installed: { platform_bucket: "desktop" | "android" | "other" };
  share_target_received: { content_type: "file" | "image" | "text" | "link" | "mixed"; count_bucket: "1" | "2_5" | "gt_5" };
  successful_transfer: { transport: Transport; size_bucket: SizeBucket; direct_only: boolean; one_time: boolean };
};
export type AnalyticsEvent = keyof Events;
declare global { interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } }
const sent = new Set<string>();
function safeParams<N extends AnalyticsEvent>(name: N, raw: Events[N]): Record<string, string | boolean> {
  switch (name) {
    case "room_created": { const p = raw as Events["room_created"]; return { room_mode: p.room_mode, duration_bucket: p.duration_bucket, auto_destroy_enabled: p.auto_destroy_enabled }; }
    case "invite_copied": { const p = raw as Events["invite_copied"]; return { method: p.method }; }
    case "item_shared": { const p = raw as Events["item_shared"], safe: Record<string, string | boolean> = { item_type: p.item_type, transport: p.transport, one_time: p.one_time, direct_only: p.direct_only }; if (p.size_bucket) safe.size_bucket = p.size_bucket; return safe; }
    case "file_upload_started": { const p = raw as Events["file_upload_started"]; return { transport_target: p.transport_target, size_bucket: p.size_bucket, direct_only: p.direct_only }; }
    case "file_upload_completed": { const p = raw as Events["file_upload_completed"]; return { transport: p.transport, size_bucket: p.size_bucket, resumed: p.resumed, one_time: p.one_time }; }
    case "file_upload_failed": { const p = raw as Events["file_upload_failed"]; return { transport: p.transport, size_bucket: p.size_bucket, error_category: p.error_category }; }
    case "upload_resumed": { const p = raw as Events["upload_resumed"]; return { size_bucket: p.size_bucket, resume_source: p.resume_source }; }
    case "file_download_started": case "file_download_completed": { const p = raw as Events["file_download_started"]; return { transport: p.transport, size_bucket: p.size_bucket, one_time: p.one_time }; }
    case "file_download_failed": { const p = raw as Events["file_download_failed"]; return { transport: p.transport, size_bucket: p.size_bucket, error_category: p.error_category }; }
    case "one_time_file_shared": { const p = raw as Events["one_time_file_shared"]; return { item_type: p.item_type, transport: p.transport }; }
    case "one_time_file_consumed": { const p = raw as Events["one_time_file_consumed"]; return { transport: p.transport }; }
    case "direct_only_enabled": case "auto_destroy_enabled": return {};
    case "room_destroyed": { const p = raw as Events["room_destroyed"]; return { reason: p.reason, room_lifetime_bucket: p.room_lifetime_bucket }; }
    case "pwa_installed": { const p = raw as Events["pwa_installed"]; return { platform_bucket: p.platform_bucket }; }
    case "share_target_received": { const p = raw as Events["share_target_received"]; return { content_type: p.content_type, count_bucket: p.count_bucket }; }
    case "successful_transfer": { const p = raw as Events["successful_transfer"]; return { transport: p.transport, size_bucket: p.size_bucket, direct_only: p.direct_only, one_time: p.one_time }; }
  }
}
export function isAnalyticsEnabled() { return process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID); }
export function sanitizePagePath(path: string) { const pathname = path.split("#", 1)[0].split("?", 1)[0] || "/"; return /^\/r\/[^/]+\/?$/.test(pathname) ? "/r/[room]" : pathname; }
export function sizeBucket(bytes: number): SizeBucket { if (bytes < 10 * 1024 ** 2) return "lt_10mb"; if (bytes < 100 * 1024 ** 2) return "10_100mb"; if (bytes < 500 * 1024 ** 2) return "100_500mb"; if (bytes < 1024 ** 3) return "500mb_1gb"; if (bytes < 5 * 1024 ** 3) return "1_5gb"; return "gt_5gb"; }
export function lifetimeBucket(ms: number): Events["room_destroyed"]["room_lifetime_bucket"] { if (ms < 600_000) return "lt_10m"; if (ms < 3_600_000) return "10_60m"; if (ms < 21_600_000) return "1_6h"; if (ms < 86_400_000) return "6_24h"; return "gt_24h"; }
export function errorCategory(error: unknown): ErrorCategory { const value = error instanceof Error ? error.message.toLowerCase() : ""; if (value.includes("cancel")) return "cancelled"; if (value.includes("network") || value.includes("offline")) return "network"; if (value.includes("timeout")) return "timeout"; if (value.includes("storage") || value.includes("temporary")) return "storage"; if (value.includes("encrypt") || value.includes("decrypt")) return "encryption"; return "unknown"; }
export function trackEvent<N extends AnalyticsEvent>(name: N, params: Events[N], dedupeKey?: string) { if (!isAnalyticsEnabled()) return; const key = dedupeKey ? `${name}:${dedupeKey}` : ""; if (key && sent.has(key)) return; if (key) sent.add(key); const safe = safeParams(name, params); if (process.env.NEXT_PUBLIC_ANALYTICS_DEBUG === "true") console.debug("[analytics]", name, safe); try { window.gtag?.("event", name, safe); } catch { /* analytics never affects product flows */ } }
export function trackPageView(path: string) { if (!isAnalyticsEnabled()) return; const pagePath = sanitizePagePath(path), location = `https://blinkroom.org${pagePath}`; try { window.gtag?.("event", "page_view", { page_path: pagePath, page_location: location }); } catch { /* noop */ } }
export function setAnalyticsConsent(granted: boolean) { if (!isAnalyticsEnabled()) return; window.gtag?.("consent", "update", { analytics_storage: granted ? "granted" : "denied" }); }
