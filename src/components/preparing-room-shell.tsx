"use client";

import { ArrowLeft, FileUp, RotateCcw } from "lucide-react";
import { brand } from "@/src/config/brand";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function PreparingRoomShell({ files, error, onRetry, onBack }: { files: File[]; error: boolean; onRetry: () => void; onBack: () => void }) {
  return <main className="room-shell preparing-room-shell" aria-busy={!error}>
    <header className="room-header"><div className="header-main"><span className="wordmark">{brand.name}<i /></span><div className="room-code"><span>ROOM</span><strong>PREPARING</strong></div></div></header>
    <section className="timeline">
      <div className="timeline-intro"><span>SHARED IN THIS ROOM</span><p>{error ? "Room creation needs your attention." : "Preparing your temporary room…"}</p></div>
      {!error && <p className="preparing-room-notice" role="status">Preparing your room… This may take a little while.</p>}
      <div className="items">{files.map((file, index) => <div className="upload-card" key={`${file.name}:${file.size}:${index}`}><FileUp /><div><strong>{file.name}</strong><small>{fileSize(file.size)}</small><span>{error ? "Waiting to retry" : "Preparing upload…"}</span><i><b className={error ? undefined : "indeterminate"} /></i></div></div>)}</div>
      {error && <div className="preparing-room-error"><strong>Couldn’t create the room.</strong><p>Your files are still available in this browser tab.</p><div><button className="button filled" onClick={onRetry}><RotateCcw />Try again</button><button className="button" onClick={onBack}><ArrowLeft />Back</button></div></div>}
    </section>
  </main>;
}
