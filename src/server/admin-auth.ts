import { cookies } from "next/headers";
import { env } from "@/src/lib/env";
import { adminCookieValue, safeEqual } from "./analytics";
export const ANALYTICS_COOKIE = "blinkroom_analytics_admin";
export function validAdminToken(token: string) { return Boolean(env.ADMIN_ANALYTICS_TOKEN && safeEqual(token, env.ADMIN_ANALYTICS_TOKEN)); }
export async function isAnalyticsAdmin(request?: Request) {
  if (!env.ADMIN_ANALYTICS_TOKEN) return false;
  const bearer = request?.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (bearer && validAdminToken(bearer)) return true;
  const value = request ? request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${ANALYTICS_COOKIE}=([^;]+)`))?.[1] : (await cookies()).get(ANALYTICS_COOKIE)?.value;
  return Boolean(value && safeEqual(value, adminCookieValue(env.ADMIN_ANALYTICS_TOKEN)));
}
