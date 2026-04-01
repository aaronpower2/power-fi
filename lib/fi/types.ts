export type GrowthType = "compound" | "capital"

export type ChartPoint = {
  /** ISO year-month or label for axis */
  label: string
  projectedTotal: number
}

export type EngineAssetInput = {
  id: string
  currentBalance: number
  growthType: GrowthType
  /** Annual decimal, e.g. 0.07 */
  assumedAnnualReturn: number | null
  assumedTerminalValue: number | null
  maturationDate: Date | null
}

export type EngineAllocationInput = {
  assetId: string
  weightPercent: number
}

export type ProjectionInput = {
  startDate: Date
  fiDate: Date
  monthlyInvestable: number
  assets: EngineAssetInput[]
  allocations: EngineAllocationInput[]
}

export type ProjectionResult = {
  points: ChartPoint[]
  finalProjectedTotal: number
}
