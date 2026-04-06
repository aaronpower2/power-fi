import { and, asc, desc, eq, gte, lte } from "drizzle-orm"

import { monthlyPlannedForExpenseCategory, monthlyPlannedForLine } from "@/lib/budget/planned-line"
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
  allocationStrategies,
  allocationTargets,
  assets,
  budgetMonthPlanLines,
  budgetMonthTransactions,
  expenseCategories,
  expenseLines,
  expenseRecords,
  goals,
  incomeLines,
  incomeRecords,
  liabilities,
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

function groupExpenseRecordsByLineId(
  rows: (typeof expenseRecords.$inferSelect)[],
): Record<string, (typeof expenseRecords.$inferSelect)[]> {
  const m: Record<string, (typeof expenseRecords.$inferSelect)[]> = {}
  for (const r of rows) {
    if (!r.expenseLineId) continue
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

function convertNativeLineMapToReportingTotals(args: {
  lineMap: LineNativeMonthTotals
  reportingCurrency: string
  fx: { rates: Map<string, number> } | null
}): { totalsById: Record<string, number>; ok: boolean } {
  const { lineMap, reportingCurrency, fx } = args
  const totalsById: Record<string, number> = {}
  if (!fx) {
    for (const [lineId, buckets] of Object.entries(lineMap)) {
      let total = 0
      for (const amount of Object.values(buckets)) total += amount
      totalsById[lineId] = total
    }
    return { totalsById, ok: true }
  }
  const rates = fx.rates
  for (const [lineId, buckets] of Object.entries(lineMap)) {
    let total = 0
    for (const [currency, amount] of Object.entries(buckets)) {
      const converted = convertAmount(amount, currency, reportingCurrency, rates)
      if (converted == null) return { totalsById: {}, ok: false }
      total += converted
    }
    totalsById[lineId] = total
  }
  return { totalsById, ok: true }
}

function sumIncomeRecordsInReportingCurrency(args: {
  rows: (typeof incomeRecords.$inferSelect)[]
  reportingCurrency: string
  fx: { rates: Map<string, number> } | null
}): { income: number; ok: boolean } {
  const { rows, reportingCurrency, fx } = args
  if (!fx) {
    let income = 0
    for (const r of rows) {
      income += Number(r.amount)
    }
    return { income, ok: true }
  }
  const rates = fx.rates
  let income = 0
  for (const r of rows) {
    const cur = r.currency ?? "USD"
    const v = convertAmount(Number(r.amount), cur, reportingCurrency, rates)
    if (v == null) return { income: 0, ok: false }
    income += v
  }
  return { income, ok: true }
}

function sumExpenseRecordsInReportingCurrency(args: {
  rows: (typeof expenseRecords.$inferSelect)[]
  reportingCurrency: string
  fx: { rates: Map<string, number> } | null
}): { expense: number; ok: boolean } {
  const { rows, reportingCurrency, fx } = args
  if (!fx) {
    let expense = 0
    for (const r of rows) {
      expense += Number(r.amount)
    }
    return { expense, ok: true }
  }
  const rates = fx.rates
  let expense = 0
  for (const r of rows) {
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
    debtPaymentActual: 0,
    debtPaymentPlanned: 0,
    investableActual: 0,
  },
  summaryCurrency: "AED" as const,
  summaryCurrencyOptions: [...BUDGET_SUMMARY_CURRENCIES],
  goalCurrency: "AED",
  fxWarning: null as string | null,
  incomeLines: [] as (typeof incomeLines.$inferSelect)[],
  incomeRecordsByLineId: {} as Record<string, (typeof incomeRecords.$inferSelect)[]>,
  expenseRecordsByLineId: {} as Record<string, (typeof expenseRecords.$inferSelect)[]>,
  incomeActualByLineNative: {} as LineNativeMonthTotals,
  incomePlannedByLineNative: {} as LineNativeMonthTotals,
  expenseCategories: [] as (typeof expenseCategories.$inferSelect)[],
  liabilityOptions: [] as {
    id: string
    name: string
    trackingMode: string
    currency: string
    securedByAssetName: string | null
  }[],
  expenseLines: [] as ((typeof expenseLines.$inferSelect) & { categoryName: string })[],
  expenseTransactionsByCategoryId: {} as Record<
    string,
    {
      id: string
      occurredOn: string
      amount: string
      currency?: string | null
      description: string
      lineId?: string | null
      lineName?: string | null
      isManual: boolean
    }[]
  >,
  expenseActualByCategoryNative: {} as LineNativeMonthTotals,
  expenseActualByLineNative: {} as LineNativeMonthTotals,
  expensePlannedByLineNative: {} as LineNativeMonthTotals,
  expensePlannedByCategoryId: {} as Record<string, number>,
  expenseActualByCategoryId: {} as Record<string, number>,
  strategyAllocate: {
    canAllocate: false,
    disabledReason: null as string | null,
    targetCount: 0,
    weightSum: 0,
  },
  allocatePreview: null as {
    strategyId: string
    strategyName: string
    targets: {
      assetId: string
      assetName: string
      currency: string
      weightPercent: number
    }[]
  } | null,
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

  const activeGoalPromise = db
    .select()
    .from(goals)
    .where(eq(goals.isActive, true))
    .orderBy(desc(goals.updatedAt))
    .limit(1)

  const liabilityOptionsPromise = db
    .select({
      id: liabilities.id,
      name: liabilities.name,
      trackingMode: liabilities.trackingMode,
      currency: liabilities.currency,
      securedByAssetName: assets.name,
    })
    .from(liabilities)
    .leftJoin(assets, eq(liabilities.securedByAssetId, assets.id))
    .orderBy(asc(liabilities.name))

  const fxPromise = loadRatesOnOrBefore(db, utcIsoDateString(now))
  const linesRawPromise = db.select().from(incomeLines)
  const monthIncomeRecPromise = db
    .select()
    .from(incomeRecords)
    .where(and(gte(incomeRecords.occurredOn, start), lte(incomeRecords.occurredOn, end)))
  const monthExpRecPromise = db
    .select()
    .from(expenseRecords)
    .where(and(gte(expenseRecords.occurredOn, start), lte(expenseRecords.occurredOn, end)))
  const monthTxRowsPromise = db
    .select()
    .from(budgetMonthTransactions)
    .where(eq(budgetMonthTransactions.periodMonth, start))
  const snapshotRowsPromise = db
    .select()
    .from(budgetMonthPlanLines)
    .where(eq(budgetMonthPlanLines.periodMonth, start))
  const catsPromise = db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))
  const expLinesFullPromise = db
    .select({
      id: expenseLines.id,
      categoryId: expenseLines.categoryId,
      name: expenseLines.name,
      createdAt: expenseLines.createdAt,
      categoryName: expenseCategories.name,
    })
    .from(expenseLines)
    .innerJoin(expenseCategories, eq(expenseLines.categoryId, expenseCategories.id))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseLines.name))
  const activeStratPromise = db
    .select()
    .from(allocationStrategies)
    .where(eq(allocationStrategies.isActive, true))
    .orderBy(desc(allocationStrategies.updatedAt))
    .limit(1)

  const [
    activeGoalRows,
    liabilityOptions,
    fx,
    linesRaw,
    monthIncomeRec,
    monthExpRec,
    monthTxRows,
    snapshotRows,
    cats,
    expLinesFull,
    activeStratRows,
  ] = await Promise.all([
    activeGoalPromise,
    liabilityOptionsPromise,
    fxPromise,
    linesRawPromise,
    monthIncomeRecPromise,
    monthExpRecPromise,
    monthTxRowsPromise,
    snapshotRowsPromise,
    catsPromise,
    expLinesFullPromise,
    activeStratPromise,
  ])

  const activeGoal = activeGoalRows[0]
  const goalCurrency = activeGoal?.currency ?? "AED"
  const summaryCurrency = resolveBudgetSummaryCurrency(opts?.summaryCurrency ?? null)
  let fxWarning: string | null = null
  if (!fx) {
    fxWarning =
      "No conversion rates loaded yet — summary totals may be unreliable if amounts use multiple currencies. Line tables stay in each line’s native currency."
  }

  const planUsesSnapshot = isPastMonth && snapshotRows.length > 0

  const incomeActualByLineNative: LineNativeMonthTotals = {}
  for (const r of monthIncomeRec) {
    bumpNative(incomeActualByLineNative, r.incomeLineId, r.currency ?? "USD", Number(r.amount))
  }

  const incomePlannedByLineNative: LineNativeMonthTotals = {}
  const hasIncomeSnapshotRows = snapshotRows.some((r) => r.lineKind === "income" && r.incomeLineId)
  if (isPastMonth && hasIncomeSnapshotRows) {
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

  const expenseActualByCategoryNative: LineNativeMonthTotals = {}
  const expenseActualByLineNative: LineNativeMonthTotals = {}
  for (const r of monthExpRec) {
    bumpNative(
      expenseActualByCategoryNative,
      r.expenseCategoryId,
      r.currency ?? "USD",
      Number(r.amount),
    )
    if (r.expenseLineId) {
      bumpNative(expenseActualByLineNative, r.expenseLineId, r.currency ?? "USD", Number(r.amount))
    }
  }

  /** Category id → native currency buckets for planned expense (envelope per category). */
  const expensePlannedByCategoryNative: LineNativeMonthTotals = {}
  const hasExpenseCategorySnap = snapshotRows.some(
    (r) => r.lineKind === "expense_category" && r.expenseCategoryId,
  )
  const hasLegacyExpenseLineSnap = snapshotRows.some((r) => r.lineKind === "expense" && r.expenseLineId)

  if (isPastMonth && hasExpenseCategorySnap) {
    for (const row of snapshotRows) {
      if (row.lineKind !== "expense_category" || !row.expenseCategoryId) continue
      const amt = Number(row.plannedAmount)
      const c = row.currency.toUpperCase()
      if (!expensePlannedByCategoryNative[row.expenseCategoryId])
        expensePlannedByCategoryNative[row.expenseCategoryId] = {}
      expensePlannedByCategoryNative[row.expenseCategoryId]![c] = amt
    }
  } else if (isPastMonth && hasLegacyExpenseLineSnap) {
    const lineToCat = new Map(expLinesFull.map((l) => [l.id, l.categoryId]))
    for (const row of snapshotRows) {
      if (row.lineKind !== "expense" || !row.expenseLineId) continue
      const cid = lineToCat.get(row.expenseLineId)
      if (!cid) continue
      const amt = Number(row.plannedAmount)
      const c = row.currency.toUpperCase()
      if (!expensePlannedByCategoryNative[cid]) expensePlannedByCategoryNative[cid] = {}
      expensePlannedByCategoryNative[cid]![c] = (expensePlannedByCategoryNative[cid]![c] ?? 0) + amt
    }
  } else {
    for (const cat of cats) {
      const { currency, amount } = monthlyPlannedForExpenseCategory(cat)
      bumpNative(expensePlannedByCategoryNative, cat.id, currency, amount)
    }
  }

  const expensePlannedByLineNative: LineNativeMonthTotals = {}

  let incomeActual = sumIncomeRecordsInReportingCurrency({
    rows: monthIncomeRec,
    reportingCurrency: summaryCurrency,
    fx,
  })
  let incomePlanned = sumNativeLineMapInReportingCurrency({
    lineMap: incomePlannedByLineNative,
    reportingCurrency: summaryCurrency,
    fx,
  })
  let expenseActual = sumExpenseRecordsInReportingCurrency({
    rows: monthExpRec,
    reportingCurrency: summaryCurrency,
    fx,
  })
  let expensePlanned = sumNativeLineMapInReportingCurrency({
    lineMap: expensePlannedByCategoryNative,
    reportingCurrency: summaryCurrency,
    fx,
  })

  let summaryFxForCategory: { rates: Map<string, number> } | null = fx

  if (
    (!incomeActual.ok ||
      !incomePlanned.ok ||
      !expenseActual.ok ||
      !expensePlanned.ok) &&
    fx
  ) {
    fxWarning = `Could not convert some flows to ${summaryCurrency} for the summary row.`
    summaryFxForCategory = null
    incomeActual = sumIncomeRecordsInReportingCurrency({
      rows: monthIncomeRec,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
    incomePlanned = sumNativeLineMapInReportingCurrency({
      lineMap: incomePlannedByLineNative,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
    expenseActual = sumExpenseRecordsInReportingCurrency({
      rows: monthExpRec,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
    expensePlanned = sumNativeLineMapInReportingCurrency({
      lineMap: expensePlannedByCategoryNative,
      reportingCurrency: summaryCurrency,
      fx: null,
    })
  }

  const investableActual = Math.max(
    0,
    (incomeActual.ok ? incomeActual.income : 0) - (expenseActual.ok ? expenseActual.expense : 0),
  )

  const debtCategoryIds = new Set(
    cats.filter((c) => c.cashFlowType === "debt_payment").map((c) => c.id),
  )
  const regularCategoryIds = new Set(
    cats.filter((c) => c.cashFlowType !== "debt_payment").map((c) => c.id),
  )
  const splitCategoryTotals = (
    totalsByCategoryId: Record<string, number>,
  ): { expense: number; debtPayment: number } => {
    let expense = 0
    let debtPayment = 0
    for (const [categoryId, total] of Object.entries(totalsByCategoryId)) {
      if (debtCategoryIds.has(categoryId)) debtPayment += total
      else if (regularCategoryIds.has(categoryId)) expense += total
    }
    return { expense, debtPayment }
  }

  const activeStrat = activeStratRows[0]

  let strategyAllocate: {
    /** True when an active strategy has targets with a positive weight sum (button enabled). Investable may still be zero; server rejects that case. */
    canAllocate: boolean
    disabledReason: string | null
    targetCount: number
    weightSum: number
  } = {
    canAllocate: false,
    disabledReason: null,
    targetCount: 0,
    weightSum: 0,
  }

  type StratTargetRow = {
    assetId: string
    weightPercent: string
    assetName: string
    currency: string | null
  }
  let stratTargetRows: StratTargetRow[] = []

  if (!activeStrat) {
    strategyAllocate = {
      canAllocate: false,
      disabledReason: "No active strategy (set one under Net Worth → Strategy).",
      targetCount: 0,
      weightSum: 0,
    }
  } else {
    stratTargetRows = await db
      .select({
        assetId: allocationTargets.assetId,
        weightPercent: allocationTargets.weightPercent,
        assetName: assets.name,
        currency: assets.currency,
      })
      .from(allocationTargets)
      .innerJoin(assets, eq(allocationTargets.assetId, assets.id))
      .where(
        and(
          eq(allocationTargets.strategyId, activeStrat.id),
          eq(assets.includeInFiProjection, true),
        ),
      )
      .orderBy(asc(assets.name))

    const weightSum = stratTargetRows.reduce((s, r) => s + Number(r.weightPercent), 0)
    const targetCount = stratTargetRows.length

    let disabledReason: string | null = null
    if (targetCount === 0) {
      disabledReason =
        "Active strategy has no targets on FI-plan assets (Net Worth → Strategy, or mark assets “in FI plan”)."
    } else if (weightSum <= 0) {
      disabledReason = "Allocation weights must sum to a positive total."
    }

    strategyAllocate = {
      canAllocate: disabledReason === null,
      disabledReason,
      targetCount,
      weightSum,
    }
  }

  const allocatePreview =
    activeStrat && stratTargetRows.length > 0
      ? {
          strategyId: activeStrat.id,
          strategyName: activeStrat.name,
          targets: stratTargetRows.map((r) => ({
            assetId: r.assetId,
            assetName: r.assetName,
            currency: r.currency ?? "USD",
            weightPercent: Number(r.weightPercent),
          })),
        }
      : null

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

  const expLinesSorted = [...expLinesFull].sort((a, b) => {
    const va = sortWeightNative(expenseActualByLineNative[a.id])
    const vb = sortWeightNative(expenseActualByLineNative[b.id])
    if (vb !== va) return vb - va
    return a.name.localeCompare(b.name)
  })

  const expLinesForMonth = expLinesSorted
  const expenseLedgerByRecordId = new Map(
    monthTxRows
      .filter((t) => t.postedExpenseRecordId)
      .map((t) => [t.postedExpenseRecordId!, t]),
  )
  const expenseLineNameById = new Map(expLinesFull.map((l) => [l.id, l.name]))
  const expenseTransactionsByCategoryId: Record<
    string,
    {
      id: string
      occurredOn: string
      amount: string
      currency?: string | null
      description: string
      lineId?: string | null
      lineName?: string | null
      isManual: boolean
    }[]
  > = {}
  for (const r of monthExpRec) {
    const tx = expenseLedgerByRecordId.get(r.id)
    const description =
      tx?.description ??
      (r.expenseLineId ? expenseLineNameById.get(r.expenseLineId) ?? "Manual record" : "Manual record")
    if (!expenseTransactionsByCategoryId[r.expenseCategoryId]) {
      expenseTransactionsByCategoryId[r.expenseCategoryId] = []
    }
    expenseTransactionsByCategoryId[r.expenseCategoryId]!.push({
      id: r.id,
      occurredOn: r.occurredOn,
      amount: r.amount,
      currency: r.currency,
      description,
      lineId: r.expenseLineId ?? null,
      lineName: r.expenseLineId ? expenseLineNameById.get(r.expenseLineId) ?? null : null,
      isManual: !tx,
    })
  }
  for (const categoryId of Object.keys(expenseTransactionsByCategoryId)) {
    expenseTransactionsByCategoryId[categoryId]!.sort((a, b) =>
      a.occurredOn < b.occurredOn ? 1 : -1,
    )
  }

  const plannedByCategoryResult = convertNativeLineMapToReportingTotals({
    lineMap: expensePlannedByCategoryNative,
    reportingCurrency: summaryCurrency,
    fx: summaryFxForCategory,
  })
  const expensePlannedByCategoryId = plannedByCategoryResult.ok ? plannedByCategoryResult.totalsById : {}
  const actualByCategoryResult = convertNativeLineMapToReportingTotals({
    lineMap: expenseActualByCategoryNative,
    reportingCurrency: summaryCurrency,
    fx: summaryFxForCategory,
  })
  const expenseActualByCategoryId = actualByCategoryResult.ok ? actualByCategoryResult.totalsById : {}
  const plannedSplit = splitCategoryTotals(expensePlannedByCategoryId)
  const actualSplit = splitCategoryTotals(expenseActualByCategoryId)

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
      expenseActual: actualSplit.expense,
      expensePlanned: plannedSplit.expense,
      debtPaymentActual: actualSplit.debtPayment,
      debtPaymentPlanned: plannedSplit.debtPayment,
      investableActual,
    },
    summaryCurrency,
    summaryCurrencyOptions: [...BUDGET_SUMMARY_CURRENCIES],
    goalCurrency,
    fxWarning,
    incomeLines: lines,
    incomeRecordsByLineId: groupIncomeRecords(monthIncomeRec),
    expenseRecordsByLineId: groupExpenseRecordsByLineId(monthExpRec),
    incomeActualByLineNative,
    incomePlannedByLineNative,
    expenseCategories: cats,
    liabilityOptions,
    expenseLines: expLinesForMonth,
    expenseTransactionsByCategoryId,
    expenseActualByCategoryNative,
    expenseActualByLineNative,
    expensePlannedByLineNative,
    expensePlannedByCategoryId,
    expenseActualByCategoryId,
    strategyAllocate,
    allocatePreview,
  }
}
