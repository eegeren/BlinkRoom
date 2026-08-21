"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileUp, RotateCcw } from "lucide-react";
import { brand } from "@/src/config/brand";
import { clearPendingRoomCreation, getPendingRoomCreation, retryPendingRoomCreation, startPendingRoomCreation } from "@/src/lib/pending-room-creation";
import { setPendingRoomUpload } from "@/src/lib/pending-room-upload";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function PreparingRoom() {
  const router = useRouter();
  const [pending] = useState(() => getPendingRoomCreation());
  const [error, setError] = useState(false);
  const activeAttempt = useRef(0);
  const finishCreation = useCallback((promise: ReturnType<typeof startPendingRoomCreation>) => {
    if (!promise || !pending) { router.replace("/"); return () => undefined; }
    const attempt = ++activeAttempt.current;
    promise.then((room) => {
      if (activeAttempt.current !== attempt) return;
      setPendingRoomUpload(room.slug, pending.files);
      clearPendingRoomCreation();
      router.replace(`/r/${room.slug}#${room.roomKey}`);
    }).catch(() => { if (activeAttempt.current === attempt) setError(true); });
    return () => { if (activeAttempt.current === attempt) activeAttempt.current += 1; };
  }, [pending, router]);
  useEffect(() => finishCreation(startPendingRoomCreation()), [finishCreation]);
  function retry() { setError(false); finishCreation(retryPendingRoomCreation()); }
  function backHome() { activeAttempt.current += 1; clearPendingRoomCreation(); router.replace("/"); }
  if (!pending) return <div className="room-loading"><span className="wordmark">{brand.name}<i /></span><div className="loader" /></div>;
  return <main className="room-shell preparing-room-shell">
    <header className="room-header"><div className="header-main"><span className="wordmark">{brand.name}<i /></span><div className="room-code"><span>ROOM</span><strong>PREPARING</strong></div></div></header>
    <section className="timeline">
      <div className="timeline-intro"><span>SHARED IN THIS ROOM</span><p>{error ? "Room creation needs your attention." : "Preparing your temporary room…"}</p></div>
      <div className="items">{pending.files.map((file, index) => <div className="upload-card" key={`${file.name}:${file.size}:${index}`}><FileUp /><div><strong>{file.name}</strong><small>{fileSize(file.size)}</small><span>{error ? "Waiting to retry" : "Preparing upload…"}</span><i><b style={{ width: "0%" }} /></i></div></div>)}</div>
      {error && <div className="preparing-room-error"><strong>Couldn’t create the room.</strong><p>Your files are still available in this browser tab.</p><div><button className="button filled" onClick={retry}><RotateCcw />Retry</button><button className="button" onClick={backHome}><ArrowLeft />Back to home</button></div></div>}
    </section>
  </main>;
}
