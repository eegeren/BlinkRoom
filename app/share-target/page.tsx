"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  readSharedInbox,
  clearSharedInbox,
  type SharedInbox,
} from "@/src/lib/share-inbox";
import { generateRoomKey, importRoomKey } from "@/src/lib/crypto/room-key";
import { encryptJson } from "@/src/lib/crypto/payload";
import { trackEvent } from "@/src/lib/analytics";
export default function ShareTargetPage() {
  const router = useRouter(),
    [inbox, setInbox] = useState<SharedInbox | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void readSharedInbox().then((value) => {
      setInbox(value);
      if (!value) return;
      const imagesOnly = value.files.length > 0 && value.files.every((file) => file.type.startsWith("image/"));
      const hasFiles = value.files.length > 0, hasText = Boolean(value.text.trim());
      trackEvent("share_target_received", { content_type: hasFiles && hasText ? "mixed" : imagesOnly ? "image" : hasFiles ? "file" : /^https?:\/\//.test(value.text.trim()) ? "link" : "text", count_bucket: value.files.length <= 1 ? "1" : value.files.length <= 5 ? "2_5" : "gt_5" }, `share-target:${value.createdAt}`);
    });
  }, []);
  async function accept() {
    if (!inbox || busy) return;
    setBusy(true);
    const roomKey = generateRoomKey(),
      response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlHours: 24 }),
      });
    if (!response.ok) {
      setBusy(false);
      return;
    }
    const { slug } = (await response.json()) as { slug: string },
      key = await importRoomKey(roomKey),
      encryptedVerifier = JSON.stringify(
        await encryptJson(
          key,
          { check: "blinkroom-room-key" },
          `${slug}:verifier:v1`,
        ),
      );
    const verified = await fetch(`/api/rooms/${slug}/verifier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptionVersion: 1, encryptedVerifier }),
    });
    if (verified.ok) { trackEvent("room_created", { room_mode: "standard", duration_bucket: "24h", auto_destroy_enabled: false }, `room:${slug}`); router.replace(`/r/${slug}#${roomKey}`); }
    else setBusy(false);
  }
  return (
    <main className="state-screen">
      <div>
        <span className="wordmark">
          BlinkRoom
          <i />
        </span>
        <h1>Ready to share.</h1>
        <p>
          {inbox
            ? `${inbox.files.length} file${inbox.files.length === 1 ? "" : "s"}${inbox.text ? " and text" : ""} will be added to a new temporary room after you confirm.`
            : "No incoming shared content was found."}
        </p>
        {inbox && (
          <div className="modal-actions">
            <button
              className="button"
              onClick={() =>
                void clearSharedInbox().then(() => router.replace("/"))
              }
            >
              Cancel
            </button>
            <button className="button filled" disabled={busy} onClick={accept}>
              {busy ? "Creating…" : "Create room & share"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
