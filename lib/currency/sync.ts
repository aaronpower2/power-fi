import { and, eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { fxRates } from "@/lib/db/schema"

import { FX_BASE_CURRENCY } from "./iso4217"
import {
  ensureEurBaseSnapshot,
  fetchFrankfurterRates,
  snapshotToRateRows,
} from "./frankfurter"

type Db = NonNullable<ReturnType<typeof getDb>>

export type SyncFxResult =
  | { ok: true; asOfDate: string; rowCount: number }
  | { ok: false; error: string }

/** Coalesces concurrent dashboard requests into a single Frankfurter fetch. */
let fxSyncInFlight: Promise<void> | null = null

/**
 * Refreshes ECB rates from Frankfurter on each dashboard load (best-effort).
 * Failures are logged in development; callers still read whatever is already in `fx_rates`.
 */
export async function syncFxOnDashboardLoad(db: Db): Promise<void> {
  if (fxSyncInFlight) {
    await fxSyncInFlight
    return
  }
  fxSyncInFlight = (async () => {
    try {
      const r = await syncFrankfurterLatest(db)
      if (!r.ok && process.env.NODE_ENV === "development") {
        console.warn("[fx] Frankfurter sync:", r.error)
      }
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[fx] Frankfurter sync threw:", e)
      }
    }
  })()
  try {
    await fxSyncInFlight
  } finally {
    fxSyncInFlight = null
  }
}

/**
 * Fetches Frankfurter latest ECB rates and replaces rows for that API date (EUR base).
 */
export async function syncFrankfurterLatest(db: Db): Promise<SyncFxResult> {
  try {
    const raw = await fetchFrankfurterRates("latest")
    const snap = ensureEurBaseSnapshot(raw)
    const rows = snapshotToRateRows(snap)
    if (rows.length === 0) {
      return { ok: false, error: "Frankfurter returned no rate rows" }
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(fxRates)
        .where(
          and(
            eq(fxRates.asOfDate, snap.date),
            eq(fxRates.baseCurrency, FX_BASE_CURRENCY),
          ),
        )
      await tx.insert(fxRates).values(
        rows.map((r) => ({
          asOfDate: r.asOfDate,
          baseCurrency: r.baseCurrency,
          quoteCurrency: r.quoteCurrency,
          rate: r.rate,
        })),
      )
    })

    return { ok: true, asOfDate: snap.date, rowCount: rows.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}
