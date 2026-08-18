import { NextResponse } from "next/server";
export async function POST(req: Request) { return NextResponse.redirect(new URL("/share-target?unsupported=1", req.url), 303); }
