ALTER TABLE "UploadSession" ADD COLUMN "uploadTokenHash" TEXT;
UPDATE "UploadSession" SET "uploadTokenHash" = md5(random()::text) WHERE "uploadTokenHash" IS NULL;
ALTER TABLE "UploadSession" ALTER COLUMN "uploadTokenHash" SET NOT NULL;
