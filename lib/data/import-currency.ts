/**
 * Currency for parsed statement rows when the file has no per-row currency.
 *
 * FI goal currency is intentionally not used here: goals may be in a different
 * currency than local bank/card statements (e.g. NZD target vs AED day-to-day).
 *
 * Order: DEFAULT_IMPORT_CURRENCY env, then AED.
 */
export function getDefaultStatementCurrency(): string {
  const env = process.env.DEFAULT_IMPORT_CURRENCY?.trim().toUpperCase()
  if (env && env.length === 3) return env

  return "AED"
}
