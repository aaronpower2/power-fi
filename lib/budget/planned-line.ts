import { parseBudgetFrequency, recurringAmountForUtcBudgetMonth } from "@/lib/budget/recurring"

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
