// Load .env.local for offline scripts (Next.js loads it automatically for the app).
import fs from "node:fs";

export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (!fs.existsSync(f)) continue;
    try {
      process.loadEnvFile(f);
    } catch {
      // ignore malformed lines; the app will report missing keys visibly
    }
  }
}
loadEnv();
