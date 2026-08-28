export type RoomDeviceSummary = {
  id: string;
  status: string;
  browserLabel: string;
  platformLabel: string;
  expiresAt?: string;
};

export function pendingDeviceRequests(devices: RoomDeviceSummary[], now = Date.now()) {
  const seen = new Set<string>();
  return devices.filter((device) => {
    if (device.status !== "PENDING" || seen.has(device.id)) return false;
    if (device.expiresAt && new Date(device.expiresAt).getTime() <= now) return false;
    seen.add(device.id);
    return true;
  });
}

export function coarseDeviceLabel(device: RoomDeviceSummary) {
  return `${device.browserLabel} on ${device.platformLabel}`;
}
