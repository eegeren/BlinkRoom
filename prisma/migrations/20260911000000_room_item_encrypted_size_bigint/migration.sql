-- RoomItem.encryptedSize was Int32 (max ~2.147 GB), which silently overflows
-- for files above ~2 GB even though the 5 GB upload cap allows them through
-- multipart upload. Widen it to match UploadSession.encryptedSize (BigInt).
ALTER TABLE "RoomItem" ALTER COLUMN "encryptedSize" TYPE BIGINT;
