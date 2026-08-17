CREATE TYPE "ItemAvailability" AS ENUM ('DIRECT', 'STORED', 'HYBRID');
ALTER TABLE "RoomItem" ADD COLUMN "availability" "ItemAvailability" NOT NULL DEFAULT 'STORED';
