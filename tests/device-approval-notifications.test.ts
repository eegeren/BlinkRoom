import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coarseDeviceLabel, pendingDeviceRequests, type RoomDeviceSummary } from "../src/lib/device-approval-notifications";

const pending = (id: string, overrides: Partial<RoomDeviceSummary> = {}): RoomDeviceSummary => ({
  id, status: "PENDING", browserLabel: "Safari", platformLabel: "iPhone", ...overrides,
});

test("pending owner notifications use only the coarse device label", () => {
  const request = pending("one");
  assert.equal(coarseDeviceLabel(request), "Safari on iPhone");
  assert.deepEqual(pendingDeviceRequests([request]), [request]);
});

test("approve and deny decisions immediately leave the notification queue", () => {
  assert.deepEqual(pendingDeviceRequests([pending("approved", { status: "APPROVED" }), pending("denied", { status: "DENIED" })]), []);
});

test("duplicate realtime records do not duplicate a notification", () => {
  assert.deepEqual(pendingDeviceRequests([pending("same"), pending("same")]).map(({ id }) => id), ["same"]);
});

test("multiple pending requests retain FIFO API order", () => {
  assert.deepEqual(pendingDeviceRequests([pending("first"), pending("second"), pending("third")]).map(({ id }) => id), ["first", "second", "third"]);
});

test("expired requests are removed", () => {
  assert.deepEqual(pendingDeviceRequests([pending("old", { expiresAt: "2026-01-01T00:00:00.000Z" })], Date.parse("2026-01-02T00:00:00.000Z")), []);
});

test("room wiring gates controls to owners and reuses realtime request and decision events", () => {
  const source = readFileSync(new URL("../src/components/room-client.tsx", import.meta.url), "utf8");
  assert.match(source, /socket\.on\("device:approval-requested"/);
  assert.match(source, /socket\.on\("device:decision"/);
  assert.match(source, /isOwner && room\.deviceApprovalRequired/);
  assert.match(source, /socket\.disconnect\(\)/);
});

test("Emergency Lock and disabling Device Approval clear pending notifications", () => {
  const source = readFileSync(new URL("../src/components/room-client.tsx", import.meta.url), "utf8");
  const lock = source.slice(source.indexOf("async function lockRoomAccess"), source.indexOf("async function updateLifetime"));
  assert.match(lock, /setRoomDevices\(\[\]\)/);
  assert.match(source, /settings\.deviceApprovalRequired === false\) setRoomDevices\(\[\]\)/);
  assert.match(source, /setting === "deviceApprovalRequired" && !value\) setRoomDevices\(\[\]\)/);
});
