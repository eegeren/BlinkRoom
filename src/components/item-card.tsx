"use client";
import { useState } from "react";
import { ArrowDown, ArrowUpRight, Check, Copy, File, Link2, Trash2 } from "lucide-react";
import type { DecryptedItem } from "@/src/lib/types";
const size = (n: number | null) => !n ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`;
const looksLikeCode = (value: string) => value.includes("\n") || /^(?:npm|pnpm|yarn|git|curl|const|let|function|SELECT|docker)\b/.test(value);
export function ItemCard({ item, you, onDelete, onPreview, onDownload }: { item: DecryptedItem; you: boolean; onDelete: () => void; onPreview: () => void; onDownload: () => void }) {
  const [copied, setCopied] = useState(false); const when = new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); async function copy() { await navigator.clipboard.writeText(item.textContent ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1400); }
  const meta = <div className="editorial-meta"><span>{you ? "YOU" : item.senderName.toUpperCase()} · {when}</span>{you && <button onClick={onDelete} title="Delete"><Trash2 /></button>}</div>;
  if (item.type === "TEXT") return <article className="editorial-item text-item">{meta}<div className="editorial-body"><div className={looksLikeCode(item.textContent ?? "") ? "text-content pre" : "text-content"}>{item.textContent}</div><button className="text-action" onClick={copy}>{copied ? <><Check/> Copied</> : <><Copy/> Copy</>}</button></div></article>;
  if (item.type === "LINK") return <article className="editorial-item link-item">{meta}<div className="link-mark"><Link2 /></div><div className="link-content"><strong>{new URL(item.textContent!).hostname}</strong><span>{item.textContent}</span><div><a href={item.textContent!} target="_blank" rel="noreferrer">Open <ArrowUpRight/></a><button onClick={copy}>{copied ? "Copied" : "Copy"}</button></div></div></article>;
  if (item.type === "IMAGE") return <article className="editorial-item image-item">{item.objectUrl ? <button className="image-preview" onClick={onPreview}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img loading="lazy" src={item.objectUrl} alt={item.fileName ?? "Shared image"} />
  </button> : <div className="image-preview unavailable">No longer available</div>}<div className="image-caption"><div><strong>{item.fileName}</strong><span>{size(item.fileSize)} · {you ? "You" : item.senderName}</span></div>{item.locallyAvailable && <button className="item-download" onClick={onDownload}>Download <ArrowDown/></button>}</div></article>;
  return <article className="editorial-item file-item"><div className="file-glyph"><File /></div><div className="file-details"><strong>{item.fileName}</strong><span>{size(item.fileSize)}{!item.locallyAvailable ? " · No longer available" : ""}</span></div><div className="file-owner">{you ? "You" : item.senderName} · {when}</div>{item.locallyAvailable && <button className="item-download" onClick={onDownload}>Download <ArrowDown/></button>}{you && <button className="file-delete" onClick={onDelete} title="Delete"><Trash2 /></button>}</article>;
}
