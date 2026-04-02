import {
  parseBudgetFrequency,
  recurringAmountForUtcBudgetMonth,
  recurringToMonthlyEquivalent,
} from "@/lib/budget/recurring"

export type LineLikeForPlanned = {
  isRecurring: boolean
  frequency: string | null
  recurringAmount: string | null
  recurringCurrency: string | null
  recurringAnchorDate: Date | string | null
}

/**
 * Monthly planned amount for a budget line in `[monthStart, monthEnd]` (inclusive ISO dates).
 */
export function monthlyPlannedForLine(
  line: LineLikeForPlanned,
  monthStart: string,
  monthEnd: string,
): { currency: string; amount: number } {
  const currency = (line.recurringCurrency ?? "USD").toUpperCase()
  if (!line.isRecurring) {
    return { currency, amount: 0 }
  }
  const freq = parseBudgetFrequency(line.frequency)
  if (freq == null || line.recurringAmount == null) {
    return { currency, amount: 0 }
  }
  const per = Number(line.recurringAmount)
  if (!Number.isFinite(per) || per <= 0) {
    return { currency, amount: 0 }
  }
  const monthly = recurringAmountForUtcBudgetMonth({
    frequency: freq,
    perPeriodAmount: per,
    anchorDate: line.recurringAnchorDate,
    monthStart,
    monthEnd,
  })
  return { currency, amount: monthly }
}

export type ExpenseCategoryLikeForPlanned = {
  isRecurring: boolean
  frequency: string | null
  recurringAmount: string | null
  recurringCurrency: string | null
}

/**
 * Month-level planned envelope for an expense category (smoothed monthly equivalent, no anchor).
 */
export function monthlyPlannedForExpenseCategory(
  cat: ExpenseCategoryLikeForPlanned,
): { currency: string; amount: number } {
  const currency = (cat.recurringCurrency ?? "USD").toUpperCase()
  if (!cat.isRecurring) {
    return { currency, amount: 0 }
  }
  const freq = parseBudgetFrequency(cat.frequency)
  if (freq == null || cat.recurringAmount == null) {
    return { currency, amount: 0 }
  }
  const per = Number(cat.recurringAmount)
  if (!Number.isFinite(per) || per <= 0) {
    return { currency, amount: 0 }
  }
  return { currency, amount: recurringToMonthlyEquivalent(freq, per) }
}
