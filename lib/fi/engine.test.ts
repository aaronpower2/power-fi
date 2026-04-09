import assert from "node:assert/strict"
import { test } from "node:test"

import {
  calcBlendedReturn,
  calcCoastFiNumber,
  monthlyRateFromAnnual,
  projectPortfolio,
} from "./engine"

test("calcBlendedReturn weights compound assets by current balance", () => {
  const blended = calcBlendedReturn([
    {
      currentBalance: 100_000,
      growthType: "compound",
      assumedAnnualReturn: 0.08,
    },
    {
      currentBalance: 300_000,
      growthType: "compound",
      assumedAnnualReturn: 0.06,
    },
  ])

  assert.equal(blended, 0.065)
})

test("calcBlendedReturn ignores capital assets and missing returns", () => {
  const blended = calcBlendedReturn([
    {
      currentBalance: 200_000,
      growthType: "capital",
      assumedAnnualReturn: null,
    },
    {
      currentBalance: 50_000,
      growthType: "compound",
      assumedAnnualReturn: null,
    },
  ])

  assert.equal(blended, null)
})

test("calcCoastFiNumber discounts using engine monthly compounding", () => {
  const coastFi = calcCoastFiNumber({
    requiredPrincipal: 1_200_000,
    monthsToFiDate: 120,
    blendedAnnualReturn: 0.07,
  })

  const expected = 1_200_000 / Math.pow(1 + monthlyRateFromAnnual(0.07), 120)

  assert.ok(coastFi != null)
  assert.ok(Math.abs(coastFi - expected) < 0.01)
})

test("calcCoastFiNumber returns null for non-future FI horizons", () => {
  const coastFi = calcCoastFiNumber({
    requiredPrincipal: 900_000,
    monthsToFiDate: 0,
    blendedAnnualReturn: 0.06,
  })

  assert.equal(coastFi, null)
})

test("projectPortfolio compounds annual-growth assets month over month", () => {
  const { points } = projectPortfolio({
    startDate: new Date("2026-01-15T00:00:00Z"),
    fiDate: new Date("2026-03-20T00:00:00Z"),
    monthlyInvestable: 0,
    assets: [
      {
        id: "property",
        currentBalance: 500_000,
        growthType: "compound",
        assumedAnnualReturn: 0.06,
        assumedTerminalValue: null,
        maturationDate: null,
      },
    ],
    allocations: [],
  })

  assert.equal(points.length, 3)
  assert.ok(points[0].projectedTotal > 500_000)
  assert.ok(points[1].projectedTotal > points[0].projectedTotal)
  assert.ok(points[2].projectedTotal > points[1].projectedTotal)
})

test("projectPortfolio applies future revaluation as a dated step change", () => {
  const { points } = projectPortfolio({
    startDate: new Date("2026-01-15T00:00:00Z"),
    fiDate: new Date("2026-03-20T00:00:00Z"),
    monthlyInvestable: 0,
    assets: [
      {
        id: "claim",
        currentBalance: 100_000,
        growthType: "capital",
        assumedAnnualReturn: null,
        assumedTerminalValue: 160_000,
        maturationDate: new Date("2026-02-10T00:00:00Z"),
      },
    ],
    allocations: [],
  })

  assert.deepEqual(
    points.map((point) => ({
      label: point.label,
      projectedTotal: point.projectedTotal,
    })),
    [
      { label: "2026-01", projectedTotal: 100_000 },
      { label: "2026-02", projectedTotal: 160_000 },
      { label: "2026-03", projectedTotal: 160_000 },
    ]
  )
})
