import { defineConfig } from "drizzle-kit"

import { loadProjectEnv } from "./lib/load-env"

loadProjectEnv()

const url = process.env.DATABASE_URL?.trim() ?? ""
if (!url && process.argv.includes("migrate")) {
  console.error(
    "\n[drizzle-kit] DATABASE_URL is empty. Add it to `.env.local` in the project root (next to package.json), not under app/.\n" +
      "Example: DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/power_fi\n" +
      "Copy from `.env.example` if present.\n",
  )
  process.exit(1)
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url,
  },
})
