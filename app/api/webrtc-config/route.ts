import { NextResponse } from "next/server";
import { env } from "@/src/lib/env";

const urls = (value: string) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
export function GET() {
  const iceServers: RTCIceServer[] = [];
  const stun = urls(env.WEBRTC_STUN_URLS); if (stun.length) iceServers.push({ urls: stun });
  const turn = urls(env.WEBRTC_TURN_URLS); if (turn.length && env.WEBRTC_TURN_USERNAME && env.WEBRTC_TURN_CREDENTIAL) iceServers.push({ urls: turn, username: env.WEBRTC_TURN_USERNAME, credential: env.WEBRTC_TURN_CREDENTIAL });
  return NextResponse.json({ iceServers, connectionTimeoutMs: env.DIRECT_CONNECTION_TIMEOUT_MS, maxDirectPeers: env.MAX_DIRECT_PEERS }, { headers: { "Cache-Control": "private, max-age=300" } });
}
