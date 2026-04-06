export const BUDGET_SUMMARY_CURRENCIES = ["AED", "NZD", "AUD"] as const

export type BudgetSummaryCurrency = (typeof BUDGET_SUMMARY_CURRENCIES)[number]

const ALLOWED = new Set<string>(BUDGET_SUMMARY_CURRENCIES)

/**
 * Resolves which ISO code to use for summary currency button groups (cash flow, net worth).
 * Valid `ccy` query wins; otherwise defaults to AED (not goal currency).
 */
export function resolveBudgetSummaryCurrency(
  requested: string | null | undefined,
): BudgetSummaryCurrency {
  const r = requested?.trim().toUpperCase()
  if (r && ALLOWED.has(r)) return r as BudgetSummaryCurrency
  return "AED"
}
