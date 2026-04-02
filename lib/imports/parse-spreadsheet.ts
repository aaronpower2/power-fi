import * as XLSX from "xlsx"

import type { NormalizedImportRow } from "@/lib/imports/types"
import { parseMoneyString } from "@/lib/imports/parse-money"

const DATE_KEYS = /^(date|transaction\s*date|posted|value\s*date|booking\s*date|tran\s*date)$/i
const AMOUNT_KEYS = /^(amount|transaction\s*amount|debit|credit|withdrawal|deposit|value)$/i
const DESC_KEYS = /^(description|details|merchant|payee|narrative|memo|note|transaction\s*details)$/i

function normHeader(cell: unknown): string {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

function scoreHeader(h: string): { date: number; amount: number; desc: number; debit: number; credit: number } {
  const n = normHeader(h)
  return {
    date: DATE_KEYS.test(n) ? 10 : n.includes("date") ? 5 : 0,
    amount: AMOUNT_KEYS.test(n) && !n.includes("balance") ? 10 : n.includes("amount") ? 5 : 0,
    desc: DESC_KEYS.test(n) ? 10 : n.includes("desc") || n.includes("merchant") ? 5 : 0,
    debit: /^debit$/i.test(n) ? 10 : n.includes("debit") ? 5 : 0,
    credit: /^credit$/i.test(n) ? 10 : n.includes("credit") ? 5 : 0,
  }
}

export type ColumnMapping = {
  dateCol: number
  amountCol: number | null
  debitCol: number | null
  creditCol: number | null
  descCol: number
}

export function detectColumnMapping(headerRow: unknown[]): ColumnMapping | null {
  const scores = headerRow.map((cell, i) => ({ i, s: scoreHeader(String(cell ?? "")) }))
  const dateCol = scores.reduce((a, b) => (b.s.date > a.s.date ? b : a))
  const descCol = scores.reduce((a, b) => (b.s.desc > a.s.desc ? b : a))
  const debitCol = scores.find((x) => x.s.debit >= 5) ?? null
  const creditCol = scores.find((x) => x.s.credit >= 5) ?? null
  const amountColEntry = scores.reduce((a, b) => (b.s.amount > a.s.amount ? b : a))

  if (dateCol.s.date < 3) return null
  if (descCol.s.desc < 3 && amountColEntry.s.amount < 3) return null

  const hasSplit = debitCol && creditCol && debitCol.i !== creditCol.i
  return {
    dateCol: dateCol.i,
    amountCol: hasSplit ? null : amountColEntry.s.amount >= 3 ? amountColEntry.i : null,
    debitCol: hasSplit ? debitCol.i : null,
    creditCol: hasSplit ? creditCol.i : null,
    descCol: descCol.s.desc >= 3 ? descCol.i : Math.max(0, Math.min(headerRow.length - 1, dateCol.i + 1)),
  }
}

function parseExcelDate(n: number): string | null {
  if (typeof n !== "number" || Number.isNaN(n)) return null
  const utc = XLSX.SSF.parse_date_code(n)
  if (!utc) return null
  const y = utc.y
  const m = String(utc.m).padStart(2, "0")
  const d = String(utc.d).padStart(2, "0")
  if (y < 1900 || y > 2100) return null
  return `${y}-${m}-${d}`
}

function parseDateCell(v: unknown): string | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return parseExcelDate(v)
  const s = String(v).trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (dmy) {
    let y = Number(dmy[3])
    if (y < 100) y += 2000
    const mo = String(Number(dmy[1])).padStart(2, "0")
    const da = String(Number(dmy[2])).padStart(2, "0")
    if (Number(mo) > 12) {
      const mo2 = String(Number(dmy[2])).padStart(2, "0")
      const da2 = String(Number(dmy[1])).padStart(2, "0")
      return `${y}-${mo2}-${da2}`
    }
    return `${y}-${mo}-${da}`
  }
  const t = Date.parse(s)
  if (!Number.isNaN(t)) {
    const d = new Date(t)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }
  return null
}

function rowsFromSheet(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][]
}

function parseRowsWithMapping(
  rows: unknown[][],
  map: ColumnMapping,
  currencyDefault: string,
): NormalizedImportRow[] {
  const out: NormalizedImportRow[] = []
  let idx = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length === 0) continue
    const dateRaw = row[map.dateCol]
    const occurredOn = parseDateCell(dateRaw)
    if (!occurredOn) continue

    let amount = 0
    if (map.amountCol != null) {
      const cell = row[map.amountCol]
      const parsed =
        typeof cell === "number" && !Number.isNaN(cell)
          ? cell
          : parseMoneyString(String(cell ?? ""))
      if (parsed == null) continue
      amount = parsed
    } else if (map.debitCol != null && map.creditCol != null) {
      const debitRaw = row[map.debitCol]
      const creditRaw = row[map.creditCol]
      const debit =
        typeof debitRaw === "number" && debitRaw !== 0
          ? debitRaw
          : parseMoneyString(String(debitRaw ?? "")) ?? 0
      const credit =
        typeof creditRaw === "number" && creditRaw !== 0
          ? creditRaw
          : parseMoneyString(String(creditRaw ?? "")) ?? 0
      if (debit && credit) {
        amount = Math.abs(debit) >= Math.abs(credit) ? debit : -credit
      } else if (debit) {
        amount = debit
      } else if (credit) {
        amount = -credit
      } else {
        continue
      }
    } else {
      continue
    }

    if (amount === 0) continue

    const descCell = row[map.descCol]
    const description = String(descCell ?? "").trim() || "(no description)"
    out.push({
      occurredOn,
      amount,
      currency: currencyDefault,
      description,
      rawPayload: { rowIndex: r, cells: row.map((c) => String(c ?? "")) },
      parserRowIndex: idx++,
    })
  }
  return out
}

function findHeaderRowIndex(rows: unknown[][]): number {
  let best = -1
  let bestScore = -1
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i]
    if (!row) continue
    const map = detectColumnMapping(row)
    if (!map) continue
    const s =
      (row[map.dateCol] != null && String(row[map.dateCol]).trim() !== "" ? 1 : 0) +
      (map.amountCol != null || (map.debitCol != null && map.creditCol != null) ? 1 : 0)
    if (s > bestScore) {
      bestScore = s
      best = i
    }
  }
  return best
}

function parseFirstSheetFromWorkbook(
  wb: XLSX.WorkBook,
  currencyDefault: string,
  sheetIndex = 0,
): { rows: NormalizedImportRow[]; mapping: ColumnMapping; headerRowIndex: number } {
  const name = wb.SheetNames[sheetIndex]
  if (!name) {
    throw new Error("Workbook has no sheets")
  }
  const sheet = wb.Sheets[name]
  const rows = rowsFromSheet(sheet)
  if (rows.length === 0) {
    throw new Error("Spreadsheet has no rows")
  }
  const headerRowIndex = findHeaderRowIndex(rows)
  if (headerRowIndex < 0) {
    throw new Error(
      "Could not find a header row with Date / Amount (or Debit+Credit) / Description columns.",
    )
  }
  const headerRow = rows[headerRowIndex]
  const map = detectColumnMapping(headerRow)
  if (!map) {
    throw new Error(
      "Could not detect date/amount/description columns. Try exporting CSV with standard headers (Date, Amount, Description).",
    )
  }
  const dataRows = rows.slice(headerRowIndex + 1)
  const parsed = parseRowsWithMapping(dataRows, map, currencyDefault)
  return { rows: parsed, mapping: map, headerRowIndex }
}

export function parseSpreadsheetBuffer(
  buffer: Buffer,
  opts: { currencyDefault?: string; sheetIndex?: number } = {},
): { rows: NormalizedImportRow[]; mapping: ColumnMapping; headerRowIndex: number } {
  const currencyDefault = opts.currencyDefault ?? "AED"
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true })
  return parseFirstSheetFromWorkbook(wb, currencyDefault, opts.sheetIndex ?? 0)
}

export function parseCsvText(
  text: string,
  opts: { currencyDefault?: string } = {},
): { rows: NormalizedImportRow[]; mapping: ColumnMapping; headerRowIndex: number } {
  const currencyDefault = opts.currencyDefault ?? "AED"
  const wb = XLSX.read(text, { type: "string", raw: true })
  return parseFirstSheetFromWorkbook(wb, currencyDefault, 0)
}
