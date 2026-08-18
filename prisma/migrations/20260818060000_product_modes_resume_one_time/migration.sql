CREATE TYPE "OneTimeStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'CONSUMED');

ALTER TABLE "Room"
  ADD COLUMN "autoDestroyWhenEmpty" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "autoDestroyEmptySince" TIMESTAMP(3),
  ADD COLUMN "directOnly" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "UploadSession"
  ADD COLUMN "oneTime" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fileFingerprint" TEXT,
  ADD COLUMN "partSize" INTEGER NOT NULL DEFAULT 10485760,
  ADD COLUMN "totalParts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "RoomItem"
  ADD COLUMN "oneTime" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "oneTimeStatus" "OneTimeStatus" NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN "consumeTokenHash" TEXT,
  ADD COLUMN "consumeReservedAt" TIMESTAMP(3),
  ADD COLUMN "consumedAt" TIMESTAMP(3);

CREATE TABLE "UploadPart" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "partNumber" INTEGER NOT NULL,
  "etag" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadPart_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UploadPart_sessionId_partNumber_key" ON "UploadPart"("sessionId", "partNumber");
CREATE INDEX "UploadPart_sessionId_idx" ON "UploadPart"("sessionId");
ALTER TABLE "UploadPart" ADD CONSTRAINT "UploadPart_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UploadSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RoomPresence" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "socketId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoomPresence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RoomPresence_socketId_key" ON "RoomPresence"("socketId");
CREATE INDEX "RoomPresence_roomId_expiresAt_idx" ON "RoomPresence"("roomId", "expiresAt");
ALTER TABLE "RoomPresence" ADD CONSTRAINT "RoomPresence_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
