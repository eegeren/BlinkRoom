import test from "node:test";
import assert from "node:assert/strict";
import { clearPendingRoomUpload, setPendingRoomUpload, takePendingRoomUpload } from "../src/lib/pending-room-upload";
import { uploadBatchValidationError, uploadValidationError } from "../src/lib/upload-validation";
import { filesFromDropSnapshot } from "../src/lib/drop-files";

test("instant-drop files remain in memory and are consumed exactly once by the matching room", () => {
  const files = [new File(["first"], "first.txt"), new File(["second"], "second.txt")];
  setPendingRoomUpload("ROOM-1", files);
  assert.equal(takePendingRoomUpload("ROOM-1").length, 2);
  assert.deepEqual(takePendingRoomUpload("ROOM-1"), []);
});

test("instant-drop handoff cannot leak files into a different room", () => {
  setPendingRoomUpload("ROOM-1", [new File(["private"], "private.txt")]);
  assert.deepEqual(takePendingRoomUpload("ROOM-2"), []);
  clearPendingRoomUpload();
});

test("landing and room uploads share the same maximum file-size validation", () => {
  assert.equal(uploadValidationError(new File(["ok"], "ok.txt"), 10), null);
  assert.equal(uploadValidationError(new File(["too large"], "large.txt"), 2), "This file is too large.");
});

test("zero-byte files use the shared known validation message", () => {
  const empty = new File([], "empty.txt");
  assert.equal(uploadValidationError(empty, 100), "Empty files can’t be uploaded.");
  assert.equal(uploadBatchValidationError([new File(["valid"], "valid.txt"), empty], 100), "Empty files can’t be uploaded.");
});

test("an empty dropped directory is rejected before it can become a fake file", async () => {
  const directory = { name: "empty-folder", isFile: false, isDirectory: true, createReader: () => ({ readEntries: (resolve: (entries: FileSystemEntry[]) => void) => resolve([]) }) } as unknown as FileSystemDirectoryEntry;
  await assert.rejects(filesFromDropSnapshot({ files: [new File(["folder placeholder"], "empty-folder")], items: [{ entry: directory, file: null }] }), /This folder is empty\./);
});
