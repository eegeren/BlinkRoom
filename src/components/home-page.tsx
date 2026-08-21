"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, FileUp, Moon, Sun } from "lucide-react";
import { brand } from "@/src/config/brand";
import { roomDurations, type RoomTtlHours } from "@/src/lib/duration";
import { generateRoomKey, importRoomKey } from "@/src/lib/crypto/room-key";
import { encryptJson } from "@/src/lib/crypto/payload";
import { useTheme } from "@/src/components/theme-provider";
import { trackEvent } from "@/src/lib/analytics";
import { clearPendingRoomUpload, setPendingRoomUpload } from "@/src/lib/pending-room-upload";
import { uploadBatchValidationError } from "@/src/lib/upload-validation";
import { filesFromDropSnapshot, snapshotDrop, type DropSnapshot } from "@/src/lib/drop-files";

export function HomePage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [ttlHours, setTtlHours] = useState<RoomTtlHours>(24);
  const [lifetimeOpen, setLifetimeOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [instantPreparing, setInstantPreparing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const creating = useRef(false);
  const validatingDrop = useRef(false);
  const dragDepth = useRef(0);
  const splitRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  function showError(message: string) {
    setFeedback(message);
    setTimeout(() => setFeedback(""), 2400);
  }
  async function createRoom(files: File[] = []) {
    if (creating.current) return;
    creating.current = true;
    setLoading(true);
    setInstantPreparing(files.length > 0);
    setLifetimeOpen(false);
    clearPendingRoomUpload();
    try {
      const roomKey = generateRoomKey();
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlHours }),
      });
      if (!res.ok) throw new Error("Couldn’t create your room.");
      const data = (await res.json()) as { slug: string };
      const key = await importRoomKey(roomKey);
      const encryptedVerifier = JSON.stringify(await encryptJson(key, { check: "blinkroom-room-key" }, `${data.slug}:verifier:v1`));
      const verifier = await fetch(`/api/rooms/${data.slug}/verifier`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ encryptionVersion: 1, encryptedVerifier }) });
      if (!verifier.ok) throw new Error("Couldn’t prepare your room.");
      if (files.length) setPendingRoomUpload(data.slug, files);
      trackEvent("room_created", { room_mode: "standard", duration_bucket: ttlHours === 1 ? "1h" : ttlHours === 6 ? "6h" : ttlHours === 24 ? "24h" : "custom", auto_destroy_enabled: false }, `room:${data.slug}`);
      router.push(`/r/${data.slug}#${roomKey}`);
      return;
    } catch (cause) {
      clearPendingRoomUpload();
      showError(cause instanceof Error ? cause.message : "Couldn’t create your room.");
    }
    creating.current = false;
    setLoading(false);
    setInstantPreparing(false);
  }
  async function createRoomFromDrop(snapshot: DropSnapshot) {
    if (creating.current || validatingDrop.current) return;
    validatingDrop.current = true;
    try {
      const files = await filesFromDropSnapshot(snapshot);
      if (!files.length) throw new Error("Nothing to upload.");
      // Empty files can be rejected synchronously, before config or room APIs.
      const basicError = uploadBatchValidationError(files, Number.POSITIVE_INFINITY);
      if (basicError) { showError(basicError); return; }
      const response = await fetch("/api/storage-config", { cache: "no-store" });
      if (!response.ok) throw new Error("Couldn’t prepare your upload.");
      const config = await response.json() as { maxFileSize: number };
      const validationError = uploadBatchValidationError(files, config.maxFileSize);
      if (validationError) { showError(validationError); return; }
      await createRoom(files);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : "Couldn’t prepare your upload.");
    } finally {
      validatingDrop.current = false;
    }
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
  useEffect(() => {
    const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => { if (!isFileDrag(event) || creating.current) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); };
    const over = (event: DragEvent) => { if (isFileDrag(event)) event.preventDefault(); };
    const leave = (event: DragEvent) => { if (!isFileDrag(event) && !dragDepth.current) return; event.preventDefault(); dragDepth.current = event.relatedTarget ? Math.max(0, dragDepth.current - 1) : 0; if (!dragDepth.current) setDragging(false); };
    const drop = (event: DragEvent) => { if (!isFileDrag(event)) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); if (creating.current || validatingDrop.current || !event.dataTransfer) return; const snapshot = snapshotDrop(event.dataTransfer); if (snapshot.files.length || snapshot.items.length) void createRoomFromDrop(snapshot); };
    window.addEventListener("dragenter", enter); window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); };
  });
  return (
    <main className="home">
      {(dragging || instantPreparing) && <div className={`global-drop-overlay${instantPreparing ? " preparing" : ""}`} role="status" aria-live="polite"><FileUp /><h2>{instantPreparing ? "Preparing your room…" : "Drop it"}</h2>{!instantPreparing && <p>to share instantly</p>}</div>}
      {feedback && <div className="feedback-toast"><span>{feedback}</span></div>}
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
            onClick={() => void createRoom()}
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
