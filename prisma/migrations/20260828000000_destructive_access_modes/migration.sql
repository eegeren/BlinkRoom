CREATE TYPE "AccessMode" AS ENUM ('STANDARD', 'VIEW_ONCE', 'BURN_AFTER_DOWNLOAD');

ALTER TABLE "UploadSession"
ADD COLUMN "accessMode" "AccessMode" NOT NULL DEFAULT 'STANDARD';

ALTER TABLE "RoomItem"
ADD COLUMN "accessMode" "AccessMode" NOT NULL DEFAULT 'STANDARD';

UPDATE "UploadSession"
SET "accessMode" = 'BURN_AFTER_DOWNLOAD'
WHERE "oneTime" = true;

UPDATE "RoomItem"
SET "accessMode" = 'BURN_AFTER_DOWNLOAD'
WHERE "oneTime" = true;
