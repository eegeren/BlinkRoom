"use client";

import { useId } from "react";
import { LockKeyhole } from "lucide-react";
import { metadataProtectionCopy } from "@/src/lib/metadata-protection-copy";

export function MetadataProtectionIndicator({
  detail = false,
  file = false,
}: {
  detail?: boolean;
  file?: boolean;
}) {
  const tooltipId = useId();
  return (
    <span className={`metadata-protection${file ? " file-metadata-protection" : ""}`}>
      <button
        type="button"
        aria-label={metadataProtectionCopy.tooltip}
        aria-describedby={tooltipId}
      >
        <LockKeyhole aria-hidden="true" />
        <span>{metadataProtectionCopy.label}</span>
      </button>
      {detail && <small>{metadataProtectionCopy.shortDescription}</small>}
      <span className="metadata-protection-tooltip" id={tooltipId} role="tooltip">
        {metadataProtectionCopy.tooltip}
      </span>
    </span>
  );
}
