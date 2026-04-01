import { and, eq, lte, max } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { fxRates } from "@/lib/db/schema"

import { mergePeggedQuotesMissingFromEcb } from "./pegged"
import { FX_BASE_CURRENCY } from "./iso4217"

type Db = NonNullable<ReturnType<typeof getDb>>

/**
 * Latest EUR-based snapshot with as_of_date on or before `onOrBefore` (YYYY-MM-DD).
 */
export async function loadRatesOnOrBefore(
  db: Db,
  onOrBefore: string,
): Promise<{ asOfDate: string; rates: Map<string, number> } | null> {
  const [row] = await db
    .select({ d: max(fxRates.asOfDate) })
    .from(fxRates)
    .where(
      and(eq(fxRates.baseCurrency, FX_BASE_CURRENCY), lte(fxRates.asOfDate, onOrBefore)),
    )

  const latest = row?.d
  if (!latest) return null

  const rows = await db
    .select({
      quote: fxRates.quoteCurrency,
      rate: fxRates.rate,
    })
    .from(fxRates)
    .where(
      and(eq(fxRates.asOfDate, latest), eq(fxRates.baseCurrency, FX_BASE_CURRENCY)),
    )

  const rates = new Map<string, number>()
  for (const r of rows) {
    rates.set(r.quote, Number(r.rate))
  }
  return { asOfDate: latest, rates: mergePeggedQuotesMissingFromEcb(rates) }
}

/** Most recent snapshot in DB (any date). */
export async function loadLatestRates(db: Db): Promise<{
  asOfDate: string
  rates: Map<string, number>
} | null> {
  const [row] = await db
    .select({ d: max(fxRates.asOfDate) })
    .from(fxRates)
    .where(eq(fxRates.baseCurrency, FX_BASE_CURRENCY))

  const latest = row?.d
  if (!latest) return null

  const rows = await db
    .select({
      quote: fxRates.quoteCurrency,
      rate: fxRates.rate,
    })
    .from(fxRates)
    .where(
      and(eq(fxRates.asOfDate, latest), eq(fxRates.baseCurrency, FX_BASE_CURRENCY)),
    )

  const rates = new Map<string, number>()
  for (const r of rows) {
    rates.set(r.quote, Number(r.rate))
  }
  return { asOfDate: latest, rates: mergePeggedQuotesMissingFromEcb(rates) }
}
