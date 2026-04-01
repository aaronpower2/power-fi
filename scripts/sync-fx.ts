/**
 * Pull latest ECB rates from Frankfurter into `fx_rates`.
 * Requires DATABASE_URL. The dashboard layout also syncs on each load; use this for CI or manual refresh.
 *
 * Usage: pnpm fx:sync
 */
import { loadProjectEnv } from "../lib/load-env"
import { getDb } from "../lib/db"
import { syncFrankfurterLatest } from "../lib/currency/sync"

async function main() {
  loadProjectEnv()
  const db = getDb()
  if (!db) {
    console.error("Set DATABASE_URL to sync FX rates.")
    process.exit(1)
  }
  const r = await syncFrankfurterLatest(db)
  if (!r.ok) {
    console.error("FX sync failed:", r.error)
    process.exit(1)
  }
  console.log(`FX sync OK: ${r.rowCount} quotes as of ${r.asOfDate}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
