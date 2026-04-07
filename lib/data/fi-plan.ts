import { and, desc, eq, gte, lte } from "drizzle-orm"

import {
  isInternalDebtCategoryName,
} from "@/lib/budget/debt-payment"
import {
  monthlyPlannedForExpenseCategory,
  monthlyPlannedForLine,
} from "@/lib/budget/planned-line"
import {
  BUDGET_SUMMARY_CURRENCIES,
  resolveBudgetSummaryCurrency,
} from "@/lib/budget/summary-currency"
import { convertAmount } from "@/lib/currency/convert"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"
import { formatYearMonthYm, utcIsoDateString, utcMonthRangeStrings } from "@/lib/dates"
import { getDb } from "@/lib/db"
import {
  allocationStrategies,
  allocationTargets,
  assets,
  expenseCategories,
  expenseLines,
  expenseRecords,
  goals,
  incomeLines,
  incomeRecords,
  liabilities,
} from "@/lib/db/schema"
import { subtractSeriesFromChartPoints } from "@/lib/fi/chart-adjust"
import {
  calcBlendedReturn,
  calcCoastFiNumber,
  fundingShortfall,
  isGoalFundable,
  monthsFromTodayToFi,
  projectPortfolio,
  requiredPrincipal,
} from "@/lib/fi"
import type { ChartPoint, EngineAllocationInput, EngineAssetInput } from "@/lib/fi/types"
import { formatGoalListLabel } from "@/lib/goals/labels"
import { dashboardRoutes } from "@/lib/routes"

export type SummaryViewModel = {
  goalFundable: boolean | null
  shortfall: number | null
  netWorth: number
  monthsToFi: number | null
  requiredPrincipal: number | null
  coastFiNumber: number | null
  coastFiProgress: number | null
  coastFiReachedMonth: string | null
  assumedWithdrawalRate: number
  chartSeries: ChartPoint[]
  reportingGoalId: string | null
  /** Active goal FI date (YYYY-MM-DD) for disclosure tooltips. */
  goalFiDate: string | null
  reportingCurrency: string
  fxAsOfDate: string | null
  fxWarning: string | null
  monthlyInvestable: number | null
  currentMonthActualInvestable: number | null
  monthlyInvestableFallbackMessage: string | null
  staleLiabilityNames: string[]
  liabilitiesWithNoPaydownTracking: { id: string; name: string; balance: number }[]
  paydownDivergenceNotes: string[]
  setupIssues: { message: string; href: string }[]
}

export type SummaryGoalOption = {
  id: string
  label: string
  isActive: boolean
}

export type FiPlanPageData = {
  summary: SummaryViewModel
  goalOptions: SummaryGoalOption[]
  monthlyInvestable: number | null
  projectedNetWorthAtFi: number | null
  summaryCurrencyOptions: typeof BUDGET_SUMMARY_CURRENCIES
}

function emptySummary(): SummaryViewModel {
  return {
    goalFundable: null,
    shortfall: null,
    netWorth: 0,
    monthsToFi: null,
    requiredPrincipal: null,
    coastFiNumber: null,
    coastFiProgress: null,
    coastFiReachedMonth: null,
    assumedWithdrawalRate: 0.04,
    chartSeries: [],
    reportingGoalId: null,
    goalFiDate: null,
    reportingCurrency: "AED",
    fxAsOfDate: null,
    fxWarning: null,
    monthlyInvestable: null,
    currentMonthActualInvestable: null,
    monthlyInvestableFallbackMessage: null,
    staleLiabilityNames: [],
    liabilitiesWithNoPaydownTracking: [],
    paydownDivergenceNotes: [],
    setupIssues: [],
  }
}

function buildSummary(overrides: Partial<SummaryViewModel>): SummaryViewModel {
  return {
    ...emptySummary(),
    ...overrides,
  }
}

function usesReportingCurrencySwitcher(
  opts?: { goalId?: string | null; reportingCurrencyRequest?: string | null },
): boolean {
  return opts != null && Object.prototype.hasOwnProperty.call(opts, "reportingCurrencyRequest")
}

function resolveFiReportingCurrency(
  opts: { goalId?: string | null; reportingCurrencyRequest?: string | null } | undefined,
  goalCurrency: string,
): string {
  return usesReportingCurrencySwitcher(opts)
    ? resolveBudgetSummaryCurrency(opts!.reportingCurrencyRequest ?? null)
    : goalCurrency
}

function pickGoalForSummary(
  rows: (typeof goals.$inferSelect)[],
  goalId: string | null | undefined,
): typeof goals.$inferSelect | null {
  if (rows.length === 0) return null
  if (goalId) {
    const match = rows.find((g) => g.id === goalId)
    if (match) return match
  }
  const active = rows
    .filter((g) => g.isActive)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  if (active.length > 0) return active[0]!
  return rows[0]!
}

function isMissingTableError(e: unknown): boolean {
  const chain: unknown[] = [e]
  let cur: unknown = e
  for (let i = 0; i < 5 && cur && typeof cur === "object" && "cause" in cur; i++) {
    cur = (cur as { cause: unknown }).cause
    chain.push(cur)
  }
  for (const err of chain) {
    if (!err || typeof err !== "object") continue
    const o = err as { code?: string; message?: string }
    if (o.code === "42P01") return true
    if (typeof o.message === "string" && /relation .+ does not exist/i.test(o.message)) {
      return true
    }
  }
  return false
}

function toEngineAssetConverted(a: {
  id: string
  growthType: "compound" | "capital"
  currentBalance: string | null
  assumedAnnualReturn: string | null
  assumedTerminalValue: string | null
  maturationDate: string | null
}): EngineAssetInput {
  return {
    id: a.id,
    growthType: a.growthType,
    currentBalance: Number(a.currentBalance ?? 0),
    assumedAnnualReturn:
      a.assumedAnnualReturn != null ? Number(a.assumedAnnualReturn) : null,
    assumedTerminalValue:
      a.assumedTerminalValue != null ? Number(a.assumedTerminalValue) : null,
    maturationDate: a.maturationDate ? new Date(`${a.maturationDate}T12:00:00Z`) : null,
  }
}

export async function getFiPlanPageData(opts?: {
  goalId?: string | null
  /**
   * When this key is present (e.g. FI Summary / portfolio), amounts are converted for display
   * using the same allowed codes as cash flow / net worth (`resolveBudgetSummaryCurrency`).
   * When omitted (e.g. Goal settings page), amounts stay in the goal’s currency.
   */
  reportingCurrencyRequest?: string | null
}): Promise<FiPlanPageData> {
  const goalId = opts?.goalId ?? null
  const db = getDb()
  if (!db) {
    return {
      summary: emptySummary(),
      goalOptions: [],
      monthlyInvestable: null,
      projectedNetWorthAtFi: null,
      summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
    }
  }

  try {
    const goalRows = await db
      .select()
      .from(goals)
      .orderBy(desc(goals.isActive), desc(goals.updatedAt))

    const goalOptions: SummaryGoalOption[] = goalRows.map((g) => ({
      id: g.id,
      label: formatGoalListLabel(g),
      isActive: g.isActive,
    }))

    const goal = pickGoalForSummary(goalRows, goalId)
    if (!goal) {
      return {
        summary: emptySummary(),
        goalOptions,
        monthlyInvestable: null,
        projectedNetWorthAtFi: null,
        summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
      }
    }

    const goalCurrency = goal.currency ?? "USD"
    const reportingCurrency = resolveFiReportingCurrency(opts, goalCurrency)
    const withdrawalRate = Number(goal.withdrawalRate)
    const monthlyFunding = Number(goal.monthlyFundingRequirement)
    const req = requiredPrincipal(monthlyFunding, withdrawalRate)
    const fiDate = new Date(`${goal.fiDate}T12:00:00Z`)
    const today = new Date()
    const todayStr = utcIsoDateString(today)
    const monthsToFi = monthsFromTodayToFi(today, fiDate)
    const finiteReq = Number.isFinite(req)
    const currentMonthLabel = formatYearMonthYm(today.getUTCFullYear(), today.getUTCMonth())

    const fx = await loadRatesOnOrBefore(db, todayStr)
    if (!fx) {
      return {
        summary: buildSummary({
          goalFundable: null,
          shortfall: null,
          netWorth: 0,
          monthsToFi,
          requiredPrincipal: finiteReq ? req : null,
          assumedWithdrawalRate: withdrawalRate,
          reportingGoalId: goal.id,
          goalFiDate: goal.fiDate,
          reportingCurrency: goalCurrency,
          fxAsOfDate: null,
          fxWarning:
            "No FX rates available (migrations applied?). Dashboard load normally refreshes rates from Frankfurter; check network or run pnpm fx:sync.",
        }),
        goalOptions,
        monthlyInvestable: null,
        projectedNetWorthAtFi: null,
        summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
      }
    }

    const rates = fx.rates
    const assetRows = await db.select().from(assets)
    const liabilityRows = await db.select().from(liabilities)
    const incomeLineRows = await db.select().from(incomeLines)
    const expenseCategoryRows = await db.select().from(expenseCategories)
    const expenseLineRows = await db.select().from(expenseLines)
    const debtPaymentLineRows = expenseLineRows.filter((row) => !!row.linkedLiabilityId)
    const regularExpenseCategoryRows = expenseCategoryRows.filter(
      (row) => row.cashFlowType !== "debt_payment" && !isInternalDebtCategoryName(row.name),
    )

    let grossAssetsGoal = 0
    for (const a of assetRows) {
      const raw = Number(a.currentBalance ?? 0)
      const cur = a.currency ?? "USD"
      const conv = convertAmount(raw, cur, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth: 0,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert ${cur} to ${goalCurrency}. Check Frankfurter supports both codes.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      grossAssetsGoal += conv
    }

    const { start, end } = utcMonthRangeStrings(today)
    const debtPaymentByLiabilityGoal = new Map<string, number>()
    for (const line of debtPaymentLineRows) {
      if (!line.linkedLiabilityId) continue
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const conv = convertAmount(amount, currency, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth: 0,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert debt payment from ${currency} to ${goalCurrency}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      debtPaymentByLiabilityGoal.set(
        line.linkedLiabilityId,
        (debtPaymentByLiabilityGoal.get(line.linkedLiabilityId) ?? 0) + conv,
      )
    }

    let liabilityTotalGoal = 0
    const liabilityStartsGoal = new Map<string, number>()
    const liabilityTrackingMode = new Map<string, string>()
    for (const L of liabilityRows) {
      const raw = Number(L.currentBalance ?? 0)
      const cur = L.currency ?? "USD"
      const conv = convertAmount(raw, cur, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth: grossAssetsGoal,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert liability from ${cur} to ${goalCurrency}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      liabilityStartsGoal.set(L.id, conv)
      liabilityTrackingMode.set(L.id, L.trackingMode ?? "fixed_installment")
      liabilityTotalGoal += conv
    }

    const netWorth = grossAssetsGoal - liabilityTotalGoal

    const [strategy] = await db
      .select()
      .from(allocationStrategies)
      .where(eq(allocationStrategies.isActive, true))
      .limit(1)

    let allocations: EngineAllocationInput[] = []
    if (strategy) {
      const targets = await db
        .select({
          assetId: allocationTargets.assetId,
          weightPercent: allocationTargets.weightPercent,
          includeInFi: assets.includeInFiProjection,
        })
        .from(allocationTargets)
        .innerJoin(assets, eq(allocationTargets.assetId, assets.id))
        .where(eq(allocationTargets.strategyId, strategy.id))
      allocations = targets
        .filter((t) => t.includeInFi)
        .map((t) => ({
          assetId: t.assetId,
          weightPercent: Number(t.weightPercent),
        }))
    }

    const incomeRows = await db
      .select()
      .from(incomeRecords)
      .where(and(gte(incomeRecords.occurredOn, start), lte(incomeRecords.occurredOn, end)))
    const expenseRows = await db
      .select()
      .from(expenseRecords)
      .where(and(gte(expenseRecords.occurredOn, start), lte(expenseRecords.occurredOn, end)))

    let incomeConv = 0
    for (const r of incomeRows) {
      const cur = r.currency ?? "USD"
      const v = convertAmount(Number(r.amount), cur, goalCurrency, rates)
      if (v == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert income from ${cur} to ${goalCurrency}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      incomeConv += v
    }

    let expenseConv = 0
    for (const r of expenseRows) {
      const cur = r.currency ?? "USD"
      const v = convertAmount(Number(r.amount), cur, goalCurrency, rates)
      if (v == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert expense from ${cur} to ${goalCurrency}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      expenseConv += v
    }

    const currentMonthActualInvestable = Math.max(0, incomeConv - expenseConv)
    let plannedIncome = 0
    for (const line of incomeLineRows) {
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      const conv = convertAmount(amount, currency, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert planned income from ${currency} to ${goalCurrency}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      plannedIncome += conv
    }
    let plannedExpense = 0
    for (const cat of regularExpenseCategoryRows) {
      const { currency, amount } = monthlyPlannedForExpenseCategory(cat)
      const conv = convertAmount(amount, currency, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert planned expense from ${currency} to ${goalCurrency}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      plannedExpense += conv
    }
    for (const line of debtPaymentLineRows) {
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      const conv = convertAmount(amount, currency, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert planned debt payment from ${currency} to ${goalCurrency}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      plannedExpense += conv
    }
    const hasRecurringRules =
      incomeLineRows.some((line) => line.isRecurring) ||
      regularExpenseCategoryRows.some((cat) => cat.isRecurring) ||
      debtPaymentLineRows.some((line) => line.isRecurring)
    const monthlyInvestableFallbackMessage = hasRecurringRules
      ? null
      : "No recurring income or expense rules are set up. The projection is using this month's actual records. Set up recurring amounts in Cash Flow for a more stable projection."
    const monthlyInvestable = hasRecurringRules
      ? Math.max(0, plannedIncome - plannedExpense)
      : currentMonthActualInvestable
    const engineAssets: EngineAssetInput[] = []
    for (const a of assetRows) {
      if (!a.includeInFiProjection) continue
      const cur = a.currency ?? "USD"
      const bal = Number(a.currentBalance ?? 0)
      const balConv = convertAmount(bal, cur, goalCurrency, rates)
      if (balConv == null) {
        return {
          summary: buildSummary({
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi,
            requiredPrincipal: finiteReq ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            reportingGoalId: goal.id,
            goalFiDate: goal.fiDate,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert asset balance from ${cur}.`,
          }),
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
          summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        }
      }
      let termConv: number | null = null
      if (a.assumedTerminalValue != null) {
        termConv = convertAmount(Number(a.assumedTerminalValue), cur, goalCurrency, rates) ?? null
        if (termConv == null) {
          return {
            summary: buildSummary({
              goalFundable: null,
              shortfall: null,
              netWorth,
              monthsToFi,
              requiredPrincipal: finiteReq ? req : null,
              assumedWithdrawalRate: withdrawalRate,
              reportingGoalId: goal.id,
              goalFiDate: goal.fiDate,
              reportingCurrency: goalCurrency,
              fxAsOfDate: fx.asOfDate,
              fxWarning: `Could not convert terminal value from ${cur}.`,
            }),
            goalOptions,
            monthlyInvestable: null,
            projectedNetWorthAtFi: null,
            summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
          }
        }
      }
      engineAssets.push(
        toEngineAssetConverted({
          id: a.id,
          growthType: a.growthType,
          currentBalance: balConv.toFixed(2),
          assumedAnnualReturn: a.assumedAnnualReturn,
          assumedTerminalValue:
            termConv != null ? termConv.toFixed(2) : a.assumedTerminalValue,
          maturationDate: a.maturationDate,
        }),
      )
    }

    const currentFiScopedNetWorth =
      engineAssets.reduce((sum, asset) => sum + asset.currentBalance, 0) - liabilityTotalGoal
    const blendedAnnualReturn = calcBlendedReturn(engineAssets)
    const coastFiNumberGoal =
      finiteReq && monthsToFi != null && monthsToFi > 0 && blendedAnnualReturn != null
        ? calcCoastFiNumber({
            requiredPrincipal: req,
            monthsToFiDate: monthsToFi,
            blendedAnnualReturn,
          })
        : null

    const { points, finalProjectedTotal: grossFinalProjected } = projectPortfolio({
      startDate: today,
      fiDate,
      monthlyInvestable,
      assets: engineAssets,
      allocations,
    })

    const liabilityOffsets = points.map((_, monthIndex) => {
      let total = 0
      for (const row of liabilityRows) {
        const startBal = liabilityStartsGoal.get(row.id) ?? 0
        if (liabilityTrackingMode.get(row.id) === "fixed_installment") {
          const monthlyPaydown = debtPaymentByLiabilityGoal.get(row.id) ?? 0
          total += Math.max(0, startBal - monthlyPaydown * (monthIndex + 1))
        } else {
          total += startBal
        }
      }
      return total
    })

    const chartSeries = subtractSeriesFromChartPoints(points, liabilityOffsets)
    const finalProjectedLiability = liabilityOffsets[liabilityOffsets.length - 1] ?? liabilityTotalGoal
    const finalProjectedNet = grossFinalProjected - finalProjectedLiability
    const coastFiReachedMonthGoal =
      coastFiNumberGoal == null
        ? null
        : currentFiScopedNetWorth >= coastFiNumberGoal
          ? currentMonthLabel
          : chartSeries.find((point) => point.projectedTotal >= coastFiNumberGoal)?.label ?? null
    const coastFiProgressGoal =
      coastFiNumberGoal != null && coastFiNumberGoal > 0
        ? Math.max(0, Math.min(1, currentFiScopedNetWorth / coastFiNumberGoal))
        : null
    const sixtyDaysAgo = new Date(today)
    sixtyDaysAgo.setUTCDate(sixtyDaysAgo.getUTCDate() - 60)
    const staleLiabilityNames = liabilityRows
      .filter(
        (row) =>
          (row.trackingMode ?? "fixed_installment") === "fixed_installment" &&
          row.updatedAt < sixtyDaysAgo,
      )
      .map((row) => row.name)
    const trackedLiabilityIds = new Set(debtPaymentByLiabilityGoal.keys())
    const liabilitiesWithNoPaydownTracking = liabilityRows
      .filter(
        (row) =>
          (row.trackingMode ?? "fixed_installment") === "fixed_installment" &&
          !trackedLiabilityIds.has(row.id),
      )
      .map((row) => ({
        id: row.id,
        name: row.name,
        balance: liabilityStartsGoal.get(row.id) ?? 0,
      }))
    const recentPaydownCutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1))
      .toISOString()
      .slice(0, 10)
    const recentAppliedPaydowns = await db
      .select({
        appliedLiabilityId: expenseRecords.appliedLiabilityId,
        appliedLiabilityAmount: expenseRecords.appliedLiabilityAmount,
        currency: expenseRecords.currency,
      })
      .from(expenseRecords)
      .where(
        and(
          gte(expenseRecords.occurredOn, recentPaydownCutoff),
          lte(expenseRecords.occurredOn, end),
        ),
      )
    const actualAvgPaydownByLiabilityGoal = new Map<string, number>()
    for (const row of recentAppliedPaydowns) {
      if (!row.appliedLiabilityId) continue
      const amount = Number(row.appliedLiabilityAmount ?? 0)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const conv = convertAmount(amount, row.currency ?? "USD", goalCurrency, rates)
      if (conv == null) continue
      actualAvgPaydownByLiabilityGoal.set(
        row.appliedLiabilityId,
        (actualAvgPaydownByLiabilityGoal.get(row.appliedLiabilityId) ?? 0) + conv / 3,
      )
    }
    const paydownDivergenceNotes = liabilityRows.flatMap((row) => {
      if ((row.trackingMode ?? "fixed_installment") !== "fixed_installment") return []
      const planned = debtPaymentByLiabilityGoal.get(row.id) ?? 0
      const actual = actualAvgPaydownByLiabilityGoal.get(row.id) ?? 0
      if (planned <= 0 || actual <= 0) return []
      const delta = Math.abs(planned - actual) / planned
      if (delta <= 0.2) return []
      return [
        `${row.name} is projected at ${planned.toFixed(0)}/${goalCurrency} per month, but the last 3 months averaged ${actual.toFixed(0)}/${goalCurrency}.`,
      ]
    })
    const rawSetupIssues: { message: string; href: string }[] = []
    if (!strategy) {
      rawSetupIssues.push({
        message: "No active allocation strategy is configured.",
        href: dashboardRoutes.netWorth,
      })
    } else {
      const rawWeightSum = allocations.reduce((sum, row) => sum + row.weightPercent, 0)
      if (rawWeightSum > 0 && Math.abs(rawWeightSum - 100) > 0.01) {
        rawSetupIssues.push({
          message: `Allocation weights sum to ${rawWeightSum.toFixed(1)}%.`,
          href: dashboardRoutes.netWorth,
        })
      }
    }
    for (const row of liabilitiesWithNoPaydownTracking) {
      rawSetupIssues.push({
        message: `${row.name} has no debt payment line.`,
        href: dashboardRoutes.cashFlow,
      })
    }
    for (const name of staleLiabilityNames) {
      rawSetupIssues.push({
        message: `${name} balance may be stale.`,
        href: dashboardRoutes.netWorth,
      })
    }

    const fundable = finiteReq ? isGoalFundable(finalProjectedNet, req) : null
    const shortfall =
      finiteReq && fundable === false ? fundingShortfall(finalProjectedNet, req) : null

    let displayNetWorth = netWorth
    let displayShortfall = shortfall
    let displayRequiredPrincipal = finiteReq ? req : null
    let displayCoastFiNumber = coastFiNumberGoal
    let displayCoastFiProgress = coastFiProgressGoal
    let displayCoastFiReachedMonth = coastFiReachedMonthGoal
    let displayChart = chartSeries
    let displayMonthlyInvestable = monthlyInvestable
    let displayCurrentMonthActualInvestable = currentMonthActualInvestable
    let displayProjectedNet = finalProjectedNet
    let displayReportingCcy = goalCurrency
    let displayFxWarning: string | null = null
    let displayLiabilitiesWithNoPaydownTracking = liabilitiesWithNoPaydownTracking

    if (reportingCurrency !== goalCurrency) {
      const c = (n: number): number | null => {
        const v = convertAmount(n, goalCurrency, reportingCurrency, rates)
        return v == null ? null : v
      }
      const convChart = chartSeries.map((p) => {
        const v = c(p.projectedTotal)
        return v == null ? null : { label: p.label, projectedTotal: v }
      })
      if (convChart.some((p) => p == null)) {
        displayFxWarning = `Could not convert projection from ${goalCurrency} to ${reportingCurrency}.`
      } else {
        const nw = c(netWorth)
        const rp = finiteReq ? c(req) : null
        const sf = shortfall != null ? c(shortfall) : null
        const coast = coastFiNumberGoal != null ? c(coastFiNumberGoal) : null
        const mi = c(monthlyInvestable)
        const actualMi = c(currentMonthActualInvestable)
        const pn = c(finalProjectedNet)
        const convertedUntracked = liabilitiesWithNoPaydownTracking.map((row) => {
          const balance = c(row.balance)
          return balance == null ? null : { ...row, balance }
        })
        if (
          nw == null ||
          (finiteReq && rp == null) ||
          (shortfall != null && sf == null) ||
          (coastFiNumberGoal != null && coast == null) ||
          mi == null ||
          actualMi == null ||
          convertedUntracked.some((row) => row == null) ||
          pn == null
        ) {
          displayFxWarning = `Could not convert totals from ${goalCurrency} to ${reportingCurrency}.`
        } else {
          displayNetWorth = nw
          displayShortfall = sf
          displayRequiredPrincipal = rp
          displayCoastFiNumber = coast
          displayCoastFiProgress = coastFiProgressGoal
          displayCoastFiReachedMonth = coastFiReachedMonthGoal
          displayChart = convChart as ChartPoint[]
          displayMonthlyInvestable = mi
          displayCurrentMonthActualInvestable = actualMi
          displayProjectedNet = pn
          displayReportingCcy = reportingCurrency
          displayLiabilitiesWithNoPaydownTracking = convertedUntracked as typeof liabilitiesWithNoPaydownTracking
        }
      }
    }

    return {
      summary: buildSummary({
        goalFundable: fundable,
        shortfall: displayShortfall,
        netWorth: displayNetWorth,
        monthsToFi,
        requiredPrincipal: displayRequiredPrincipal,
        coastFiNumber: displayCoastFiNumber,
        coastFiProgress: displayCoastFiProgress,
        coastFiReachedMonth: displayCoastFiReachedMonth,
        assumedWithdrawalRate: withdrawalRate,
        chartSeries: displayChart,
        reportingGoalId: goal.id,
        goalFiDate: goal.fiDate,
        reportingCurrency: displayReportingCcy,
        fxAsOfDate: fx.asOfDate,
        fxWarning: displayFxWarning,
        monthlyInvestable: displayMonthlyInvestable,
        currentMonthActualInvestable: displayCurrentMonthActualInvestable,
        monthlyInvestableFallbackMessage,
        staleLiabilityNames,
        liabilitiesWithNoPaydownTracking: displayLiabilitiesWithNoPaydownTracking,
        paydownDivergenceNotes,
        setupIssues: rawSetupIssues,
      }),
      goalOptions,
      monthlyInvestable: displayMonthlyInvestable,
      projectedNetWorthAtFi: displayProjectedNet,
      summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      if (isMissingTableError(e)) {
        console.warn("[getFiPlanPageData] Tables not found. Apply migrations: pnpm db:migrate")
      } else {
        console.warn("[getFiPlanPageData]", e)
      }
    }
    return {
      summary: emptySummary(),
      goalOptions: [],
      monthlyInvestable: null,
      projectedNetWorthAtFi: null,
      summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
    }
  }
}

export async function getFiPlanData(opts?: {
  goalId?: string | null
}): Promise<SummaryViewModel> {
  return (await getFiPlanPageData(opts)).summary
}
