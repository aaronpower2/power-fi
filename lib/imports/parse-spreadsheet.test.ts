import assert from "node:assert"
import { describe, it } from "node:test"

import { parseCsvText } from "@/lib/imports/parse-spreadsheet"

describe("parseCsvText", () => {
  it("parses headered bank account CSV exports with amount in/out columns", () => {
    const csv = [
      "Date,Description,Amount in,Amount out,Balance",
      '01/04/2026,"Bellbird transfer",,"200.00","80,499.59"',
      '17/03/2026,"Salary",44850.00,,"77,952.20"',
    ].join("\n")

    const parsed = parseCsvText(csv, { currencyDefault: "AED" })

    assert.strictEqual(parsed.headerRowIndex, 0)
    assert.strictEqual(parsed.rows.length, 2)
    assert.strictEqual(parsed.rows[0]?.occurredOn, "2026-04-01")
    assert.strictEqual(parsed.rows[0]?.description, "Bellbird transfer")
    assert.strictEqual(parsed.rows[0]?.amount, 200)
    assert.strictEqual(parsed.rows[1]?.occurredOn, "2026-03-17")
    assert.strictEqual(parsed.rows[1]?.description, "Salary")
    assert.strictEqual(parsed.rows[1]?.amount, 44850)
  })

  it("parses headerless day-first bank account CSV exports", () => {
    const csv = [
      '01/04/2026,           TRANSFER            AEV010462Y8CKTXC            HIB- 68656X120242 Bellbird Solutions FZC AE250330000019100971306 OAT IBAL15687 INTERNET BANKING,-200.00,"80,499.59"',
      '01/04/2026,           TRANSFER            AEV010465Q8CKRGG            OW IPP RTP PYMT            HIB- 130687X303817 Aaron Power 4033370026476010 CRP IBA545287 INTERNET BANKING,"-50,000.00","80,699.59"',
      '17/03/2026,           TRANSFER            01025B475163640            AER170368I6Z0PKX SSMC JV PAYROLL ACCOUNT /REF/Salary for 25486 for 03-2026 YPI808044 OTHER SOURCE,"44,850.00","77,952.20"',
    ].join("\n")

    const parsed = parseCsvText(csv, { currencyDefault: "AED" })

    assert.strictEqual(parsed.headerRowIndex, -1)
    assert.strictEqual(parsed.rows.length, 3)
    assert.deepStrictEqual(parsed.rows[0], {
      occurredOn: "2026-04-01",
      amount: -200,
      currency: "AED",
      description:
        "TRANSFER AEV010462Y8CKTXC HIB- 68656X120242 Bellbird Solutions FZC AE250330000019100971306 OAT IBAL15687 INTERNET BANKING",
      rawPayload: {
        rowIndex: 0,
        cells: [
          "01/04/2026",
          "           TRANSFER            AEV010462Y8CKTXC            HIB- 68656X120242 Bellbird Solutions FZC AE250330000019100971306 OAT IBAL15687 INTERNET BANKING",
          "-200.00",
          "80,499.59",
        ],
      },
      parserRowIndex: 0,
    })
    assert.strictEqual(parsed.rows[1]?.occurredOn, "2026-04-01")
    assert.strictEqual(parsed.rows[2]?.occurredOn, "2026-03-17")
    assert.strictEqual(parsed.rows[2]?.amount, 44850)
  })
})
