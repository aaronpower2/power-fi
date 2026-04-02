/**
 * Truncates application tables (empty data, keeps schema and Drizzle migrations).
 *
 * Usage:
 *   pnpm db:clear                    — all app tables
 *   pnpm db:clear -- goals assets    — only listed tables (+ CASCADE dependents)
 *   pnpm db:clear -- --help          — list table names
 */
import { Pool } from "pg"

import { loadProjectEnv } from "../lib/load-env"

/** Must match `lib/db/schema.ts` — omit `__drizzle_migrations`. */
const APP_TABLES = [
  "budget_month_transactions",
  "imported_transactions",
  "transaction_import_files",
  "transaction_import_batches",
  "allocation_records",
  "budget_month_plan_lines",
  "expense_records",
  "expense_lines",
  "expense_categories",
  "income_records",
  "income_lines",
  "allocation_targets",
  "allocation_strategies",
  "liabilities",
  "goal_lifestyle_lines",
  "goals",
  "assets",
  "fx_rates",
] as const

const ALLOWED = new Set<string>(APP_TABLES)

function printHelp(): void {
  console.log(`Usage:
  pnpm db:clear
  pnpm db:clear -- <table> [table ...]

PostgreSQL TRUNCATE ... CASCADE may also empty rows in other tables that
reference the tables you name.

Tables:
  ${[...APP_TABLES].sort().join("\n  ")}
`)
}

/** User-supplied args only; skips the script path that pnpm/tsx leaves in argv. */
function cliArgs(): string[] {
  let rest = process.argv.slice(2).filter((a) => a !== "--")
  if (rest[0]?.endsWith(".ts") || rest[0]?.endsWith(".js")) {
    rest = rest.slice(1)
  }
  return rest
}

function resolveTargets(): string[] {
  const argv = cliArgs()
  if (argv.length === 0) {
    return [...APP_TABLES]
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    printHelp()
    process.exit(0)
  }

  const normalized = argv.map((t) => t.toLowerCase().trim()).filter(Boolean)
  const invalid = normalized.filter((t) => !ALLOWED.has(t))
  if (invalid.length > 0) {
    console.error(`Unknown table(s): ${invalid.join(", ")}\n`)
    printHelp()
    process.exit(1)
  }

  return [...new Set(normalized)]
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

  const targets = resolveTargets()
  const pool = new Pool({ connectionString: url })
  try {
    const list = targets.join(", ")
    await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
    if (targets.length === APP_TABLES.length) {
      console.log(`Cleared ${targets.length} application tables.`)
    } else {
      console.log(`Truncated: ${list}`)
      console.log("(Related tables may also be empty due to CASCADE.)")
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
