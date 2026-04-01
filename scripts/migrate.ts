/**
 * Runs Drizzle migrations with explicit error output. drizzle-kit's migrate
 * spinner can hide the underlying Postgres message on some terminals.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { drizzle } from "drizzle-orm/node-postgres"
import { resolve } from "node:path"
import { Pool } from "pg"

import { loadProjectEnv } from "../lib/load-env"

function printMigrationError(e: unknown): void {
  console.error("\nMigration failed:\n")
  const visit = (prefix: string, err: unknown, depth: number) => {
    if (depth > 6 || err == null) return
    if (typeof err === "object") {
      const o = err as Record<string, unknown>
      const msg = o.message
      const code = o.code
      if (typeof msg === "string" && msg.length > 0) {
        const codeBit = typeof code === "string" ? ` [${code}]` : ""
        console.error(`${prefix}${codeBit}: ${msg}`)
      }
      if ("cause" in o) visit("  Cause", o.cause, depth + 1)
    } else if (typeof err === "string") {
      console.error(`${prefix}: ${err}`)
    }
  }
  visit("Error", e, 0)
  if (e instanceof Error && e.stack) {
    console.error("\n" + e.stack)
  }
}

async function main() {
  loadProjectEnv()
  const url = process.env.DATABASE_URL?.trim() ?? ""
  if (!url) {
    console.error(
      "\nDATABASE_URL is empty. Set it in `.env.local` at the project root (next to package.json).\n" +
        "Example: DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/power_fi\n",
    )
    process.exit(1)
  }

  const folder = resolve(process.cwd(), "drizzle")
  const pool = new Pool({ connectionString: url })
  const db = drizzle({ client: pool })

  try {
    await migrate(db, { migrationsFolder: folder })
    console.log("Migrations applied successfully.")
  } catch (e) {
    printMigrationError(e)
    const flat = e instanceof Error ? `${e.message}\n${e.cause}` : String(e)
    if (/role .+ does not exist/i.test(flat)) {
      console.error(
        "\nThis often means the username in DATABASE_URL is wrong. On macOS with Homebrew Postgres, " +
          "the default superuser is usually your macOS login name, not `postgres`. " +
          "Try: postgresql://YOUR_USERNAME@127.0.0.1:5432/power_fi\n",
      )
    }
    console.error(
      "\nHints: ensure Postgres is running, the database exists, and credentials in DATABASE_URL are correct.\n" +
        "For cloud hosts, you may need `?sslmode=require` on the URL.\n",
    )
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
