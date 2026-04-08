import assert from "node:assert/strict"
import test from "node:test"

import {
  buildSavingsRateMonthTotals,
  rateFromSavingsRateTotals,
  summarizeSavingsRateMonths,
} from "./fi-plan"

test("rateFromSavingsRateTotals returns null when income is zero", () => {
  assert.equal(rateFromSavingsRateTotals({ income: 0, expenses: 50 }), null)
})

test("buildSavingsRateMonthTotals converts mixed currencies before summarizing", () => {
  const rates = new Map<string, number>([
    ["USD", 4],
    ["AED", 1],
    ["EUR", 5],
  ])
  const result = buildSavingsRateMonthTotals({
    incomeRows: [
      { occurredOn: "2026-04-03", amount: "1000.00", currency: "USD" },
      { occurredOn: "2026-03-15", amount: "500.00", currency: "EUR" },
    ],
    expenseRows: [
      { occurredOn: "2026-04-10", amount: "500.00", currency: "AED" },
      { occurredOn: "2026-03-20", amount: "1000.00", currency: "AED" },
    ],
    reportingCurrency: "AED",
    rates,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.monthTotals.get("2026-04"), { income: 250, expenses: 500 })
  assert.deepEqual(result.monthTotals.get("2026-03"), { income: 500, expenses: 1000 })
})

test("summarizeSavingsRateMonths uses current month and last closed months with data", () => {
  const monthTotals = new Map([
    ["2026-04", { income: 1000, expenses: 600 }],
    ["2026-03", { income: 1200, expenses: 600 }],
    ["2026-02", { income: 900, expenses: 450 }],
    ["2026-01", { income: 800, expenses: 600 }],
  ])

  const summary = summarizeSavingsRateMonths({
    monthTotals,
    currentMonth: "2026-04",
  })

  assert.equal(summary.currentRate, 0.4)
  assert.equal(summary.rollingAvg3Month, (0.5 + 0.5 + 0.25) / 3)
})
