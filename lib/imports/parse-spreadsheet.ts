import * as XLSX from "xlsx"

import type { NormalizedImportRow } from "@/lib/imports/types"
import { parseMoneyString } from "@/lib/imports/parse-money"

const DATE_KEYS = /^(date|transaction\s*date|posted|value\s*date|booking\s*date|tran\s*date)$/i
const AMOUNT_KEYS = /^(amount|transaction\s*amount|debit|credit|withdrawal|deposit|value)$/i
const DESC_KEYS = /^(description|details|merchant|payee|narrative|memo|note|transaction\s*details)$/i
const AMOUNT_OUT_KEYS = /^(amount\s*out|money\s*out|debit|withdrawal)$/i
const AMOUNT_IN_KEYS = /^(amount\s*in|money\s*in|credit|deposit)$/i

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
    debit: AMOUNT_OUT_KEYS.test(n) ? 10 : n.includes("debit") || n.includes("amount out") ? 5 : 0,
    credit: AMOUNT_IN_KEYS.test(n) ? 10 : n.includes("credit") || n.includes("amount in") ? 5 : 0,
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

function parseDayFirstDateCell(v: unknown): string | null {
  if (v == null || v === "") return null
  if (typeof v === "number") return parseExcelDate(v)
  const s = String(v).trim()
  if (!s) return null
  const dmy = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (!dmy) return null
  let y = Number(dmy[3])
  if (y < 100) y += 2000
  const mo = String(Number(dmy[2])).padStart(2, "0")
  const da = String(Number(dmy[1])).padStart(2, "0")
  return `${y}-${mo}-${da}`
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
  opts: { parseDate?: (value: unknown) => string | null } = {},
): NormalizedImportRow[] {
  const parseDate = opts.parseDate ?? parseDateCell
  const out: NormalizedImportRow[] = []
  let idx = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length === 0) continue
    const dateRaw = row[map.dateCol]
    const occurredOn = parseDate(dateRaw)
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
          ? Math.abs(debitRaw)
          : Math.abs(parseMoneyString(String(debitRaw ?? "")) ?? 0)
      const credit =
        typeof creditRaw === "number" && creditRaw !== 0
          ? Math.abs(creditRaw)
          : Math.abs(parseMoneyString(String(creditRaw ?? "")) ?? 0)
      if (debit && credit) {
        amount = debit >= credit ? debit : credit
      } else if (debit) {
        amount = debit
      } else if (credit) {
        amount = credit
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

function detectHeaderlessBankCsvShape(rows: unknown[][]): {
  amountCol: number
  balanceCol: number
} | null {
  let matched = 0
  let detected: { amountCol: number; balanceCol: number } | null = null

  for (const row of rows.slice(0, 10)) {
    if (!row || row.length < 4) continue
    if (!parseDayFirstDateCell(row[0])) continue

    let balanceCol = -1
    let amountCol = -1
    for (let i = row.length - 1; i >= 1; i--) {
      const parsed = parseMoneyString(String(row[i] ?? ""))
      if (parsed == null) continue
      if (balanceCol < 0) {
        balanceCol = i
        continue
      }
      amountCol = i
      break
    }

    if (amountCol <= 0 || balanceCol <= amountCol) continue
    matched++
    if (!detected) detected = { amountCol, balanceCol }
  }

  return matched >= 2 ? detected : null
}

function parseHeaderlessBankCsvRows(
  rows: unknown[][],
  currencyDefault: string,
): { rows: NormalizedImportRow[]; mapping: ColumnMapping; headerRowIndex: number } | null {
  const detected = detectHeaderlessBankCsvShape(rows)
  if (!detected) return null

  const out: NormalizedImportRow[] = []
  let idx = 0
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length <= detected.amountCol) continue
    const occurredOn = parseDayFirstDateCell(row[0])
    if (!occurredOn) continue
    const amount = parseMoneyString(String(row[detected.amountCol] ?? ""))
    if (amount == null || amount === 0) continue

    const description = row
      .slice(1, detected.amountCol)
      .map((cell) => String(cell ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")

    out.push({
      occurredOn,
      amount,
      currency: currencyDefault,
      description: description || "(no description)",
      rawPayload: { rowIndex: r, cells: row.map((c) => String(c ?? "")) },
      parserRowIndex: idx++,
    })
  }

  return {
    rows: out,
    mapping: {
      dateCol: 0,
      amountCol: detected.amountCol,
      debitCol: null,
      creditCol: null,
      descCol: 1,
    },
    headerRowIndex: -1,
  }
}

function isDayFirstBankHeaderRow(headerRow: unknown[]): boolean {
  const normalized = headerRow.map((cell) => normHeader(cell))
  return normalized.includes("date") &&
    normalized.includes("description") &&
    normalized.includes("amount in") &&
    normalized.includes("amount out")
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
  const parsed = parseRowsWithMapping(dataRows, map, currencyDefault, {
    parseDate: isDayFirstBankHeaderRow(headerRow) ? parseDayFirstDateCell : parseDateCell,
  })
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
  try {
    return parseFirstSheetFromWorkbook(wb, currencyDefault, 0)
  } catch (error) {
    const name = wb.SheetNames[0]
    if (!name) throw error
    const sheet = wb.Sheets[name]
    const rows = rowsFromSheet(sheet)
    const fallback = parseHeaderlessBankCsvRows(rows, currencyDefault)
    if (fallback) return fallback
    throw error
  }
}
