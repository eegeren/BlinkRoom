export type InstantDropTimingMark =
  | "drop_received"
  | "validation_done"
  | "shell_render_requested"
  | "shell_render_committed"
  | "room_request_started"
  | "room_response_received"
  | "route_replace_started"
  | "upload_init_started"
  | "first_upload_progress";

let startedAt = 0;
const recorded = new Map<InstantDropTimingMark, number>();

export function beginInstantDropTiming() {
  if (process.env.NODE_ENV !== "development") return;
  startedAt = performance.now();
  recorded.clear();
  markInstantDropTiming("drop_received");
}

export function markInstantDropTiming(mark: InstantDropTimingMark) {
  if (process.env.NODE_ENV !== "development" || !startedAt || recorded.has(mark)) return;
  const elapsed = performance.now() - startedAt;
  recorded.set(mark, elapsed);
  console.debug(`[INSTANT_DROP_TIMING] ${mark}: ${elapsed.toFixed(1)}ms`);
  if (mark === "first_upload_progress") {
    console.debug("[INSTANT_DROP_TIMING] complete", Object.fromEntries(recorded));
  }
}
