import { asc, desc, eq, isNotNull } from "drizzle-orm"

import {
  BUDGET_SUMMARY_CURRENCIES,
  type BudgetSummaryCurrency,
  resolveBudgetSummaryCurrency,
} from "@/lib/budget/summary-currency"
import { convertAmount } from "@/lib/currency/convert"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"
import { utcIsoDateString } from "@/lib/dates"
import { getDb } from "@/lib/db"
import type { ChartPoint } from "@/lib/fi/types"
import { getFiPlanPageData } from "@/lib/data/fi-plan"
import {
  allocationRecords,
  allocationStrategies,
  allocationTargets,
  assets,
  expenseLines,
  goals,
  liabilities,
} from "@/lib/db/schema"

export type PortfolioAllocationRecordRow = typeof allocationRecords.$inferSelect

export type PortfolioLiabilityRow = {
  id: string
  name: string
  liabilityType: string | null
  trackingMode: string
  currency: string
  currentBalance: string
  securedByAssetId: string | null
  securedByAssetName: string | null
  meta: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  hasDebtPaymentLine: boolean
}

export type AllocationHealthSummary = {
  strategyName: string | null
  targetCount: number
  weightSum: number
  lastAllocatedOn: string | null
  canAllocate: boolean
}

export type PortfolioPageData = {
  assets: (typeof assets.$inferSelect)[]
  liabilities: PortfolioLiabilityRow[]
  strategies: (typeof allocationStrategies.$inferSelect)[]
  activeStrategy: (typeof allocationStrategies.$inferSelect) | null
  targets: {
    id: string
    strategyId: string
    assetId: string
    weightPercent: string
    assetName: string
  }[]
  allocationRecordsByAssetId: Record<string, PortfolioAllocationRecordRow[]>
  /** Sum of allocation record amounts in selected summary currency; null if no goal, FX, or conversion failed. */
  totalInvestedReporting: number | null
  /** Gross asset balances in selected summary currency (same as before liabilities). */
  currentPositionReporting: number | null
  /** Total remaining owed in selected summary currency; null if conversion failed. */
  totalLiabilitiesReporting: number | null
  /** Gross assets minus liabilities in selected summary currency. */
  netPositionReporting: number | null
  /** End-of-month projected portfolio total, last month in each calendar year through FI year. */
  yearlyProjectedReporting: { year: number; projectedTotal: number }[]
  /** Reporting currency for net-worth totals (Cash Flow toolbar options; `ccy` query or goal default). */
  summaryCurrency: BudgetSummaryCurrency
  summaryCurrencyOptions: typeof BUDGET_SUMMARY_CURRENCIES
  /** Same as `summaryCurrency` — display code for formatted totals. */
  goalReportingCurrency: string | null
  fiDateLabel: string | null
  portfolioFxWarning: string | null
  fxAsOfDate: string | null
  /** At most one secured liability per asset id (DB constraint). */
  securedLiabilityByAssetId: Record<
    string,
    {
      id: string
      name: string
      liabilityType: string | null
      trackingMode: string
      currency: string
      currentBalance: string
    }
  >
  allocationHealthSummary: AllocationHealthSummary
}

function buildSecuredLiabilityByAssetId(
  liabilityList: PortfolioLiabilityRow[],
): PortfolioPageData["securedLiabilityByAssetId"] {
  const m: PortfolioPageData["securedLiabilityByAssetId"] = {}
  for (const L of liabilityList) {
    if (!L.securedByAssetId) continue
    m[L.securedByAssetId] = {
      id: L.id,
      name: L.name,
      liabilityType: L.liabilityType,
      trackingMode: L.trackingMode,
      currency: L.currency,
      currentBalance: L.currentBalance,
    }
  }
  return m
}

function emptyPortfolio(): PortfolioPageData {
  const summaryCurrency = resolveBudgetSummaryCurrency(null)
  return {
    assets: [],
    liabilities: [],
    strategies: [],
    activeStrategy: null,
    targets: [],
    allocationRecordsByAssetId: {},
    securedLiabilityByAssetId: {},
    totalInvestedReporting: null,
    currentPositionReporting: null,
    totalLiabilitiesReporting: null,
    netPositionReporting: null,
    yearlyProjectedReporting: [],
    summaryCurrency,
    summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
    goalReportingCurrency: null,
    fiDateLabel: null,
    portfolioFxWarning: null,
    fxAsOfDate: null,
    allocationHealthSummary: {
      strategyName: null,
      targetCount: 0,
      weightSum: 0,
      lastAllocatedOn: null,
      canAllocate: false,
    },
  }
}

type AppDb = NonNullable<ReturnType<typeof getDb>>

async function loadPortfolioLiabilities(db: AppDb): Promise<PortfolioLiabilityRow[]> {
  const linkedLiabilityIds = await db
    .select({ id: expenseLines.linkedLiabilityId })
    .from(expenseLines)
    .where(isNotNull(expenseLines.linkedLiabilityId))
  const linkedSet = new Set(linkedLiabilityIds.map((row) => row.id))
  const rows = await db
    .select({
      id: liabilities.id,
      name: liabilities.name,
      liabilityType: liabilities.liabilityType,
      trackingMode: liabilities.trackingMode,
      currency: liabilities.currency,
      currentBalance: liabilities.currentBalance,
      securedByAssetId: liabilities.securedByAssetId,
      securedByAssetName: assets.name,
      meta: liabilities.meta,
      createdAt: liabilities.createdAt,
      updatedAt: liabilities.updatedAt,
    })
    .from(liabilities)
    .leftJoin(assets, eq(liabilities.securedByAssetId, assets.id))
    .orderBy(asc(liabilities.name))

  return rows.map((r) => ({
    ...r,
    meta: (r.meta ?? {}) as Record<string, unknown>,
    hasDebtPaymentLine: linkedSet.has(r.id),
  }))
}

/** Last projected total per calendar year from monthly chart points (chronological series). */
export function chartPointsToYearEndTotals(points: ChartPoint[]): {
  year: number
  projectedTotal: number
}[] {
  const lastInYear = new Map<number, number>()
  for (const p of points) {
    const year = Number(p.label.slice(0, 4))
    if (!Number.isFinite(year)) continue
    lastInYear.set(year, p.projectedTotal)
  }
  return [...lastInYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, projectedTotal]) => ({ year, projectedTotal }))
}

export async function getPortfolioData(opts?: {
  summaryCurrency?: string | null
}): Promise<PortfolioPageData> {
  const db = getDb()
  if (!db) {
    return emptyPortfolio()
  }

  const assetList = await db.select().from(assets).orderBy(asc(assets.name))
  const strategyList = await db
    .select()
    .from(allocationStrategies)
    .orderBy(desc(allocationStrategies.isActive), asc(allocationStrategies.name))

  const activeStrategy = strategyList.find((s) => s.isActive) ?? null

  let targets: PortfolioPageData["targets"] = []

  if (activeStrategy) {
    targets = await db
      .select({
        id: allocationTargets.id,
        strategyId: allocationTargets.strategyId,
        assetId: allocationTargets.assetId,
        weightPercent: allocationTargets.weightPercent,
        assetName: assets.name,
      })
      .from(allocationTargets)
      .innerJoin(assets, eq(allocationTargets.assetId, assets.id))
      .where(eq(allocationTargets.strategyId, activeStrategy.id))
      .orderBy(asc(assets.name))
  }

  const recordRows = await db
    .select()
    .from(allocationRecords)
    .orderBy(desc(allocationRecords.allocatedOn), desc(allocationRecords.createdAt))

  const allocationRecordsByAssetId: Record<string, PortfolioAllocationRecordRow[]> = {}
  for (const r of recordRows) {
    const list = allocationRecordsByAssetId[r.assetId] ?? []
    list.push(r)
    allocationRecordsByAssetId[r.assetId] = list
  }

  const liabilityList = await loadPortfolioLiabilities(db)
  const securedLiabilityByAssetId = buildSecuredLiabilityByAssetId(liabilityList)
  const allocationHealthSummary: AllocationHealthSummary = {
    strategyName: activeStrategy?.name ?? null,
    targetCount: targets.length,
    weightSum: targets.reduce((sum, target) => sum + Number(target.weightPercent), 0),
    lastAllocatedOn: recordRows[0]?.allocatedOn ?? null,
    canAllocate: !!activeStrategy && targets.length > 0,
  }

  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.isActive, true))
    .orderBy(desc(goals.updatedAt))
    .limit(1)

  if (!goal) {
    const summaryCurrency = resolveBudgetSummaryCurrency(opts?.summaryCurrency ?? null)
    return {
      assets: assetList,
      liabilities: liabilityList,
      strategies: strategyList,
      activeStrategy,
      targets,
      allocationRecordsByAssetId,
      securedLiabilityByAssetId,
      totalInvestedReporting: null,
      currentPositionReporting: null,
      totalLiabilitiesReporting: null,
      netPositionReporting: null,
      yearlyProjectedReporting: [],
      summaryCurrency,
      summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
      goalReportingCurrency: null,
      fiDateLabel: null,
      portfolioFxWarning: null,
      fxAsOfDate: null,
      allocationHealthSummary,
    }
  }

  const goalCurrency = goal.currency ?? "USD"
  const summaryCurrency = resolveBudgetSummaryCurrency(opts?.summaryCurrency ?? null)
  const todayStr = utcIsoDateString(new Date())
  const fx = await loadRatesOnOrBefore(db, todayStr)

  if (!fx) {
    return {
      assets: assetList,
      liabilities: liabilityList,
      strategies: strategyList,
      activeStrategy,
      targets,
      allocationRecordsByAssetId,
      securedLiabilityByAssetId,
      totalInvestedReporting: null,
      currentPositionReporting: null,
      totalLiabilitiesReporting: null,
      netPositionReporting: null,
      yearlyProjectedReporting: [],
      summaryCurrency,
      summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
      goalReportingCurrency: summaryCurrency,
      fiDateLabel: goal.fiDate,
      portfolioFxWarning:
        "No FX rates available — totals and yearly projection need rates (run pnpm fx:sync).",
      fxAsOfDate: null,
      allocationHealthSummary,
    }
  }

  const rates = fx.rates
  const currencyByAssetId = new Map(assetList.map((a) => [a.id, a.currency ?? "USD"]))

  let currentPositionReporting = 0
  for (const a of assetList) {
    const raw = Number(a.currentBalance ?? 0)
    const cur = a.currency ?? "USD"
    const conv = convertAmount(raw, cur, summaryCurrency, rates)
    if (conv == null) {
      return {
        assets: assetList,
        liabilities: liabilityList,
        strategies: strategyList,
        activeStrategy,
        targets,
        allocationRecordsByAssetId,
        securedLiabilityByAssetId,
        totalInvestedReporting: null,
        currentPositionReporting: null,
        totalLiabilitiesReporting: null,
        netPositionReporting: null,
        yearlyProjectedReporting: [],
        summaryCurrency,
        summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        goalReportingCurrency: summaryCurrency,
        fiDateLabel: goal.fiDate,
        portfolioFxWarning: `Could not convert ${cur} to ${summaryCurrency} for portfolio totals.`,
        fxAsOfDate: fx.asOfDate,
        allocationHealthSummary,
      }
    }
    currentPositionReporting += conv
  }

  let totalInvestedReporting = 0
  for (const r of recordRows) {
    const cur = currencyByAssetId.get(r.assetId) ?? "USD"
    const conv = convertAmount(Number(r.amount), cur, summaryCurrency, rates)
    if (conv == null) {
      return {
        assets: assetList,
        liabilities: liabilityList,
        strategies: strategyList,
        activeStrategy,
        targets,
        allocationRecordsByAssetId,
        securedLiabilityByAssetId,
        totalInvestedReporting: null,
        currentPositionReporting,
        totalLiabilitiesReporting: null,
        netPositionReporting: null,
        yearlyProjectedReporting: [],
        summaryCurrency,
        summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        goalReportingCurrency: summaryCurrency,
        fiDateLabel: goal.fiDate,
        portfolioFxWarning: `Could not convert allocation record from ${cur} to ${summaryCurrency}.`,
        fxAsOfDate: fx.asOfDate,
        allocationHealthSummary,
      }
    }
    totalInvestedReporting += conv
  }

  let totalLiabilitiesReporting = 0
  for (const L of liabilityList) {
    const raw = Number(L.currentBalance ?? 0)
    const cur = L.currency ?? "USD"
    const conv = convertAmount(raw, cur, summaryCurrency, rates)
    if (conv == null) {
      return {
        assets: assetList,
        liabilities: liabilityList,
        strategies: strategyList,
        activeStrategy,
        targets,
        allocationRecordsByAssetId,
        securedLiabilityByAssetId,
        totalInvestedReporting,
        currentPositionReporting,
        totalLiabilitiesReporting: null,
        netPositionReporting: null,
        yearlyProjectedReporting: [],
        summaryCurrency,
        summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
        goalReportingCurrency: summaryCurrency,
        fiDateLabel: goal.fiDate,
        portfolioFxWarning: `Could not convert liability from ${cur} to ${summaryCurrency}.`,
        fxAsOfDate: fx.asOfDate,
        allocationHealthSummary,
      }
    }
    totalLiabilitiesReporting += conv
  }

  const netPositionReporting = currentPositionReporting - totalLiabilitiesReporting

  const fiPlan = await getFiPlanPageData({ reportingCurrencyRequest: summaryCurrency })
  const summary = fiPlan.summary
  const yearlyProjectedReporting =
    summary.fxWarning == null && summary.chartSeries.length > 0
      ? chartPointsToYearEndTotals(summary.chartSeries)
      : []

  const portfolioFxWarning =
    summary.fxWarning != null
      ? summary.fxWarning
      : yearlyProjectedReporting.length === 0 && summary.chartSeries.length === 0
        ? "Add assets and an active goal to see yearly projected values."
        : null

  return {
    assets: assetList,
    liabilities: liabilityList,
    strategies: strategyList,
    activeStrategy,
    targets,
    allocationRecordsByAssetId,
    securedLiabilityByAssetId,
    totalInvestedReporting,
    currentPositionReporting,
    totalLiabilitiesReporting,
    netPositionReporting,
    yearlyProjectedReporting,
    summaryCurrency,
    summaryCurrencyOptions: BUDGET_SUMMARY_CURRENCIES,
    goalReportingCurrency: summaryCurrency,
    fiDateLabel: goal.fiDate,
    portfolioFxWarning,
    fxAsOfDate: summary.fxAsOfDate,
    allocationHealthSummary,
  }
}
