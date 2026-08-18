import type { Server } from "socket.io";
import { z } from "zod";
import { rateLimiter } from "./rate-limit";
import { db } from "@/src/lib/db";
import { canRelaySignal } from "./signaling-policy";
import { env } from "@/src/lib/env";
import { cleanupRoomStorage } from "./storage/cleanup";

type Presence = Map<string, { name: string; sockets: Set<string> }>;
const rooms = new Map<string, Presence>();
const names = new Map<string, Map<string, string>>();
const realtimeGlobal = globalThis as typeof globalThis & {
  blinkRoomIo?: Server;
};
const targetSchema = z.object({ target: z.string().uuid() }).passthrough();
const descriptionSchema = targetSchema
  .extend({
    description: z.object({
      type: z.enum(["offer", "answer"]),
      sdp: z.string().max(60_000).optional(),
    }),
  })
  .strict();
const candidateSchema = targetSchema
  .extend({
    candidate: z
      .object({
        candidate: z.string().max(8_000),
        sdpMid: z.string().max(256).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(128).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional(),
      })
      .strict(),
  })
  .strict();

function snapshot(slug: string) {
  return [...(rooms.get(slug)?.entries() ?? [])].map(([id, v]) => ({
    id,
    name: v.name,
  }));
}
export function registerRealtime(io: Server) {
  realtimeGlobal.blinkRoomIo = io;
  io.on("connection", (socket) => {
    socket.on(
      "room:join",
      async ({
        slug,
        participantId,
        name,
      }: {
        slug: string;
        participantId: string;
        name: string;
      }) => {
        if (
          !/^[A-Z0-9-]{4,16}$/.test(slug) ||
          !z.string().uuid().safeParse(participantId).success ||
          (socket.data.slug && socket.data.slug !== slug)
        )
          return;
        const active = await db.room.findUnique({
          where: { slug },
          select: { id: true, status: true, expiresAt: true },
        });
        if (
          !active ||
          !canRelaySignal(slug, slug, active.status, active.expiresAt)
        )
          return;
        await db.$transaction([
          db.roomPresence.upsert({
            where: { socketId: socket.id },
            create: {
              socketId: socket.id,
              roomId: active.id,
              participantId,
              expiresAt: new Date(
                Date.now() + env.PRESENCE_LEASE_SECONDS * 1000,
              ),
            },
            update: {
              roomId: active.id,
              participantId,
              expiresAt: new Date(
                Date.now() + env.PRESENCE_LEASE_SECONDS * 1000,
              ),
            },
          }),
          db.room.update({
            where: { id: active.id },
            data: { autoDestroyEmptySince: null },
          }),
        ]);
        const registry = names.get(slug) ?? new Map<string, string>();
        names.set(slug, registry);
        let assignedName = registry.get(participantId);
        if (!assignedName) {
          assignedName =
            name === "Room owner"
              ? "Room owner"
              : `Guest ${[...registry.values()].filter((v) => v.startsWith("Guest ")).length + 1}`;
          registry.set(participantId, assignedName);
        }
        socket.join(slug);
        socket.data = { slug, participantId, name: assignedName };
        const presence = rooms.get(slug) ?? new Map();
        rooms.set(slug, presence);
        const existing = presence.get(participantId);
        if (existing) existing.sockets.add(socket.id);
        else {
          presence.set(participantId, {
            name: assignedName,
            sockets: new Set([socket.id]),
          });
          socket
            .to(slug)
            .emit("presence:event", { kind: "joined", name: assignedName });
        }
        io.to(slug).emit("presence:update", snapshot(slug));
      },
    );
    const heartbeat = setInterval(
      () => {
        if (socket.data.slug)
          void db.roomPresence.updateMany({
            where: { socketId: socket.id },
            data: {
              expiresAt: new Date(
                Date.now() + env.PRESENCE_LEASE_SECONDS * 1000,
              ),
            },
          });
      },
      Math.floor(env.PRESENCE_LEASE_SECONDS * 500),
    );
    const relay = async (
      event:
        | "webrtc:offer"
        | "webrtc:answer"
        | "webrtc:ice-candidate"
        | "webrtc:ready"
        | "webrtc:failed",
      raw: unknown,
    ) => {
      const { slug, participantId } = socket.data as {
        slug?: string;
        participantId?: string;
      };
      if (!slug || !participantId) return;
      const parsed =
        event === "webrtc:ice-candidate"
          ? candidateSchema.safeParse(raw)
          : event === "webrtc:offer" || event === "webrtc:answer"
            ? descriptionSchema.safeParse(raw)
            : targetSchema.strict().safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.target === participantId ||
        JSON.stringify(raw).length > 64_000 ||
        !rateLimiter.check(`signal:${socket.id}`, 180, 60_000)
      )
        return;
      const room = await db.room.findUnique({
        where: { slug },
        select: { status: true, expiresAt: true },
      });
      if (
        !room ||
        !canRelaySignal(slug, slug, room.status, room.expiresAt) ||
        !rooms.get(slug)?.has(parsed.data.target)
      )
        return;
      for (const targetSocket of rooms.get(slug)?.get(parsed.data.target)
        ?.sockets ?? [])
        io.to(targetSocket).emit(event, {
          ...(raw as object),
          target: undefined,
          from: participantId,
        });
    };
    socket.on("webrtc:offer", (payload) => void relay("webrtc:offer", payload));
    socket.on(
      "webrtc:answer",
      (payload) => void relay("webrtc:answer", payload),
    );
    socket.on(
      "webrtc:ice-candidate",
      (payload) => void relay("webrtc:ice-candidate", payload),
    );
    socket.on("webrtc:ready", (payload) => void relay("webrtc:ready", payload));
    socket.on(
      "webrtc:failed",
      (payload) => void relay("webrtc:failed", payload),
    );
    socket.on("disconnect", () => {
      clearInterval(heartbeat);
      const { slug, participantId, name } = socket.data as {
        slug?: string;
        participantId?: string;
        name?: string;
      };
      if (!slug || !participantId) return;
      const presence = rooms.get(slug);
      const participant = presence?.get(participantId);
      participant?.sockets.delete(socket.id);
      if (participant?.sockets.size === 0) {
        presence?.delete(participantId);
        socket.to(slug).emit("presence:event", { kind: "left", name });
      }
      if (!presence?.size) {
        rooms.delete(slug);
        names.delete(slug);
      } else io.to(slug).emit("presence:update", snapshot(slug));
      void handleReliableEmpty(slug, socket.id);
    });
  });
}
async function handleReliableEmpty(slug: string, socketId: string) {
  const room = await db.room.findUnique({
    where: { slug },
    select: { id: true, autoDestroyWhenEmpty: true, status: true },
  });
  if (!room) return;
  await db.roomPresence.deleteMany({ where: { socketId } });
  if (!room.autoDestroyWhenEmpty || room.status !== "ACTIVE") return;
  const now = new Date(),
    active = await db.roomPresence.count({
      where: { roomId: room.id, expiresAt: { gt: now } },
    });
  if (active) return;
  const marked = await db.room.updateMany({
    where: {
      id: room.id,
      status: "ACTIVE",
      autoDestroyWhenEmpty: true,
      autoDestroyEmptySince: null,
    },
    data: { autoDestroyEmptySince: now },
  });
  if (!marked.count) return;
  realtimeGlobal.blinkRoomIo?.to(slug).emit("room:auto-destroy-pending", {
    graceSeconds: env.AUTO_DESTROY_GRACE_SECONDS,
  });
  setTimeout(async () => {
    const cutoff = new Date(Date.now() - env.AUTO_DESTROY_GRACE_SECONDS * 1000);
    const destroyed = await db.$transaction(async (tx) => {
      const current = await tx.room.findUnique({
        where: { id: room.id },
        select: {
          status: true,
          autoDestroyWhenEmpty: true,
          autoDestroyEmptySince: true,
        },
      });
      if (
        !current ||
        current.status !== "ACTIVE" ||
        !current.autoDestroyWhenEmpty ||
        !current.autoDestroyEmptySince ||
        current.autoDestroyEmptySince > cutoff ||
        (await tx.roomPresence.count({
          where: { roomId: room.id, expiresAt: { gt: new Date() } },
        }))
      )
        return false;
      await tx.room.update({
        where: { id: room.id },
        data: {
          status: "DESTROYED",
          destroyedAt: new Date(),
          cleanupStatus: "PENDING",
          cleanupUpdatedAt: new Date(),
        },
      });
      return true;
    });
    if (destroyed) {
      roomChannel.destroyed(slug);
      void cleanupRoomStorage(room.id, slug).catch(() => undefined);
    }
  }, env.AUTO_DESTROY_GRACE_SECONDS * 1000);
}
export const roomChannel = {
  itemCreated: (slug: string, item: unknown) =>
    realtimeGlobal.blinkRoomIo?.to(slug).emit("item:create", item),
  itemDeleted: (slug: string, id: string) =>
    realtimeGlobal.blinkRoomIo?.to(slug).emit("item:delete", { id }),
  destroyed: (slug: string) =>
    realtimeGlobal.blinkRoomIo?.to(slug).emit("room:destroy"),
  expired: (slug: string) =>
    realtimeGlobal.blinkRoomIo?.to(slug).emit("room:expired"),
  expirationUpdated: (slug: string, expiresAt: string) =>
    realtimeGlobal.blinkRoomIo
      ?.to(slug)
      .emit("room:expiration-updated", { expiresAt }),
  settingsUpdated: (
    slug: string,
    settings: { autoDestroyWhenEmpty: boolean; directOnly: boolean },
  ) =>
    realtimeGlobal.blinkRoomIo
      ?.to(slug)
      .emit("room:settings-updated", settings),
  itemConsumed: (slug: string, id: string) =>
    realtimeGlobal.blinkRoomIo?.to(slug).emit("item:consumed", { id }),
};
