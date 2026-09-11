"use client";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Copy,
  File,
  FileArchive,
  FileText,
  Link2,
  Trash2,
  Video,
} from "lucide-react";
import type { DecryptedItem } from "@/src/lib/types";
import { MetadataProtectionIndicator } from "@/src/components/metadata-protection-indicator";
import styles from "./item-card.module.css";
const size = (n: number | null) =>
  !n
    ? ""
    : n >= 1024 ** 3
      ? `${(n / 1024 ** 3).toFixed(1)} GB`
      : n >= 1048576
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${Math.max(1, Math.ceil(n / 1024))} KB`;
const looksLikeCode = (value: string) =>
  value.includes("\n") ||
  /^(?:npm|pnpm|yarn|git|curl|const|let|function|SELECT|docker)\b/.test(value);
const fileKind = (item: DecryptedItem) => {
  const extension = item.fileName?.split(".").pop();
  if (extension && extension !== item.fileName && extension.length <= 6)
    return extension.toUpperCase();
  return item.mimeType?.split("/").pop()?.toUpperCase() ?? "FILE";
};
const fileIcon = (mimeType: string | null) => {
  if (mimeType === "application/pdf") return <FileText />;
  if (mimeType?.startsWith("video/")) return <Video />;
  if (mimeType && /(?:zip|rar|7z|tar|gzip|archive)/i.test(mimeType))
    return <FileArchive />;
  return <File />;
};
export function ItemCard({
  item,
  you,
  onDelete,
  onPreview,
  onDownload,
}: {
  item: DecryptedItem;
  you: boolean;
  onDelete: () => void;
  onPreview: () => void;
  onDownload: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const when = new Date(item.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  async function copy() {
    await navigator.clipboard.writeText(item.textContent ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  const meta = (
    <div className="editorial-meta">
      <span>
        {you ? "YOU" : item.senderName.toUpperCase()} · {when}
      </span>
      {you && (
        <button onClick={onDelete} title="Delete">
          <Trash2 />
        </button>
      )}
    </div>
  );
  if (item.type === "TEXT")
    return (
      <article className="editorial-item text-item">
        {meta}
        <div className="editorial-body">
          <div
            className={
              looksLikeCode(item.textContent ?? "")
                ? "text-content pre"
                : "text-content"
            }
          >
            {item.textContent}
          </div>
          <button className="text-action" onClick={copy}>
            {copied ? (
              <>
                <Check /> Copied
              </>
            ) : (
              <>
                <Copy /> Copy
              </>
            )}
          </button>
        </div>
      </article>
    );
  if (item.type === "LINK")
    return (
      <article className="editorial-item link-item">
        {meta}
        <div className="link-mark">
          <Link2 />
        </div>
        <div className="link-content">
          <strong>{new URL(item.textContent!).hostname}</strong>
          <span>{item.textContent}</span>
          <div>
            <a href={item.textContent!} target="_blank" rel="noreferrer">
              Open <ArrowUpRight />
            </a>
            <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      </article>
    );
  const isImage = item.type === "IMAGE";
  return (
    <article className={`editorial-item file-item ${styles.fileRow}`}>
      {isImage && item.objectUrl ? (
        <button
          className={styles.thumbnail}
          onClick={onPreview}
          aria-label={`Preview ${item.fileName ?? "image"}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img loading="lazy" src={item.objectUrl} alt="" />
        </button>
      ) : (
        <div className={`file-glyph ${styles.filePreview}`}>
          {fileIcon(item.mimeType)}
        </div>
      )}
      <div className={`file-details ${styles.details}`}>
        <div className={styles.titleLine}>
          <strong title={item.fileName ?? undefined}>{item.fileName}</strong>
          {item.metadataProtected && <MetadataProtectionIndicator file />}
        </div>
        <span className={styles.metadata}>
          {fileKind(item)} · {size(item.fileSize)} · {when}
          {!item.locallyAvailable || item.oneTimeStatus === "CONSUMED"
            ? " · No longer available"
            : item.accessMode === "VIEW_ONCE"
              ? " · 👁 View once"
              : item.accessMode === "BURN_AFTER_DOWNLOAD" || item.oneTime
                ? " · 🔥 Burns after download"
              : ""}
        </span>
      </div>
      <div className={`file-owner ${styles.owner}`}>
        {you ? "You" : item.senderName} · {when}
      </div>
      {item.locallyAvailable && item.oneTimeStatus !== "CONSUMED" && (
        <button className={`item-download ${styles.download}`} onClick={onDownload}>
          <span>{item.accessMode === "VIEW_ONCE" ? "View once" : item.oneTime ? "Download once" : "Download"}</span> <ArrowDown />
        </button>
      )}
      {you && (
        <button className={`file-delete ${styles.remove}`} onClick={onDelete} title="Delete">
          <Trash2 />
        </button>
      )}
    </article>
  );
}
