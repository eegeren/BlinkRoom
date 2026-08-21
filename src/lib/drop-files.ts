type DroppedFile = { path: string; file: File };
type DropSnapshotItem = { entry: FileSystemEntry | null; file: File | null };
export type DropSnapshot = { files: File[]; items: DropSnapshotItem[] };

const fileFromEntry = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));
const readDirectoryBatch = (reader: FileSystemDirectoryReader) => new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

async function readAllDirectoryEntries(directory: FileSystemDirectoryEntry) {
  const reader = directory.createReader(), result: FileSystemEntry[] = [];
  while (true) { const batch = await readDirectoryBatch(reader); if (!batch.length) break; result.push(...batch); }
  return result;
}

async function walkDroppedEntry(entry: FileSystemEntry, parentPath = ""): Promise<DroppedFile[]> {
  const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  if (entry.isFile) return [{ path, file: await fileFromEntry(entry as FileSystemFileEntry) }];
  if (!entry.isDirectory) return [];
  const children = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry);
  return (await Promise.all(children.map((child) => walkDroppedEntry(child, path)))).flat();
}

const safeArchiveName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "_").trim() || "Folder";

async function droppedDirectoryToZip(directory: FileSystemDirectoryEntry) {
  const droppedFiles = await walkDroppedEntry(directory);
  if (!droppedFiles.length) throw new Error("This folder is empty.");
  const { downloadZip } = await import("client-zip");
  const rootPrefix = `${directory.name}/`;
  const zipBlob = await downloadZip(droppedFiles.map(({ path, file }) => ({ name: path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path, input: file }))).blob();
  return new File([zipBlob], `${safeArchiveName(directory.name)}.zip`, { type: "application/zip", lastModified: Date.now() });
}

// Must run synchronously inside the drop event because DataTransfer is cleared
// by browsers after the handler returns.
export function snapshotDrop(dataTransfer: DataTransfer): DropSnapshot {
  return { files: Array.from(dataTransfer.files), items: Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file").map((item) => ({ entry: item.webkitGetAsEntry?.() ?? null, file: item.getAsFile() })) };
}

export async function filesFromDropSnapshot({ files, items }: DropSnapshot) {
  if (!items.length || !items.some((item) => item.entry?.isDirectory)) return files;
  const output: File[] = [];
  for (const item of items) {
    const entry = item.entry;
    if (!entry) { if (item.file) output.push(item.file); continue; }
    if (entry.isFile) output.push(item.file ?? await fileFromEntry(entry as FileSystemFileEntry));
    else if (entry.isDirectory) output.push(await droppedDirectoryToZip(entry as FileSystemDirectoryEntry));
  }
  return output.length ? output : files;
}
