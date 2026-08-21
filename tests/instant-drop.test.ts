import test from "node:test";
import assert from "node:assert/strict";
import { clearPendingRoomUpload, peekPendingRoomUpload, setPendingRoomUpload, takePendingRoomUpload } from "../src/lib/pending-room-upload";
import { uploadBatchValidationError, uploadValidationError } from "../src/lib/upload-validation";
import { filesFromDropSnapshot } from "../src/lib/drop-files";
import { createQueuedUploads } from "../src/lib/upload-queue";
import { clearPendingRoomCreation, getPendingRoomCreation, preparePendingRoomCreation, startPendingRoomCreation } from "../src/lib/pending-room-creation";

test("instant-drop files remain in memory and are consumed exactly once by the matching room", () => {
  const files = [new File(["first"], "first.txt"), new File(["second"], "second.txt")];
  setPendingRoomUpload("ROOM-1", files);
  assert.equal(peekPendingRoomUpload("ROOM-1")[0], files[0]);
  assert.equal(peekPendingRoomUpload("ROOM-1").length, 2);
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

test("every dropped file is represented optimistically before upload workers start", () => {
  const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")];
  let id = 0;
  const queued = createQueuedUploads(files, () => `upload-${++id}`);

  assert.deepEqual(queued.map(({ id, file, progress, status }) => ({ id, name: file.name, progress, status })), [
    { id: "upload-1", name: "one.txt", progress: 0, status: "queued" },
    { id: "upload-2", name: "two.txt", progress: 0, status: "queued" },
  ]);
});

test("instant shell preserves File objects without persistent serialization", () => {
  const file = new File(["private"], "private.txt");
  preparePendingRoomCreation([file], 24);
  assert.equal(getPendingRoomCreation()?.files[0], file);
  clearPendingRoomCreation();
});

test("instant shell starts a delayed room request eagerly and never duplicates it", async () => {
  const file = new File(["one"], "one.txt");
  let calls = 0;
  let resolveRoom!: (room: { slug: string; roomKey: string }) => void;
  const create = async () => {
    calls += 1;
    return new Promise<{ slug: string; roomKey: string }>((resolve) => { resolveRoom = resolve; });
  };
  preparePendingRoomCreation([file], 24);
  const first = startPendingRoomCreation(create);
  const second = startPendingRoomCreation(create);
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(getPendingRoomCreation()?.files[0], file);
  resolveRoom({ slug: "ROOM-1", roomKey: "key" });
  assert.deepEqual(await first, { slug: "ROOM-1", roomKey: "key" });
  clearPendingRoomCreation();
});
