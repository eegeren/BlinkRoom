import { Readable } from "node:stream";
import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListMultipartUploadsCommand, ListObjectsV2Command, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, requireR2Config } from "@/src/lib/env";
import type { CompletedPart, StorageProvider } from "./types";

export class R2StorageProvider implements StorageProvider {
  readonly kind = "r2" as const; private client: S3Client; private bucket: string;
  constructor() { const config = requireR2Config(); this.bucket = config.bucket; this.client = new S3Client({ region: "auto", endpoint: config.endpoint, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }); }
  async upload(): Promise<string> { throw new Error("R2 uploads must use presigned multipart sessions"); }
  async delete(key: string) { await this.deleteObjects([key]); }
  async deleteObjects(keys: string[]) { for (let offset = 0; offset < keys.length; offset += 1000) { const batch = keys.slice(offset, offset + 1000); if (batch.length) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Quiet: true, Objects: batch.map((Key) => ({ Key })) } })); } }
  async getPublicOrSignedUrl(key: string) { return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: "application/octet-stream", ResponseContentDisposition: "attachment; filename=encrypted.bin" }), { expiresIn: Math.min(env.STORAGE_SIGNED_URL_TTL_SECONDS, 300) }); }
  async createReadStream(key: string) { const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); if (!result.Body) throw new Error("Object unavailable"); return result.Body as Readable; }
  async deleteRoomFiles(roomSlug: string) { let token: string | undefined; do { const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: `rooms/${roomSlug}/`, ContinuationToken: token })); await this.deleteObjects((page.Contents ?? []).flatMap((entry) => entry.Key ? [entry.Key] : [])); token = page.NextContinuationToken; } while (token); }
  async createMultipartUpload(key: string) { const result = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: "application/octet-stream" })); if (!result.UploadId) throw new Error("Unable to create multipart upload"); return result.UploadId; }
  async signUploadPart(key: string, uploadId: string, partNumber: number) { return getSignedUrl(this.client, new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn: env.STORAGE_SIGNED_URL_TTL_SECONDS }); }
  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]) { await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) } })); }
  async abortMultipartUpload(key: string, uploadId: string) { await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })).catch(() => undefined); }
  async headSize(key: string) { const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return Number(result.ContentLength ?? -1); }
  async abortStaleMultipartUploads(before: Date) { let count = 0, keyMarker: string | undefined, uploadIdMarker: string | undefined; do { const page = await this.client.send(new ListMultipartUploadsCommand({ Bucket: this.bucket, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker })); for (const upload of page.Uploads ?? []) if (upload.Key && upload.UploadId && upload.Initiated && upload.Initiated < before) { await this.abortMultipartUpload(upload.Key, upload.UploadId); count++; } keyMarker = page.NextKeyMarker; uploadIdMarker = page.NextUploadIdMarker; if (!page.IsTruncated) break; } while (true); return count; }
}
