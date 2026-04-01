/**
 * Loads env for CLI tools (Drizzle Kit, seed script). Matches Next.js priority:
 * `.env` then `.env.local` (local overrides).
 * Next.js still loads these automatically for `next dev`; this is for non-Next processes.
 */
import { config } from "dotenv"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

export function loadProjectEnv(cwd: string = process.cwd()): void {
  const envFile = resolve(cwd, ".env")
  const localFile = resolve(cwd, ".env.local")
  if (existsSync(envFile)) {
    config({ path: envFile })
  }
  if (existsSync(localFile)) {
    config({ path: localFile, override: true })
  }
}
