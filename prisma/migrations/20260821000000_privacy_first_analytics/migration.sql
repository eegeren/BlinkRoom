CREATE TABLE "AnalyticsHourly" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "sessions" BIGINT NOT NULL DEFAULT 0,
    "pageViews" BIGINT NOT NULL DEFAULT 0,
    "roomsCreated" BIGINT NOT NULL DEFAULT 0,
    "filesUploaded" BIGINT NOT NULL DEFAULT 0,
    "filesDownloaded" BIGINT NOT NULL DEFAULT 0,
    "uploadBytes" BIGINT NOT NULL DEFAULT 0,
    "downloadBytes" BIGINT NOT NULL DEFAULT 0,
    "failedUploads" BIGINT NOT NULL DEFAULT 0,
    "failedDownloads" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "AnalyticsHourly_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AnalyticsHourly_bucketStart_key" ON "AnalyticsHourly"("bucketStart");

CREATE TABLE "AnalyticsSessionDedupe" (
    "sessionHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalyticsSessionDedupe_pkey" PRIMARY KEY ("sessionHash")
);
CREATE INDEX "AnalyticsSessionDedupe_expiresAt_idx" ON "AnalyticsSessionDedupe"("expiresAt");
