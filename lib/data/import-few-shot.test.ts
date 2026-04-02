import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { normalizeImportDescriptionForFewShot } from "./import-few-shot"

describe("normalizeImportDescriptionForFewShot", () => {
  it("trims, lowercases, collapses spaces, caps length", () => {
    assert.equal(
      normalizeImportDescriptionForFewShot("  FOO   BAR  "),
      "foo bar",
    )
    const long = "a".repeat(120)
    assert.equal(normalizeImportDescriptionForFewShot(long).length, 100)
    assert.equal(normalizeImportDescriptionForFewShot(long), "a".repeat(100))
  })
})
