import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { env } from "@/src/lib/env";
import type { StorageProvider, UploadInput } from "./types";

export class LocalStorageProvider implements StorageProvider {
  readonly kind = "local" as const;
  private root = path.resolve(env.LOCAL_STORAGE_PATH);
  private resolve(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Invalid storage key");
    return target;
  }
  async upload(input: UploadInput) {
    const key = `${input.roomSlug}/${input.itemId}`;
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await pipeline(input.stream, createWriteStream(target, { flags: "wx", mode: 0o600 }));
    return key;
  }
  async deleteObject(key: string) { await rm(this.resolve(key), { force: true }); }
  async deleteObjects(keys: string[]) { await Promise.all(keys.map((key) => this.deleteObject(key).catch(() => undefined))); }
  async getPublicOrSignedUrl(key: string) { return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`; }
  async createReadStream(key: string) { return createReadStream(this.resolve(key)); }
  async deleteRoomObjects(slug: string) { await rm(this.resolve(`${slug}/placeholder`), { recursive: true, force: true }).catch(() => undefined); await rm(path.resolve(this.root, slug), { recursive: true, force: true }); }
  async createMultipartUpload(): Promise<string> { throw new Error("Multipart direct upload is not available for local storage"); }
  async signUploadPart(): Promise<string> { throw new Error("Multipart direct upload is not available for local storage"); }
  async completeMultipartUpload() { throw new Error("Multipart direct upload is not available for local storage"); }
  async abortMultipartUpload() { return; }
  async headSize(): Promise<number> { throw new Error("Object size lookup is unavailable"); }
  async abortStaleMultipartUploads() { return 0; }
}
