import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currency/iso4217"

export function coalesceSupportedCurrency(
  code: string | null | undefined,
  fallback: SupportedCurrency,
): SupportedCurrency {
  const u = code?.trim().toUpperCase()
  if (u && (SUPPORTED_CURRENCIES as readonly string[]).includes(u)) {
    return u as SupportedCurrency
  }
  return fallback
}

export type ExpenseCategoryForInputCurrency = {
  cashFlowType: string
  linkedLiabilityId: string | null
  isRecurring: boolean
  recurringCurrency: string | null
}

export type ExpenseLineForInputCurrency = {
  linkedLiabilityId: string | null
  isRecurring: boolean
  recurringCurrency: string | null
}

/**
 * Currency for posting expense/debt line records: liability denomination for debt categories,
 * else category recurring budget currency when set; otherwise `fallbackCurrency` (typically
 * the budget summary / page-control currency).
 */
export function defaultExpenseCategoryRecordCurrency(args: {
  category: ExpenseCategoryForInputCurrency | undefined
  liabilityCurrencyById: ReadonlyMap<string, string>
  fallbackCurrency: SupportedCurrency
}): SupportedCurrency {
  const { category, liabilityCurrencyById, fallbackCurrency } = args
  if (!category) return fallbackCurrency
  if (category.cashFlowType === "debt_payment" && category.linkedLiabilityId) {
    const ccy = liabilityCurrencyById.get(category.linkedLiabilityId)
    return coalesceSupportedCurrency(ccy, fallbackCurrency)
  }
  if (category.isRecurring) {
    return coalesceSupportedCurrency(category.recurringCurrency, fallbackCurrency)
  }
  return fallbackCurrency
}

export function defaultExpenseLineRecordCurrency(args: {
  line: ExpenseLineForInputCurrency | undefined
  liabilityCurrencyById: ReadonlyMap<string, string>
  fallbackCurrency: SupportedCurrency
}): SupportedCurrency {
  const { line, liabilityCurrencyById, fallbackCurrency } = args
  if (!line) return fallbackCurrency
  if (line.linkedLiabilityId) {
    const ccy = liabilityCurrencyById.get(line.linkedLiabilityId)
    return coalesceSupportedCurrency(ccy, fallbackCurrency)
  }
  if (line.isRecurring) {
    return coalesceSupportedCurrency(line.recurringCurrency, fallbackCurrency)
  }
  return fallbackCurrency
}

export function defaultIncomeLineRecordCurrency(
  line: { recurringCurrency: string | null | undefined },
  fallbackCurrency: SupportedCurrency,
): SupportedCurrency {
  return coalesceSupportedCurrency(line.recurringCurrency ?? null, fallbackCurrency)
}
