"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { coarseDeviceLabel, type RoomDeviceSummary } from "@/src/lib/device-approval-notifications";

type Result = "approved" | "denied" | null;

export function DeviceApprovalNotification({
  requests,
  onDecision,
}: {
  requests: RoomDeviceSummary[];
  onDecision: (requestId: string, action: "approve" | "deny") => Promise<boolean>;
}) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [exiting, setExiting] = useState(false);
  const [resolvedDevice, setResolvedDevice] = useState<RoomDeviceSummary | null>(null);
  const timer = useRef<number | null>(null);
  const exitTimer = useRef<number | null>(null);
  const active = result ? resolvedDevice : requests[0];

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
  }, []);

  if (!active) return null;

  async function decide(action: "approve" | "deny") {
    if (processing || result || !active) return;
    setProcessing(true);
    const succeeded = await onDecision(active.id, action).catch(() => false);
    if (!succeeded) {
      setProcessing(false);
      return;
    }
    setResolvedDevice(active);
    setResult(action === "approve" ? "approved" : "denied");
    timer.current = window.setTimeout(() => setExiting(true), 1800);
    exitTimer.current = window.setTimeout(() => {
      setResult(null);
      setResolvedDevice(null);
      setExiting(false);
      setProcessing(false);
      exitTimer.current = null;
    }, 2000);
  }

  return (
    <aside className={`device-approval-notification${exiting ? " exiting" : ""}`} aria-live="polite" aria-atomic="true">
      <div className={`device-approval-icon${result ? ` ${result}` : ""}`} aria-hidden="true">
        {result === "approved" ? <Check /> : <ShieldCheck />}
      </div>
      <div className="device-approval-copy">
        <strong>{result === "approved" ? "Device approved" : result === "denied" ? "Device denied" : "Device wants to join"}</strong>
        {!result && <><span>{coarseDeviceLabel(active)}</span><small>Waiting for your approval</small></>}
      </div>
      {!result && (
        <div className="device-approval-actions">
          <button type="button" onClick={() => void decide("deny")} disabled={processing} aria-label={`Deny ${coarseDeviceLabel(active)}`}>Deny</button>
          <button type="button" className="approve" onClick={() => void decide("approve")} disabled={processing} aria-label={`Approve ${coarseDeviceLabel(active)}`}>Approve</button>
        </div>
      )}
      {!result && requests.length > 1 && <small className="device-approval-more">{requests.length - 1} more request{requests.length === 2 ? "" : "s"}</small>}
    </aside>
  );
}
