import { NextResponse } from "next/server";
import { adminCookieValue } from "@/src/server/analytics";
import { ANALYTICS_COOKIE, validAdminToken } from "@/src/server/admin-auth";
import { env } from "@/src/lib/env";
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string" || !validAdminToken(body.token)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ANALYTICS_COOKIE, adminCookieValue(env.ADMIN_ANALYTICS_TOKEN!), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
  return response;
}
export async function DELETE() { const response = NextResponse.json({ ok: true }); response.cookies.set(ANALYTICS_COOKIE, "", { httpOnly: true, expires: new Date(0), path: "/" }); return response; }
