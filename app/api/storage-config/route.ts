import { NextResponse } from "next/server";
import { env, resolveStorageRuntimeConfig } from "@/src/lib/env";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export function GET() { const config = resolveStorageRuntimeConfig(env); return NextResponse.json({ directUpload: config.directUpload, partSize: config.partSize, maxFileSize: config.maxFileSize }, { headers: { "Cache-Control": "no-store" } }); }
