"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { createBlinkRoom } from "@/src/lib/create-room";

export function SeoCreateRoom() {
  const router = useRouter(), [loading, setLoading] = useState(false), [error, setError] = useState("");
  async function create() { if (loading) return; setLoading(true); setError(""); try { const room = await createBlinkRoom(24); router.push(`/r/${room.slug}#${room.roomKey}`); } catch { setError("Couldn’t create your room. Try again."); setLoading(false); } }
  return <div className="seo-cta-wrap"><button className="primary-cta" onClick={() => void create()} disabled={loading}><span>{loading ? "Creating room…" : "Create a Room"}</span><ArrowUpRight /></button>{error && <small role="alert">{error}</small>}</div>;
}
