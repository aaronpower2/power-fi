import { FX_BASE_CURRENCY } from "./iso4217"

export type FrankfurterFetchDate = "latest" | string

export type FrankfurterSnapshot = {
  /** YYYY-MM-DD from API */
  date: string
  base: string
  /** quote -> units of quote per 1 base */
  rates: Record<string, number>
}

export async function fetchFrankfurterRates(
  date: FrankfurterFetchDate,
): Promise<FrankfurterSnapshot> {
  const path = date === "latest" ? "latest" : date
  const url = `https://api.frankfurter.app/${path}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Frankfurter ${res.status}: ${text || res.statusText}`)
  }
  const data = (await res.json()) as {
    amount?: number
    base?: string
    date?: string
    rates?: Record<string, number>
  }
  if (!data.base || !data.date || !data.rates || typeof data.rates !== "object") {
    throw new Error("Frankfurter: unexpected response shape")
  }
  return {
    date: data.date,
    base: data.base,
    rates: data.rates,
  }
}

/** Rows ready for `fx_rates` insert (base + one row per quote). */
export function snapshotToRateRows(
  snap: FrankfurterSnapshot,
): { asOfDate: string; baseCurrency: string; quoteCurrency: string; rate: string }[] {
  const base = snap.base.toUpperCase()
  const rows: { asOfDate: string; baseCurrency: string; quoteCurrency: string; rate: string }[] =
    []
  for (const [quote, rate] of Object.entries(snap.rates)) {
    if (typeof rate !== "number" || !Number.isFinite(rate)) continue
    rows.push({
      asOfDate: snap.date,
      baseCurrency: base,
      quoteCurrency: quote.toUpperCase(),
      rate: rate.toFixed(10),
    })
  }
  return rows
}

/** Normalize to EUR base rows for storage (Frankfurter default base is EUR for latest). */
export function ensureEurBaseSnapshot(snap: FrankfurterSnapshot): FrankfurterSnapshot {
  if (snap.base.toUpperCase() === FX_BASE_CURRENCY) return snap
  throw new Error(
    `Expected Frankfurter base ${FX_BASE_CURRENCY}, got ${snap.base}. Use ?from=EUR if needed.`,
  )
}
