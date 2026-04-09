import assert from "node:assert/strict"
import test from "node:test"

import {
  allowedGrowthTypesForCategory,
  defaultGrowthType,
  growthTypeLabel,
  isGrowthTypeAllowedForCategory,
} from "./asset-category"

test("real estate defaults to annual growth and disallows future revaluation", () => {
  assert.equal(defaultGrowthType("real_estate_rental"), "compound")
  assert.deepEqual(allowedGrowthTypesForCategory("real_estate_primary"), [
    "compound",
  ])
  assert.equal(
    isGrowthTypeAllowedForCategory("real_estate_primary", "compound"),
    true
  )
  assert.equal(
    isGrowthTypeAllowedForCategory("real_estate_primary", "capital"),
    false
  )
})

test("depreciating assets default to future revaluation", () => {
  assert.equal(defaultGrowthType("vehicle"), "capital")
  assert.equal(defaultGrowthType("depreciating_other"), "capital")
  assert.deepEqual(allowedGrowthTypesForCategory("vehicle"), [
    "compound",
    "capital",
  ])
})

test("growth labels use user-facing terminology", () => {
  assert.equal(growthTypeLabel("compound"), "Annual growth")
  assert.equal(growthTypeLabel("capital"), "Future revaluation")
})
