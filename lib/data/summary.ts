import { and, desc, eq, gte, lte } from "drizzle-orm"

import { convertAmount } from "@/lib/currency/convert"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"
import { utcIsoDateString, utcMonthRangeStrings } from "@/lib/dates"
import { getDb } from "@/lib/db"
import { formatGoalListLabel } from "@/lib/goals/labels"
import {
  allocationStrategies,
  allocationTargets,
  assets,
  expenseRecords,
  goals,
  incomeRecords,
  liabilities,
} from "@/lib/db/schema"
import { subtractConstantFromChartPoints } from "@/lib/fi/chart-adjust"
import {
  fundingShortfall,
  isGoalFundable,
  monthsFromTodayToFi,
  projectPortfolio,
  requiredPrincipal,
} from "@/lib/fi"
import type { ChartPoint } from "@/lib/fi/types"
import type { EngineAllocationInput, EngineAssetInput } from "@/lib/fi/types"

export type SummaryViewModel = {
  goalFundable: boolean | null
  shortfall: number | null
  netWorth: number
  monthsToFi: number | null
  /** Null when undefined (e.g. withdrawal rate is zero). */
  requiredPrincipal: number | null
  assumedWithdrawalRate: number
  chartSeries: ChartPoint[]
  /** Goal row used for this summary (projection, currency, funding target). */
  reportingGoalId: string | null
  /** Active goal currency; FI headline amounts use this. */
  reportingCurrency: string
  /** Date of ECB snapshot used for conversion (YYYY-MM-DD), if any. */
  fxAsOfDate: string | null
  /** Set when FX data is missing or a needed currency pair cannot be converted. */
  fxWarning: string | null
}

export type SummaryGoalOption = {
  id: string
  /** Short label for selects (FI date, currency, active hint). */
  label: string
  isActive: boolean
}

export type SummaryPageData = {
  summary: SummaryViewModel
  goalOptions: SummaryGoalOption[]
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
  const active = rows.filter((g) => g.isActive).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  if (active.length > 0) return active[0]!
  return rows[0]!
}

/** Postgres undefined_table or Drizzle-wrapped equivalent */
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

export async function getSummaryPageData(opts?: {
  goalId?: string | null
}): Promise<SummaryPageData> {
  const goalId = opts?.goalId ?? null
  const db = getDb()
  if (!db) {
    return { summary: emptySummary(), goalOptions: [] }
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
      return { summary: emptySummary(), goalOptions }
    }

    const goalCurrency = goal.currency ?? "USD"
    const withdrawalRate = Number(goal.withdrawalRate)
    const monthlyFunding = Number(goal.monthlyFundingRequirement)
    const req = requiredPrincipal(monthlyFunding, withdrawalRate)
    const fiDate = new Date(`${goal.fiDate}T12:00:00Z`)
    const todayStr = utcIsoDateString(new Date())

    const fx = await loadRatesOnOrBefore(db, todayStr)
    if (!fx) {
      return {
        summary: {
          goalFundable: null,
          shortfall: null,
          netWorth: 0,
          monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
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
      }
    }

    const rates = fx.rates

    const assetRows = await db.select().from(assets)

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
            monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert ${cur} to ${goalCurrency}. Check Frankfurter supports both codes.`,
          },
          goalOptions,
        }
      }
      grossAssetsGoal += conv
    }

    const liabilityRows = await db.select().from(liabilities)
    let liabilityTotalGoal = 0
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
            monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert liability from ${cur} to ${goalCurrency}.`,
          },
          goalOptions,
        }
      }
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

    const { start, end } = utcMonthRangeStrings(new Date())

    const incomeRows = await db
      .select()
      .from(incomeRecords)
      .where(
        and(gte(incomeRecords.occurredOn, start), lte(incomeRecords.occurredOn, end)),
      )

    const expenseRows = await db
      .select()
      .from(expenseRecords)
      .where(
        and(gte(expenseRecords.occurredOn, start), lte(expenseRecords.occurredOn, end)),
      )

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
            monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert income from ${cur} to ${goalCurrency}.`,
          },
          goalOptions,
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
            monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert expense from ${cur} to ${goalCurrency}.`,
          },
          goalOptions,
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
            monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
            requiredPrincipal: Number.isFinite(req) ? req : null,
            assumedWithdrawalRate: withdrawalRate,
            chartSeries: [],
            reportingGoalId: goal.id,
            reportingCurrency: goalCurrency,
            fxAsOfDate: fx.asOfDate,
            fxWarning: `Could not convert asset balance from ${cur}.`,
          },
          goalOptions,
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
              monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
              requiredPrincipal: Number.isFinite(req) ? req : null,
              assumedWithdrawalRate: withdrawalRate,
              chartSeries: [],
              reportingGoalId: goal.id,
              reportingCurrency: goalCurrency,
              fxAsOfDate: fx.asOfDate,
              fxWarning: `Could not convert terminal value from ${cur}.`,
            },
            goalOptions,
          }
        }
      }
      const base = toEngineAssetConverted({
        id: a.id,
        growthType: a.growthType,
        currentBalance: balConv.toFixed(2),
        assumedAnnualReturn: a.assumedAnnualReturn,
        assumedTerminalValue:
          termConv != null ? termConv.toFixed(2) : a.assumedTerminalValue,
        maturationDate: a.maturationDate,
      })
      engineAssets.push(base)
    }

    const { points, finalProjectedTotal: grossFinalProjected } = projectPortfolio({
      startDate: new Date(),
      fiDate,
      monthlyInvestable,
      assets: engineAssets,
      allocations,
    })

    /** v1: liability principal held constant in goal currency across the projection horizon. */
    const chartSeries = subtractConstantFromChartPoints(points, liabilityTotalGoal)
    const finalProjectedNet =
      chartSeries.length > 0
        ? chartSeries[chartSeries.length - 1]!.projectedTotal
        : grossFinalProjected - liabilityTotalGoal

    const finiteReq = Number.isFinite(req)
    const fundable = finiteReq ? isGoalFundable(finalProjectedNet, req) : null
    const shortfall =
      finiteReq && fundable === false ? fundingShortfall(finalProjectedNet, req) : null

    return {
      summary: {
        goalFundable: fundable,
        shortfall,
        netWorth,
        monthsToFi: monthsFromTodayToFi(new Date(), fiDate),
        requiredPrincipal: finiteReq ? req : null,
        assumedWithdrawalRate: withdrawalRate,
        chartSeries,
        reportingGoalId: goal.id,
        reportingCurrency: goalCurrency,
        fxAsOfDate: fx.asOfDate,
        fxWarning: null,
      },
      goalOptions,
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      if (isMissingTableError(e)) {
        console.warn(
          "[getSummaryPageData] Tables not found. Apply migrations: pnpm db:migrate",
        )
      } else {
        console.warn("[getSummaryPageData]", e)
      }
    }
    return { summary: emptySummary(), goalOptions: [] }
  }
}

export async function getSummaryData(opts?: {
  goalId?: string | null
}): Promise<SummaryViewModel> {
  return (await getSummaryPageData(opts)).summary
}
