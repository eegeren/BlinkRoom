import { NextResponse } from "next/server";
import { db } from "@/src/lib/db";
import { storage } from "@/src/server/storage";
export async function GET() { try { await db.$queryRaw`SELECT 1`; return NextResponse.json({ status: "ok", database: "ok", storage: storage.kind === "r2" ? "configured" : "local" }); } catch { return NextResponse.json({ status: "degraded", database: "unavailable", storage: "unknown" }, { status: 503 }); } }
