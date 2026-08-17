import { z } from "zod";

export const ttlHoursSchema = z.union([
  z.literal(1),
  z.literal(6),
  z.literal(24),
  z.literal(72),
]);

export const roomDurationSchema = z.object({ ttlHours: ttlHoursSchema }).strict();
export type RoomTtlHours = z.infer<typeof ttlHoursSchema>;

export const roomDurations: ReadonlyArray<{ hours: RoomTtlHours; label: string }> = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 72, label: "3 days" },
];
