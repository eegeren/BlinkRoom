export const TRANSFER_PROTOCOL_VERSION = 1;
export const NETWORK_CHUNK_BYTES = 64 * 1024;
export type TransferControl =
  | { kind: "TRANSFER_START"; version: 1; transferId: string; itemId: string; type: "IMAGE" | "FILE"; encryptedMetadata: string; encryptedSize: number; totalChunks: number }
  | { kind: "TRANSFER_COMPLETE"; version: 1; transferId: string }
  | { kind: "TRANSFER_CANCEL"; version: 1; transferId: string }
  | { kind: "TRANSFER_ACK"; version: 1; transferId: string; receivedBytes: number }
  | { kind: "TRANSFER_ERROR"; version: 1; transferId: string; message: string };

const encoder = new TextEncoder(); const decoder = new TextDecoder(); const HEADER_BYTES = 41;
export function serializeControl(message: TransferControl) { return JSON.stringify(message); }
export function parseControl(value: string): TransferControl | null { try { const message = JSON.parse(value) as TransferControl; return message && message.version === 1 && typeof message.kind === "string" && typeof message.transferId === "string" ? message : null; } catch { return null; } }
export function serializeChunk(transferId: string, index: number, bytes: ArrayBuffer): ArrayBuffer { const id = encoder.encode(transferId); if (id.length !== 36) throw new Error("Invalid transfer ID"); const output = new Uint8Array(HEADER_BYTES + bytes.byteLength); output[0] = 1; output.set(id, 1); new DataView(output.buffer).setUint32(37, index); output.set(new Uint8Array(bytes), HEADER_BYTES); return output.buffer; }
export function parseChunk(frame: ArrayBuffer) { if (frame.byteLength < HEADER_BYTES) throw new Error("Invalid chunk frame"); const bytes = new Uint8Array(frame); if (bytes[0] !== 1) throw new Error("Unknown chunk frame"); return { transferId: decoder.decode(bytes.slice(1, 37)), index: new DataView(frame).getUint32(37), bytes: frame.slice(HEADER_BYTES) }; }
export function validateCompleteChunks(chunks: Map<number, BlobPart>, totalChunks: number, expectedSize: number, receivedSize: number) { if (chunks.size !== totalChunks || receivedSize !== expectedSize) throw new Error("Incomplete transfer"); for (let index = 0; index < totalChunks; index++) if (!chunks.has(index)) throw new Error("Missing transfer chunk"); return new Blob(Array.from({ length: totalChunks }, (_, index) => chunks.get(index)!)); }
