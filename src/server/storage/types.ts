import type { Readable } from "node:stream";
export interface UploadInput { roomSlug: string; itemId: string; filename: string; stream: Readable }
export type CompletedPart = { partNumber: number; etag: string };
export interface StorageProvider {
  readonly kind: "local" | "r2";
  upload(input: UploadInput): Promise<string>;
  deleteObject(key: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<void>;
  getPublicOrSignedUrl(key: string): Promise<string>;
  createReadStream(key: string): Promise<Readable>;
  deleteRoomObjects(roomSlug: string): Promise<void>;
  createMultipartUpload(key: string): Promise<string>;
  signUploadPart(key: string, uploadId: string, partNumber: number): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  headSize(key: string): Promise<number>;
  abortStaleMultipartUploads(before: Date): Promise<number>;
}
