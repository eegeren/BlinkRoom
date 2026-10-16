export class UploadRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}
const wait = (signal: AbortSignal, ms: number) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
  signal.addEventListener("abort", abort, { once: true });
});

export async function retryUploadRequest<T>(operation: () => Promise<T>, signal: AbortSignal, delay = 1000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await operation(); }
    catch (error) {
      if (signal.aborted || attempt >= 2 || !(error instanceof TypeError || error instanceof UploadRequestError && error.retryable)) throw error;
      await wait(signal, delay * 2 ** attempt);
    }
  }
}

export async function uploadApiRequest(url: string, init: RequestInit, stage: string, retry = true) {
  const signal = init.signal as AbortSignal;
  const operation = async () => {
    let response: Response;
    try { response = await fetch(url, init); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new UploadRequestError(`Connection interrupted while ${stage}. Please retry.`, true);
    }
    if (!response.ok) {
      // Keep diagnostics free of file names, keys, tokens and signed URLs.
      console.warn("[UPLOAD_REQUEST_FAILED]", { stage, status: response.status });
      throw new UploadRequestError(`Upload failed while ${stage} (HTTP ${response.status}). Please retry.`, response.status === 429 || response.status >= 500);
    }
    return response;
  };
  return retry ? retryUploadRequest(operation, signal) : operation();
}

export function uploadPartBytes(url: string, body: Blob, signal: AbortSignal, onProgress: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const fail = (message: string, retryable: boolean) => {
      signal.removeEventListener("abort", abort);
      reject(new UploadRequestError(message, retryable));
    };
    xhr.open("PUT", url);
    xhr.timeout = 300_000;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded); };
    xhr.onload = () => {
      signal.removeEventListener("abort", abort);
      if (xhr.status < 200 || xhr.status >= 300) {
        fail(`Upload failed while sending a part (HTTP ${xhr.status}). Please retry.`, xhr.status === 429 || xhr.status >= 500 || xhr.status === 403);
        return;
      }
      const etag = xhr.getResponseHeader("etag");
      if (!etag) { fail("Storage did not confirm the upload. Please try again later.", false); return; }
      resolve(etag);
    };
    xhr.onerror = () => fail("Connection interrupted while sending a part. Please retry.", true);
    xhr.ontimeout = () => fail("Upload timed out while sending a part. Please retry.", true);
    xhr.onabort = () => fail("Transfer cancelled", false);
    signal.addEventListener("abort", abort, { once: true });
    try { xhr.send(body); }
    catch (error) { signal.removeEventListener("abort", abort); reject(error); }
  });
}
