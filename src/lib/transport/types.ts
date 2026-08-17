export type DirectFile = { itemId: string; type: "IMAGE" | "FILE"; encryptedMetadata: string; encrypted: Blob };
export type DirectReceive = DirectFile & { from: string };
export type TransferProgress = { transferId: string; itemId: string; direction: "sending" | "receiving"; progress: number };
export interface DirectTransport { setPeers(ids: string[]): void; sendFile(file: DirectFile, peers: string[], signal?: AbortSignal): Promise<{ delivered: string[]; failed: string[] }>; close(): void; }
