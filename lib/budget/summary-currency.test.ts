import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveBudgetSummaryCurrency } from "@/lib/budget/summary-currency"

describe("resolveBudgetSummaryCurrency", () => {
  it("uses requested code when allowed", () => {
    assert.equal(resolveBudgetSummaryCurrency("aed", "USD"), "AED")
    assert.equal(resolveBudgetSummaryCurrency("NZD", "USD"), "NZD")
  })

  it("falls back to goal when request invalid", () => {
    assert.equal(resolveBudgetSummaryCurrency("USD", "AUD"), "AUD")
    assert.equal(resolveBudgetSummaryCurrency(null, "NZD"), "NZD")
  })

  it("defaults to AED when neither applies", () => {
    assert.equal(resolveBudgetSummaryCurrency(null, "USD"), "AED")
    assert.equal(resolveBudgetSummaryCurrency("EUR", "GBP"), "AED")
  })
})
