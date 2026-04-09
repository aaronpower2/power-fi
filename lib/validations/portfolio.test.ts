import assert from "node:assert/strict"
import test from "node:test"

import { createAssetSchema } from "./portfolio"

test("createAssetSchema rejects future revaluation for real estate", () => {
  const parsed = createAssetSchema.safeParse({
    name: "Rental Property",
    assetCategory: "real_estate_rental",
    includeInFiProjection: true,
    currency: "USD",
    growthType: "capital",
    assumedTerminalValue: 600000,
    maturationDate: "2030-01-01",
    currentBalance: 500000,
    meta: {},
  })

  assert.equal(parsed.success, false)
  assert.match(
    parsed.error.issues[0]?.message ?? "",
    /Real estate assets must use annual growth/i
  )
})

test("createAssetSchema accepts annual growth for real estate", () => {
  const parsed = createAssetSchema.safeParse({
    name: "Rental Property",
    assetCategory: "real_estate_rental",
    includeInFiProjection: true,
    currency: "USD",
    growthType: "compound",
    assumedAnnualReturnPercent: 4.5,
    currentBalance: 500000,
    meta: {},
  })

  assert.equal(parsed.success, true)
})
