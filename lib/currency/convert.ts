import { FX_BASE_CURRENCY } from "./iso4217"

export type RatesFromBase = ReadonlyMap<string, number>

/**
 * Frankfurter-style: 1 unit of base (EUR) = rate units of quote.
 * Map keys are quote currency codes; values are rates vs {@link FX_BASE_CURRENCY}.
 */
export function rateQuotePerBase(quote: string, ratesFromBase: RatesFromBase): number | undefined {
  if (quote === FX_BASE_CURRENCY) return 1
  return ratesFromBase.get(quote)
}

/** How many `to` units equal 1 unit of `from` (both vs same base). */
export function crossRate(
  from: string,
  to: string,
  ratesFromBase: RatesFromBase,
): number | undefined {
  if (from === to) return 1
  const rFrom = rateQuotePerBase(from, ratesFromBase)
  const rTo = rateQuotePerBase(to, ratesFromBase)
  if (rFrom == null || rTo == null || rFrom === 0) return undefined
  return rTo / rFrom
}

export function convertAmount(
  amount: number,
  from: string,
  to: string,
  ratesFromBase: RatesFromBase,
): number | undefined {
  if (from === to) return amount
  const cr = crossRate(from, to, ratesFromBase)
  if (cr == null) return undefined
  return amount * cr
}
