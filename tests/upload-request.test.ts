import test from "node:test";
import assert from "node:assert/strict";
import { retryUploadRequest, UploadRequestError, uploadApiRequest } from "../src/lib/upload-request";

test("transient part failures retry and succeed without replacing operation input", async () => {
  let calls = 0;
  const bytes = new Uint8Array([1, 2, 3]);
  const result = await retryUploadRequest(async () => {
    if (++calls < 3) throw new UploadRequestError("connection", true);
    return bytes;
  }, new AbortController().signal, 0);
  assert.equal(result, bytes);
  assert.equal(calls, 3);
});

test("permanent errors stop immediately and transient failures stop after three tries", async () => {
  for (const retryable of [false, true]) {
    let calls = 0;
    await assert.rejects(retryUploadRequest(async () => { calls++; throw new UploadRequestError("failed", retryable); }, new AbortController().signal, 0));
    assert.equal(calls, retryable ? 3 : 1);
  }
});

test("cancellation during backoff prevents another attempt", async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = retryUploadRequest(async () => { calls++; throw new TypeError("network"); }, controller.signal);
  setTimeout(() => controller.abort(), 1);
  await assert.rejects(result);
  assert.equal(calls, 1);
});

test("API errors identify the stage and HTTP status without revealing request secrets", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 403 }));
  const signal = new AbortController().signal;
  await assert.rejects(uploadApiRequest("https://example.invalid/secret-token", { signal }, "confirming a part"), (error: Error) => {
    assert.match(error.message, /confirming a part.*403/);
    assert.ok(!error.message.includes("secret-token"));
    return true;
  });
});

test("part PUT retries reuse the same blob and clean up abort listeners", async (t) => {
  const { uploadPartBytes } = await import("../src/lib/upload-request");
  const bodies: Blob[] = [];
  const controller = new AbortController();
  let adds = 0, removes = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  t.mock.method(controller.signal, "addEventListener", (...args: Parameters<typeof add>) => { adds++; return add(...args); });
  t.mock.method(controller.signal, "removeEventListener", (...args: Parameters<typeof remove>) => { removes++; return remove(...args); });
  class FakeXHR {
    upload = {};
    status = 200;
    onerror = () => {};
    onload = () => {};
    open() {}
    setRequestHeader() {}
    getResponseHeader() { return '"etag"'; }
    send(body: Blob) { bodies.push(body); queueMicrotask(() => bodies.length === 1 ? this.onerror() : this.onload()); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  Object.defineProperty(globalThis, "XMLHttpRequest", { value: FakeXHR, configurable: true });
  try {
    const body = new Blob(["ciphertext"]);
    const etag = await retryUploadRequest(() => uploadPartBytes("https://example.invalid", body, controller.signal, () => {}), controller.signal, 0);
    assert.equal(etag, '"etag"');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], body);
    assert.equal(bodies[1], body);
    assert.equal(adds, removes);
  } finally {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
    else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  }
});
