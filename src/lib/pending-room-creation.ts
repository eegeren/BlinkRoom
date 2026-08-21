import type { RoomTtlHours } from "./duration";
import { createBlinkRoom } from "./create-room";

type CreatedRoom = Awaited<ReturnType<typeof createBlinkRoom>>;
type PendingRoomCreation = { files: File[]; ttlHours: RoomTtlHours; createdAt: number; creationPromise: Promise<CreatedRoom> | null };
let pending: PendingRoomCreation | null = null;

export function preparePendingRoomCreation(files: File[], ttlHours: RoomTtlHours) {
  pending = { files: [...files], ttlHours, createdAt: Date.now(), creationPromise: null };
}
export function getPendingRoomCreation() {
  if (pending && Date.now() - pending.createdAt <= 5 * 60_000) return pending;
  pending = null;
  return null;
}
export function startPendingRoomCreation(create: typeof createBlinkRoom = createBlinkRoom) {
  const current = getPendingRoomCreation();
  if (!current) return null;
  if (!current.creationPromise) current.creationPromise = create(current.ttlHours);
  return current.creationPromise;
}
export function retryPendingRoomCreation() {
  const current = getPendingRoomCreation();
  if (!current) return null;
  current.creationPromise = null;
  return startPendingRoomCreation();
}
export function clearPendingRoomCreation() { pending = null; }
