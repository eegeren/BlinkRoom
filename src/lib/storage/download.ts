type Fetcher = typeof fetch;
export async function getEncryptedFileSource(slug: string, itemId: string, fetcher: Fetcher = fetch) {
  const response = await fetcher(`/api/rooms/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/download`, { cache: "no-store" });
  if (!response.ok) throw new Error("Encrypted file unavailable");
  const payload = await response.json() as { url?: string };
  if (!payload.url) throw new Error("Encrypted file unavailable");
  return payload.url;
}
export async function fetchEncryptedFile(slug: string, itemId: string, fetcher: Fetcher = fetch) {
  const source = await getEncryptedFileSource(slug, itemId, fetcher);
  const response = await fetcher(source, { cache: "no-store" });
  if (!response.ok) throw new Error("Encrypted file unavailable");
  return response.blob();
}
