"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { io } from "socket.io-client";
import {
  ArrowUp,
  Check,
  ChevronUp,
  Download,
  FileUp,
  Image as ImageIcon,
  LockKeyhole,
  MoreHorizontal,
  Paperclip,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from "lucide-react";

import { brand } from "@/src/config/brand";
import type {
  DecryptedItem,
  ItemType,
  PublicItem,
  PublicRoom,
} from "@/src/lib/types";

import { InviteModal } from "./invite-modal";
import { ItemCard } from "./item-card";
import { roomDurations, type RoomTtlHours } from "@/src/lib/duration";
import { CRYPTO_VERSION } from "@/src/lib/crypto/constants";

import {
  decryptFileChunks,
  encryptedFileSize,
  encryptFileChunks,
  encryptFileMultipart,
} from "@/src/lib/crypto/file";

import {
  decryptJson,
  encryptJson,
  parseEnvelope,
} from "@/src/lib/crypto/payload";

import {
  importRoomKey,
  roomKeyFromFragment,
} from "@/src/lib/crypto/room-key";

import { WebRTCTransport } from "@/src/lib/transport/webrtc";
import { selectTransport } from "@/src/lib/transport/selection";
import { fetchEncryptedFile } from "@/src/lib/storage/download";
import { takeSharedInbox } from "@/src/lib/share-inbox";
import { peekPendingRoomUpload, takePendingRoomUpload } from "@/src/lib/pending-room-upload";
import { uploadValidationError } from "@/src/lib/upload-validation";
import { filesFromDropSnapshot, snapshotDrop } from "@/src/lib/drop-files";
import { createQueuedUploads } from "@/src/lib/upload-queue";
import { markInstantDropTiming } from "@/src/lib/instant-drop-timing";
import { PreparingRoomShell } from "@/src/components/preparing-room-shell";

import {
  errorCategory,
  lifetimeBucket,
  sizeBucket,
  trackEvent,
  type Transport,
} from "@/src/lib/analytics";

import type { Socket } from "socket.io-client";

type Upload = {
  id: string;
  file: File;
  progress: number;
  status:
    | "queued"
    | "encrypting"
    | "sending"
    | "uploading"
    | "paused"
    | "resuming"
    | "failed"
    | "complete";
  error?: string;
  direct?: boolean;
  uploadedBytes?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
};

type Participant = {
  id: string;
  name: string;
};

type ItemSecret = {
  content?: string;
  senderName: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

type WebRTCConfig = {
  iceServers: RTCIceServer[];
  connectionTimeoutMs: number;
  maxDirectPeers: number;
};

type StorageConfig = {
  directUpload: boolean;
  partSize: number;
  maxFileSize: number;
};

const getIdentity = () => {
  let id = localStorage.getItem("blinkroom_participant");

  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("blinkroom_participant", id);
  }

  return {
    id,
    name: "Guest",
  };
};

const isSafeLink = (value: string) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const CLIENT_UPLOAD_CONCURRENCY = 6;

async function fileFingerprint(file: File) {
  const sample = 1024 * 1024;

  const bytes = new Uint8Array(
    await new Blob([
      new TextEncoder().encode(String(file.size)),
      file.slice(0, sample),
      file.slice(Math.max(0, file.size - sample)),
    ]).arrayBuffer(),
  );

  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes),
    ),
  ]
    .map((value) =>
      value.toString(16).padStart(2, "0"),
    )
    .join("");
}

async function uploadMultipartStorage(input: {
  slug: string;
  itemId: string;
  senderId: string;
  type: "IMAGE" | "FILE";
  encryptedMetadata: string;
  encrypted: Blob;
  directDelivered: boolean;
  oneTime: boolean;
  fileFingerprint: string;
  signal: AbortSignal;
  onProgress: (value: number) => void;
}) {
  const created = await fetch(
    `/api/rooms/${input.slug}/uploads`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        itemId: input.itemId,
        senderId: input.senderId,
        type: input.type,
        encryptionVersion: CRYPTO_VERSION,
        encryptedMetadata: input.encryptedMetadata,
        encryptedSize: input.encrypted.size,
        directDelivered: input.directDelivered,
        oneTime: input.oneTime,
        fileFingerprint: input.fileFingerprint,
        partSize: 10 * 1024 * 1024,
      }),
      signal: input.signal,
    },
  );

  if (!created.ok) {
    throw new Error(
      (
        (await created.json().catch(() => null)) as {
          error?: string;
        } | null
      )?.error ??
        "Temporary storage is unavailable right now.",
    );
  }

  const session = (await created.json()) as {
    sessionId: string;
    uploadToken: string;
    partSize: number;
    partCount: number;
    completedParts: Array<{
      partNumber: number;
      etag: string;
      size: number;
    }>;
  };

  const parts: Array<{
    partNumber: number;
    etag: string;
  }> = session.completedParts.map(
    ({ partNumber, etag }) => ({
      partNumber,
      etag,
    }),
  );

  const authHeaders = {
    "Content-Type": "application/json",
    "x-upload-token": session.uploadToken,
  };

  const done = new Set(
    parts.map((part) => part.partNumber),
  );

  for (
    let index = 0;
    index < session.partCount;
    index++
  ) {
    if (input.signal.aborted) {
      throw new Error("Transfer cancelled");
    }

    const partNumber = index + 1;

    if (done.has(partNumber)) {
      input.onProgress(
        Math.round(
          (Math.min(
            input.encrypted.size,
            partNumber * session.partSize,
          ) /
            input.encrypted.size) *
            100,
        ),
      );

      continue;
    }

    const signed = await fetch(
      `/api/rooms/${input.slug}/uploads/${session.sessionId}/parts`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          partNumber,
        }),
        signal: input.signal,
      },
    );

    if (!signed.ok) {
      throw new Error(
        "Temporary storage is unavailable right now.",
      );
    }

    const { url } = (await signed.json()) as {
      url: string;
    };

    const body = input.encrypted.slice(
      index * session.partSize,
      Math.min(
        input.encrypted.size,
        partNumber * session.partSize,
      ),
    );

    const etag = await new Promise<string>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();

        const abort = () => xhr.abort();

        input.signal.addEventListener(
          "abort",
          abort,
          {
            once: true,
          },
        );

        xhr.open("PUT", url);

        xhr.setRequestHeader(
          "Content-Type",
          "application/octet-stream",
        );

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            input.onProgress(
              Math.round(
                ((index * session.partSize +
                  event.loaded) /
                  input.encrypted.size) *
                  100,
              ),
            );
          }
        };

        xhr.onload = () => {
          input.signal.removeEventListener(
            "abort",
            abort,
          );

          const value =
            xhr.getResponseHeader("etag");

          if (
            xhr.status >= 200 &&
            xhr.status < 300 &&
            value
          ) {
            resolve(value);
          } else {
            reject(
              new Error(
                "Temporary storage is unavailable right now.",
              ),
            );
          }
        };

        xhr.onerror = () =>
          reject(
            new Error(
              "Temporary storage is unavailable right now.",
            ),
          );

        xhr.onabort = () =>
          reject(
            new Error("Transfer cancelled"),
          );

        xhr.send(body);
      },
    );

    parts.push({
      partNumber,
      etag,
    });

    const acknowledged = await fetch(
      `/api/rooms/${input.slug}/uploads/${session.sessionId}/parts`,
      {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          partNumber,
          etag,
          size: body.size,
        }),
        signal: input.signal,
      },
    );

    if (!acknowledged.ok) {
      throw new Error(
        "Temporary storage is unavailable right now.",
      );
    }
  }

  const completed = await fetch(
    `/api/rooms/${input.slug}/uploads/${session.sessionId}`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        parts,
      }),
      signal: input.signal,
    },
  );

  if (!completed.ok) {
    throw new Error(
      (
        (await completed.json().catch(() => null)) as {
          error?: string;
        } | null
      )?.error ??
        "Temporary storage is unavailable right now.",
    );
  }

  input.onProgress(100);
}

async function uploadStreamingStorage(input: {
  slug: string;
  cryptoContext: string;
  itemId: string;
  senderId: string;
  type: "IMAGE" | "FILE";
  encryptedMetadata: string;
  key: CryptoKey;
  file: File;
  partSize: number;
  signal: AbortSignal;
  onEncrypt: (value: number) => void;
  onUpload: (value: number) => void;
  oneTime: boolean;
}) {
  const size = encryptedFileSize(input.file.size);

  const fingerprint = await fileFingerprint(
    input.file,
  );

  const created = await fetch(
    `/api/rooms/${input.slug}/uploads`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        itemId: input.itemId,
        senderId: input.senderId,
        type: input.type,
        encryptionVersion: CRYPTO_VERSION,
        encryptedMetadata: input.encryptedMetadata,
        encryptedSize: size,
        directDelivered: false,
        oneTime: input.oneTime,
        fileFingerprint: fingerprint,
        partSize: input.partSize,
      }),
      signal: input.signal,
    },
  );

  if (!created.ok) {
    throw new Error(
      (
        (await created.json().catch(() => null)) as {
          error?: string;
        } | null
      )?.error ??
        "Temporary storage is unavailable right now.",
    );
  }

  const session = (await created.json()) as {
    sessionId: string;
    uploadToken: string;
    partSize: number;
    partCount: number;
    completedParts: Array<{
      partNumber: number;
      etag: string;
      size: number;
    }>;
  };

  const authHeaders = {
    "Content-Type": "application/json",
    "x-upload-token": session.uploadToken,
  };

  const parts: Array<{
    partNumber: number;
    etag: string;
  }> = session.completedParts.map(
    ({ partNumber, etag }) => ({
      partNumber,
      etag,
    }),
  );

  let uploaded = session.completedParts.reduce(
    (sum, part) => sum + part.size,
    0,
  );

  let partNumber = 0;

  const done = new Set(
    parts.map((part) => part.partNumber),
  );

  for await (const body of encryptFileMultipart(
    input.key,
    input.file,
    input.cryptoContext,
    input.itemId,
    session.partSize,
    input.onEncrypt,
  )) {
    partNumber++;

    if (done.has(partNumber)) {
      input.onUpload(
        Math.round((uploaded / size) * 100),
      );

      continue;
    }

    const signed = await fetch(
      `/api/rooms/${input.slug}/uploads/${session.sessionId}/parts`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          partNumber,
        }),
        signal: input.signal,
      },
    );

    if (!signed.ok) {
      throw new Error(
        "Temporary storage is unavailable right now.",
      );
    }

    const { url } = (await signed.json()) as {
      url: string;
    };

    const etag = await new Promise<string>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();

        const abort = () => xhr.abort();

        input.signal.addEventListener(
          "abort",
          abort,
          {
            once: true,
          },
        );

        xhr.open("PUT", url);

        xhr.setRequestHeader(
          "Content-Type",
          "application/octet-stream",
        );

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            input.onUpload(
              Math.round(
                ((uploaded + event.loaded) /
                  size) *
                  100,
              ),
            );
          }
        };

        xhr.onload = () => {
          input.signal.removeEventListener(
            "abort",
            abort,
          );

          const value =
            xhr.getResponseHeader("etag");

          if (
            xhr.status >= 200 &&
            xhr.status < 300 &&
            value
          ) {
            resolve(value);
          } else {
            reject(
              new Error(
                "Temporary storage is unavailable right now.",
              ),
            );
          }
        };

        xhr.onerror = () =>
          reject(
            new Error(
              "Temporary storage is unavailable right now.",
            ),
          );

        xhr.onabort = () =>
          reject(
            new Error("Transfer cancelled"),
          );

        xhr.send(body);
      },
    );

    parts.push({
      partNumber,
      etag,
    });

    uploaded += body.size;

    const acknowledged = await fetch(
      `/api/rooms/${input.slug}/uploads/${session.sessionId}/parts`,
      {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          partNumber,
          etag,
          size: body.size,
        }),
        signal: input.signal,
      },
    );

    if (!acknowledged.ok) {
      throw new Error(
        "Temporary storage is unavailable right now.",
      );
    }
  }

  if (partNumber !== session.partCount) {
    throw new Error(
      "Temporary storage is unavailable right now.",
    );
  }

  const completed = await fetch(
    `/api/rooms/${input.slug}/uploads/${session.sessionId}`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        parts,
      }),
      signal: input.signal,
    },
  );

  if (!completed.ok) {
    throw new Error(
      (
        (await completed.json().catch(() => null)) as {
          error?: string;
        } | null
      )?.error ??
        "Temporary storage is unavailable right now.",
    );
  }

  input.onUpload(100);
}

export function RoomClient({
  slug,
  isOwner,
}: {
  slug: string;
  isOwner: boolean;
}) {
  const [room, setRoom] =
    useState<PublicRoom | null>(null);
  const cryptoContextRef = useRef(slug);

  const [items, setItems] = useState<
    DecryptedItem[]
  >([]);

  const [identity, setIdentity] = useState({
    id: "",
    name: "Guest",
  });

  const [keyError, setKeyError] = useState<
    "missing" | "unlock" | ""
  >("");

  const [cryptoKey, setCryptoKey] =
    useState<CryptoKey | null>(null);

  const [error, setError] = useState("");

  const [status, setStatus] = useState<
    "connecting" | "connected" | "offline"
  >("connecting");

  const [participants, setParticipants] =
    useState<Participant[]>([]);

  const [events, setEvents] = useState<
    {
      id: string;
      text: string;
    }[]
  >([]);

  const [invite, setInvite] = useState(false);
  const [destroy, setDestroy] = useState(false);
  const [emergencyLock, setEmergencyLock] = useState(false);
  const [lockingRoom, setLockingRoom] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [oneTimeNext, setOneTimeNext] =
    useState(false);

  const [menu, setMenu] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [lifetime, setLifetime] =
    useState(false);
  const [lifetimeClosing, setLifetimeClosing] = useState(false);

  const [feedback, setFeedback] = useState("");
  const securityFeedbackRef = useRef(false);
  const [downloadingAll, setDownloadingAll] =
    useState(false);

  const [draft, setDraft] = useState("");
  const [uploads, setUploads] = useState<
    Upload[]
  >([]);

  const [dragging, setDragging] =
    useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [instantPendingFiles] = useState(() => peekPendingRoomUpload(slug));
  const [instantHandoffStarted, setInstantHandoffStarted] = useState(false);

  const [preview, setPreview] =
    useState<DecryptedItem | null>(null);

  const [now, setNow] = useState(0);
  const menuCloseTimer = useRef<number | null>(null);
  const sheetCloseTimer = useRef<number | null>(null);
  const lifetimeCloseTimer = useRef<number | null>(null);

  const closeMenu = useCallback(() => {
    if (!menu || menuClosing) return;
    setMenuClosing(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140;
    menuCloseTimer.current = window.setTimeout(() => {
      setMenu(false);
      setMenuClosing(false);
    }, delay);
  }, [menu, menuClosing]);

  const closeSheet = useCallback(() => {
    if (!sheet || sheetClosing) return;
    setSheetClosing(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140;
    sheetCloseTimer.current = window.setTimeout(() => {
      setSheet(false);
      setSheetClosing(false);
    }, delay);
  }, [sheet, sheetClosing]);

  const closeLifetime = useCallback(() => {
    if (!lifetime || lifetimeClosing) return;
    setLifetimeClosing(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140;
    lifetimeCloseTimer.current = window.setTimeout(() => {
      setLifetime(false);
      setLifetimeClosing(false);
    }, delay);
  }, [lifetime, lifetimeClosing]);

  useEffect(() => {
    const secured = sessionStorage.getItem("blinkroom_room_secured");
    if (secured !== slug) return;
    securityFeedbackRef.current = true;
    const showTimer = window.setTimeout(
      () => setFeedback("Room secured — a new room code was generated and previous access was revoked."),
      0,
    );
    const hideTimer = window.setTimeout(() => {
      if (sessionStorage.getItem("blinkroom_room_secured") === slug)
        sessionStorage.removeItem("blinkroom_room_secured");
      securityFeedbackRef.current = false;
      setFeedback("");
    }, 3200);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [slug]);

  useEffect(() => {
    if (!menu || !window.matchMedia("(max-width: 720px)").matches) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menu]);

  useEffect(() => {
    if (!menu && !sheet && !lifetime) return;
    const dismissOnPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (menu && !target.closest('[data-room-popup="menu"]')) closeMenu();
      if (sheet && !target.closest('[data-room-popup="sheet"]')) closeSheet();
      if (lifetime && !target.closest('[data-room-popup="lifetime"]')) closeLifetime();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
      closeSheet();
      closeLifetime();
    };
    document.addEventListener("pointerdown", dismissOnPointerDown, true);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnPointerDown, true);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [closeLifetime, closeMenu, closeSheet, lifetime, menu, sheet]);

  useEffect(() => () => {
    if (menuCloseTimer.current !== null) window.clearTimeout(menuCloseTimer.current);
    if (sheetCloseTimer.current !== null) window.clearTimeout(sheetCloseTimer.current);
    if (lifetimeCloseTimer.current !== null) window.clearTimeout(lifetimeCloseTimer.current);
  }, []);

  const fileRef =
    useRef<HTMLInputElement>(null);

  const photoRef =
    useRef<HTMLInputElement>(null);

  const bottomRef =
    useRef<HTMLDivElement>(null);

  const keyRef =
    useRef<CryptoKey | null>(null);

  const itemsRef =
    useRef<DecryptedItem[]>([]);

  const pendingXhrs = useRef(
    new Set<XMLHttpRequest>(),
  );

  const transferControllers = useRef(
    new Map<string, AbortController>(),
  );

  const directBlobs = useRef(
    new Map<string, Blob>(),
  );

  const transportRef =
    useRef<WebRTCTransport | null>(null);

  const transportConfig =
    useRef<WebRTCConfig | null>(null);

  const storageConfig =
    useRef<StorageConfig | null>(null);

  const participantsRef =
    useRef<Participant[]>([]);

  const roomRef =
    useRef<PublicRoom | null>(null);

  const autoDestroyPending =
    useRef(false);

  const replaceItems = useCallback(
    (next: DecryptedItem[]) => {
      for (const item of itemsRef.current) {
        if (
          item.objectUrl &&
          !next.some(
            (candidate) =>
              candidate.objectUrl === item.objectUrl,
          )
        ) {
          URL.revokeObjectURL(item.objectUrl);
        }
      }

      itemsRef.current = next;
      setItems(next);
    },
    [],
  );

  const clearSecrets = useCallback(() => {
    for (const item of itemsRef.current) {
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
    }

    itemsRef.current = [];
    setItems([]);

    keyRef.current = null;
    setCryptoKey(null);

    for (const xhr of pendingXhrs.current) {
      xhr.abort();
    }

    pendingXhrs.current.clear();

    for (const controller of transferControllers.current.values()) {
      controller.abort();
    }

    transferControllers.current.clear();

    transportRef.current?.close();
    transportRef.current = null;

    directBlobs.current.clear();

    setUploads([]);
    setPreview(null);
  }, []);

  const decryptItem = useCallback(
    async (
      key: CryptoKey,
      item: PublicItem,
    ): Promise<DecryptedItem> => {
      if (
        item.encryptionVersion !== CRYPTO_VERSION
      ) {
        throw new Error(
          "Unsupported crypto version",
        );
      }

      if (
        item.type === "TEXT" ||
        item.type === "LINK"
      ) {
        if (!item.encryptedPayload) {
          throw new Error(
            "Missing encrypted payload",
          );
        }

        const secret =
          await decryptJson<ItemSecret>(
            key,
            parseEnvelope(
              item.encryptedPayload,
            ),
            `${cryptoContextRef.current}:${item.id}:content:v1`,
          );

        if (
          !secret.content ||
          (item.type === "LINK" &&
            !isSafeLink(secret.content))
        ) {
          throw new Error(
            "Invalid encrypted content",
          );
        }

        return {
          ...item,
          senderName: secret.senderName,
          textContent: secret.content,
          fileName: null,
          fileSize: null,
          mimeType: null,
        };
      }

      if (!item.encryptedMetadata) {
        throw new Error(
          "Missing encrypted metadata",
        );
      }

      const secret =
        await decryptJson<ItemSecret>(
          key,
          parseEnvelope(
            item.encryptedMetadata,
          ),
          `${cryptoContextRef.current}:${item.id}:metadata:v1`,
        );

      if (
        !secret.fileName ||
        !secret.mimeType ||
        typeof secret.fileSize !== "number"
      ) {
        throw new Error(
          "Invalid encrypted metadata",
        );
      }

      const localEncrypted =
        directBlobs.current.get(item.id);

      const stored =
        item.availability !== "DIRECT";

      const decrypted: DecryptedItem = {
        ...item,
        senderName: secret.senderName,
        textContent: null,
        fileName: secret.fileName,
        fileSize: secret.fileSize,
        mimeType: secret.mimeType,
        locallyAvailable:
          Boolean(localEncrypted) || stored,
      };

      if (
        item.type === "IMAGE" &&
        !item.oneTime &&
        (localEncrypted || stored)
      ) {
        const encrypted =
          localEncrypted ??
          (await fetchEncryptedFile(
            slug,
            item.id,
          ));

        const blob =
          await decryptFileChunks(
            key,
            encrypted,
            cryptoContextRef.current,
            item.id,
            secret.mimeType,
          );

        decrypted.objectUrl =
          URL.createObjectURL(blob);
      }

      return decrypted;
    },
    [slug],
  );

  const sync = useCallback(
    async (
      key = keyRef.current,
    ) => {
      if (!key) {
        return;
      }

      const res = await fetch(
        `/api/rooms/${slug}`,
      );

      if (!res.ok) {
        setError(
          res.status === 404
            ? "not-found"
            : "unavailable",
        );

        return;
      }

      const data =
        (await res.json()) as PublicRoom;

      if (data.status !== "ACTIVE") {
        clearSecrets();
        setError(
          data.status.toLowerCase(),
        );

        return;
      }

      try {
        if (
          !data.encryptedVerifier ||
          data.encryptionVersion !==
            CRYPTO_VERSION
        ) {
          throw new Error(
            "Missing verifier",
          );
        }

        const verifier =
          await decryptJson<{
            check: string;
          }>(
            key,
            parseEnvelope(
              data.encryptedVerifier,
            ),
            `${data.cryptoContext}:verifier:v1`,
          );

        if (
          verifier.check !==
          "blinkroom-room-key"
        ) {
          throw new Error(
            "Invalid verifier",
          );
        }

        cryptoContextRef.current = data.cryptoContext;
        const decrypted =
          await Promise.all(
            data.items.map((item) =>
              decryptItem(key, item),
            ),
          );

        setRoom(data);
        replaceItems(decrypted);
      } catch {
        setKeyError("unlock");
        clearSecrets();
      }
    },
    [
      clearSecrets,
      decryptItem,
      replaceItems,
      slug,
    ],
  );

  useEffect(() => {
    const serialized =
      roomKeyFromFragment(
        window.location.hash,
      );

    if (!serialized) {
      queueMicrotask(() =>
        setKeyError("missing"),
      );

      return;
    }

    const me = getIdentity();

    queueMicrotask(() =>
      setIdentity(me),
    );

    importRoomKey(serialized)
      .then((key) => {
        keyRef.current = key;
        setCryptoKey(key);
      })
      .catch(() =>
        setKeyError("unlock"),
      );

    return clearSecrets;
  }, [clearSecrets]);

  useEffect(() => {
    void fetch("/api/storage-config")
      .then((response) =>
        response.json(),
      )
      .then(
        (config: StorageConfig) => {
          storageConfig.current =
            config;
          setStorageReady(true);
        },
      )
      .catch(() => setStorageReady(true));
  }, []);

  useEffect(() => {
    if (!cryptoKey) {
      return;
    }

    queueMicrotask(() =>
      sync(cryptoKey),
    );

    const me = getIdentity();

    const socket: Socket = io({
      path: "/api/socket",
    });

    void fetch("/api/webrtc-config")
      .then((response) =>
        response.json(),
      )
      .then(
        (config: WebRTCConfig) => {
          if (!socket.connected) {
            return;
          }

          transportConfig.current =
            config;

          transportRef.current?.close();

          transportRef.current =
            new WebRTCTransport(
              socket,
              me.id,
              config,
              {
                onReceive: async (
                  file,
                ) => {
                  directBlobs.current.set(
                    file.itemId,
                    file.encrypted,
                  );

                  setFeedback(
                    "Direct transfer ready.",
                  );

                  setTimeout(
                    () =>
                      setFeedback(""),
                    1400,
                  );
                },

                onProgress: ({
                  itemId,
                  direction,
                  progress,
                }) => {
                  if (
                    direction ===
                    "sending"
                  ) {
                    if (progress > 0) markInstantDropTiming("first_upload_progress");
                    setUploads(
                      (current) =>
                        current.map(
                          (upload) =>
                            upload.id ===
                            itemId
                              ? {
                                  ...upload,
                                  status:
                                    "sending",
                                  direct:
                                    true,
                                  progress,
                                }
                              : upload,
                        ),
                    );
                  }
                },

                onError: () =>
                  undefined,
              },
            );

          transportRef.current.setPeers(
            participantsRef.current.map(
              (participant) =>
                participant.id,
            ),
          );
        },
      )
      .catch(() => undefined);

    socket.on("connect", () => {
      if (!transportRef.current) {
        void fetch(
          "/api/webrtc-config",
        )
          .then((response) =>
            response.json(),
          )
          .then(
            (
              config: WebRTCConfig,
            ) => {
              transportConfig.current =
                config;

              transportRef.current =
                new WebRTCTransport(
                  socket,
                  me.id,
                  config,
                  {
                    onReceive:
                      async (
                        file,
                      ) => {
                        directBlobs.current.set(
                          file.itemId,
                          file.encrypted,
                        );

                        setFeedback(
                          "Direct transfer ready.",
                        );

                        setTimeout(
                          () =>
                            setFeedback(
                              "",
                            ),
                          1400,
                        );
                      },

                    onProgress: ({
                      itemId,
                      direction,
                      progress,
                    }) => {
                      if (
                        direction ===
                        "sending"
                      ) {
                        if (progress > 0) markInstantDropTiming("first_upload_progress");
                        setUploads(
                          (
                            current,
                          ) =>
                            current.map(
                              (
                                upload,
                              ) =>
                                upload.id ===
                                itemId
                                  ? {
                                      ...upload,
                                      status:
                                        "sending",
                                      direct:
                                        true,
                                      progress,
                                    }
                                  : upload,
                            ),
                        );
                      }
                    },
                  },
                );

              transportRef.current.setPeers(
                participantsRef.current.map(
                  (
                    participant,
                  ) =>
                    participant.id,
                ),
              );
            },
          )
          .catch(
            () => undefined,
          );
      }
    });

    socket.on("connect", () => {
      setStatus("connected");
      if (!securityFeedbackRef.current) {
        setFeedback("Connected");
        setTimeout(() => setFeedback(""), 1200);
      }

      socket.emit("room:join", {
        slug,
        participantId: me.id,
        name: isOwner
          ? "Room owner"
          : "Guest",
      });

      sync(cryptoKey);
    });

    socket.on(
      "disconnect",
      () => {
        setStatus(
          navigator.onLine
            ? "connecting"
            : "offline",
        );
      },
    );

    socket.on(
      "connect_error",
      () => setStatus("connecting"),
    );

    socket.on(
      "presence:update",
      (next: Participant[]) => {
        participantsRef.current =
          next;

        setParticipants(next);

        transportRef.current?.setPeers(
          next.map(
            (participant) =>
              participant.id,
          ),
        );
      },
    );

    socket.on(
      "presence:event",
      ({ kind, name }) => {
        setEvents((current) => [
          ...current.slice(-4),
          {
            id: crypto.randomUUID(),
            text: `${name || "Someone"} ${kind}`,
          },
        ]);
      },
    );

    socket.on(
      "item:create",
      async (item: PublicItem) => {
        try {
          const decrypted =
            await decryptItem(
              cryptoKey,
              item,
            );

          const position =
            itemsRef.current.findIndex(
              (existing) =>
                existing.id ===
                item.id,
            );

          replaceItems(
            position < 0
              ? [
                  ...itemsRef.current,
                  decrypted,
                ]
              : itemsRef.current.map(
                  (existing) =>
                    existing.id ===
                    item.id
                      ? decrypted
                      : existing,
                ),
          );

          setRoom((current) =>
            current
              ? {
                  ...current,

                  items:
                    current.items.some(
                      (existing) =>
                        existing.id ===
                        item.id,
                    )
                      ? current.items.map(
                          (
                            existing,
                          ) =>
                            existing.id ===
                            item.id
                              ? item
                              : existing,
                        )
                      : [
                          ...current.items,
                          item,
                        ],
                }
              : current,
          );
        } catch {
          setKeyError("unlock");
          clearSecrets();
        }
      },
    );

    socket.on(
      "item:delete",
      ({ id }) => {
        replaceItems(
          itemsRef.current.filter(
            (item) =>
              item.id !== id,
          ),
        );

        setRoom((current) =>
          current
            ? {
                ...current,
                items:
                  current.items.filter(
                    (item) =>
                      item.id !== id,
                  ),
              }
            : current,
        );
      },
    );

    socket.on(
      "room:destroy",
      () => {
        const remaining =
          roomRef.current
            ? Math.max(
                0,
                new Date(
                  roomRef.current
                    .expiresAt,
                ).getTime() -
                  Date.now(),
              )
            : 0;

        trackEvent(
          "room_destroyed",
          {
            reason:
              autoDestroyPending.current
                ? "auto_empty"
                : "owner",

            room_lifetime_bucket:
              lifetimeBucket(
                remaining,
              ),
          },
          "room-destroyed",
        );

        clearSecrets();
        setError("destroyed");
      },
    );

    socket.on(
      "room:expired",
      () => {
        trackEvent(
          "room_destroyed",
          {
            reason: "expiration",
            room_lifetime_bucket:
              "lt_10m",
          },
          "room-destroyed",
        );

        clearSecrets();
        setError("expired");
      },
    );

    socket.on("room:access-revoked", () => {
      clearSecrets();
      transportRef.current?.close();
      transportRef.current = null;
      socket.disconnect();
      setError("access-changed");
    });

    socket.on("room:rotated", ({ slug: nextSlug }: { slug: string }) => {
      if (!isOwner || !/^[A-Z0-9-]{4,16}$/.test(nextSlug)) return;
      sessionStorage.setItem("blinkroom_room_secured", nextSlug);
      window.setTimeout(() => window.location.replace(`/r/${nextSlug}${window.location.hash}`), 450);
    });

    socket.on(
      "room:expiration-updated",
      ({
        expiresAt,
      }: {
        expiresAt: string;
      }) => {
        setRoom((current) =>
          current
            ? {
                ...current,
                expiresAt,
              }
            : current,
        );
      },
    );

    socket.on(
      "room:auto-destroy-pending",
      () => {
        autoDestroyPending.current =
          true;
      },
    );

    socket.on(
      "room:settings-updated",
      (settings: {
        autoDestroyWhenEmpty: boolean;
        directOnly: boolean;
      }) => {
        setRoom((current) =>
          current
            ? {
                ...current,
                ...settings,
              }
            : current,
        );
      },
    );

    socket.on(
      "item:consumed",
      ({
        id,
      }: {
        id: string;
      }) => {
        setRoom((current) =>
          current
            ? {
                ...current,

                items:
                  current.items.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,
                            oneTimeStatus:
                              "CONSUMED",
                          }
                        : item,
                  ),
              }
            : current,
        );

        replaceItems(
          itemsRef.current.map(
            (item) =>
              item.id === id
                ? {
                    ...item,
                    oneTimeStatus:
                      "CONSUMED",
                    locallyAvailable:
                      false,
                    objectUrl:
                      undefined,
                  }
                : item,
          ),
        );
      },
    );

    const online = () => {
      setStatus(
        socket.connected
          ? "connected"
          : "connecting",
      );

      socket.connect();
    };

    const offline = () =>
      setStatus("offline");

    window.addEventListener(
      "online",
      online,
    );

    window.addEventListener(
      "offline",
      offline,
    );

    return () => {
      transportRef.current?.close();
      transportRef.current = null;

      socket.disconnect();

      window.removeEventListener(
        "online",
        online,
      );

      window.removeEventListener(
        "offline",
        offline,
      );
    };
  }, [
    clearSecrets,
    cryptoKey,
    decryptItem,
    isOwner,
    replaceItems,
    slug,
    sync,
  ]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    queueMicrotask(() =>
      setNow(Date.now()),
    );

    const timer = setInterval(
      () => setNow(Date.now()),
      1000,
    );

    return () =>
      clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!cryptoKey) {
      return;
    }

    const timer = setInterval(
      () => sync(cryptoKey),
      30_000,
    );

    return () =>
      clearInterval(timer);
  }, [cryptoKey, sync]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [
    items.length,
    uploads.length,
  ]);

  const senderName =
    participants.find(
      (participant) =>
        participant.id === identity.id,
    )?.name ??
    (isOwner
      ? "Room owner"
      : "Guest");

  const shareText = useCallback(
    async (value = draft) => {
      const content = value.trim();
      const key = keyRef.current;

      if (
        !content ||
        !identity.id ||
        !key
      ) {
        return;
      }

      const type: ItemType =
        isSafeLink(content)
          ? "LINK"
          : "TEXT";

      const itemId =
        crypto.randomUUID();

      const encryptedPayload =
        JSON.stringify(
          await encryptJson(
            key,
            {
              content,
              senderName,
            },
            `${cryptoContextRef.current}:${itemId}:content:v1`,
          ),
        );

      const res = await fetch(
        `/api/rooms/${slug}/items/text`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            itemId,
            senderId: identity.id,
            type,
            encryptionVersion:
              CRYPTO_VERSION,
            encryptedPayload,
          }),
        },
      );

      if (res.ok) {
        setDraft("");

        trackEvent(
          "item_shared",
          {
            item_type:
              type === "LINK"
                ? "link"
                : "text",

            transport: "p2p",

            one_time: false,

            direct_only: Boolean(
              room?.directOnly,
            ),
          },
          `item:${itemId}`,
        );
      }
    },
    [
      draft,
      identity.id,
      room?.directOnly,
      senderName,
      slug,
    ],
  );

  const uploadOne = useCallback(
    async (
      file: File,
      existingId?: string,
      oneTime = false,
      resumeSource:
        | "manual"
        | "reconnect"
        | "reload" = "manual",
      prequeued = false,
    ) => {
      const key = keyRef.current;

      if (!key || !identity.id) {
        return;
      }

      const id =
        existingId ??
        crypto.randomUUID();

      const bucket =
        sizeBucket(file.size);

      let analyticsTransport: Transport =
        "r2";

      if (existingId && !prequeued) {
        trackEvent(
          "upload_resumed",
          {
            size_bucket: bucket,
            resume_source:
              resumeSource,
          },
          `resume:${id}`,
        );
      }

      if (
        transferControllers.current.has(
          id,
        )
      ) {
        return;
      }

      const controller =
        new AbortController();

      transferControllers.current.set(
        id,
        controller,
      );

      setUploads((current) =>
        existingId
          ? current.map((item) =>
              item.id === id
                ? {
                    ...item,
                    progress: 0,
                    status:
                      "encrypting",
                    error: undefined,
                  }
                : item,
            )
          : [
              ...current,
              {
                id,
                file,
                progress: 0,
                status:
                  "encrypting",
              },
            ],
      );

      try {
        const validationError = storageConfig.current
          ? uploadValidationError(file, storageConfig.current.maxFileSize)
          : null;
        if (validationError) throw new Error(validationError);

        const type:
          | "IMAGE"
          | "FILE" = [
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
        ].includes(file.type)
          ? "IMAGE"
          : "FILE";

        const encryptedMetadata =
          JSON.stringify(
            await encryptJson(
              key,
              {
                fileName: file.name,

                mimeType:
                  file.type ||
                  "application/octet-stream",

                fileSize:
                  file.size,

                senderName,
              },
              `${cryptoContextRef.current}:${id}:metadata:v1`,
            ),
          );

        const peers =
          participantsRef.current
            .filter(
              (participant) =>
                participant.id !==
                identity.id,
            )
            .map(
              (participant) =>
                participant.id,
            );

        const config =
          transportConfig.current;

        const direct =
          config &&
          transportRef.current &&
          selectTransport(
            peers.length,
            config.maxDirectPeers,
            typeof RTCPeerConnection !==
              "undefined",
          ) === "DIRECT";

        analyticsTransport = direct
          ? "p2p"
          : "r2";

        trackEvent(
          "file_upload_started",
          {
            transport_target:
              analyticsTransport,

            size_bucket: bucket,

            direct_only: Boolean(
              room?.directOnly,
            ),
          },
          `start:${id}`,
        );

        const trackCompleted = (
          transport: Transport,
        ) => {
          trackEvent(
            "file_upload_completed",
            {
              transport,
              size_bucket:
                bucket,
              resumed: Boolean(
                existingId,
              ),
              one_time:
                oneTime,
            },
            `complete:${id}`,
          );

          trackEvent(
            "item_shared",
            {
              item_type:
                type === "IMAGE"
                  ? "image"
                  : "file",

              transport,

              one_time:
                oneTime,

              direct_only:
                Boolean(
                  room?.directOnly,
                ),

              size_bucket:
                bucket,
            },
            `item:${id}`,
          );

          if (
            transport === "p2p"
          ) {
            trackEvent(
              "successful_transfer",
              {
                transport,
                size_bucket:
                  bucket,

                direct_only:
                  Boolean(
                    room?.directOnly,
                  ),

                one_time:
                  oneTime,
              },
              `transfer:${id}`,
            );
          }

          if (oneTime) {
            trackEvent(
              "one_time_file_shared",
              {
                item_type:
                  type === "IMAGE"
                    ? "image"
                    : "file",

                transport,
              },
              `one-time:${id}`,
            );
          }
        };

        if (
          room?.directOnly &&
          !direct
        ) {
          throw new Error(
            "Direct transfer unavailable.",
          );
        }

        if (
          !room?.directOnly &&
          !direct &&
          storageConfig.current
            ?.directUpload
        ) {
          const uploadStartedAt = performance.now();
          await uploadStreamingStorage({
            slug,
            cryptoContext: cryptoContextRef.current,
            itemId: id,
            senderId: identity.id,
            type,
            encryptedMetadata,
            key,
            file,

            partSize:
              storageConfig.current
                .partSize,

            signal:
              controller.signal,

            onEncrypt: (
              progress,
            ) => {
              setUploads(
                (current) =>
                  current.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,

                            status:
                              "encrypting",

                            progress:
                              Math.round(
                                progress *
                                  0.35,
                              ),
                          }
                        : item,
                  ),
              );
            },

            onUpload: (
              progress,
            ) => {
              if (progress > 0) markInstantDropTiming("first_upload_progress");
              const uploadedBytes = Math.min(file.size, Math.round(file.size * progress / 100));
              const elapsedSeconds = (performance.now() - uploadStartedAt) / 1000;
              const bytesPerSecond = elapsedSeconds >= 1 && uploadedBytes > 0 ? uploadedBytes / elapsedSeconds : 0;
              const etaSeconds = bytesPerSecond > 0 ? Math.max(0, (file.size - uploadedBytes) / bytesPerSecond) : 0;
              setUploads(
                (current) =>
                  current.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,

                            status:
                              "uploading",

                            progress:
                              35 +
                              Math.round(
                                progress *
                                  0.65,
                              ),
                            uploadedBytes,
                            bytesPerSecond,
                            etaSeconds,
                          }
                        : item,
                  ),
              );
            },

            oneTime,
          });

          setUploads((current) =>
            current.map((item) =>
              item.id === id
                ? {
                    ...item,
                    progress: 100,
                    status:
                      "complete",
                  }
                : item,
            ),
          );

          trackCompleted("r2");

          setTimeout(() => {
            setUploads((current) =>
              current.filter(
                (item) =>
                  item.id !== id,
              ),
            );
          }, 900);

          return;
        }

        const encryptedFile =
          await encryptFileChunks(
            key,
            file,
            cryptoContextRef.current,
            id,
            (progress) => {
              setUploads(
                (current) =>
                  current.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,

                            progress:
                              Math.round(
                                progress *
                                  0.35,
                              ),

                            status:
                              "encrypting",
                          }
                        : item,
                  ),
              );
            },
          );

        if (
          controller.signal.aborted
        ) {
          throw new Error(
            "Cancelled",
          );
        }

        directBlobs.current.set(
          id,
          encryptedFile,
        );

        let delivered = 0;

        if (direct) {
          setUploads((current) =>
            current.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status:
                      "sending",
                    direct: true,
                    progress: 35,
                  }
                : item,
            ),
          );

          const result =
            await transportRef.current!.sendFile(
              {
                itemId: id,
                type,
                encryptedMetadata,
                encrypted:
                  encryptedFile,
              },
              peers,
              controller.signal,
            );

          delivered =
            result.delivered.length;

          if (
            delivered ===
            peers.length
          ) {
            const response =
              await fetch(
                `/api/rooms/${slug}/items/direct`,
                {
                  method: "POST",

                  headers: {
                    "Content-Type":
                      "application/json",
                  },

                  body:
                    JSON.stringify(
                      {
                        itemId:
                          id,

                        senderId:
                          identity.id,

                        type,

                        encryptionVersion:
                          CRYPTO_VERSION,

                        encryptedMetadata,

                        encryptedSize:
                          encryptedFile.size,

                        oneTime,
                      },
                    ),

                  signal:
                    controller.signal,
                },
              );

            if (response.ok) {
              trackCompleted(
                "p2p",
              );

              setUploads(
                (current) =>
                  current.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,
                            progress:
                              100,
                            status:
                              "complete",
                          }
                        : item,
                  ),
              );

              setTimeout(
                () => {
                  setUploads(
                    (current) =>
                      current.filter(
                        (
                          item,
                        ) =>
                          item.id !==
                          id,
                      ),
                  );
                },
                900,
              );

              transferControllers.current.delete(
                id,
              );

              return;
            }
          }
        }

        if (
          controller.signal.aborted
        ) {
          throw new Error(
            "Cancelled",
          );
        }

        if (room?.directOnly) {
          throw new Error(
            "Direct transfer unavailable.",
          );
        }

        if (
          storageConfig.current
            ?.directUpload
        ) {
          setUploads((current) =>
            current.map((item) =>
              item.id === id
                ? {
                    ...item,

                    status:
                      "uploading",

                    direct: false,

                    progress: 35,
                  }
                : item,
            ),
          );

          await uploadMultipartStorage({
            slug,
            itemId: id,
            senderId: identity.id,
            type,
            encryptedMetadata,
            encrypted:
              encryptedFile,

            directDelivered:
              delivered > 0,

            oneTime,

            fileFingerprint:
              await fileFingerprint(
                file,
              ),

            signal:
              controller.signal,

            onProgress: (
              progress,
            ) => {
              if (progress > 0) markInstantDropTiming("first_upload_progress");
              setUploads(
                (current) =>
                  current.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,

                            status:
                              "uploading",

                            progress:
                              35 +
                              Math.round(
                                progress *
                                  0.65,
                              ),
                          }
                        : item,
                  ),
              );
            },
          });

          trackCompleted("r2");

          setUploads((current) =>
            current.map((item) =>
              item.id === id
                ? {
                    ...item,
                    progress: 100,
                    status:
                      "complete",
                  }
                : item,
            ),
          );

          setTimeout(() => {
            setUploads((current) =>
              current.filter(
                (item) =>
                  item.id !== id,
              ),
            );
          }, 900);

          return;
        }

        const form =
          new FormData();

        form.append(
          "itemId",
          id,
        );

        form.append(
          "senderId",
          identity.id,
        );

        form.append(
          "type",
          type,
        );

        form.append(
          "encryptionVersion",
          String(CRYPTO_VERSION),
        );

        form.append(
          "encryptedMetadata",
          encryptedMetadata,
        );

        form.append(
          "directDelivered",
          delivered > 0
            ? "true"
            : "false",
        );

        form.append(
          "file",
          encryptedFile,
          "encrypted.bin",
        );

        await new Promise<void>(
          (resolve) => {
            const xhr =
              new XMLHttpRequest();

            pendingXhrs.current.add(
              xhr,
            );

            const abort = () =>
              xhr.abort();

            controller.signal.addEventListener(
              "abort",
              abort,
              {
                once: true,
              },
            );

            xhr.open(
              "POST",
              `/api/rooms/${slug}/items/upload`,
            );

            xhr.upload.onprogress = (
              event,
            ) => {
              if (
                event.lengthComputable
              ) {
                if (event.loaded > 0) markInstantDropTiming("first_upload_progress");
                setUploads(
                  (current) =>
                    current.map(
                      (item) =>
                        item.id ===
                        id
                          ? {
                              ...item,

                              progress:
                                35 +
                                Math.round(
                                  (event.loaded /
                                    event.total) *
                                    65,
                                ),

                              status:
                                "uploading",

                              direct:
                                false,
                            }
                          : item,
                    ),
                );
              }
            };

            xhr.onload = () => {
              pendingXhrs.current.delete(
                xhr,
              );

              controller.signal.removeEventListener(
                "abort",
                abort,
              );

              if (
                xhr.status < 300
              ) {
                trackCompleted(
                  "r2",
                );

                setUploads(
                  (current) =>
                    current.map(
                      (item) =>
                        item.id ===
                        id
                          ? {
                              ...item,

                              progress:
                                100,

                              status:
                                "complete",
                            }
                          : item,
                    ),
                );

                setTimeout(
                  () => {
                    setUploads(
                      (
                        current,
                      ) =>
                        current.filter(
                          (
                            item,
                          ) =>
                            item.id !==
                            id,
                        ),
                    );
                  },
                  900,
                );
              } else {
                trackEvent(
                  "file_upload_failed",
                  {
                    transport:
                      "r2",

                    size_bucket:
                      bucket,

                    error_category:
                      "storage",
                  },
                  `failed:${id}:storage`,
                );

                setUploads(
                  (current) =>
                    current.map(
                      (item) =>
                        item.id ===
                        id
                          ? {
                              ...item,

                              status:
                                "failed",

                              error:
                                "Transfer failed",
                            }
                          : item,
                    ),
                );
              }

              resolve();
            };

            xhr.onerror = () => {
              pendingXhrs.current.delete(
                xhr,
              );

              trackEvent(
                "file_upload_failed",
                {
                  transport:
                    "r2",

                  size_bucket:
                    bucket,

                  error_category:
                    "network",
                },
                `failed:${id}:network`,
              );

              setUploads(
                (current) =>
                  current.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,

                            status:
                              "failed",

                            error:
                              "Network error",
                          }
                        : item,
                  ),
              );

              resolve();
            };

            xhr.onabort = () => {
              pendingXhrs.current.delete(
                xhr,
              );

              trackEvent(
                "file_upload_failed",
                {
                  transport:
                    "r2",

                  size_bucket:
                    bucket,

                  error_category:
                    "cancelled",
                },
                `failed:${id}:cancelled`,
              );

              setUploads(
                (current) =>
                  current.map(
                    (item) =>
                      item.id === id
                        ? {
                            ...item,

                            status:
                              "failed",

                            error:
                              "Transfer cancelled",
                          }
                        : item,
                  ),
              );

              resolve();
            };

            xhr.send(form);
          },
        );
      } catch (cause) {
        const category =
          errorCategory(cause);

        trackEvent(
          "file_upload_failed",
          {
            transport:
              analyticsTransport,

            size_bucket:
              bucket,

            error_category:
              category,
          },
          `failed:${id}:${category}`,
        );

        const message =
          cause instanceof Error
            ? cause.message
            : "";

        const disconnected =
          !navigator.onLine;

        const cancelled =
          controller.signal.aborted ||
          message === "Cancelled" ||
          message ===
            "Transfer cancelled";

        const friendly = [
          "Empty files can’t be uploaded.",
          "This file is too large.",
          "This room has reached its temporary storage limit.",
          "This room has reached its item limit.",
          "Too many uploads are already in progress.",
          "Temporary storage is unavailable right now.",
          "Direct transfer unavailable.",
        ].includes(message)
          ? message
          : "Couldn’t send this file. Try again.";

        setUploads((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,

                  status:
                    disconnected
                      ? "paused"
                      : "failed",

                  error:
                    disconnected
                      ? "Paused — connection lost"
                      : cancelled
                        ? "Transfer cancelled"
                        : friendly,
                }
              : item,
          ),
        );
      } finally {
        transferControllers.current.delete(
          id,
        );
      }
    },
    [
      identity.id,
      room,
      senderName,
      slug,
    ],
  );

  const uploadFiles = useCallback(
    async (
      files: FileList | File[],
    ) => {
      const oneTime =
        oneTimeNext;

      setOneTimeNext(false);

      const queue = createQueuedUploads(files);

      if (!queue.length) {
        return;
      }

      // Workers consume `queue` with shift(). Keep the optimistic rows on an
      // immutable snapshot so React cannot observe an already-drained array.
      const queuedForRender = [...queue];
      setUploads((current) => [...current, ...queuedForRender]);

      const workerCount =
        Math.min(
          CLIENT_UPLOAD_CONCURRENCY,
          queue.length,
        );

      const workers = Array.from(
        {
          length: workerCount,
        },
        async () => {
          while (queue.length) {
            const upload =
              queue.shift();

            if (!upload) {
              return;
            }

            await uploadOne(
              upload.file,
              upload.id,
              oneTime,
              "manual",
              true,
            );
          }
        },
      );

      await Promise.all(workers);
    },
    [
      oneTimeNext,
      uploadOne,
    ],
  );

  useEffect(() => {
    if (!cryptoKey || !storageReady || !identity.id || !room) return;
    const files = takePendingRoomUpload(slug);
    if (files.length) {
      markInstantDropTiming("upload_init_started");
      queueMicrotask(() => {
        setInstantHandoffStarted(true);
        void uploadFiles(files);
      });
    }
  }, [cryptoKey, identity.id, room, slug, storageReady, uploadFiles]);

  useEffect(() => {
    const resume = () => {
      for (const upload of uploads) {
        if (
          upload.status ===
          "paused"
        ) {
          setUploads(
            (current) =>
              current.map(
                (item) =>
                  item.id ===
                  upload.id
                    ? {
                        ...item,

                        status:
                          "resuming",

                        error:
                          undefined,
                      }
                    : item,
              ),
          );

          void uploadOne(
            upload.file,
            upload.id,
            false,
            "reconnect",
          );
        }
      }
    };

    window.addEventListener(
      "online",
      resume,
    );

    return () =>
      window.removeEventListener(
        "online",
        resume,
      );
  }, [uploadOne, uploads]);

  useEffect(() => {
    if (!cryptoKey) {
      return;
    }

    void takeSharedInbox().then(
      async (incoming) => {
        if (
          !incoming ||
          Date.now() -
            incoming.createdAt >
            15 * 60_000
        ) {
          return;
        }

        if (
          incoming.text.trim()
        ) {
          await shareText(
            incoming.text,
          );
        }

        if (
          incoming.files.length
        ) {
          await uploadFiles(
            incoming.files,
          );
        }
      },
    );
  }, [
    cryptoKey,
    shareText,
    uploadFiles,
  ]);

  useEffect(() => {
    const paste = (
      event: ClipboardEvent,
    ) => {
      const image = [
        ...(event.clipboardData
          ?.items ?? []),
      ].find(
        (item) =>
          item.kind === "file" &&
          item.type.startsWith(
            "image/",
          ),
      );

      if (image) {
        const blob =
          image.getAsFile();

        if (blob) {
          event.preventDefault();

          const extension =
            blob.type
              .split("/")[1]
              ?.replace(
                "jpeg",
                "jpg",
              ) || "png";

          setFeedback(
            "Image pasted",
          );

          setTimeout(
            () => setFeedback(""),
            1500,
          );

          uploadFiles([
            new File(
              [blob],
              `pasted-image-${Date.now()}.${extension}`,
              {
                type: blob.type,
              },
            ),
          ]);
        }
      } else {
        const text =
          event.clipboardData?.getData(
            "text",
          );

        if (
          text &&
          document.activeElement
            ?.tagName !==
            "INPUT" &&
          document.activeElement
            ?.tagName !==
            "TEXTAREA"
        ) {
          event.preventDefault();

          setDraft(text);

          setFeedback(
            "Text pasted",
          );

          setTimeout(
            () => setFeedback(""),
            1200,
          );
        }
      }
    };

    window.addEventListener(
      "paste",
      paste,
    );

    return () =>
      window.removeEventListener(
        "paste",
        paste,
      );
  }, [uploadFiles]);

  if (keyError) {
    return (
      <KeyState kind={keyError} />
    );
  }

  if (error) {
    return (
      <StateScreen kind={error} />
    );
  }

  if (!room) {
    if (instantPendingFiles.length) return <PreparingRoomShell files={instantPendingFiles} error={false} onRetry={() => undefined} onBack={() => undefined} />;
    return (
      <div className="room-loading">
        <span className="wordmark">
          {brand.name}
          <i />
        </span>

        <div className="loader" />
      </div>
    );
  }

  if (instantPendingFiles.length && !instantHandoffStarted) {
    return <PreparingRoomShell files={instantPendingFiles} error={false} onRetry={() => undefined} onBack={() => undefined} />;
  }

  const left = Math.max(
    0,
    new Date(
      room.expiresAt,
    ).getTime() - now,
  );

  const timerLabel =
    formatRemaining(left);

  const roomUrl =
    typeof window !==
    "undefined"
      ? window.location.href
      : "";

  const downloadableFiles =
    items.filter(
      (item) =>
        (item.type === "FILE" ||
          item.type ===
            "IMAGE") &&
        item.locallyAvailable &&
        item.fileName &&
        item.mimeType &&
        item.oneTimeStatus !==
          "CONSUMED",
    );

  async function deleteItem(
    id: string,
  ) {
    await fetch(
      `/api/rooms/${slug}/items/${id}`,
      {
        method: "DELETE",

        headers: {
          "x-participant-id":
            identity.id,
        },
      },
    );
  }

  async function downloadItem(
    item: DecryptedItem,
  ) {
    const key = keyRef.current;

    if (
      !key ||
      !item.fileName ||
      !item.mimeType
    ) {
      return;
    }

    const transport: Transport =
      item.availability ===
      "DIRECT"
        ? "p2p"
        : "r2";

    const bucket = sizeBucket(
      item.fileSize ?? 0,
    );

    trackEvent(
      "file_download_started",
      {
        transport,
        size_bucket: bucket,
        one_time:
          item.oneTime,
      },
      `download-start:${item.id}`,
    );

    try {
      let consumeToken:
        | string
        | undefined;

      if (item.oneTime) {
        const reserved =
          await fetch(
            `/api/rooms/${slug}/items/${item.id}/consume`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  action:
                    "reserve",
                }),
            },
          );

        if (!reserved.ok) {
          throw new Error(
            "No longer available",
          );
        }

        consumeToken = (
          (await reserved.json()) as {
            consumeToken: string;
          }
        ).consumeToken;
      }

      const encrypted =
        directBlobs.current.get(
          item.id,
        ) ??
        (await fetchEncryptedFile(
          slug,
          item.id,
          fetch,
          consumeToken,
        ));

      const blob =
        await decryptFileChunks(
          key,
          encrypted,
          cryptoContextRef.current,
          item.id,
          item.mimeType,
        );

      const url =
        URL.createObjectURL(blob);

      const anchor =
        document.createElement(
          "a",
        );

      anchor.href = url;
      anchor.download =
        item.fileName;

      anchor.click();

      if (consumeToken) {
        await fetch(
          `/api/rooms/${slug}/items/${item.id}/consume`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "complete",

                consumeToken,
              }),
          },
        );
      }

      trackEvent(
        "file_download_completed",
        {
          transport,
          size_bucket: bucket,
          one_time:
            item.oneTime,
        },
        `download-complete:${item.id}`,
      );

      trackEvent(
        "successful_transfer",
        {
          transport,
          size_bucket: bucket,
          direct_only: Boolean(
            room?.directOnly,
          ),
          one_time:
            item.oneTime,
        },
        `transfer:${item.id}`,
      );

      if (consumeToken) {
        trackEvent(
          "one_time_file_consumed",
          {
            transport,
          },
          `consumed:${item.id}`,
        );
      }

      setTimeout(
        () =>
          URL.revokeObjectURL(
            url,
          ),
        1000,
      );
    } catch (cause) {
      const category =
        errorCategory(cause);

      trackEvent(
        "file_download_failed",
        {
          transport,
          size_bucket: bucket,
          error_category:
            category,
        },
        `download-failed:${item.id}:${category}`,
      );

      setFeedback(
        item.availability ===
          "DIRECT"
          ? "No longer available."
          : "Unable to decrypt file.",
      );

      setTimeout(
        () => setFeedback(""),
        1600,
      );
    }
  }

  async function downloadAll() {
    const key = keyRef.current;

    if (
      !key ||
      downloadableFiles.length <
        2 ||
      downloadingAll
    ) {
      return;
    }

    setDownloadingAll(true);

    const consumed: {
      id: string;
      token: string;
    }[] = [];

    try {
      const usedNames =
        new Set<string>();

      const files: {
        name: string;
        input: Blob;
      }[] = [];

      for (const [
        index,
        item,
      ] of downloadableFiles.entries()) {
        let consumeToken:
          | string
          | undefined;

        if (item.oneTime) {
          const reserved =
            await fetch(
              `/api/rooms/${slug}/items/${item.id}/consume`,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json",
                },

                body:
                  JSON.stringify({
                    action:
                      "reserve",
                  }),
              },
            );

          if (!reserved.ok) {
            throw new Error(
              "No longer available",
            );
          }

          consumeToken = (
            (await reserved.json()) as {
              consumeToken:
                string;
            }
          ).consumeToken;
        }

        const encrypted =
          directBlobs.current.get(
            item.id,
          ) ??
          (await fetchEncryptedFile(
            slug,
            item.id,
            fetch,
            consumeToken,
          ));

        const blob =
          await decryptFileChunks(
            key,
            encrypted,
            cryptoContextRef.current,
            item.id,
            item.mimeType!,
          );

        const safeName =
          item
            .fileName!.replace(
              /[\\/]/g,
              "_",
            )
            .replace(
              /[\u0000-\u001f\u007f]/g,
              "_",
            )
            .trim() ||
          `file-${index + 1}`;

        const dot =
          safeName.lastIndexOf(
            ".",
          );

        const stem =
          dot > 0
            ? safeName.slice(
                0,
                dot,
              )
            : safeName;

        const extension =
          dot > 0
            ? safeName.slice(
                dot,
              )
            : "";

        let archiveName =
          safeName;

        let duplicate = 2;

        while (
          usedNames.has(
            archiveName,
          )
        ) {
          archiveName = `${stem} (${duplicate++})${extension}`;
        }

        usedNames.add(
          archiveName,
        );

        files.push({
          name: archiveName,
          input: blob,
        });

        if (consumeToken) {
          consumed.push({
            id: item.id,
            token:
              consumeToken,
          });
        }
      }

      const { downloadZip } =
        await import(
          "client-zip"
        );

      const zip =
        await downloadZip(
          files,
        ).blob();

      const url =
        URL.createObjectURL(zip);

      const anchor =
        document.createElement(
          "a",
        );

      anchor.href = url;

      anchor.download = `BlinkRoom-${slug}.zip`;

      anchor.click();
      anchor.remove();

      for (const item of consumed) {
        await fetch(
          `/api/rooms/${slug}/items/${item.id}/consume`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "complete",

                consumeToken:
                  item.token,
              }),
          },
        );
      }

      setTimeout(
        () =>
          URL.revokeObjectURL(
            url,
          ),
        1000,
      );

      setFeedback(
        `${files.length} files downloaded.`,
      );

      setTimeout(
        () => setFeedback(""),
        1600,
      );
    } catch {
      setFeedback(
        "Unable to download all files.",
      );

      setTimeout(
        () => setFeedback(""),
        2200,
      );
    } finally {
      setDownloadingAll(false);
    }
  }

  async function destroyRoom() {
    const res = await fetch(
      `/api/rooms/${slug}`,
      {
        method: "DELETE",
      },
    );

    if (res.ok) {
      trackEvent(
        "room_destroyed",
        {
          reason: "owner",

          room_lifetime_bucket:
            lifetimeBucket(left),
        },
        "room-destroyed",
      );

      clearSecrets();
      setError("destroyed");
    }
  }

  async function lockRoomAccess() {
    if (lockingRoom) return;
    setLockingRoom(true);
    const res = await fetch(`/api/rooms/${slug}/rotate`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      setFeedback(data?.error ?? "Unable to secure this room.");
      setTimeout(() => setFeedback(""), 2400);
      setLockingRoom(false);
      return;
    }
    const data = await res.json() as { slug: string };
    sessionStorage.setItem("blinkroom_room_secured", data.slug);
    window.location.replace(`/r/${data.slug}${window.location.hash}`);
  }

  async function updateLifetime(
    ttlHours: RoomTtlHours,
  ) {
    const res = await fetch(
      `/api/rooms/${slug}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          ttlHours,
        }),
      },
    );

    if (!res.ok) {
      if (
        res.status === 409 ||
        res.status === 410
      ) {
        clearSecrets();
        setError("expired");
      }

      return;
    }

    const data =
      (await res.json()) as {
        expiresAt: string;
      };

    setRoom((current) =>
      current
        ? {
            ...current,
            expiresAt:
              data.expiresAt,
          }
        : current,
    );

    setLifetime(false);

    setFeedback(
      "Lifetime updated.",
    );

    setTimeout(
      () => setFeedback(""),
      1600,
    );
  }

  async function updateSetting(
    setting:
      | "autoDestroyWhenEmpty"
      | "directOnly",
    value: boolean,
  ) {
    const res = await fetch(
      `/api/rooms/${slug}/settings`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          [setting]: value,
        }),
      },
    );

    if (!res.ok) {
      setFeedback(
        (
          (await res
            .json()
            .catch(
              () => null,
            )) as {
            error?: string;
          } | null
        )?.error ??
          "Unable to update room.",
      );

      setTimeout(
        () => setFeedback(""),
        2200,
      );

      return;
    }

    const settings =
      (await res.json()) as {
        autoDestroyWhenEmpty:
          boolean;
        directOnly: boolean;
      };

    setRoom((current) =>
      current
        ? {
            ...current,
            ...settings,
          }
        : current,
    );

    if (
      value &&
      setting ===
        "directOnly"
    ) {
      trackEvent(
        "direct_only_enabled",
        {},
        "direct-only-enabled",
      );
    }

    if (
      value &&
      setting ===
        "autoDestroyWhenEmpty"
    ) {
      trackEvent(
        "auto_destroy_enabled",
        {},
        "auto-destroy-enabled",
      );
    }

    setFeedback(
      "Room settings updated.",
    );

    setTimeout(
      () => setFeedback(""),
      1600,
    );
  }

  return (
    <main
      className="room-shell"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);

        const snapshot =
          snapshotDrop(
            event.dataTransfer,
          );

        void (async () => {
          try {
            setFeedback(
              "Preparing files…",
            );

            const files =
              await filesFromDropSnapshot(
                snapshot,
              );

            if (!files.length) {
              setFeedback(
                "Nothing to upload.",
              );

              setTimeout(
                () =>
                  setFeedback(""),
                1800,
              );

              return;
            }

            setFeedback(
              files.length === 1
                ? "1 item ready."
                : `${files.length} items ready.`,
            );

            setTimeout(
              () =>
                setFeedback(""),
              1200,
            );

            await uploadFiles(
              files,
            );
          } catch (cause) {
            console.error(
              "[DROP_PREPARATION_FAILED]",
              {
                name:
                  cause instanceof
                  Error
                    ? cause.name
                    : "Unknown",

                message:
                  cause instanceof
                  Error
                    ? cause.message
                    : String(
                        cause,
                      ),
              },
            );

            setFeedback(
              cause instanceof
                Error &&
                cause.message ===
                  "This folder is empty."
                ? "This folder is empty."
                : "Couldn’t prepare dropped items.",
            );

            setTimeout(
              () =>
                setFeedback(""),
              2200,
            );
          }
        })();
      }}
    >
      {dragging && (
        <div
          className="drop-overlay"
          onDragLeave={() =>
            setDragging(false)
          }
        >
          <strong>
            DROP IT.
          </strong>

          <span>
            Everyone in the room
            will see it.
          </span>
        </div>
      )}

      {feedback && (
        <div className="feedback-toast">
          <Check />
          {feedback}
        </div>
      )}

      <header className="room-header">
        <div className="header-main">
          <Link
            className="wordmark"
            href="/"
          >
            {brand.name}
            <i />
          </Link>

          <div className="room-code">
            <span>ROOM</span>
            <strong>
              {slug}
            </strong>
          </div>

          <button
            className="presence-count"
            onClick={closeMenu}
          >
            <i />
            {participants.length}{" "}
            online
          </button>

          <div
            className="e2ee-label"
            title="Shared content is encrypted in your browser. BlinkRoom does not receive the room encryption key."
          >
            <LockKeyhole />
            End-to-end encrypted
          </div>

          <div className="lifetime-wrap" data-room-popup="lifetime">
            {isOwner ? (
              <button
                className={`room-timer owner ${
                  left < 3600000
                    ? "ending"
                    : ""
                } ${
                  left < 300000
                    ? "urgent"
                    : ""
                }`}
                onClick={() => {
                  if (lifetime) closeLifetime();
                  else {
                    setLifetimeClosing(false);
                    setLifetime(true);
                  }
                }}
              >
                {timerLabel}
              </button>
            ) : (
              <div
                className={`room-timer ${
                  left < 3600000
                    ? "ending"
                    : ""
                } ${
                  left < 300000
                    ? "urgent"
                    : ""
                }`}
              >
                {timerLabel}
              </div>
            )}

            {lifetime &&
              isOwner && (
                <div className={`lifetime-popover${lifetimeClosing ? " popup-closing" : ""}`}>
                  <strong>
                    Room lifetime
                  </strong>

                  <span>
                    Expires in{" "}
                    {formatExpirationSummary(
                      left,
                    )}
                  </span>

                  <div>
                    {roomDurations.map(
                      (duration) => (
                        <button
                          key={
                            duration.hours
                          }
                          onClick={() =>
                            updateLifetime(
                              duration.hours,
                            )
                          }
                        >
                          {
                            duration.label
                          }
                        </button>
                      ),
                    )}
                  </div>
                </div>
              )}
          </div>

          <div className="header-actions">
            <button
              className="button"
              onClick={() =>
                setInvite(true)
              }
            >
              <Share2 />
              Invite
            </button>

            <div className="more-wrap" data-room-popup="menu">
              <button
                className="more-button"
                onClick={() => {
                  if (menu) closeMenu();
                  else {
                    setMenuClosing(false);
                    setMenu(true);
                  }
                }}
                aria-label="Room menu"
              >
                <MoreHorizontal />
              </button>

              {menu && (
                <div className={`room-menu${menuClosing ? " popup-closing" : ""}`}>
                  {isOwner ? (
                    <>
                      <button
                        className="setting-option"
                        onClick={() =>
                          updateSetting(
                            "autoDestroyWhenEmpty",
                            !room.autoDestroyWhenEmpty,
                          )
                        }
                      >
                        <span>
                          Destroy when
                          everyone leaves

                          <small>
                            The room
                            disappears
                            after the last
                            participant
                            leaves.
                          </small>
                        </span>

                        <b>
                          {room.autoDestroyWhenEmpty
                            ? "On"
                            : "Off"}
                        </b>
                      </button>

                      <button
                        className="setting-option"
                        onClick={() =>
                          updateSetting(
                            "directOnly",
                            !room.directOnly,
                          )
                        }
                      >
                        <span>
                          Direct transfers
                          only

                          <small>
                            Files are never
                            stored
                            temporarily.
                          </small>
                        </span>

                        <b>
                          {room.directOnly
                            ? "On"
                            : "Off"}
                        </b>
                      </button>

                      <button
                        className="emergency-lock-option"
                        onClick={() => { setEmergencyLock(true); setMenu(false); }}
                      >
                        <LockKeyhole />
                        <span>Emergency lock<small>Change the room code and remove existing access.</small></span>
                      </button>

                      <button
                        onClick={() => {
                          setDestroy(
                            true,
                          );

                          setMenu(
                            false,
                          );
                        }}
                      >
                        <Trash2 />
                        Destroy room
                      </button>
                    </>
                  ) : (
                    <span>
                      No room actions
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <button
            className="mobile-menu"
            aria-label="Invite people"
            onClick={() =>
              setInvite(true)
            }
          >
            <Share2 />
          </button>

          {isOwner && (
            <button
              className="mobile-more"
              aria-label="Room options"
              aria-haspopup="dialog"
              aria-expanded={menu}
              data-room-popup="menu"
              onClick={() => {
                if (menu) closeMenu();
                else {
                  setMenuClosing(false);
                  setMenu(true);
                }
              }}
            >
              <MoreHorizontal />
            </button>
          )}

          {menu &&
            isOwner && (
              createPortal(
              <div className={`mobile-room-menu-backdrop${menuClosing ? " popup-closing" : ""}`} onMouseDown={closeMenu}>
              <section data-room-popup="menu" className="mobile-room-menu" role="dialog" aria-modal="true" aria-labelledby="mobile-room-options-title" onMouseDown={(event) => event.stopPropagation()}>
                <div className="mobile-room-menu-handle" />
                <header><h2 id="mobile-room-options-title">Room options</h2><button onClick={closeMenu} aria-label="Close room options"><X /></button></header>
                <button className="mobile-setting-option" onClick={() => updateSetting("autoDestroyWhenEmpty", !room.autoDestroyWhenEmpty)}>
                  <span><strong>Destroy when everyone leaves</strong><small>The room disappears after the last participant leaves.</small></span><b>{room.autoDestroyWhenEmpty ? "On" : "Off"}</b>
                </button>
                <button className="mobile-setting-option" onClick={() => updateSetting("directOnly", !room.directOnly)}>
                  <span><strong>Direct transfers only</strong><small>Files are never stored temporarily.</small></span><b>{room.directOnly ? "On" : "Off"}</b>
                </button>
                <button className="mobile-emergency-lock" onClick={() => { setEmergencyLock(true); setMenu(false); }}>
                  <LockKeyhole /><span><strong>Emergency lock</strong><small>Change the room code and remove existing access.</small></span>
                </button>
                <div className="mobile-room-menu-divider" />
                <button className="mobile-destroy-room"
                  onClick={() => {
                    setDestroy(
                      true,
                    );

                    setMenu(
                      false,
                    );
                  }}
                >
                  <Trash2 />
                  Destroy room
                </button>
              </section>
              </div>,
              document.body,
              )
            )}
        </div>

        {status !==
          "connected" && (
          <div className="connection-strip">
            {status ===
            "offline"
              ? "You’re offline"
              : "Reconnecting…"}
          </div>
        )}
      </header>

      <section className="timeline">
        <div className="timeline-intro">
          <span>
            SHARED IN THIS ROOM
          </span>

          <div className="timeline-intro-actions">
            <p>
              Everything here
              disappears when the
              room ends.
            </p>

            {downloadableFiles.length >
              1 && (
              <button
                className="download-all"
                onClick={
                  downloadAll
                }
                disabled={
                  downloadingAll
                }
              >
                <Download />

                {downloadingAll
                  ? "Preparing…"
                  : "Download All"}
              </button>
            )}
          </div>
        </div>

        {!items.length &&
          !uploads.length && (
            <div className="empty">
              <h1>
                Drop anything.
              </h1>

              <p>
                Files, photos,
                text or links.
              </p>

              <small>
                Everyone in this
                room sees it
                instantly.
              </small>

              <button
                className="button"
                onClick={() =>
                  fileRef.current?.click()
                }
              >
                <Paperclip />
                Choose a file
              </button>
            </div>
          )}

        <div className="items">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              you={
                item.senderId ===
                identity.id
              }
              onDelete={() =>
                deleteItem(
                  item.id,
                )
              }
              onPreview={() =>
                setPreview(item)
              }
              onDownload={() =>
                downloadItem(
                  item,
                )
              }
            />
          ))}

          {uploads.map(
            (upload) => (
              <div
                className={`upload-card ${upload.status}`}
                key={upload.id}
              >
                <FileUp />

                <div>
                  <strong>
                    {
                      upload.file
                        .name
                    }
                  </strong>

                  <small>
                    {formatSize(
                      upload.file
                        .size,
                    )}
                  </small>

                  <span>
                    {upload.status ===
                    "queued"
                      ? "Preparing upload…"
                      : upload.status ===
                    "paused"
                      ? "Paused — connection lost"
                      : upload.status ===
                          "resuming"
                        ? `Resuming… · ${upload.progress}%`
                        : upload.status ===
                            "failed"
                          ? upload.error ??
                            "Transfer failed"
                          : upload.status ===
                              "complete"
                            ? "Ready"
                            : upload.status ===
                                "encrypting"
                              ? `Encrypting · ${upload.progress}%`
                              : upload.status ===
                                  "sending"
                                ? `Sending · ${upload.progress}%`
                                : `Uploading securely · ${upload.progress}%`}
                  </span>

                  {upload.status === "uploading" && upload.uploadedBytes !== undefined && (
                    <small className="upload-transfer-meta">
                      {formatSize(upload.uploadedBytes)} / {formatSize(upload.file.size)}
                      {upload.bytesPerSecond && upload.etaSeconds !== undefined
                        ? ` · ${formatSize(upload.bytesPerSecond)}/s · ~${Math.max(1, Math.ceil(upload.etaSeconds))} sec remaining`
                        : ""}
                    </small>
                  )}

                  {upload.status !==
                    "failed" &&
                    upload.status !==
                      "paused" && (
                      <i>
                        <b
                          style={{
                            width: `${upload.progress}%`,
                          }}
                        />
                      </i>
                    )}
                </div>

                {upload.status ===
                "complete" ? (
                  <Check />
                ) : upload.status ===
                    "failed" ||
                  upload.status ===
                    "paused" ? (
                  <div className="upload-actions">
                    <button
                      onClick={() =>
                        uploadOne(
                          upload.file,
                          upload.id,
                        )
                      }
                    >
                      <RotateCcw />

                      {upload.status ===
                      "paused"
                        ? "Resume"
                        : "Retry"}
                    </button>

                    <button
                      onClick={() =>
                        setUploads(
                          (
                            all,
                          ) =>
                            all.filter(
                              (
                                item,
                              ) =>
                                item.id !==
                                upload.id,
                            ),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    className="transfer-cancel"
                    aria-label="Cancel transfer"
                    onClick={() =>
                      transferControllers.current
                        .get(
                          upload.id,
                        )
                        ?.abort()
                    }
                  >
                    <X />
                  </button>
                )}
              </div>
            ),
          )}

          {events.map(
            (event) => (
              <div
                className="system-event"
                key={event.id}
              >
                <span>
                  {event.text}
                </span>
              </div>
            ),
          )}

          <div ref={bottomRef} />
        </div>
      </section>

      <div className="composer">
        <div className="composer-inner">
          <button
            className="add-button"
            data-room-popup="sheet"
            onClick={() => {
              if (sheet) closeSheet();
              else {
                setSheetClosing(false);
                setSheet(true);
              }
            }}
          >
            <Plus />
          </button>

          <textarea
            value={draft}
            onChange={(event) =>
              setDraft(
                event.target.value,
              )
            }
            onKeyDown={(event) => {
              if (
                event.key ===
                  "Enter" &&
                !event.shiftKey
              ) {
                event.preventDefault();
                void shareText();
              }
            }}
            rows={1}
            placeholder="Paste or type anything…"
          />

          <button
            className="send-button"
            onClick={() =>
              void shareText()
            }
            disabled={
              !draft.trim()
            }
          >
            <ArrowUp />
          </button>
        </div>

        <span>
          Press Enter to share ·
          Shift + Enter for a new
          line
        </span>
      </div>

      <input
        hidden
        multiple
        ref={fileRef}
        type="file"
        onChange={(event) => {
          if (
            event.target.files
          ) {
            void uploadFiles(
              event.target.files,
            );
          }
        }}
      />

      <input
        hidden
        multiple
        ref={photoRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(event) => {
          if (
            event.target.files
          ) {
            void uploadFiles(
              event.target.files,
            );
          }
        }}
      />

      {invite && (
        <InviteModal
          url={roomUrl}
          onClose={() =>
            setInvite(false)
          }
        />
      )}

      {destroy && (
        <ConfirmDestroy
          onClose={() =>
            setDestroy(false)
          }
          onConfirm={
            destroyRoom
          }
        />
      )}

      {emergencyLock && (
        <ConfirmEmergencyLock
          loading={lockingRoom}
          onClose={() => { if (!lockingRoom) setEmergencyLock(false); }}
          onConfirm={lockRoomAccess}
        />
      )}

      {sheet && (
        <div
          className={`sheet-backdrop${sheetClosing ? " popup-closing" : ""}`}
          onClick={closeSheet}
        >
          <div
            className={`bottom-sheet${sheetClosing ? " popup-closing" : ""}`}
            data-room-popup="sheet"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="sheet-handle" />

            <h3>
              Add to room
            </h3>

            <button
              className="one-time-option"
              aria-pressed={
                oneTimeNext
              }
              onClick={() =>
                setOneTimeNext(
                  (value) =>
                    !value,
                )
              }
            >
              <span>
                Open once

                <small>
                  Unavailable after
                  one successful
                  download.
                </small>
              </span>

              <b>
                {oneTimeNext
                  ? "On"
                  : "Off"}
              </b>
            </button>

            <div className="sheet-options">
              <button
                onClick={() => {
                  fileRef.current?.click();
                  setSheet(false);
                }}
              >
                <FileUp />

                <span>
                  Upload file
                </span>
              </button>

              <button
                onClick={() => {
                  photoRef.current?.click();
                  setSheet(false);
                }}
              >
                <ImageIcon />

                <span>
                  Choose photo
                </span>
              </button>
            </div>

            <button
              className="sheet-close"
              onClick={closeSheet}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {preview?.objectUrl && (
        <div
          className="lightbox"
          onClick={() =>
            setPreview(null)
          }
        >
          <button>
            <X />
          </button>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              preview.objectUrl
            }
            alt={
              preview.fileName ??
              "Preview"
            }
          />

          <button
            className="button filled"
            onClick={(event) => {
              event.stopPropagation();

              void downloadItem(
                preview,
              );
            }}
          >
            <FileUp />
            Download
          </button>
        </div>
      )}
    </main>
  );
}

function ConfirmEmergencyLock({ onClose, onConfirm, loading }: { onClose: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal emergency-lock-confirm" role="dialog" aria-modal="true" aria-labelledby="emergency-lock-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="lock-mark"><LockKeyhole /></div>
        <h2 id="emergency-lock-title">Lock this room?</h2>
        <p>Use this if your room code may have been shared with someone you don’t trust.</p>
        <ul>
          <li>A new room code will be generated.</li>
          <li>The old room code will stop working immediately.</li>
          <li>Existing participants will be disconnected.</li>
          <li>Your files and room will remain available.</li>
        </ul>
        <div className="modal-actions">
          <button className="button" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="button lock" onClick={onConfirm} disabled={loading}>{loading ? "Securing room…" : "Lock & generate new code"}</button>
        </div>
      </section>
    </div>
  );
}

function ConfirmDestroy({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={onClose}
    >
      <section
        className="modal confirm"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <div className="warning">
          <Trash2 />
        </div>

        <h2>
          Destroy this room?
        </h2>

        <p>
          Everything shared here
          will disappear
          immediately.
        </p>

        <strong>
          This cannot be undone.
        </strong>

        <div className="modal-actions">
          <button
            className="button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="button destroy"
            onClick={onConfirm}
          >
            Destroy room
          </button>
        </div>
      </section>
    </div>
  );
}

function KeyState({
  kind,
}: {
  kind:
    | "missing"
    | "unlock";
}) {
  const copy =
    kind === "missing"
      ? [
          "Missing room key.",
          "This link is incomplete. Ask the room owner for the original invite link.",
        ]
      : [
          "Unable to unlock this room.",
          "The invite key is invalid or the encrypted content could not be verified.",
        ];

  return (
    <main className="state-screen">
      <Link
        className="wordmark"
        href="/"
      >
        {brand.name}
        <i />
      </Link>

      <div>
        <span className="state-icon">
          <LockKeyhole />
        </span>

        <h1>
          {copy[0]}
        </h1>

        <p>
          {copy[1]}
        </p>

        <Link
          href="/"
          className="button filled"
        >
          Create a room
          <ChevronUp />
        </Link>
      </div>
    </main>
  );
}

function StateScreen({
  kind,
}: {
  kind: string;
}) {
  const copy =
    kind === "expired"
      ? [
          "Time’s up.",
          "This room has expired and its contents are no longer available.",
          "Create another room",
        ]
      : kind === "destroyed"
        ? [
            "This room is gone.",
            "Everything shared here is no longer available.",
            "Create another room",
          ]
        : kind === "access-changed"
          ? [
              "Room access changed",
              "The room owner reset access to this room. Ask them for the new room code to reconnect.",
              "Back to BlinkRoom",
            ]
        : kind === "not-found"
          ? [
              "Nothing here.",
              "This room doesn’t exist or is no longer available.",
              "Create a room",
            ]
          : [
              "This room is unavailable.",
              "Please try again in a moment.",
              "Create a room",
            ];

  return (
    <main className="state-screen">
      <Link
        className="wordmark"
        href="/"
      >
        {brand.name}
        <i />
      </Link>

      <div>
        <span className="state-icon">
          <X />
        </span>

        <h1>
          {copy[0]}
        </h1>

        <p>
          {copy[1]}
        </p>

        <Link
          href="/"
          className="button filled"
        >
          {copy[2]}
          <ChevronUp />
        </Link>
      </div>
    </main>
  );
}

function formatSize(n: number) {
  return n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(
        1,
        Math.ceil(n / 1024),
      )} KB`;
}

function formatRemaining(
  ms: number,
) {
  if (ms >= 86_400_000) {
    return `${Math.floor(
      ms / 86_400_000,
    )}d ${Math.floor(
      (ms % 86_400_000) /
        3_600_000,
    )}h left`;
  }

  return `${String(
    Math.floor(
      ms / 3_600_000,
    ),
  ).padStart(
    2,
    "0",
  )}:${String(
    Math.floor(
      (ms % 3_600_000) /
        60_000,
    ),
  ).padStart(
    2,
    "0",
  )}:${String(
    Math.floor(
      (ms % 60_000) /
        1000,
    ),
  ).padStart(
    2,
    "0",
  )} left`;
}

function formatExpirationSummary(
  ms: number,
) {
  if (ms >= 86_400_000) {
    return `${Math.floor(
      ms / 86_400_000,
    )}d ${Math.floor(
      (ms % 86_400_000) /
        3_600_000,
    )}h`;
  }

  return `${Math.floor(
    ms / 3_600_000,
  )}h ${Math.floor(
    (ms % 3_600_000) /
      60_000,
  )}m`;
}
