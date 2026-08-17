# BlinkRoom

BlinkRoom is a no-account, end-to-end encrypted temporary sharing room for files, images, text, and links. Create a room in one click, invite people by link or QR code, and destroy everything when you are done.

## Requirements and setup

Requires Node.js 22+, PostgreSQL 15+, and npm.

1. Copy `.env.example` to `.env` and replace the development values.
2. Create a PostgreSQL database named `blinkroom` (or update `DATABASE_URL`).
3. Run `npm install`.
4. Run `npx prisma migrate deploy`.
5. Run `npm run dev`, then open `http://localhost:3000`.

An optional local database:

```bash
docker run --name blinkroom-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=blinkroom -p 5432:5432 -d postgres:16
```

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `NEXT_PUBLIC_APP_URL` | Public application origin |
| `ROOM_DEFAULT_TTL_HOURS` | Room lifetime: `1`, `6`, or `24` |
| `MAX_FILE_SIZE_MB` | Maximum declared encrypted file size |
| `MAX_ROOM_STORAGE_MB` | Maximum encrypted temporary-storage bytes per room |
| `MAX_ROOM_ITEMS` | Maximum items per room |
| `MAX_CONCURRENT_UPLOADS` | Maximum reserved multipart uploads per room |
| `STORAGE_PROVIDER` | `local` or `r2`; defaults to `local` |
| `LOCAL_STORAGE_PATH` | Private local blob directory |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Server-only Cloudflare R2 configuration |
| `R2_ENDPOINT` | Optional S3-compatible endpoint override |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | Presigned upload/download lifetime, 60–900 seconds |
| `MULTIPART_STALE_HOURS` | Age at which incomplete multipart uploads are aborted |
| `CLEANUP_BATCH_SIZE` | Maximum rooms/sessions reconciled per cleanup call |
| `TRUST_PROXY_HEADERS` | Trust the first forwarded IP only behind a controlled proxy |
| `CLEANUP_SECRET` | Long bearer secret for cleanup calls |
| `WEBRTC_STUN_URLS` | Comma-separated STUN URLs |
| `WEBRTC_TURN_URLS` | Comma-separated TURN URLs |
| `WEBRTC_TURN_USERNAME` | TURN username delivered only as ICE configuration |
| `WEBRTC_TURN_CREDENTIAL` | TURN credential delivered only as ICE configuration; never logged |
| `DIRECT_CONNECTION_TIMEOUT_MS` | Time before automatic encrypted-storage fallback |
| `MAX_DIRECT_PEERS` | Maximum direct mesh recipients before storage fallback |

## Commands

- `npm run dev` — Next.js and Socket.IO development server
- `npm run typecheck` — strict TypeScript check
- `npm run lint` — ESLint
- `npm run build` — Prisma generation and production build
- `npm start` — production custom server
- `npx prisma migrate deploy` — apply committed migrations

## Architecture

Next.js App Router serves the UI and REST API. A custom Node server owns Socket.IO. Room item ciphertext is durable in PostgreSQL; successful writes broadcast only opaque encrypted item data through the realtime channel. Reconnecting clients fetch a fresh encrypted snapshot and decrypt it locally. Presence is in-memory for the MVP and isolated in `src/server/realtime.ts`; use the Socket.IO Redis adapter for multiple instances.

Owner tokens are random 256-bit values stored in secure HTTP-only cookies. PostgreSQL stores only their SHA-256 hashes. Content encryption uses a separate browser-generated 256-bit key in the invite URL fragment. The server never receives that key. Text, links, filenames, MIME types, original sizes, and file bytes are encrypted with AES-GCM before upload. Files use independently authenticated 4 MiB chunks and are returned as opaque encrypted blobs with `nosniff`. See [SECURITY.md](SECURITY.md) for the exact threat model and binary format.

### Storage and R2/S3 migration

Blob operations go through `StorageProvider`; business logic does not branch on vendor details. `LocalStorageProvider` remains the zero-credential development default. `R2StorageProvider` uses Cloudflare’s S3-compatible API, private presigned downloads, multipart creation/completion/abort, bulk deletion, and stale multipart reconciliation. Object keys contain only the room slug and a server-generated UUID (`rooms/ROOM/random-uuid.bin`). Original filenames, MIME types, invite URLs, keys, and user content are never object keys or R2 metadata.

### Cloudflare R2 setup

1. Create an R2 bucket and keep public access disabled.
2. Create a narrowly scoped R2 API token/access-key pair for that bucket.
3. Set `STORAGE_PROVIDER=r2` and the four `R2_*` credentials. They are server-only; never prefix them with `NEXT_PUBLIC_`.
4. Configure bucket CORS for the exact BlinkRoom production origin and explicit local development origins. Allow only `PUT`, `GET`, and `HEAD`; allow `Content-Type`; expose `ETag`; avoid `*` origins in production.
5. Run migrations and start the app. The browser encrypts first, requests a server-created upload session, uploads 10 MiB encrypted parts directly to R2, and returns ETags for server-side completion verification.
6. Configure an optional R2 lifecycle rule that deletes objects under `rooms/` after a few days. This is only a safety net; the application database’s `expiresAt` and cleanup service remain authoritative.
7. Test using a distinctive filename and verify that the database, object key, R2 metadata, and server logs contain no plaintext filename. The downloaded object should be opaque until the browser decrypts it with the room key.

Example CORS policy (replace origins with deployments you control):

```json
[{"AllowedOrigins":["https://blinkroom.example","http://localhost:3000"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["Content-Type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":300}]
```

R2 multipart uploads are used only after WebRTC is unavailable or incomplete. Successful P2P-only transfers create no upload session and consume no room storage quota. R2 credentials are validated lazily only when `STORAGE_PROVIDER=r2`, so local development and production builds work without them.

### Cleanup job

Schedule a POST to `/api/internal/cleanup` every 15–60 minutes with `Authorization: Bearer <CLEANUP_SECRET>`. It processes bounded batches, atomically marks overdue rooms expired, removes encrypted objects and opaque item metadata, aborts stale multipart uploads, and reconciles partial failures idempotently. Destroy makes a room inaccessible before cleanup starts.

For orphan-object cleanup, use a conservative grace period longer than the maximum room lifetime plus operational delay. List old `rooms/` objects, compare their keys with `RoomItem` and `UploadSession`, and delete only unreferenced candidates older than the grace period. Do not run aggressive age-only deletion against active rooms.

### Transfer architecture

BlinkRoom automatically chooses the available transport; users only drop a file. When all currently online recipients can establish a connection within the configured timeout (up to `MAX_DIRECT_PEERS`), the already AES-GCM-encrypted binary is sent over ordered WebRTC DataChannels and is not uploaded to BlinkRoom storage. With no online recipient, too many recipients, an unreachable peer, or an interrupted connection, the same encrypted binary is uploaded through the temporary storage provider. If only some recipients complete direct delivery, the timeline has one `HYBRID` item and storage keeps the encrypted fallback for the others.

```text
DIRECT:   Browser A → AES-GCM encrypt → WebRTC → AES-GCM decrypt → Browser B
FALLBACK: Browser A → AES-GCM encrypt → Temporary Storage → AES-GCM decrypt → Browser B
```

The DataChannel protocol uses 64 KiB network frames independently of the 4 MiB authenticated crypto chunks. It declares expected encrypted bytes/chunks, acknowledges received bytes for real progress, checks ordering/completeness, and supports cancellation. AES-GCM authentication remains the final integrity check. Direct-only files are cached in the participating browser session; a participant joining later sees “No longer available” unless a storage fallback exists.

Public STUN is suitable for development, but reliable WebRTC across real-world NAT/firewall combinations usually requires a production TURN service. Configure TURN credentials in server environment variables; never commit them. To test over a LAN, bind the app to an address reachable by both devices, use HTTPS (Web Crypto/WebRTC require a secure context outside localhost), set `NEXT_PUBLIC_APP_URL` to that HTTPS origin, open the full invite URL including its fragment on the second device, and verify direct delivery while both devices stay in the room.

## Production

Run behind a proxy with WebSocket upgrade support, use managed PostgreSQL, and mount `LOCAL_STORAGE_PATH` on persistent storage. For horizontal scaling, replace in-memory presence and rate limiting with Redis.
