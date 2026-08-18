import { z } from "zod";

const optionalTrimmed = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value, z.string().optional());
const optionalUrl = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value, z.string().url().optional());
const provider = z.preprocess((value) => typeof value === "string" ? value.trim().toLowerCase() : value, z.enum(["local", "r2"]).default("local"));
const storageFields = {
  MAX_FILE_SIZE_MB: z.coerce.number().positive().max(10240).default(10240),
  MAX_ROOM_STORAGE_MB: z.coerce.number().positive().max(102400).default(20480),
  STORAGE_PROVIDER: provider,
  LOCAL_STORAGE_PATH: z.string().default("./storage"),
  R2_ACCOUNT_ID: optionalTrimmed,
  R2_ACCESS_KEY_ID: optionalTrimmed,
  R2_SECRET_ACCESS_KEY: optionalTrimmed,
  R2_BUCKET_NAME: optionalTrimmed,
  R2_ENDPOINT: optionalUrl,
};
const storageSchema = z.object(storageFields);
const baseSchema = z.object({
  DATABASE_URL: z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string().min(1)),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ROOM_DEFAULT_TTL_HOURS: z.coerce.number().refine((v) => [1, 6, 24, 72].includes(v)).default(24),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(10240).default(100),
  MAX_ROOM_ITEMS: z.coerce.number().int().positive().max(10000).default(500),
  MAX_CONCURRENT_UPLOADS: z.coerce.number().int().positive().max(20).default(3),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  MULTIPART_STALE_HOURS: z.coerce.number().positive().max(168).default(6),
  ORPHAN_GRACE_HOURS: z.coerce.number().positive().max(720).default(24),
  CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(100),
  TRUST_PROXY_HEADERS: z.string().transform((value) => value === "true").default("false"),
  CLEANUP_SECRET: z.string().min(16),
  WEBRTC_STUN_URLS: z.string().default("stun:stun.l.google.com:19302"),
  WEBRTC_TURN_URLS: z.string().default(""),
  WEBRTC_TURN_USERNAME: z.string().default(""),
  WEBRTC_TURN_CREDENTIAL: z.string().default(""),
  DIRECT_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  MAX_DIRECT_PEERS: z.coerce.number().int().min(1).max(8).default(4),
});
const schema = baseSchema.merge(storageSchema);
type StorageEnv = z.infer<typeof storageSchema>;
function assertR2Credentials(config: StorageEnv) { if (config.STORAGE_PROVIDER === "r2" && (!config.R2_ACCOUNT_ID || !config.R2_ACCESS_KEY_ID || !config.R2_SECRET_ACCESS_KEY || !config.R2_BUCKET_NAME)) throw new Error("Invalid R2 configuration: STORAGE_PROVIDER=r2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME"); }
export function resolveStorageRuntimeConfig(source: Record<string, unknown>) { const config = storageSchema.parse(source); assertR2Credentials(config); return { ...config, directUpload: config.STORAGE_PROVIDER === "r2", maxFileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024, partSize: 10 * 1024 * 1024 }; }
export const env = schema.parse(process.env);
assertR2Credentials(env);
export function requireR2Config(config: StorageEnv = env) { assertR2Credentials(config); if (config.STORAGE_PROVIDER !== "r2") throw new Error("R2 configuration requested while STORAGE_PROVIDER is not r2"); const accountId = config.R2_ACCOUNT_ID!, accessKeyId = config.R2_ACCESS_KEY_ID!, secretAccessKey = config.R2_SECRET_ACCESS_KEY!, bucket = config.R2_BUCKET_NAME!; return { accountId, accessKeyId, secretAccessKey, bucket, endpoint: config.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com` }; }
