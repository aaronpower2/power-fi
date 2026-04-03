import type { ChartPoint } from "./types"

/** Subtract a constant offset from every projected total. */
export function subtractConstantFromChartPoints(
  points: ChartPoint[],
  offsetGoalCcy: number,
): ChartPoint[] {
  if (offsetGoalCcy === 0) return points
  return points.map((p) => ({
    ...p,
    projectedTotal: p.projectedTotal - offsetGoalCcy,
  }))
}

/** Subtract a month-by-month liability path from the gross projected series. */
export function subtractSeriesFromChartPoints(
  points: ChartPoint[],
  offsetsGoalCcy: number[],
): ChartPoint[] {
  return points.map((p, i) => ({
    ...p,
    projectedTotal: p.projectedTotal - (offsetsGoalCcy[i] ?? 0),
  }))
}
