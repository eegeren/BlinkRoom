export type ItemType = "TEXT" | "LINK" | "IMAGE" | "FILE";
export type EncryptedEnvelope = {
  version: 1;
  algorithm: "AES-GCM";
  iv: string;
  ciphertext: string;
};
export type ItemAvailability = "DIRECT" | "STORED" | "HYBRID";
export type AccessMode = "STANDARD" | "VIEW_ONCE" | "BURN_AFTER_DOWNLOAD";
export type PublicItem = {
  id: string;
  senderId: string;
  type: ItemType;
  encryptedPayload: string | null;
  encryptedMetadata: string | null;
  encryptionVersion: number;
  encryptedSize: number | null;
  availability: ItemAvailability;
  oneTime: boolean;
  accessMode: AccessMode;
  oneTimeStatus: "AVAILABLE" | "RESERVED" | "CONSUMED";
  createdAt: string;
};
export type PublicRoom = {
  slug: string;
  cryptoContext: string;
  accessVersion: number;
  status: "ACTIVE" | "EXPIRED" | "DESTROYED";
  expiresAt: string;
  encryptedVerifier: string | null;
  encryptionVersion: number;
  autoDestroyWhenEmpty: boolean;
  directOnly: boolean;
  deviceApprovalRequired: boolean;
  items: PublicItem[];
};
export type DecryptedItem = PublicItem & {
  senderName: string;
  textContent: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  metadataProtected?: boolean;
  objectUrl?: string;
  locallyAvailable?: boolean;
};
