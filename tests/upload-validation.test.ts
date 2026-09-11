import test from "node:test";
import assert from "node:assert/strict";
import { maxFileSizeMessage, uploadBatchValidationError, uploadValidationError } from "../src/lib/upload-validation";

const FIVE_GB = 5 * 1024 * 1024 * 1024;
const file = (size: number, name = "video.mp4") => ({ size, name } as File);

test("the default 5 GB cap produces the exact required message", () => {
  assert.equal(maxFileSizeMessage(FIVE_GB), "Maximum file size is 5 GB.");
});
test("a file exactly at the cap is accepted", () => {
  assert.equal(uploadValidationError(file(FIVE_GB), FIVE_GB), null);
});
test("a file one byte over the cap is rejected with the 5 GB message", () => {
  assert.equal(uploadValidationError(file(FIVE_GB + 1), FIVE_GB), "Maximum file size is 5 GB.");
});
test("empty files are rejected before the size check", () => {
  assert.equal(uploadValidationError(file(0), FIVE_GB), "Empty files can’t be uploaded.");
});
test("batch validation surfaces the first oversized file", () => {
  assert.equal(uploadBatchValidationError([file(10), file(FIVE_GB + 1)], FIVE_GB), "Maximum file size is 5 GB.");
});
test("a smaller configured cap is reflected in the message, not hardcoded", () => {
  assert.equal(maxFileSizeMessage(1024 * 1024 * 1024), "Maximum file size is 1 GB.");
  assert.equal(maxFileSizeMessage(2.5 * 1024 * 1024 * 1024), "Maximum file size is 2.5 GB.");
});
test("a sub-GB configured cap never renders as a misleading 0 GB", () => {
  assert.equal(maxFileSizeMessage(100 * 1024 * 1024), "Maximum file size is 100 MB.");
  assert.equal(maxFileSizeMessage(2), "Maximum file size is 1 KB.");
});
