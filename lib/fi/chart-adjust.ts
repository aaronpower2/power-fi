import type { ChartPoint } from "./types"

/** Subtract a constant (e.g. total liabilities in goal currency) from every projected total. v1: debt held flat through horizon. */
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
