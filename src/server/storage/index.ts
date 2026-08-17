import { LocalStorageProvider } from "./local";
import { R2StorageProvider } from "./r2";
import type { StorageProvider } from "./types";
import { env } from "@/src/lib/env";
export const createStorageProvider = (kind: "local" | "r2"): StorageProvider => kind === "r2" ? new R2StorageProvider() : new LocalStorageProvider();
export const storage: StorageProvider = createStorageProvider(env.STORAGE_PROVIDER);
export const getStorageProvider = () => storage;
export type { StorageProvider } from "./types";
