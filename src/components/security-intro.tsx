"use client";

import { ArrowRight, Clock3, Radio, Trash2, UserRoundCheck, UsersRound, X } from "lucide-react";
import { useState } from "react";
import { brand } from "@/src/config/brand";

const features = [
  { icon: Clock3, title: "Temporary by default", text: "Rooms and files are temporary and expire automatically." },
  { icon: UsersRound, title: "Destroy when everyone leaves", text: "An optional room control that destroys the room after the last participant leaves." },
  { icon: Radio, title: "Direct transfers only", text: "An optional mode that transfers files directly between participants without temporary storage." },
  { icon: Trash2, title: "Destroy anytime", text: "Room owners can manually destroy a room when it is no longer needed." },
  { icon: UserRoundCheck, title: "No account required", text: "Create and join rooms without creating a permanent BlinkRoom account." },
];

export function SecurityIntro({ onContinue, revisiting = false }: { onContinue: () => void; revisiting?: boolean }) {
  const [leaving, setLeaving] = useState(false);
  function leave() {
    setLeaving(true);
    window.setTimeout(onContinue, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
  }
  return (
    <section className={`security-intro${revisiting ? " revisiting" : ""}${leaving ? " leaving" : ""}`} aria-modal={revisiting ? "true" : undefined} role={revisiting ? "dialog" : undefined} aria-labelledby="security-intro-title">
      <header><span className="wordmark">{brand.name}<i /></span>{revisiting && <button className="security-intro-close" onClick={leave} aria-label="Close security information"><X /></button>}</header>
      <div className="security-intro-content">
        <div className="security-intro-copy"><p className="security-intro-kicker">HOW BLINKROOM WORKS</p><h1 id="security-intro-title">Built to share.<br />Designed to disappear.</h1><p>BlinkRoom gives you control over how your files are shared, how long they exist, and when they disappear.</p></div>
        <div className="security-feature-list">{features.map(({ icon: Icon, title, text }) => <article key={title}><Icon aria-hidden="true" /><div><h2>{title}</h2><p>{text}</p></div></article>)}</div>
      </div>
      <footer><button className="security-continue" onClick={leave}>Continue to BlinkRoom <ArrowRight /></button></footer>
    </section>
  );
}
