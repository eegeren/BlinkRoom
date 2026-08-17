CREATE TYPE "RoomStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DESTROYED');
CREATE TYPE "ItemType" AS ENUM ('TEXT', 'LINK', 'IMAGE', 'FILE');
CREATE TABLE "Room" ("id" TEXT NOT NULL, "slug" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL, "destroyedAt" TIMESTAMP(3), "ownerTokenHash" TEXT NOT NULL, "status" "RoomStatus" NOT NULL DEFAULT 'ACTIVE', CONSTRAINT "Room_pkey" PRIMARY KEY ("id"));
CREATE TABLE "RoomItem" ("id" TEXT NOT NULL, "roomId" TEXT NOT NULL, "senderId" TEXT NOT NULL, "senderName" TEXT NOT NULL, "type" "ItemType" NOT NULL, "textContent" TEXT, "fileName" TEXT, "fileSize" INTEGER, "mimeType" TEXT, "storageKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RoomItem_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Room_slug_key" ON "Room"("slug");
CREATE INDEX "Room_status_expiresAt_idx" ON "Room"("status", "expiresAt");
CREATE INDEX "RoomItem_roomId_createdAt_idx" ON "RoomItem"("roomId", "createdAt");
ALTER TABLE "RoomItem" ADD CONSTRAINT "RoomItem_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
