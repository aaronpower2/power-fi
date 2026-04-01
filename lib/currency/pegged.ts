/**
 * Currencies pegged to USD that ECB reference rates omit. Frankfurter (ECB) therefore
 * has no AED row; we derive EUR→AED from EUR→USD × the official peg.
 *
 * @see https://www.centralbank.ae/en/our-operations/financial-stability/exchange-rates
 */
export const AED_PER_USD = 3.6725

/**
 * Fills missing ECB quotes using known USD pegs. Only adds keys that are absent.
 */
export function mergePeggedQuotesMissingFromEcb(rates: Map<string, number>): Map<string, number> {
  const m = new Map(rates)
  const usdPerEur = m.get("USD")
  if (usdPerEur != null && Number.isFinite(usdPerEur) && usdPerEur > 0 && !m.has("AED")) {
    m.set("AED", usdPerEur * AED_PER_USD)
  }
  return m
}
