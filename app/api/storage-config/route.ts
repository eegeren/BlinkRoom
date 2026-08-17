import { NextResponse } from "next/server";
import { env } from "@/src/lib/env";
export function GET() { return NextResponse.json({ directUpload: env.STORAGE_PROVIDER === "r2", partSize: 10 * 1024 * 1024, maxFileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024 }); }
