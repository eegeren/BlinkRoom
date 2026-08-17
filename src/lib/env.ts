import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ROOM_DEFAULT_TTL_HOURS: z.coerce.number().refine((v) => [1, 6, 24, 72].includes(v)).default(24),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(2048).default(100),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().max(5120).default(500),
  MAX_ROOM_STORAGE_MB: z.coerce.number().positive().max(20480).default(2048),
  MAX_ROOM_ITEMS: z.coerce.number().int().positive().max(10000).default(500),
  MAX_CONCURRENT_UPLOADS: z.coerce.number().int().positive().max(20).default(3),
  STORAGE_PROVIDER: z.enum(["local", "r2"]).default("local"),
  LOCAL_STORAGE_PATH: z.string().default("./storage"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  MULTIPART_STALE_HOURS: z.coerce.number().positive().max(168).default(6),
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
export const env = schema.parse(process.env);
export function requireR2Config() { if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) throw new Error("R2 storage is selected but required server credentials are missing"); return { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET_NAME, endpoint: env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` }; }
