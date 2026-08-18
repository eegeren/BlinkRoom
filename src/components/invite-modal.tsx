"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Share2, X } from "lucide-react";
import { trackEvent } from "@/src/lib/analytics";

export function InviteModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [qr, setQr] = useState(""); const [copied, setCopied] = useState(false);
  useEffect(() => { QRCode.toDataURL(url, { width: 360, margin: 1, color: { dark: "#111111", light: "#ffffff" } }).then(setQr); }, [url]);
  async function copy() { await navigator.clipboard.writeText(url); trackEvent("invite_copied", { method: "copy_link" }); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal invite-modal" onMouseDown={(e) => e.stopPropagation()}>
    <button className="modal-close" onClick={onClose}><X /></button><div className="modal-kicker">INVITE PEOPLE</div><h2>Bring someone in.</h2><p>Anyone with this link can access this room.</p><small className="invite-security">The encryption key is part of the invite link and is never sent to BlinkRoom’s servers.</small>
    <div className="qr-wrap">{qr && <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code for room link" />
    </>}</div><label>Room link</label><div className="copy-field"><span>{url}</span><button onClick={copy}>{copied ? <Check /> : <Copy />}</button></div>
    <div className="modal-actions"><button className="button filled" onClick={copy}>{copied ? "Copied." : "Copy link"}</button>{typeof navigator !== "undefined" && "share" in navigator && <button className="button" onClick={async () => { await navigator.share({ title: "Join my BlinkRoom", url }); trackEvent("invite_copied", { method: "native_share" }); }}><Share2 /> Share</button>}</div>
  </section></div>;
}
