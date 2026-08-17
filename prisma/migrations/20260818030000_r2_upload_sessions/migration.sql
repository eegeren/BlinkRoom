CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'COMPLETED', 'ABORTED', 'FAILED');
CREATE TABLE "UploadSession" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "itemType" "ItemType" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "multipartUploadId" TEXT,
  "encryptedMetadata" TEXT NOT NULL,
  "encryptedSize" BIGINT NOT NULL,
  "directDelivered" BOOLEAN NOT NULL DEFAULT false,
  "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UploadSession_itemId_key" ON "UploadSession"("itemId");
CREATE UNIQUE INDEX "UploadSession_storageKey_key" ON "UploadSession"("storageKey");
CREATE INDEX "UploadSession_roomId_status_idx" ON "UploadSession"("roomId", "status");
CREATE INDEX "UploadSession_status_createdAt_idx" ON "UploadSession"("status", "createdAt");
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
