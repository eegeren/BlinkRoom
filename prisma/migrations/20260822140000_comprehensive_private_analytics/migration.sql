ALTER TABLE "AnalyticsHourly"
ADD COLUMN "uploadDurationMs" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "downloadDurationMs" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "desktopSessions" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "mobileSessions" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "tabletSessions" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "chromeSessions" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "safariSessions" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "firefoxSessions" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "edgeSessions" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "otherBrowserSessions" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "AnalyticsRecentEvent" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsRecentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnalyticsRecentEvent_createdAt_idx" ON "AnalyticsRecentEvent"("createdAt");
