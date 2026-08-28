CREATE TYPE "DeviceApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'REVOKED', 'EXPIRED');

ALTER TABLE "Room"
ADD COLUMN "deviceApprovalRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "RoomDevice" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "deviceIdHash" TEXT NOT NULL,
  "sessionTokenHash" TEXT,
  "accessVersion" INTEGER NOT NULL,
  "status" "DeviceApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "browserLabel" TEXT NOT NULL,
  "platformLabel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "deniedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoomDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoomDevice_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RoomDevice_roomId_deviceIdHash_key" ON "RoomDevice"("roomId", "deviceIdHash");
CREATE INDEX "RoomDevice_roomId_status_idx" ON "RoomDevice"("roomId", "status");
CREATE INDEX "RoomDevice_status_expiresAt_idx" ON "RoomDevice"("status", "expiresAt");
