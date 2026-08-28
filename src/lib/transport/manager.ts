import { selectTransport } from "./selection";
import type {
  DirectFile,
  DirectTransport,
  TransferState,
  TransferStateChange,
} from "./types";

export type TemporaryTransport = {
  send(signal?: AbortSignal): Promise<void>;
};

type Options = {
  direct?: DirectTransport | null;
  maxDirectPeers: number;
  directSupported?: boolean;
  onStateChange?: (change: TransferStateChange) => void;
  onDiagnostic?: (event: string) => void;
};

export type TransferRequest = {
  file: DirectFile;
  peerIds: string[];
  temporary: TemporaryTransport;
  directOnly?: boolean;
  signal?: AbortSignal;
  completeDirect?: (deliveredPeerIds: string[]) => Promise<boolean>;
};

/** Coordinates transport policy while keeping browser and storage details isolated. */
export class TransferManager {
  private currentState: TransferState = "idle";

  constructor(private readonly options: Options) {}

  get state() {
    return this.currentState;
  }

  private transition(change: TransferStateChange) {
    this.currentState = change.state;
    this.options.onStateChange?.(change);
  }

  async transfer(request: TransferRequest): Promise<"direct" | "temporary"> {
    this.transition({ state: "preparing" });
    const supported = this.options.directSupported ??
      typeof globalThis.RTCPeerConnection !== "undefined";
    const choice = selectTransport(
      request.peerIds.length,
      this.options.maxDirectPeers,
      supported && Boolean(this.options.direct),
    );

    if (choice === "DIRECT") {
      this.transition({ state: "connecting", transport: "direct" });
      try {
        const result = await this.options.direct!.sendFile(
          request.file,
          request.peerIds,
          request.signal,
        );
        const deliveredAll = result.delivered.length === request.peerIds.length;
        const registered = deliveredAll &&
          (request.completeDirect ? await request.completeDirect(result.delivered) : true);
        if (registered) {
          this.options.onDiagnostic?.("transport_selected=direct");
          this.options.onDiagnostic?.("direct_transfer_completed");
          this.transition({ state: "completed", transport: "direct" });
          return "direct";
        }
        throw new Error("Direct transfer was not delivered to every peer");
      } catch (error) {
        if (request.signal?.aborted) {
          this.transition({ state: "failed", transport: "direct" });
          throw error;
        }
        this.options.onDiagnostic?.("direct_connection_failed");
        if (request.directOnly) {
          this.transition({ state: "failed", transport: "direct" });
          throw error;
        }
      }
    } else if (request.directOnly) {
      this.transition({ state: "failed", transport: "direct" });
      throw new Error("Direct transfer unavailable.");
    }

    const reason = !supported
      ? "unsupported"
      : request.peerIds.length === 0
        ? "no_peer"
        : request.peerIds.length > this.options.maxDirectPeers
          ? "multiple_peers"
          : "connection_failed";
    this.transition({ state: "cloud_fallback", transport: "temporary", reason });
    this.options.onDiagnostic?.("transport_selected=temporary");
    this.transition({ state: "transferring", transport: "temporary" });
    try {
      await request.temporary.send(request.signal);
      this.transition({ state: "completed", transport: "temporary" });
      return "temporary";
    } catch (error) {
      this.transition({ state: "failed", transport: "temporary" });
      throw error;
    }
  }
}
