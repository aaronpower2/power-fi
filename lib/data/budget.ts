import { asc, desc, eq } from "drizzle-orm"

import { monthlyPlannedForLine } from "@/lib/budget/planned-line"
import {
  BUDGET_SUMMARY_CURRENCIES,
  resolveBudgetSummaryCurrency,
} from "@/lib/budget/summary-currency"
import { convertAmount } from "@/lib/currency/convert"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"
import {
  formatYearMonthYm,
  parseYearMonthYm,
  utcIsoDateString,
  utcMonthBoundsForCalendarMonth,
  utcMonthRangeStrings,
} from "@/lib/dates"
import { getDb } from "@/lib/db"
import {
  budgetMonthPlanLines,
  expenseCategories,
  expenseLines,
  expenseRecords,
  goals,
  incomeLines,
  incomeRecords,
} from "@/lib/db/schema"

/** Per budget line id → per ISO currency → sum for the UTC month (not converted). */
export type LineNativeMonthTotals = Record<string, Record<string, number>>

function groupIncomeRecords(
  rows: (typeof incomeRecords.$inferSelect)[],
): Record<string, (typeof incomeRecords.$inferSelect)[]> {
  const m: Record<string, (typeof incomeRecords.$inferSelect)[]> = {}
  for (const r of rows) {
    const k = r.incomeLineId
    if (!m[k]) m[k] = []
    m[k].push(r)
  }
  for (const k of Object.keys(m)) {
    m[k].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
  }
  return m
}

function groupExpenseRecords(
  rows: (typeof expenseRecords.$inferSelect)[],
): Record<string, (typeof expenseRecords.$inferSelect)[]> {
  const m: Record<string, (typeof expenseRecords.$inferSelect)[]> = {}
  for (const r of rows) {
    const k = r.expenseLineId
    if (!m[k]) m[k] = []
    m[k].push(r)
  }
  for (const k of Object.keys(m)) {
    m[k].sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
  }
  return m
}

function bumpNative(
  m: LineNativeMonthTotals,
  lineId: string,
  currencyCode: string,
  amount: number,
) {
  if (!Number.isFinite(amount) || amount === 0) return
  const c = currencyCode.toUpperCase()
  if (!m[lineId]) m[lineId] = {}
  m[lineId][c] = (m[lineId][c] ?? 0) + amount
}

function sortWeightNative(buckets: Record<string, number> | undefined): number {
  if (!buckets || Object.keys(buckets).length === 0) return 0
  return Math.max(...Object.values(buckets))
}

function sumNativeLineMapInReportingCurrency(args: {
  lineMap: LineNativeMonthTotals
  reportingCurrency: string
  fx: { rates: Map<string, number> } | null
}): { total: number; ok: boolean } {
  const { lineMap, reportingCurrency, fx } = args
  if (!fx) {
    let total = 0
    for (const lineId of Object.keys(lineMap)) {
      const buckets = lineMap[lineId]
      for (const cur of Object.keys(buckets)) {
        total += buckets[cur]!
      }
    }
    return { total, ok: true }
  }
  const rates = fx.rates
  let total = 0
  for (const lineId of Object.keys(lineMap)) {
    const buckets = lineMap[lineId]
    for (const cur of Object.keys(buckets)) {
      const v = convertAmount(buckets[cur]!, cur, reportingCurrency, rates)
      if (v == null) return { total: 0, ok: false }
      total += v
    }
  }
  return { total, ok: true }
}

function sumIncomeRecordsInReportingCurrency(args: {
  allIncomeRec: (typeof incomeRecords.$inferSelect)[]
  start: string
  end: string
  reportingCurrency: string
  fx: { rates: Map<string, number> } | null
}): { income: number; ok: boolean } {
  const { allIncomeRec, start, end, reportingCurrency, fx } = args
  if (!fx) {
    let income = 0
    for (const r of allIncomeRec) {
      if (r.occurredOn >= start && r.occurredOn <= end) {
        income += Number(r.amount)
      }
    }
    return { income, ok: true }
  }
  const rates = fx.rates
  let income = 0
  for (const r of allIncomeRec) {
    if (r.occurredOn < start || r.occurredOn > end) continue
    const cur = r.currency ?? "USD"
    const v = convertAmount(Number(r.amount), cur, reportingCurrency, rates)
    if (v == null) return { income: 0, ok: false }
    income += v
  }
  return { income, ok: true }
}

function sumExpenseRecordsInReportingCurrency(args: {
  allExpRec: (typeof expenseRecords.$inferSelect)[]
  start: string
  end: string
  reportingCurrency: string
  fx: { rates: Map<string, number> } | null
}): { expense: number; ok: boolean } {
  const { allExpRec, start, end, reportingCurrency, fx } = args
  if (!fx) {
    let expense = 0
    for (const r of allExpRec) {
      if (r.occurredOn >= start && r.occurredOn <= end) {
        expense += Number(r.amount)
      }
    }
    return { expense, ok: true }
  }
  const rates = fx.rates
  let expense = 0
  for (const r of allExpRec) {
    if (r.occurredOn < start || r.occurredOn > end) continue
    const cur = r.currency ?? "USD"
    const v = convertAmount(Number(r.amount), cur, reportingCurrency, rates)
    if (v == null) return { expense: 0, ok: false }
    expense += v
  }
  return { expense, ok: true }
}

const empty = {
  ym: "",
  monthLabel: "",
  monthStart: "",
  monthEnd: "",
  isPastMonth: false,
  planUsesSnapshot: false,
  totals: {
    incomeActual: 0,
    incomePlanned: 0,
    expenseActual: 0,
    expensePlanned: 0,
    investableActual: 0,
  },
  summaryCurrency: "AED" as const,
  summaryCurrencyOptions: [...BUDGET_SUMMARY_CURRENCIES],
  goalCurrency: "USD",
  fxWarning: null as string | null,
  incomeLines: [] as (typeof incomeLines.$inferSelect)[],
  incomeRecordsByLineId: {} as Record<string, (typeof incomeRecords.$inferSelect)[]>,
  incomeActualByLineNative: {} as LineNativeMonthTotals,
  incomePlannedByLineNative: {} as LineNativeMonthTotals,
  expenseCategories: [] as (typeof expenseCategories.$inferSelect)[],
  expenseLines: [] as ((typeof expenseLines.$inferSelect) & { categoryName: string })[],
  expenseRecordsByLineId: {} as Record<string, (typeof expenseRecords.$inferSelect)[]>,
  expenseActualByLineNative: {} as LineNativeMonthTotals,
  expensePlannedByLineNative: {} as LineNativeMonthTotals,
}

export type BudgetPageData = Awaited<ReturnType<typeof getBudgetPageData>>

export async function getBudgetPageData(opts?: {
  yearMonth?: string | null
  summaryCurrency?: string | null
}) {
  const db = getDb()
  if (!db) return empty

  const now = new Date()
  const parsedYm = parseYearMonthYm(opts?.yearMonth ?? undefined)
  const viewYear = parsedYm?.year ?? now.getUTCFullYear()
  const viewMonthIndex0 = parsedYm?.monthIndex0 ?? now.getUTCMonth()
  const ym = formatYearMonthYm(viewYear, viewMonthIndex0)

  const { start, end } = utcMonthBoundsForCalendarMonth(viewYear, viewMonthIndex0)
  const monthLabel = new Date(Date.UTC(viewYear, viewMonthIndex0, 1)).toLocaleString(
    "en-US",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  )

  const currentMonthStart = utcMonthRangeStrings(now).start
  const isPastMonth = start < currentMonthStart

  const [activeGoal] = await db
    .select()
    .from(goals)
    .where(eq(goals.isActive, true))
    .orderBy(desc(goals.updatedAt))
    .limit(1)
  const goalCurrency = activeGoal?.currency ?? "USD"
  const summaryCurrency = resolveBudgetSummaryCurrency(opts?.summaryCurrency, goalCurrency)

  const fx = await loadRatesOnOrBefore(db, utcIsoDateString(now))
  let fxWarning: string | null = null
  if (!fx) {
    fxWarning =
      "No conversion rates loaded yet — summary totals may be unreliable if amounts use multiple currencies. Line tables stay in each line’s native currency."
  }

  const linesRaw = await db.select().from(incomeLines)
  const allIncomeRec = await db.select().from(incomeRecords)
  const allExpRec = await db.select().from(expenseRecords)

  const snapshotRows = await db
    .select()
    .from(budgetMonthPlanLines)
    .where(eq(budgetMonthPlanLines.periodMonth, start))

  const planUsesSnapshot = isPastMonth && snapshotRows.length > 0

  const incomeActualByLineNative: LineNativeMonthTotals = {}
  for (const r of allIncomeRec) {
    if (r.occurredOn >= start && r.occurredOn <= end) {
      bumpNative(incomeActualByLineNative, r.incomeLineId, r.currency ?? "USD", Number(r.amount))
    }
  }

  const incomePlannedByLineNative: LineNativeMonthTotals = {}
  if (planUsesSnapshot) {
    for (const row of snapshotRows) {
      if (row.lineKind !== "income" || !row.incomeLineId) continue
      const amt = Number(row.plannedAmount)
      const c = row.currency.toUpperCase()
      if (!incomePlannedByLineNative[row.incomeLineId]) incomePlannedByLineNative[row.incomeLineId] = {}
      incomePlannedByLineNative[row.incomeLineId][c] = amt
    }
  } else {
    for (const line of linesRaw) {
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      bumpNative(incomePlannedByLineNative, line.id, currency, amount)
    }
  }

  const expenseActualByLineNative: LineNativeMonthTotals = {}
  for (const r of allExpRec) {
    if (r.occurredOn >= start && r.occurredOn <= end) {
      bumpNative(expenseActualByLineNative, r.expenseLineId, r.currency ?? "USD", Number(r.amount))
    }
  }

  const expLinesFull = await db
    .select({
      id: expenseLines.id,
      categoryId: expenseLines.categoryId,
      name: expenseLines.name,
      isRecurring: expenseLines.isRecurring,
      frequency: expenseLines.frequency,
      recurringAmount: expenseLines.recurringAmount,
      recurringCurrency: expenseLines.recurringCurrency,
      recurringAnchorDate: expenseLines.recurringAnchorDate,
      createdAt: expenseLines.createdAt,
      categoryName: expenseCategories.name,
    })
    .from(expenseLines)
    .innerJoin(expenseCategories, eq(expenseLines.categoryId, expenseCategories.id))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseLines.name))

  const expensePlannedByLineNative: LineNativeMonthTotals = {}
  if (planUsesSnapshot) {
    for (const row of snapshotRows) {
      if (row.lineKind !== "expense" || !row.expenseLineId) continue
      const amt = Number(row.plannedAmount)
      const c = row.currency.toUpperCase()
      if (!expensePlannedByLineNative[row.expenseLineId])
        expensePlannedByLineNative[row.expenseLineId] = {}
      expensePlannedByLineNative[row.expenseLineId][c] = amt
    }
  } else {
    for (const line of expLinesFull) {
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      bumpNative(expensePlannedByLineNative, line.id, currency, amount)
    }
  }

  let incomeActual = sumIncomeRecordsInReportingCurrency({
    allIncomeRec,
    start,
    end,
    reportingCurrency: summaryCurrency,
    fx,
  })
  let incomePlanned = sumNativeLineMapInReportingCurrency({
    lineMap: incomePlannedByLineNative,
    reportingCurrency: summaryCurrency,
    fx,
  })
  let expenseActual = sumExpenseRecordsInReportingCurrency({
    allExpRec,
    start,
    end,
    reportingCurrency: summaryCurrency,
    fx,
  })
  let expensePlanned = sumNativeLineMapInReportingCurrency({
    lineMap: expensePlannedByLineNative,
    reportingCurrency: summaryCurrency,
    fx,
  })

  if (
    (!incomeActual.ok ||
      !incomePlanned.ok ||
      !expenseActual.ok ||
      !expensePlanned.ok) &&
    fx
  ) {
    fxWarning = `Could not convert some flows to ${summaryCurrency} for the summary row.`
    incomeActual = sumIncomeRecordsInReportingCurrency({
      allIncomeRec,
      start,
      end,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
    incomePlanned = sumNativeLineMapInReportingCurrency({
      lineMap: incomePlannedByLineNative,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
    expenseActual = sumExpenseRecordsInReportingCurrency({
      allExpRec,
      start,
      end,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
    expensePlanned = sumNativeLineMapInReportingCurrency({
      lineMap: expensePlannedByLineNative,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
  }

  const investableActual = Math.max(
    0,
    (incomeActual.ok ? incomeActual.income : 0) - (expenseActual.ok ? expenseActual.expense : 0),
  )

  const lines = [...linesRaw].sort((a, b) => {
    const va = Math.max(
      sortWeightNative(incomeActualByLineNative[a.id]),
      sortWeightNative(incomePlannedByLineNative[a.id]),
    )
    const vb = Math.max(
      sortWeightNative(incomeActualByLineNative[b.id]),
      sortWeightNative(incomePlannedByLineNative[b.id]),
    )
    if (vb !== va) return vb - va
    return a.name.localeCompare(b.name)
  })

  const cats = await db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))

  const expLinesSorted = [...expLinesFull].sort((a, b) => {
    const va = Math.max(
      sortWeightNative(expenseActualByLineNative[a.id]),
      sortWeightNative(expensePlannedByLineNative[a.id]),
    )
    const vb = Math.max(
      sortWeightNative(expenseActualByLineNative[b.id]),
      sortWeightNative(expensePlannedByLineNative[b.id]),
    )
    if (vb !== va) return vb - va
    return a.name.localeCompare(b.name)
  })

  return {
    ym,
    monthLabel,
    monthStart: start,
    monthEnd: end,
    isPastMonth,
    planUsesSnapshot,
    totals: {
      incomeActual: incomeActual.ok ? incomeActual.income : 0,
      incomePlanned: incomePlanned.ok ? incomePlanned.total : 0,
      expenseActual: expenseActual.ok ? expenseActual.expense : 0,
      expensePlanned: expensePlanned.ok ? expensePlanned.total : 0,
      investableActual,
    },
    summaryCurrency,
    summaryCurrencyOptions: [...BUDGET_SUMMARY_CURRENCIES],
    goalCurrency,
    fxWarning,
    incomeLines: lines,
    incomeRecordsByLineId: groupIncomeRecords(allIncomeRec),
    incomeActualByLineNative,
    incomePlannedByLineNative,
    expenseCategories: cats,
    expenseLines: expLinesSorted,
    expenseRecordsByLineId: groupExpenseRecords(allExpRec),
    expenseActualByLineNative,
    expensePlannedByLineNative,
  }
}
