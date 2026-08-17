import test from "node:test";
import assert from "node:assert/strict";
import { parseChunk, parseControl, serializeChunk, serializeControl, validateCompleteChunks, type TransferControl } from "../src/lib/transport/protocol";
import { selectTransport } from "../src/lib/transport/selection";
import { canRelaySignal } from "../src/server/signaling-policy";

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
