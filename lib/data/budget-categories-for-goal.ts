import { asc } from "drizzle-orm"

import { monthlyPlannedForExpenseCategory } from "@/lib/budget/planned-line"
import { utcIsoDateString } from "@/lib/dates"
import { getDb } from "@/lib/db"
import { expenseCategories } from "@/lib/db/schema"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"

export type BudgetCategoryPlannedForGoalCopy = {
  id: string
  name: string
  monthlyAmountNative: number
  nativeCurrency: string
}

export async function listBudgetCategoriesPlannedForGoalCopy(): Promise<{
  categories: BudgetCategoryPlannedForGoalCopy[]
  fxRatesFromBase: Record<string, number> | null
  fxAsOfDate: string | null
}> {
  const db = getDb()
  if (!db) {
    return { categories: [], fxRatesFromBase: null, fxAsOfDate: null }
  }

  const rows = await db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))

  const categories: BudgetCategoryPlannedForGoalCopy[] = rows.map((r) => {
    const { currency, amount } = monthlyPlannedForExpenseCategory({
      isRecurring: r.isRecurring,
      frequency: r.frequency,
      recurringAmount: r.recurringAmount,
      recurringCurrency: r.recurringCurrency,
    })
    return {
      id: r.id,
      name: r.name,
      monthlyAmountNative: amount,
      nativeCurrency: currency,
    }
  })

  const fx = await loadRatesOnOrBefore(db, utcIsoDateString(new Date()))
  return {
    categories,
    fxRatesFromBase: fx ? Object.fromEntries(fx.rates) : null,
    fxAsOfDate: fx?.asOfDate ?? null,
  }
}
