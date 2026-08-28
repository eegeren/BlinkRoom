export type DirectFile = { itemId: string; type: "IMAGE" | "FILE"; encryptedMetadata: string; encrypted: Blob };
export type DirectReceive = DirectFile & { from: string };
export type TransferProgress = { transferId: string; itemId: string; direction: "sending" | "receiving"; progress: number };
export interface DirectTransport { setPeers(ids: string[]): void; sendFile(file: DirectFile, peers: string[], signal?: AbortSignal): Promise<{ delivered: string[]; failed: string[] }>; close(): void; }

export type TransferState =
  | "idle"
  | "preparing"
  | "waiting_for_peer"
  | "connecting"
  | "direct_transfer"
  | "cloud_fallback"
  | "transferring"
  | "paused"
  | "completed"
  | "failed";

export type TransferStateChange = {
  state: TransferState;
  transport?: "direct" | "temporary";
  reason?: "unsupported" | "no_peer" | "multiple_peers" | "connection_failed";
};
