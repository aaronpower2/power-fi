import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveBudgetSummaryCurrency } from "@/lib/budget/summary-currency"

describe("resolveBudgetSummaryCurrency", () => {
  it("uses requested code when allowed", () => {
    assert.equal(resolveBudgetSummaryCurrency("aed"), "AED")
    assert.equal(resolveBudgetSummaryCurrency("NZD"), "NZD")
    assert.equal(resolveBudgetSummaryCurrency("AUD"), "AUD")
  })

  it("defaults to AED when request missing or not in allowed set", () => {
    assert.equal(resolveBudgetSummaryCurrency(null), "AED")
    assert.equal(resolveBudgetSummaryCurrency(undefined), "AED")
    assert.equal(resolveBudgetSummaryCurrency("USD"), "AED")
    assert.equal(resolveBudgetSummaryCurrency("EUR"), "AED")
  })
})
