import "server-only";

import Link from "next/link";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { brand } from "@/src/config/brand";
import { roomDurations } from "@/src/lib/duration";
import { env } from "@/src/lib/env";
import { SeoCreateRoom } from "./seo-create-room";

function formatMegabytes(megabytes: number) {
  if (megabytes >= 1024 && megabytes % 1024 === 0) {
    return `${megabytes / 1024} GB`;
  }
  return `${megabytes} MB`;
}

type GuideRow = {
  label: string;
  text: string;
};

function GuideRows({ rows }: { rows: GuideRow[] }) {
  return (
    <dl className="guide-rows">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function HowToUsePage() {
  const durationLabels = roomDurations.map((duration) => duration.label);
  const limits = [
    { label: "Maximum file size", value: formatMegabytes(env.MAX_FILE_SIZE_MB) },
    { label: "Temporary room storage", value: formatMegabytes(env.MAX_ROOM_STORAGE_MB) },
    { label: "Items per room", value: String(env.MAX_ROOM_ITEMS) },
    { label: "Concurrent uploads", value: String(env.MAX_CONCURRENT_UPLOADS) },
    { label: "Direct-transfer peers", value: `Up to ${env.MAX_DIRECT_PEERS}` },
  ];

  return (
    <div className="seo-page guide-page">
      <header className="seo-header">
        <Link className="wordmark" href="/">
          {brand.name}<i />
        </Link>
        <Link href="/" className="seo-home-link">Home</Link>
      </header>

      <main>
        <section className="seo-hero guide-hero">
          <p className="seo-eyebrow">HOW TO USE</p>
          <h1>How to use BlinkRoom</h1>
          <p className="seo-intro">Create a temporary room, add what you need and share it in a few seconds — no account required.</p>
          <SeoCreateRoom />
          <div className="seo-proof">
            <LockKeyhole aria-hidden="true" />
            <span>Files, images, text and links · Temporary by design</span>
          </div>
        </section>

        <section className="seo-steps" aria-labelledby="guide-quick-start">
          <div>
            <p className="seo-eyebrow">QUICK START</p>
            <h2 id="guide-quick-start">From home to shared.</h2>
          </div>
          <ol>
            <li><span>01</span><h3>Create or drop</h3><p>Open a room with Create a Room, or drop files on the homepage for the instant flow.</p></li>
            <li><span>02</span><h3>Add anything</h3><p>Upload files and photos, drag in multiple items, or share text and links from the composer.</p></li>
            <li><span>03</span><h3>Invite and download</h3><p>Send the room link. Recipients open it and download without creating an account.</p></li>
          </ol>
        </section>

        <section className="seo-content guide-section">
          <div>
            <p className="seo-eyebrow">START A ROOM</p>
            <h2>Choose the way in.</h2>
          </div>
          <div>
            <GuideRows rows={[
              { label: "Create a Room", text: "Select the main button to open an empty temporary room. Use the arrow beside it first if you want to choose the room lifetime." },
              { label: "Drop It", text: "Drag files anywhere over the BlinkRoom homepage. Release them when “Drop it” appears; BlinkRoom creates the room and prepares the upload automatically. Multiple files and folders are supported." },
            ]} />
            <p className="guide-note">The instant Drop It flow uses the lifetime currently selected on the homepage.</p>
          </div>
        </section>

        <section className="seo-content guide-section">
          <div>
            <p className="seo-eyebrow">ROOM LIFETIME</p>
            <h2>Available for as long as needed.</h2>
          </div>
          <div>
            <p>Choose a lifetime before creating the room. The room owner can also select the countdown in the room header and set a new lifetime from the current moment.</p>
            <div className="guide-pills" aria-label="Available room lifetimes">
              {durationLabels.map((label) => <span key={label}>{label}</span>)}
            </div>
            <p>When the countdown ends, the room can no longer be accessed. Stored encrypted objects and room metadata are cleaned up asynchronously after access has ended.</p>
          </div>
        </section>

        <section className="seo-content guide-section">
          <div>
            <p className="seo-eyebrow">ROOM CONTROLS</p>
            <h2>Settings that end access sooner.</h2>
          </div>
          <div>
            <GuideRows rows={[
              { label: "Room lifetime", text: "Changes when the active room expires. Only the room owner can update it." },
              { label: "Destroy when everyone leaves", text: "Destroys the room shortly after the last participant leaves. Turn it on for a room that should end with the session." },
              { label: "Direct transfers only", text: "Keeps new files out of temporary storage and transfers them only between connected peers. It cannot be enabled while stored files or stored uploads remain." },
              { label: "Open once", text: "Applies to the next file or photo you add. After one successful download, that item becomes unavailable." },
              { label: "Destroy room", text: "Ends access to the entire room immediately. This owner action cannot be undone; physical storage cleanup follows asynchronously." },
            ]} />
          </div>
        </section>

        <section className="seo-content guide-section">
          <div>
            <p className="seo-eyebrow">ADD TO THE ROOM</p>
            <h2>Files, photos, words and links.</h2>
          </div>
          <div>
            <GuideRows rows={[
              { label: "Choose a file", text: "Opens the file picker from an empty room. The + menu also provides Upload file and Choose photo." },
              { label: "Drag and drop", text: "Drop files or folders anywhere inside an open room. Multiple items are queued and their progress is shown separately." },
              { label: "Paste or type anything…", text: "Share text or a web link from the composer. Press Enter or the send arrow; use Shift + Enter for a new line." },
              { label: "Delete", text: "Removes an item you shared. The room owner can remove any item." },
            ]} />
            <div className="guide-limits" aria-label="Current upload limits">
              {limits.map((limit) => <div key={limit.label}><span>{limit.label}</span><strong>{limit.value}</strong></div>)}
            </div>
            <p className="guide-note">These values come from this BlinkRoom deployment’s current configuration. Empty files are rejected.</p>
          </div>
        </section>

        <section className="seo-content guide-section">
          <div>
            <p className="seo-eyebrow">UPLOAD STATUS</p>
            <h2>Know what is happening.</h2>
          </div>
          <div>
            <GuideRows rows={[
              { label: "Preparing upload…", text: "The item is queued before processing starts." },
              { label: "Encrypting", text: "BlinkRoom is encrypting the file in your browser." },
              { label: "Sending / Uploading securely", text: "The encrypted file is transferring directly to peers or to temporary storage." },
              { label: "Paused / Resuming", text: "A connection interruption paused the transfer. Use Resume, or wait while it reconnects." },
              { label: "Ready", text: "The file completed its transfer and is available in the room." },
              { label: "Retry / Remove / Cancel transfer", text: "Retry a failed upload, remove a failed or paused row, or cancel one that is still running." },
            ]} />
          </div>
        </section>

        <section className="seo-content guide-section">
          <div>
            <p className="seo-eyebrow">SHARE & RECEIVE</p>
            <h2>One room link.</h2>
          </div>
          <div>
            <GuideRows rows={[
              { label: "Invite", text: "Opens the room’s invite panel with its complete link and a QR code." },
              { label: "Copy link / Share", text: "Copy the complete room URL, or use the device share sheet when available. Anyone with the complete link may be able to access and decrypt the room." },
              { label: "Download / Open once", text: "Recipients select the action beside a file or photo. Open-once items become unavailable after one successful download." },
              { label: "Download All", text: "When at least two downloadable files are present, packages them into a BlinkRoom ZIP." },
              { label: "Copy / Open", text: "Copy shared text, or open and copy shared web links directly from their item rows." },
            ]} />
            <p className="guide-note">Recipients do not need a BlinkRoom account. Direct-only files require the sender and recipient to be connected at the same time.</p>
          </div>
        </section>

        <section className="seo-content guide-section">
          <div>
            <p className="seo-eyebrow">WHEN IT ENDS</p>
            <h2>Access stops first. Cleanup follows.</h2>
          </div>
          <div>
            <p>A room becomes inaccessible when its selected lifetime expires, when the owner destroys it, or when “Destroy when everyone leaves” completes. BlinkRoom then cleans up encrypted stored files and temporary database records asynchronously.</p>
            <p>Stored file content and identifying metadata are encrypted in the browser with AES-GCM. The room key is carried in the URL fragment and is not sent to BlinkRoom’s servers.</p>
            <nav className="guide-links" aria-label="Learn more about BlinkRoom">
              <Link href="/encrypted-file-sharing">Learn more about encryption <ArrowUpRight /></Link>
              <Link href="/temporary-file-sharing">Learn more about temporary rooms <ArrowUpRight /></Link>
            </nav>
          </div>
        </section>

        <section className="seo-final">
          <h2>Ready when you are.</h2>
          <p>Choose a lifetime, open a room and share without creating an account.</p>
          <SeoCreateRoom />
        </section>
      </main>

      <footer className="seo-footer">
        <Link className="wordmark" href="/">{brand.name}<i /></Link>
        <nav aria-label="Related BlinkRoom guides">
          <Link href="/encrypted-file-sharing">Encrypted</Link>
          <Link href="/temporary-file-sharing">Temporary</Link>
          <Link href="/send-files-without-signup">No signup</Link>
          <Link href="/private-file-sharing">Private</Link>
        </nav>
        <span>Private by default · Gone by design</span>
      </footer>
    </div>
  );
}
