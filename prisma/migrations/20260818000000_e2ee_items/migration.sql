ALTER TABLE "RoomItem"
  DROP COLUMN "senderName",
  DROP COLUMN "textContent",
  DROP COLUMN "fileName",
  DROP COLUMN "fileSize",
  DROP COLUMN "mimeType",
  ADD COLUMN "encryptedPayload" TEXT,
  ADD COLUMN "encryptedMetadata" TEXT,
  ADD COLUMN "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "encryptedSize" INTEGER;
