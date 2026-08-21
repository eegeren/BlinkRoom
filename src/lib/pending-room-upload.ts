type PendingRoomUpload = { slug: string; files: File[]; createdAt: number };

let pending: PendingRoomUpload | null = null;

// File objects cannot be serialized safely. App Router navigation keeps this
// module alive, so the handoff remains in memory and intentionally does not
// survive a reload or create a plaintext copy in persistent browser storage.
export function setPendingRoomUpload(slug: string, files: File[]) {
  pending = { slug, files: [...files], createdAt: Date.now() };
}

export function takePendingRoomUpload(slug: string) {
  const current = pending;
  pending = null;
  if (!current || current.slug !== slug || Date.now() - current.createdAt > 5 * 60_000) return [];
  return current.files;
}

export function clearPendingRoomUpload() { pending = null; }
