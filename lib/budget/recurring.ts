export const BUDGET_RECURRING_FREQUENCIES = [
  "monthly",
  "weekly",
  "biweekly",
  "quarterly",
  "annually",
] as const

export type BudgetRecurringFrequency = (typeof BUDGET_RECURRING_FREQUENCIES)[number]

export const BUDGET_FREQUENCY_LABELS: Record<BudgetRecurringFrequency, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  quarterly: "Quarterly",
  annually: "Annually",
}

/** Maps one pay period to an average monthly amount for budget totals. */
export function recurringToMonthlyEquivalent(
  frequency: BudgetRecurringFrequency,
  perPeriodAmount: number,
): number {
  switch (frequency) {
    case "monthly":
      return perPeriodAmount
    case "weekly":
      return perPeriodAmount * (52 / 12)
    case "biweekly":
      return perPeriodAmount * (26 / 12)
    case "quarterly":
      return perPeriodAmount / 3
    case "annually":
      return perPeriodAmount / 12
  }
}

export function parseBudgetFrequency(v: string | null): BudgetRecurringFrequency | null {
  if (!v) return null
  return (BUDGET_RECURRING_FREQUENCIES as readonly string[]).includes(v)
    ? (v as BudgetRecurringFrequency)
    : null
}

function parseIsoDateParts(s: string): { y: number; m: number; d: number } {
  const [y, mo, d] = s.split("-").map(Number)
  return { y, m: mo, d }
}

/** Clamp day to valid calendar day in UTC month (e.g. Jan 31 anchor → Feb 28 in non-leap years). */
function utcIsoDateFromParts(y: number, month: number, preferredDay: number): string {
  const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate()
  const day = Math.min(preferredDay, lastDay)
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function addUtcDays(iso: string, days: number): string {
  const { y, m, d } = parseIsoDateParts(iso)
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000
  const x = new Date(t)
  const yy = x.getUTCFullYear()
  const mm = x.getUTCMonth() + 1
  const dd = x.getUTCDate()
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
}

/**
 * How many per-period payments fall in `[monthStart, monthEnd]` (inclusive ISO dates, UTC month).
 * `anchor` is any historical payment date on the schedule.
 */
export function recurringPaymentCountInUtcMonth(
  anchor: string,
  frequency: BudgetRecurringFrequency,
  monthStart: string,
  monthEnd: string,
): number {
  switch (frequency) {
    case "weekly": {
      const step = 7
      let d = anchor
      while (d < monthStart) d = addUtcDays(d, step)
      let n = 0
      while (d <= monthEnd) {
        n++
        d = addUtcDays(d, step)
      }
      return n
    }
    case "biweekly": {
      const step = 14
      let d = anchor
      while (d < monthStart) d = addUtcDays(d, step)
      let n = 0
      while (d <= monthEnd) {
        n++
        d = addUtcDays(d, step)
      }
      return n
    }
    case "monthly": {
      const { y: ys, m: ms } = parseIsoDateParts(monthStart)
      const { d: anchorD } = parseIsoDateParts(anchor)
      const occ = utcIsoDateFromParts(ys, ms, anchorD)
      return occ >= monthStart && occ <= monthEnd ? 1 : 0
    }
    case "quarterly": {
      const { y: ys, m: ms } = parseIsoDateParts(monthStart)
      const { m: am, d: ad } = parseIsoDateParts(anchor)
      if ((ms - am + 12) % 3 !== 0) return 0
      const occ = utcIsoDateFromParts(ys, ms, ad)
      return occ >= monthStart && occ <= monthEnd ? 1 : 0
    }
    case "annually": {
      const { y: ys, m: ms } = parseIsoDateParts(monthStart)
      const { m: am, d: ad } = parseIsoDateParts(anchor)
      if (ms !== am) return 0
      const occ = utcIsoDateFromParts(ys, ms, ad)
      return occ >= monthStart && occ <= monthEnd ? 1 : 0
    }
    default:
      return 0
  }
}

export function normalizeRecurringAnchorDate(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === "string") {
    const s = v.trim()
    return s.length >= 10 ? s.slice(0, 10) : null
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear()
    const m = v.getUTCMonth() + 1
    const d = v.getUTCDate()
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  }
  return null
}

/**
 * Amount to count toward a UTC budget month: either smoothed (no anchor) or sum of dated payments.
 */
export function recurringAmountForUtcBudgetMonth(args: {
  frequency: BudgetRecurringFrequency
  perPeriodAmount: number
  anchorDate: unknown
  monthStart: string
  monthEnd: string
}): number {
  const { frequency, perPeriodAmount, anchorDate, monthStart, monthEnd } = args
  if (!Number.isFinite(perPeriodAmount) || perPeriodAmount <= 0) return 0
  const anchor = normalizeRecurringAnchorDate(anchorDate)
  if (anchor == null) {
    return recurringToMonthlyEquivalent(frequency, perPeriodAmount)
  }
  const n = recurringPaymentCountInUtcMonth(anchor, frequency, monthStart, monthEnd)
  return n * perPeriodAmount
}
