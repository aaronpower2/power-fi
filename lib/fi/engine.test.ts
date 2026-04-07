import assert from "node:assert/strict"
import { test } from "node:test"

import { calcBlendedReturn, calcCoastFiNumber, monthlyRateFromAnnual } from "./engine"

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

  const expected =
    1_200_000 / Math.pow(1 + monthlyRateFromAnnual(0.07), 120)

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
