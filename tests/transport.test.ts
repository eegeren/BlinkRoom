import test from "node:test";
import assert from "node:assert/strict";
import { parseChunk, parseControl, serializeChunk, serializeControl, validateCompleteChunks, type TransferControl } from "../src/lib/transport/protocol";
import { selectTransport } from "../src/lib/transport/selection";
import { canRelaySignal } from "../src/server/signaling-policy";
import { TransferManager } from "../src/lib/transport/manager";
import type { DirectFile, DirectTransport, TransferState } from "../src/lib/transport/types";

const file: DirectFile = { itemId: crypto.randomUUID(), type: "FILE", encryptedMetadata: "opaque", encrypted: new Blob(["encrypted"]) };
function direct(result: { delivered: string[]; failed: string[] } | Error): DirectTransport {
  return { setPeers() {}, close() {}, async sendFile() { if (result instanceof Error) throw result; return result; } };
}

test("available peers select direct WebRTC", () => assert.equal(selectTransport(1, 4), "DIRECT"));
test("no peer selects encrypted storage", () => assert.equal(selectTransport(0, 4), "STORAGE"));
test("disabled or timed-out direct transport selects storage", () => assert.equal(selectTransport(1, 4, false), "STORAGE"));
test("participant limit selects storage", () => assert.equal(selectTransport(5, 4), "STORAGE"));
test("transfer control protocol round-trips", () => { const message: TransferControl = { kind: "TRANSFER_START", version: 1, transferId: crypto.randomUUID(), itemId: crypto.randomUUID(), type: "FILE", encryptedMetadata: "opaque", encryptedSize: 42, totalChunks: 2 }; assert.deepEqual(parseControl(serializeControl(message)), message); });
test("binary chunks preserve index and bytes", () => { const id = crypto.randomUUID(), body = new Uint8Array([8, 4, 2]).buffer; const decoded = parseChunk(serializeChunk(id, 7, body)); assert.equal(decoded.transferId, id); assert.equal(decoded.index, 7); assert.deepEqual(new Uint8Array(decoded.bytes), new Uint8Array(body)); });
test("chunk assembly preserves ordering", async () => { const chunks = new Map<number, BlobPart>([[1, new Uint8Array([3, 4])], [0, new Uint8Array([1, 2])]]); const blob = validateCompleteChunks(chunks, 2, 4, 4); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3, 4])); });
test("missing chunks are rejected", () => assert.throws(() => validateCompleteChunks(new Map([[1, new Uint8Array([3])]]), 2, 2, 1)));
test("cancel protocol is explicit and parseable", () => { const cancel: TransferControl = { kind: "TRANSFER_CANCEL", version: 1, transferId: crypto.randomUUID() }; assert.deepEqual(parseControl(serializeControl(cancel)), cancel); });
test("cross-room signaling is rejected", () => assert.equal(canRelaySignal("ROOM-A", "ROOM-B", "ACTIVE", new Date(Date.now() + 1000)), false));
test("expired and destroyed rooms reject signaling", () => { assert.equal(canRelaySignal("ROOM", "ROOM", "EXPIRED", new Date(Date.now() + 1000)), false); assert.equal(canRelaySignal("ROOM", "ROOM", "ACTIVE", new Date(Date.now() - 1)), false); });

test("manager completes a successful direct transfer without storage", async () => {
  let temporary = 0; const states: TransferState[] = [];
  const manager = new TransferManager({ direct: direct({ delivered: ["peer"], failed: [] }), directSupported: true, maxDirectPeers: 1, onStateChange: ({ state }) => states.push(state) });
  assert.equal(await manager.transfer({ file, peerIds: ["peer"], temporary: { async send() { temporary++; } } }), "direct");
  assert.equal(temporary, 0); assert.deepEqual(states, ["preparing", "connecting", "completed"]);
});

test("manager falls back when direct connection fails", async () => {
  let temporary = 0;
  const manager = new TransferManager({ direct: direct(new Error("timeout")), directSupported: true, maxDirectPeers: 1 });
  assert.equal(await manager.transfer({ file, peerIds: ["peer"], temporary: { async send() { temporary++; } } }), "temporary");
  assert.equal(temporary, 1); assert.equal(manager.state, "completed");
});

test("manager uses storage without browser support or an available peer", async () => {
  for (const peerIds of [[], ["peer"]]) {
    let temporary = 0;
    const manager = new TransferManager({ direct: null, directSupported: false, maxDirectPeers: 1 });
    assert.equal(await manager.transfer({ file, peerIds, temporary: { async send() { temporary++; } } }), "temporary");
    assert.equal(temporary, 1);
  }
});

test("manager falls back on partial delivery and recipient disconnect", async () => {
  for (const result of [{ delivered: [], failed: ["peer"] }, new Error("Peer disconnected")]) {
    let temporary = 0;
    const manager = new TransferManager({ direct: direct(result), directSupported: true, maxDirectPeers: 1 });
    assert.equal(await manager.transfer({ file, peerIds: ["peer"], temporary: { async send() { temporary++; } } }), "temporary");
    assert.equal(temporary, 1);
  }
});

test("direct-only mode reports failure instead of storing", async () => {
  const manager = new TransferManager({ direct: direct(new Error("timeout")), directSupported: true, maxDirectPeers: 1 });
  await assert.rejects(manager.transfer({ file, peerIds: ["peer"], directOnly: true, temporary: { async send() { throw new Error("must not run"); } } }));
  assert.equal(manager.state, "failed");
});

test("fallback authorization failure cannot produce duplicate completion", async () => {
  const states: TransferState[] = []; let temporaryAttempts = 0;
  const manager = new TransferManager({ direct: direct(new Error("connection lost")), directSupported: true, maxDirectPeers: 1, onStateChange: ({ state }) => states.push(state) });
  await assert.rejects(manager.transfer({ file, peerIds: ["peer"], temporary: { async send() { temporaryAttempts++; throw new Error("session revoked"); } } }), /session revoked/);
  assert.equal(temporaryAttempts, 1);
  assert.equal(manager.state, "failed");
  assert.deepEqual(states, ["preparing", "connecting", "cloud_fallback", "transferring", "failed"]);
});

test("aborted direct transfer never starts temporary fallback", async () => {
  let temporaryAttempts = 0;
  const controller = new AbortController(); controller.abort();
  const aborting: DirectTransport = { setPeers() {}, close() {}, async sendFile() { throw new DOMException("Aborted", "AbortError"); } };
  const manager = new TransferManager({ direct: aborting, directSupported: true, maxDirectPeers: 1 });
  await assert.rejects(manager.transfer({ file, peerIds: ["peer"], signal: controller.signal, temporary: { async send() { temporaryAttempts++; } } }));
  assert.equal(temporaryAttempts, 0); assert.equal(manager.state, "failed");
});
