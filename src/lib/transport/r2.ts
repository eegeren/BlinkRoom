import type { TemporaryTransport } from "./manager";

/** Adapter around BlinkRoom's existing multipart operation; it intentionally owns no upload logic. */
export class R2Transport implements TemporaryTransport {
  constructor(private readonly upload: (signal?: AbortSignal) => Promise<void>) {}

  send(signal?: AbortSignal) {
    return this.upload(signal);
  }
}
