import type { RoomTtlHours } from "./duration";
import { generateRoomKey, importRoomKey } from "./crypto/room-key";
import { encryptJson } from "./crypto/payload";
import { trackEvent } from "./analytics";

export async function createBlinkRoom(ttlHours: RoomTtlHours) {
  const roomKey = generateRoomKey();
  const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ttlHours }) });
  if (!response.ok) throw new Error("Couldn’t create your room.");
  const { slug } = await response.json() as { slug: string };
  const key = await importRoomKey(roomKey);
  const encryptedVerifier = JSON.stringify(await encryptJson(key, { check: "blinkroom-room-key" }, `${slug}:verifier:v1`));
  const verifier = await fetch(`/api/rooms/${slug}/verifier`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ encryptionVersion: 1, encryptedVerifier }) });
  if (!verifier.ok) throw new Error("Couldn’t prepare your room.");
  trackEvent("room_created", { room_mode: "standard", duration_bucket: ttlHours === 1 ? "1h" : ttlHours === 6 ? "6h" : ttlHours === 24 ? "24h" : "custom", auto_destroy_enabled: false }, `room:${slug}`);
  return { slug, roomKey };
}
