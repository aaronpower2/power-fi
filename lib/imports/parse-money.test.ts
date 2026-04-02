import assert from "node:assert"
import { describe, it } from "node:test"

import { parseMoneyString } from "@/lib/imports/parse-money"

describe("parseMoneyString", () => {
  it("parses US-style decimals", () => {
    assert.strictEqual(parseMoneyString("1,234.56"), 1234.56)
  })

  it("parses parentheses as negative", () => {
    assert.strictEqual(parseMoneyString("(99.00)"), -99)
  })

  it("parses European-style when comma is decimal", () => {
    assert.strictEqual(parseMoneyString("12,50"), 12.5)
  })
})
