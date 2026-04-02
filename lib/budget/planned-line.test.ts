import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { monthlyPlannedForExpenseCategory, monthlyPlannedForLine } from "@/lib/budget/planned-line"

describe("monthlyPlannedForLine", () => {
  it("returns zero for non-recurring line", () => {
    const r = monthlyPlannedForLine(
      {
        isRecurring: false,
        frequency: null,
        recurringAmount: null,
        recurringCurrency: "USD",
        recurringAnchorDate: null,
      },
      "2026-01-01",
      "2026-01-31",
    )
    assert.equal(r.amount, 0)
    assert.equal(r.currency, "USD")
  })

  it("computes monthly expense budget from recurring monthly amount", () => {
    const r = monthlyPlannedForLine(
      {
        isRecurring: true,
        frequency: "monthly",
        recurringAmount: "500",
        recurringCurrency: "EUR",
        recurringAnchorDate: null,
      },
      "2026-04-01",
      "2026-04-30",
    )
    assert.equal(r.currency, "EUR")
    assert.equal(r.amount, 500)
  })

  it("smooths weekly amount without anchor", () => {
    const r = monthlyPlannedForLine(
      {
        isRecurring: true,
        frequency: "weekly",
        recurringAmount: "100",
        recurringCurrency: "USD",
        recurringAnchorDate: null,
      },
      "2026-06-01",
      "2026-06-30",
    )
    assert.ok(Math.abs(r.amount - (100 * 52) / 12) < 0.0001)
  })
})

describe("monthlyPlannedForExpenseCategory", () => {
  it("returns zero when not recurring", () => {
    const r = monthlyPlannedForExpenseCategory({
      isRecurring: false,
      frequency: null,
      recurringAmount: null,
      recurringCurrency: "USD",
    })
    assert.equal(r.amount, 0)
  })

  it("uses smoothed monthly equivalent for weekly", () => {
    const r = monthlyPlannedForExpenseCategory({
      isRecurring: true,
      frequency: "weekly",
      recurringAmount: "120",
      recurringCurrency: "AED",
    })
    assert.ok(Math.abs(r.amount - (120 * 52) / 12) < 0.0001)
  })
})
