"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { brand } from "@/src/config/brand";
import { clearPendingRoomCreation, getPendingRoomCreation, retryPendingRoomCreation, startPendingRoomCreation } from "@/src/lib/pending-room-creation";
import { setPendingRoomUpload } from "@/src/lib/pending-room-upload";
import { PreparingRoomShell } from "@/src/components/preparing-room-shell";

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
  return <PreparingRoomShell files={pending.files} error={error} onRetry={retry} onBack={backHome} />;
}
