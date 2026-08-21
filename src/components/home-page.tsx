"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Check, ChevronDown, FileUp, Moon, Sun } from "lucide-react";
import { brand } from "@/src/config/brand";
import { roomDurations, type RoomTtlHours } from "@/src/lib/duration";
import { useTheme } from "@/src/components/theme-provider";
import { clearPendingRoomUpload, setPendingRoomUpload } from "@/src/lib/pending-room-upload";
import { uploadBatchValidationError } from "@/src/lib/upload-validation";
import { filesFromDropSnapshot, snapshotDrop, type DropSnapshot } from "@/src/lib/drop-files";
import { createBlinkRoom } from "@/src/lib/create-room";
import { preparePendingRoomCreation } from "@/src/lib/pending-room-creation";

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
  const storageConfigRequest = useRef<Promise<{ maxFileSize: number }> | null>(null);
  const dragDepth = useRef(0);
  const splitRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  function showError(message: string) {
    setFeedback(message);
    setTimeout(() => setFeedback(""), 2400);
  }
  function getStorageConfig() {
    if (!storageConfigRequest.current) {
      storageConfigRequest.current = fetch("/api/storage-config", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Couldn’t prepare your upload.");
          return response.json() as Promise<{ maxFileSize: number }>;
        })
        .catch((cause) => {
          storageConfigRequest.current = null;
          throw cause;
        });
    }
    return storageConfigRequest.current;
  }
  async function createRoom(files: File[] = []) {
    if (creating.current) return;
    creating.current = true;
    setLoading(true);
    setInstantPreparing(files.length > 0);
    setLifetimeOpen(false);
    clearPendingRoomUpload();
    try {
      const data = await createBlinkRoom(ttlHours);
      if (files.length) setPendingRoomUpload(data.slug, files);
      router.push(`/r/${data.slug}#${data.roomKey}`);
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
      const config = await getStorageConfig();
      const validationError = uploadBatchValidationError(files, config.maxFileSize);
      if (validationError) { showError(validationError); return; }
      creating.current = true;
      preparePendingRoomCreation(files, ttlHours);
      router.push("/preparing-room");
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
    router.prefetch("/preparing-room");
    void getStorageConfig().catch(() => undefined);
  }, [router]);
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
        <nav className="home-seo-links" aria-label="Explore BlinkRoom">
          <Link href="/encrypted-file-sharing">Encrypted</Link>
          <Link href="/temporary-file-sharing">Temporary</Link>
          <Link href="/send-files-without-signup">No signup</Link>
          <Link href="/private-file-sharing">Private</Link>
          <Link href="/secure-file-sharing">Secure sharing</Link>
        </nav>
        <span>Private by default · Gone by design</span>
      </footer>
    </main>
  );
}
