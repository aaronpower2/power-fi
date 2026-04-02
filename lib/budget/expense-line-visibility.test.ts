import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { expenseLineAppliesToBudgetMonth } from "@/lib/budget/expense-line-visibility"

describe("expenseLineAppliesToBudgetMonth", () => {
  it("always includes lines for budget and import workflows", () => {
    const id = "00000000-0000-4000-8000-000000000001"
    assert.equal(
      expenseLineAppliesToBudgetMonth({ isRecurring: true }, id, {}, {}),
      true,
    )
    assert.equal(
      expenseLineAppliesToBudgetMonth({ isRecurring: false }, id, {}, {}),
      true,
    )
  })
})
