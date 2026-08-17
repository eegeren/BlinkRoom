ALTER TABLE "Room" ADD COLUMN "encryptedVerifier" TEXT, ADD COLUMN "encryptionVersion" INTEGER NOT NULL DEFAULT 1;
