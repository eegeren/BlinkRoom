import assert from "node:assert/strict";
if (process.env.STORAGE_PROVIDER !== "r2") { console.log("R2 integration skipped: set STORAGE_PROVIDER=r2 and server-side R2 credentials."); process.exit(0); }
const response = await fetch(`${process.env.TEST_BASE_URL ?? "http://localhost:3000"}/api/health`); assert.equal(response.status, 200); const health = await response.json() as { storage: string }; assert.equal(health.storage, "configured"); console.log(JSON.stringify({ r2RuntimeConfigured: true }));
