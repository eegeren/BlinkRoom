# BlinkRoom

## Production cleanup job

Room access is denied authoritatively as soon as a room is destroyed or its `expiresAt` has passed. Physical cleanup of encrypted objects and database metadata is asynchronous and retryable.

Schedule the internal cleanup endpoint every 15 minutes (hourly is also supported) with Railway Cron or another scheduler:

```sh
curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $CLEANUP_SECRET" \
  https://your-production-origin.example/api/internal/cleanup
```

The job works in configurable batches (`CLEANUP_BATCH_SIZE`), expires overdue rooms, deletes their encrypted storage objects, aborts incomplete multipart uploads, clears temporary item/session metadata, and retries rooms whose cleanup is `PARTIAL`. `MULTIPART_STALE_HOURS` controls abandoned multipart cleanup and defaults to 6 hours.

Deployments must run `prisma migrate deploy` before application startup. The repository's `npm start` command already does this.

### Orphan safety

Inactive-room prefix cleanup is safe because the room has already become inaccessible. Provider-level multipart cleanup uses the configured stale threshold. BlinkRoom does not automatically delete arbitrary R2 objects that have no database reference: distinguishing a true orphan from a temporarily inconsistent active upload requires an inventory/reconciliation process. Any manual orphan-object reconciliation should use `ORPHAN_GRACE_HOURS` (default 24 hours), verify that no `RoomItem` or `UploadSession` references the key, and never delete objects belonging to active rooms.

## PWA and production feature support

BlinkRoom is installable in current Chromium desktop and Android browsers. Android Web Share Target accepts files, images, text, and URLs into a browser-only IndexedDB inbox, asks for confirmation, then clears the inbox while content is encrypted and shared. iOS Safari does not currently expose installed web apps as general file share targets. The service worker caches only the homepage and icon assets; room pages, APIs, WebSocket traffic, signed R2 URLs, and user objects are never cached.

Deploy with `prisma migrate deploy`. `AUTO_DESTROY_GRACE_SECONDS` defaults to 30, `PRESENCE_LEASE_SECONDS` to 60, and `ONE_TIME_RESERVATION_SECONDS` to 300. Multiple instances coordinate presence leases and one-time reservations in PostgreSQL. Direct-only rooms reject both multipart and local storage routes server-side.

## Privacy-safe GA4

Production analytics is enabled only when Railway builds with `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-161QZ8MP4C`; public env changes require a rebuild. `NEXT_PUBLIC_ANALYTICS_DEBUG=true` enables safe development diagnostics. BlinkRoom measures coarse product actions such as room creation and successful transfers. Room slugs, URL fragments, invite keys, filenames, content, exact sizes, storage/session IDs, peer IDs, and signed URLs are never event parameters. Consent Mode defaults analytics storage to denied and exposes `setAnalyticsConsent` for a future consent UI.

In GA Admin, disable Enhanced Measurement’s automatic page changes/history events, outbound clicks, form interactions, and site search. BlinkRoom sends its own sanitized page views (`/r/[room]`) and allowlisted events. Mark `room_created`, `file_upload_completed`, and `file_download_completed` as key events; `successful_transfer` is the preferred future Ads conversion signal. No Google Ads tag is installed.

## Privacy-First Analytics

BlinkRoom stores hourly aggregate counters for anonymous sessions, page views, rooms created, successful/failed transfers, and transferred encrypted byte totals. Active rooms are calculated from the Room table. It never stores IP addresses, room codes/IDs, file IDs or names, URLs, email, raw User-Agent values, fingerprints, encryption metadata, or a persistent visitor identifier.

The browser creates a random UUID in `sessionStorage` and rotates it after 30 minutes of inactivity. The server stores only its SHA-256 digest for at most 30 minutes to deduplicate the visit, then retains only aggregate counters. Page-view payloads contain no URL or path.

Set `ADMIN_ANALYTICS_TOKEN` to at least 32 cryptographically random characters. `/admin/analytics` exchanges it server-side for an HttpOnly, SameSite=Strict cookie; it is never embedded in the browser bundle or accepted in a query string. The internal API also supports `Authorization: Bearer <token>`.

Run `npx prisma migrate deploy` during deployment (already part of `npm start`). Metrics begin at the first event after this migration and are never backfilled. The R2 download count means a signed download URL was successfully issued, which is the last completion point observable by the application server; local downloads are counted when the encrypted stream opens successfully.
