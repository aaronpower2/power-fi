import assert from "node:assert/strict"
import test from "node:test"

import { goalInputSchema } from "./goal"

test("goalInputSchema normalizes blank target savings rate to null", () => {
  const parsed = goalInputSchema.parse({
    name: "Baseline",
    currency: "USD",
    fiDate: "2035-01-01",
    withdrawalRatePercent: 4,
    targetSavingsRatePercent: "",
    lifestyleLines: [{ name: "Living", monthlyAmount: 5000 }],
  })

  assert.equal(parsed.targetSavingsRatePercent, null)
})

test("goalInputSchema keeps numeric target savings rate percent", () => {
  const parsed = goalInputSchema.parse({
    name: "Baseline",
    currency: "USD",
    fiDate: "2035-01-01",
    withdrawalRatePercent: 4,
    targetSavingsRatePercent: "42.5",
    lifestyleLines: [{ name: "Living", monthlyAmount: 5000 }],
  })

  assert.equal(parsed.targetSavingsRatePercent, 42.5)
})
