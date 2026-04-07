import test from "node:test"
import assert from "node:assert/strict"

import {
  coalesceSupportedCurrency,
  defaultExpenseCategoryRecordCurrency,
  defaultExpenseLineRecordCurrency,
  defaultIncomeLineRecordCurrency,
} from "./cashflow-input-currency"

test("coalesceSupportedCurrency returns fallback for unknown codes", () => {
  assert.equal(coalesceSupportedCurrency("XXX", "USD"), "USD")
  assert.equal(coalesceSupportedCurrency(null, "NZD"), "NZD")
})

test("coalesceSupportedCurrency accepts supported codes", () => {
  assert.equal(coalesceSupportedCurrency("nzd", "USD"), "NZD")
})

test("defaultExpenseCategoryRecordCurrency uses liability for debt_payment", () => {
  const map = new Map([["li-1", "NZD"]])
  const ccy = defaultExpenseCategoryRecordCurrency({
    category: {
      cashFlowType: "debt_payment",
      linkedLiabilityId: "li-1",
      isRecurring: false,
      recurringCurrency: "USD",
    },
    liabilityCurrencyById: map,
    fallbackCurrency: "AED",
  })
  assert.equal(ccy, "NZD")
})

test("defaultExpenseCategoryRecordCurrency uses recurring for non-debt recurring", () => {
  const map = new Map<string, string>()
  const ccy = defaultExpenseCategoryRecordCurrency({
    category: {
      cashFlowType: "expense",
      linkedLiabilityId: null,
      isRecurring: true,
      recurringCurrency: "EUR",
    },
    liabilityCurrencyById: map,
    fallbackCurrency: "USD",
  })
  assert.equal(ccy, "EUR")
})

test("defaultIncomeLineRecordCurrency uses line recurring currency", () => {
  assert.equal(
    defaultIncomeLineRecordCurrency({ recurringCurrency: "NZD" }, "USD"),
    "NZD",
  )
})

test("defaultExpenseLineRecordCurrency uses linked liability currency", () => {
  const map = new Map([["li-1", "GBP"]])
  const ccy = defaultExpenseLineRecordCurrency({
    line: {
      linkedLiabilityId: "li-1",
      isRecurring: true,
      recurringCurrency: "USD",
    },
    liabilityCurrencyById: map,
    fallbackCurrency: "AED",
  })
  assert.equal(ccy, "GBP")
})
