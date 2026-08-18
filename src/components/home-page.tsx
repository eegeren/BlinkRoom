"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, Moon, Sun } from "lucide-react";
import { brand } from "@/src/config/brand";
import { roomDurations, type RoomTtlHours } from "@/src/lib/duration";
import { generateRoomKey, importRoomKey } from "@/src/lib/crypto/room-key";
import { encryptJson } from "@/src/lib/crypto/payload";
import { useTheme } from "@/src/components/theme-provider";
import { trackEvent } from "@/src/lib/analytics";

export function HomePage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [ttlHours, setTtlHours] = useState<RoomTtlHours>(24);
  const [lifetimeOpen, setLifetimeOpen] = useState(false);
  const creating = useRef(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  async function createRoom() {
    if (creating.current) return;
    creating.current = true;
    setLoading(true);
    setLifetimeOpen(false);
    const roomKey = generateRoomKey();
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlHours }),
    });
    if (res.ok) {
      const data = (await res.json()) as { slug: string };
      const key = await importRoomKey(roomKey);
      const encryptedVerifier = JSON.stringify(
        await encryptJson(
          key,
          { check: "blinkroom-room-key" },
          `${data.slug}:verifier:v1`,
        ),
      );
      const verifier = await fetch(`/api/rooms/${data.slug}/verifier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryptionVersion: 1, encryptedVerifier }),
      });
      if (verifier.ok) {
        trackEvent("room_created", { room_mode: "standard", duration_bucket: ttlHours === 1 ? "1h" : ttlHours === 6 ? "6h" : ttlHours === 24 ? "24h" : "custom", auto_destroy_enabled: false }, `room:${data.slug}`);
        router.push(`/r/${data.slug}#${roomKey}`);
        return;
      }
    }
    creating.current = false;
    setLoading(false);
  }
  function selectDuration(hours: RoomTtlHours) {
    setTtlHours(hours);
    setLifetimeOpen(false);
  }
  function moveOption(index: number, direction: 1 | -1) {
    const next =
      (index + direction + roomDurations.length) % roomDurations.length;
    optionRefs.current[next]?.focus();
  }
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!splitRef.current?.contains(event.target as Node))
        setLifetimeOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLifetimeOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <main className="home">
      <nav className="landing-nav">
        <Link className="wordmark" href="/">
          {brand.name}
          <i />
        </Link>
        <button
          className="icon-button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </button>
      </nav>
      <section className="hero">
        <div className="eyebrow">
          <span className="live-dot" /> Temporary spaces for instant sharing
        </div>
        <h1>
          Share anything.
          <br />
          <em>Instantly.</em>
        </h1>
        <p>
          Create a temporary room and share files, text, images and links in
          real time. No account required.
        </p>
        <div className="split-cta" ref={splitRef}>
          <button
            className="create-room-action"
            onClick={createRoom}
            disabled={loading}
            aria-label="Create a room"
          >
            <span>{loading ? "Creating room…" : "Create a Room"}</span>
          </button>
          <button
            className="duration-trigger"
            type="button"
            onClick={() => setLifetimeOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setLifetimeOpen(true);
                queueMicrotask(() =>
                  optionRefs.current[
                    roomDurations.findIndex((item) => item.hours === ttlHours)
                  ]?.focus(),
                );
              }
            }}
            disabled={loading}
            aria-label="Choose room lifetime"
            aria-haspopup="menu"
            aria-expanded={lifetimeOpen}
          >
            <ArrowUpRight />
            <ChevronDown className="duration-chevron" />
          </button>
          {lifetimeOpen && (
            <div
              className="duration-popover"
              role="menu"
              aria-label="Room lifetime"
            >
              {roomDurations.map((duration, index) => (
                <button
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  key={duration.hours}
                  role="menuitemradio"
                  aria-checked={ttlHours === duration.hours}
                  onClick={() => selectDuration(duration.hours)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      moveOption(index, 1);
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      moveOption(index, -1);
                    }
                  }}
                >
                  <span>{duration.label}</span>
                  {ttlHours === duration.hours && <Check />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="trust-row">
          {["No account", "No app", "Temporary", "Cross-platform"].map((x) => (
            <span key={x}>
              <Check />
              {x}
            </span>
          ))}
        </div>
      </section>
      <footer>
        <span>{brand.tagline}</span>
        <span>Private by default · Gone by design</span>
      </footer>
    </main>
  );
}
