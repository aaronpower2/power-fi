import assert from "node:assert"
import { describe, it } from "node:test"

import { importMatchResponseSchema } from "@/lib/anthropic/import-matcher"

describe("importMatchResponseSchema", () => {
  it("parses valid array", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000"
    const parsed = importMatchResponseSchema.parse([
      {
        staging_id: id,
        kind: "expense",
        existing_line_id: id,
        confidence: "high",
        notes: null,
      },
    ])
    assert.strictEqual(parsed.length, 1)
    assert.strictEqual(parsed[0].kind, "expense")
  })

  it("rejects when neither line nor proposal", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000"
    assert.throws(() =>
      importMatchResponseSchema.parse([
        {
          staging_id: id,
          kind: "expense",
          confidence: "low",
        },
      ]),
    )
  })
})
