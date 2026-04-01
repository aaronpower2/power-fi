export const BUDGET_SUMMARY_CURRENCIES = ["AED", "NZD", "AUD"] as const

export type BudgetSummaryCurrency = (typeof BUDGET_SUMMARY_CURRENCIES)[number]

const ALLOWED = new Set<string>(BUDGET_SUMMARY_CURRENCIES)

/**
 * Resolves which ISO code to use for budget summary cards.
 * Requested `ccy` query wins if allowed; else goal currency if allowed; else AED.
 */
export function resolveBudgetSummaryCurrency(
  requested: string | null | undefined,
  goalCurrency: string,
): BudgetSummaryCurrency {
  const r = requested?.trim().toUpperCase()
  if (r && ALLOWED.has(r)) return r as BudgetSummaryCurrency
  const g = goalCurrency.trim().toUpperCase()
  if (ALLOWED.has(g)) return g as BudgetSummaryCurrency
  return "AED"
}
