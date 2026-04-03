import { and, desc, eq, gte, lte } from "drizzle-orm"

import { monthlyPlannedForExpenseCategory } from "@/lib/budget/planned-line"
import { convertAmount } from "@/lib/currency/convert"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"
import { utcIsoDateString, utcMonthRangeStrings } from "@/lib/dates"
import { getDb } from "@/lib/db"
import {
  allocationStrategies,
  allocationTargets,
  assets,
  expenseCategories,
  expenseRecords,
  goals,
  incomeRecords,
  liabilities,
} from "@/lib/db/schema"
import { subtractSeriesFromChartPoints } from "@/lib/fi/chart-adjust"
import {
  fundingShortfall,
  isGoalFundable,
  monthsFromTodayToFi,
  projectPortfolio,
  requiredPrincipal,
} from "@/lib/fi"
import type { ChartPoint, EngineAllocationInput, EngineAssetInput } from "@/lib/fi/types"
import { formatGoalListLabel } from "@/lib/goals/labels"

export type SummaryViewModel = {
  goalFundable: boolean | null
  shortfall: number | null
  netWorth: number
  monthsToFi: number | null
  requiredPrincipal: number | null
  assumedWithdrawalRate: number
  chartSeries: ChartPoint[]
  reportingGoalId: string | null
  reportingCurrency: string
  fxAsOfDate: string | null
  fxWarning: string | null
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
}

function emptySummary(): SummaryViewModel {
  return {
    goalFundable: null,
    shortfall: null,
    netWorth: 0,
    monthsToFi: null,
    requiredPrincipal: null,
    assumedWithdrawalRate: 0.04,
    chartSeries: [],
    reportingGoalId: null,
    reportingCurrency: "USD",
    fxAsOfDate: null,
    fxWarning: null,
  }
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
}): Promise<FiPlanPageData> {
  const goalId = opts?.goalId ?? null
  const db = getDb()
  if (!db) {
    return { summary: emptySummary(), goalOptions: [], monthlyInvestable: null, projectedNetWorthAtFi: null }
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
      }
    }

    const goalCurrency = goal.currency ?? "USD"
    const withdrawalRate = Number(goal.withdrawalRate)
    const monthlyFunding = Number(goal.monthlyFundingRequirement)
    const req = requiredPrincipal(monthlyFunding, withdrawalRate)
    const fiDate = new Date(`${goal.fiDate}T12:00:00Z`)
    const today = new Date()
    const todayStr = utcIsoDateString(today)

    const fx = await loadRatesOnOrBefore(db, todayStr)
    if (!fx) {
      return {
        summary: {
          goalFundable: null,
          shortfall: null,
          netWorth: 0,
          monthsToFi: monthsFromTodayToFi(today, fiDate),
          requiredPrincipal: Number.isFinite(req) ? req : null,
          assumedWithdrawalRate: withdrawalRate,
          chartSeries: [],
          reportingGoalId: goal.id,
          reportingCurrency: goalCurrency,
          fxAsOfDate: null,
          fxWarning:
            "No FX rates available (migrations applied?). Dashboard load normally refreshes rates from Frankfurter; check network or run pnpm fx:sync.",
        },
        goalOptions,
        monthlyInvestable: null,
        projectedNetWorthAtFi: null,
      }
    }

    const rates = fx.rates
    const assetRows = await db.select().from(assets)
    const liabilityRows = await db.select().from(liabilities)
    const debtPaymentCategoryRows = await db
      .select()
      .from(expenseCategories)
      .where(eq(expenseCategories.cashFlowType, "debt_payment"))

    let grossAssetsGoal = 0
    for (const a of assetRows) {
      const raw = Number(a.currentBalance ?? 0)
      const cur = a.currency ?? "USD"
      const conv = convertAmount(raw, cur, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: {
            goalFundable: null,
            shortfall: null,
            netWorth: 0,
            monthsToFi: monthsFromTodayToFi(today, fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert ${cur} to ${goalCurrency}. Check Frankfurter supports both codes.`,
          },
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
        }
      }
      grossAssetsGoal += conv
    }

    const debtPaymentByLiabilityGoal = new Map<string, number>()
    for (const cat of debtPaymentCategoryRows) {
      if (!cat.linkedLiabilityId) continue
      const { currency, amount } = monthlyPlannedForExpenseCategory(cat)
      if (!Number.isFinite(amount) || amount <= 0) continue
      const conv = convertAmount(amount, currency, goalCurrency, rates)
      if (conv == null) {
        return {
          summary: {
            goalFundable: null,
            shortfall: null,
            netWorth: 0,
            monthsToFi: monthsFromTodayToFi(today, fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert debt payment from ${currency} to ${goalCurrency}.`,
          },
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
        }
      }
      debtPaymentByLiabilityGoal.set(
        cat.linkedLiabilityId,
        (debtPaymentByLiabilityGoal.get(cat.linkedLiabilityId) ?? 0) + conv,
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
          summary: {
            goalFundable: null,
            shortfall: null,
            netWorth: grossAssetsGoal,
            monthsToFi: monthsFromTodayToFi(today, fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert liability from ${cur} to ${goalCurrency}.`,
          },
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
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
        .select()
        .from(allocationTargets)
        .where(eq(allocationTargets.strategyId, strategy.id))
      allocations = targets.map((t) => ({
        assetId: t.assetId,
        weightPercent: Number(t.weightPercent),
      }))
    }

    const { start, end } = utcMonthRangeStrings(today)
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
          summary: {
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi: monthsFromTodayToFi(today, fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert income from ${cur} to ${goalCurrency}.`,
          },
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
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
          summary: {
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi: monthsFromTodayToFi(today, fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert expense from ${cur} to ${goalCurrency}.`,
          },
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
        }
      }
      expenseConv += v
    }

    const monthlyInvestable = Math.max(0, incomeConv - expenseConv)
    const engineAssets: EngineAssetInput[] = []
    for (const a of assetRows) {
      const cur = a.currency ?? "USD"
      const bal = Number(a.currentBalance ?? 0)
      const balConv = convertAmount(bal, cur, goalCurrency, rates)
      if (balConv == null) {
        return {
          summary: {
            goalFundable: null,
            shortfall: null,
            netWorth,
            monthsToFi: monthsFromTodayToFi(today, fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert asset balance from ${cur}.`,
          },
          goalOptions,
          monthlyInvestable: null,
          projectedNetWorthAtFi: null,
        }
      }
      let termConv: number | null = null
      if (a.assumedTerminalValue != null) {
        termConv = convertAmount(Number(a.assumedTerminalValue), cur, goalCurrency, rates) ?? null
        if (termConv == null) {
          return {
            summary: {
              goalFundable: null,
              shortfall: null,
              netWorth,
              monthsToFi: monthsFromTodayToFi(today, fiDate),
              requiredPrincipal: Number.isFinite(req) ? req : null,
              assumedWithdrawalRate: withdrawalRate,
              chartSeries: [],
              reportingGoalId: goal.id,
              reportingCurrency: goalCurrency,
              fxAsOfDate: fx.asOfDate,
              fxWarning: `Could not convert terminal value from ${cur}.`,
            },
            goalOptions,
            monthlyInvestable: null,
            projectedNetWorthAtFi: null,
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

    const finiteReq = Number.isFinite(req)
    const fundable = finiteReq ? isGoalFundable(finalProjectedNet, req) : null
    const shortfall =
      finiteReq && fundable === false ? fundingShortfall(finalProjectedNet, req) : null

    return {
      summary: {
        goalFundable: fundable,
        shortfall,
        netWorth,
        monthsToFi: monthsFromTodayToFi(today, fiDate),
        requiredPrincipal: finiteReq ? req : null,
        assumedWithdrawalRate: withdrawalRate,
        chartSeries,
        reportingGoalId: goal.id,
        reportingCurrency: goalCurrency,
        fxAsOfDate: fx.asOfDate,
        fxWarning: null,
      },
      goalOptions,
      monthlyInvestable,
      projectedNetWorthAtFi: finalProjectedNet,
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      if (isMissingTableError(e)) {
        console.warn("[getFiPlanPageData] Tables not found. Apply migrations: pnpm db:migrate")
      } else {
        console.warn("[getFiPlanPageData]", e)
      }
    }
    return { summary: emptySummary(), goalOptions: [], monthlyInvestable: null, projectedNetWorthAtFi: null }
  }
}

export async function getFiPlanData(opts?: {
  goalId?: string | null
}): Promise<SummaryViewModel> {
  return (await getFiPlanPageData(opts)).summary
}
