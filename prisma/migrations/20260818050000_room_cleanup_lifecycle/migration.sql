CREATE TYPE "CleanupStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PARTIAL', 'COMPLETED');
ALTER TABLE "Room"
  ADD COLUMN "cleanupStatus" "CleanupStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cleanupLastError" TEXT,
  ADD COLUMN "cleanupUpdatedAt" TIMESTAMP(3);
CREATE INDEX "Room_status_cleanupStatus_idx" ON "Room"("status", "cleanupStatus");
