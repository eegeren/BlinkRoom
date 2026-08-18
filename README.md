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
