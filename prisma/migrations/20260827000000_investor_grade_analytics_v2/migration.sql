CREATE TABLE "AnalyticsProductEvent" (
  "id" TEXT NOT NULL, "eventType" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 2, "clientHash" TEXT,
  "sessionHash" TEXT, "roomHash" TEXT, "fileHash" TEXT,
  "attemptHash" TEXT, "bytes" BIGINT, "dedupeKey" TEXT NOT NULL,
  CONSTRAINT "AnalyticsProductEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsProductEvent_dedupeKey_key" ON "AnalyticsProductEvent"("dedupeKey");
CREATE INDEX "AnalyticsProductEvent_occurredAt_idx" ON "AnalyticsProductEvent"("occurredAt");
CREATE INDEX "AnalyticsProductEvent_eventType_occurredAt_idx" ON "AnalyticsProductEvent"("eventType", "occurredAt");
CREATE INDEX "AnalyticsProductEvent_roomHash_occurredAt_idx" ON "AnalyticsProductEvent"("roomHash", "occurredAt");
CREATE INDEX "AnalyticsProductEvent_fileHash_occurredAt_idx" ON "AnalyticsProductEvent"("fileHash", "occurredAt");
CREATE INDEX "AnalyticsProductEvent_clientHash_occurredAt_idx" ON "AnalyticsProductEvent"("clientHash", "occurredAt");
CREATE TABLE "AnalyticsSuccessfulFile" (
  "fileHash" TEXT NOT NULL, "roomHash" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsSuccessfulFile_pkey" PRIMARY KEY ("fileHash")
);
CREATE INDEX "AnalyticsSuccessfulFile_completedAt_idx" ON "AnalyticsSuccessfulFile"("completedAt");
CREATE INDEX "AnalyticsSuccessfulFile_roomHash_completedAt_idx" ON "AnalyticsSuccessfulFile"("roomHash", "completedAt");
CREATE TABLE "AnalyticsDiagnosticsHourly" (
  "bucketStart" TIMESTAMP(3) NOT NULL, "duplicateEvents" BIGINT NOT NULL DEFAULT 0,
  "selfDownloadsExcluded" BIGINT NOT NULL DEFAULT 0,
  "transferDeduplications" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "AnalyticsDiagnosticsHourly_pkey" PRIMARY KEY ("bucketStart")
);
CREATE INDEX "AnalyticsDiagnosticsHourly_bucketStart_idx" ON "AnalyticsDiagnosticsHourly"("bucketStart");
-- Legacy counters remain untouched. V2 starts here; old downloads cannot be reconstructed safely.
