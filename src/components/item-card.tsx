"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Copy,
  File,
  Image as ImageIcon,
  Link2,
  Trash2,
} from "lucide-react";

import type { DecryptedItem } from "@/src/lib/types";

const size = (n: number | null) =>
  !n
    ? ""
    : n >= 1048576
      ? `${(n / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.ceil(n / 1024))} KB`;

const looksLikeCode = (value: string) =>
  value.includes("\n") ||
  /^(?:npm|pnpm|yarn|git|curl|const|let|function|SELECT|docker)\b/.test(
    value,
  );

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

  if (item.type === "TEXT") {
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
  }

  if (item.type === "LINK") {
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

            <button onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </article>
    );
  }

  if (item.type === "IMAGE") {
    const available =
      item.locallyAvailable && item.oneTimeStatus !== "CONSUMED";

    return (
      <article className="editorial-item compact-file-row image-file-row">
        <button
          type="button"
          className={`compact-file-preview ${
            item.objectUrl ? "has-image" : ""
          }`}
          onClick={item.objectUrl ? onPreview : undefined}
          disabled={!item.objectUrl}
          aria-label={
            item.objectUrl
              ? `Preview ${item.fileName ?? "image"}`
              : "Image unavailable"
          }
        >
          {item.objectUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              loading="lazy"
              src={item.objectUrl}
              alt={item.fileName ?? "Shared image"}
            />
          ) : (
            <ImageIcon />
          )}
        </button>

        <div className="compact-file-details">
          <button
            type="button"
            className="compact-file-name"
            onClick={item.objectUrl ? onPreview : undefined}
            disabled={!item.objectUrl}
          >
            {item.fileName ?? "Shared image"}
          </button>

          <span>
            {size(item.fileSize)}
            {size(item.fileSize) ? " · " : ""}
            {you ? "You" : item.senderName}
            {" · "}
            {when}
            {item.oneTime ? " · Open once" : ""}
            {!available ? " · No longer available" : ""}
          </span>
        </div>

        <div className="compact-file-actions">
          {available && (
            <button
              className="item-download compact-download"
              onClick={onDownload}
              title={item.oneTime ? "Open once" : "Download"}
            >
              <span>{item.oneTime ? "Open once" : "Download"}</span>
              <ArrowDown />
            </button>
          )}

          {you && (
            <button
              className="file-delete compact-delete"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 />
            </button>
          )}
        </div>
      </article>
    );
  }

  const available =
    item.locallyAvailable && item.oneTimeStatus !== "CONSUMED";

  return (
    <article className="editorial-item compact-file-row">
      <div className="compact-file-preview file-icon-preview">
        <File />
      </div>

      <div className="compact-file-details">
        <strong className="compact-file-name static">
          {item.fileName ?? "File"}
        </strong>

        <span>
          {size(item.fileSize)}
          {size(item.fileSize) ? " · " : ""}
          {you ? "You" : item.senderName}
          {" · "}
          {when}
          {item.oneTime ? " · Open once" : ""}
          {!available ? " · No longer available" : ""}
        </span>
      </div>

      <div className="compact-file-actions">
        {available && (
          <button
            className="item-download compact-download"
            onClick={onDownload}
            title={item.oneTime ? "Open once" : "Download"}
          >
            <span>{item.oneTime ? "Open once" : "Download"}</span>
            <ArrowDown />
          </button>
        )}

        {you && (
          <button
            className="file-delete compact-delete"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 />
          </button>
        )}
      </div>
    </article>
  );
}