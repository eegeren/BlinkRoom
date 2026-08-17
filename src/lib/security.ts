import { createHash, randomBytes } from "node:crypto";
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ownerToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function roomSlug() {
  const bytes = randomBytes(6);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
export const sanitizeFilename = (name: string) => name.normalize("NFKC").replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\.{2,}/g, ".").slice(0, 180) || "file";
export const validUrl = (value: string) => { try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol); } catch { return false; } };
export const ephemeralRequestKey = (parts: Array<string | null | undefined>) => createHash("sha256").update(parts.filter(Boolean).join("|")).digest("base64url").slice(0, 22);
