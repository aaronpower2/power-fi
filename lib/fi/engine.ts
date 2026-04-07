import type {
  BlendedReturnAssetInput,
  ChartPoint,
  CoastFiInput,
  EngineAssetInput,
  ProjectionInput,
  ProjectionResult,
} from "./types"

/** Classic FIRE: annual spend / withdrawal rate (e.g. 4% rule). */
export function requiredPrincipal(
  monthlyFunding: number,
  withdrawalRate: number,
): number {
  if (withdrawalRate <= 0 || !Number.isFinite(withdrawalRate)) return Number.POSITIVE_INFINITY
  return (monthlyFunding * 12) / withdrawalRate
}

export function monthlyRateFromAnnual(annual: number): number {
  return (1 + annual) ** (1 / 12) - 1
}

export function calcBlendedReturn(assets: BlendedReturnAssetInput[]): number | null {
  const included = assets.filter(
    (asset) =>
      asset.growthType === "compound" &&
      asset.assumedAnnualReturn != null &&
      asset.currentBalance > 0,
  )
  const totalBalance = included.reduce((sum, asset) => sum + asset.currentBalance, 0)
  if (totalBalance <= 0) return null

  return included.reduce(
    (sum, asset) =>
      sum + (asset.currentBalance / totalBalance) * (asset.assumedAnnualReturn ?? 0),
    0,
  )
}

export function calcCoastFiNumber(input: CoastFiInput): number | null {
  const { requiredPrincipal, monthsToFiDate, blendedAnnualReturn } = input
  if (!Number.isFinite(requiredPrincipal) || requiredPrincipal <= 0) return null
  if (!Number.isFinite(monthsToFiDate) || monthsToFiDate <= 0) return null
  if (!Number.isFinite(blendedAnnualReturn)) return null

  const monthlyRate = monthlyRateFromAnnual(blendedAnnualReturn)
  return requiredPrincipal / Math.pow(1 + monthlyRate, monthsToFiDate)
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function sameUtcMonth(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
  )
}

function addUtcMonths(d: Date, delta: number): Date {
  const x = new Date(d)
  x.setUTCMonth(x.getUTCMonth() + delta)
  return x
}

/** Inclusive count of month buckets from start month through FI month. */
export function monthCountInclusive(start: Date, fi: Date): number {
  const s = startOfUtcMonth(start)
  const e = startOfUtcMonth(fi)
  const diff =
    (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth())
  return diff + 1
}

function formatMonthLabel(d: Date): string {
  const m = d.getUTCMonth() + 1
  return `${d.getUTCFullYear()}-${String(m).padStart(2, "0")}`
}

/**
 * End-of-month projection: compound growth, then capital maturation, then contributions.
 */
export function projectPortfolio(input: ProjectionInput): ProjectionResult {
  const { startDate, fiDate, monthlyInvestable, assets, allocations } = input
  const monthStart = startOfUtcMonth(startDate)
  const fiMonthStart = startOfUtcMonth(fiDate)
  const n = monthCountInclusive(monthStart, fiMonthStart)

  const weights = new Map(allocations.map((a) => [a.assetId, a.weightPercent / 100]))
  const balances = new Map<string, number>()
  for (const a of assets) {
    balances.set(a.id, a.currentBalance)
  }

  const sumBalances = () =>
    assets.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)

  if (n <= 0) {
    const total = sumBalances()
    return {
      points: [{ label: formatMonthLabel(fiMonthStart), projectedTotal: total }],
      finalProjectedTotal: total,
    }
  }

  const points: ChartPoint[] = []

  for (let t = 0; t < n; t++) {
    const cursor = addUtcMonths(monthStart, t)

    for (const a of assets) {
      if (a.growthType !== "compound") continue
      const annual = a.assumedAnnualReturn ?? 0
      const mr = monthlyRateFromAnnual(annual)
      const id = a.id
      balances.set(id, (balances.get(id) ?? 0) * (1 + mr))
    }

    for (const a of assets) {
      if (a.growthType !== "capital" || !a.maturationDate) continue
      if (sameUtcMonth(cursor, a.maturationDate)) {
        const tv = a.assumedTerminalValue ?? 0
        balances.set(a.id, tv)
      }
    }

    for (const a of assets) {
      const w = weights.get(a.id) ?? 0
      balances.set(a.id, (balances.get(a.id) ?? 0) + monthlyInvestable * w)
    }

    points.push({
      label: formatMonthLabel(cursor),
      projectedTotal: sumBalances(),
    })
  }

  const finalProjectedTotal = points[points.length - 1]?.projectedTotal ?? 0
  return { points, finalProjectedTotal }
}

export function isGoalFundable(projectedAtFi: number, required: number): boolean {
  if (!Number.isFinite(required) || required <= 0) return false
  return projectedAtFi >= required - 0.5
}

export function fundingShortfall(projectedAtFi: number, required: number): number {
  return Math.max(0, required - projectedAtFi)
}

export function monthsFromTodayToFi(today: Date, fiDate: Date): number | null {
  const t = startOfUtcMonth(today)
  const f = startOfUtcMonth(fiDate)
  const diff =
    (f.getUTCFullYear() - t.getUTCFullYear()) * 12 + (f.getUTCMonth() - t.getUTCMonth())
  if (diff < 0) return 0
  return diff
}

export function toEngineAsset(row: {
  id: string
  growthType: "compound" | "capital"
  currentBalance: string | null
  assumedAnnualReturn: string | null
  assumedTerminalValue: string | null
  maturationDate: string | null
}): EngineAssetInput {
  return {
    id: row.id,
    growthType: row.growthType,
    currentBalance: Number(row.currentBalance ?? 0),
    assumedAnnualReturn:
      row.assumedAnnualReturn != null ? Number(row.assumedAnnualReturn) : null,
    assumedTerminalValue:
      row.assumedTerminalValue != null ? Number(row.assumedTerminalValue) : null,
    maturationDate: row.maturationDate ? new Date(`${row.maturationDate}T12:00:00Z`) : null,
  }
}
