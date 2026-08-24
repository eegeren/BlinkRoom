CREATE TABLE "AnalyticsVisitor" (
  "visitorHash" TEXT NOT NULL,
  "firstSeen" TIMESTAMP(3) NOT NULL,
  "lastSeen" TIMESTAMP(3) NOT NULL,
  "firstSource" TEXT NOT NULL,
  CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("visitorHash")
);
CREATE INDEX "AnalyticsVisitor_lastSeen_idx" ON "AnalyticsVisitor"("lastSeen");
CREATE INDEX "AnalyticsVisitor_firstSource_idx" ON "AnalyticsVisitor"("firstSource");

CREATE TABLE "AnalyticsVisitorDay" (
  "visitorHash" TEXT NOT NULL,
  "day" TIMESTAMP(3) NOT NULL,
  "returning" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "AnalyticsVisitorDay_pkey" PRIMARY KEY ("visitorHash", "day"),
  CONSTRAINT "AnalyticsVisitorDay_visitorHash_fkey" FOREIGN KEY ("visitorHash") REFERENCES "AnalyticsVisitor"("visitorHash") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AnalyticsVisitorDay_day_returning_idx" ON "AnalyticsVisitorDay"("day", "returning");

CREATE TABLE "AnalyticsSuccessfulTransfer" (
  "roomHash" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsSuccessfulTransfer_pkey" PRIMARY KEY ("roomHash")
);
CREATE INDEX "AnalyticsSuccessfulTransfer_completedAt_idx" ON "AnalyticsSuccessfulTransfer"("completedAt");

CREATE TABLE "AnalyticsDownloadDedupe" (
  "actionHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnalyticsDownloadDedupe_pkey" PRIMARY KEY ("actionHash")
);
CREATE INDEX "AnalyticsDownloadDedupe_expiresAt_idx" ON "AnalyticsDownloadDedupe"("expiresAt");
