export type QueuedUpload = {
  id: string;
  file: File;
  progress: 0;
  status: "queued";
};

export function createQueuedUploads(
  files: FileList | File[],
  createId: () => string = () => crypto.randomUUID(),
): QueuedUpload[] {
  return Array.from(files, (file) => ({
    id: createId(),
    file,
    progress: 0,
    status: "queued",
  }));
}
