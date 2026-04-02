import assert from "node:assert/strict"
import { test } from "node:test"

import { subtractConstantFromChartPoints } from "./chart-adjust"

test("subtractConstantFromChartPoints offsets each point", () => {
  const pts = [
    { label: "2026-01", projectedTotal: 100 },
    { label: "2026-02", projectedTotal: 110 },
  ]
  const out = subtractConstantFromChartPoints(pts, 25)
  assert.equal(out[0]?.projectedTotal, 75)
  assert.equal(out[1]?.projectedTotal, 85)
})

test("subtractConstantFromChartPoints no-op when offset zero", () => {
  const pts = [{ label: "2026-01", projectedTotal: 50 }]
  const out = subtractConstantFromChartPoints(pts, 0)
  assert.equal(out[0]?.projectedTotal, 50)
})
