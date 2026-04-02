import assert from "node:assert"
import { describe, it } from "node:test"

import { importRowDedupeHash } from "@/lib/imports/dedupe-hash"

describe("importRowDedupeHash", () => {
  it("is stable for same inputs", () => {
    const a = importRowDedupeHash({
      occurredOn: "2026-01-15",
      amount: -42.5,
      description: "COFFEE",
      fileId: "f1",
      parserRowIndex: 3,
    })
    const b = importRowDedupeHash({
      occurredOn: "2026-01-15",
      amount: -42.5,
      description: "COFFEE",
      fileId: "f1",
      parserRowIndex: 3,
    })
    assert.strictEqual(a, b)
    assert.strictEqual(a.length, 64)
  })

  it("differs when file id differs", () => {
    const a = importRowDedupeHash({
      occurredOn: "2026-01-15",
      amount: 10,
      description: "X",
      fileId: "a",
      parserRowIndex: 0,
    })
    const b = importRowDedupeHash({
      occurredOn: "2026-01-15",
      amount: 10,
      description: "X",
      fileId: "b",
      parserRowIndex: 0,
    })
    assert.notStrictEqual(a, b)
  })
})
