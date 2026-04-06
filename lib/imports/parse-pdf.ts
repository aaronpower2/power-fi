import type { NormalizedImportRow } from "@/lib/imports/types"
import { parseMoneyString } from "@/lib/imports/parse-money"

const DATE_RE =
  /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})/

function normalizeDate(m: string): string | null {
  const iso = m.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const dmy = m.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (!dmy) return null
  let y = Number(dmy[3])
  if (y < 100) y += 2000
  const a = Number(dmy[1])
  const b = Number(dmy[2])
  let mo = a
  let da = b
  if (a > 12) {
    mo = b
    da = a
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`
}

function extractDate(line: string): string | null {
  const m = line.match(DATE_RE)
  if (!m) return null
  return normalizeDate(m[1])
}

function buildDescription(line: string, dateStr: string | null, amountPart: string | null): string {
  let s = line
  if (dateStr) {
    s = s.replace(DATE_RE, " ")
  }
  if (amountPart) {
    const idx = s.lastIndexOf(amountPart)
    if (idx >= 0) s = s.slice(0, idx)
  }
  return s.replace(/\s+/g, " ").trim() || "(no description)"
}

export type ParsePdfOptions = {
  /** ISO 4217; defaults to AED when omitted (caller should pass goal/env default). */
  currency?: string
}

/**
 * Best-effort line parser for text-based bank PDFs. Scanned PDFs are not supported in v1.
 */
export async function parsePdfTransactions(
  buffer: Buffer,
  opts: ParsePdfOptions = {},
): Promise<NormalizedImportRow[]> {
  const currency = (opts.currency ?? "AED").toUpperCase().slice(0, 3)
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  let text = ""
  try {
    const result = await parser.getText()
    text = result.text ?? ""
  } finally {
    await parser.destroy().catch(() => {})
  }

  const lines = text.split(/\r?\n/)
  const out: NormalizedImportRow[] = []
  let idx = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length < 6) continue
    const dateStr = extractDate(trimmed)
    const amountMatch = trimmed.match(/([+\-]?\(?[\d,.\s]+\)?)\s*$/)
    const amountStr = amountMatch ? amountMatch[1] : null
    let amount = amountStr ? parseMoneyString(amountStr.replace(/[()]/g, "")) : null
    if (amount == null) {
      const tail = trimmed.match(/([+\-]?\(?[\d,.\s]+\)?)\s*$/)
      if (tail) amount = parseMoneyString(tail[1].replace(/[()]/g, ""))
    }
    if (!dateStr || amount == null || amount === 0) continue
    const description = buildDescription(trimmed, dateStr, amountStr)
    if (description.length < 2) continue
    out.push({
      occurredOn: dateStr,
      amount,
      currency,
      description,
      rawPayload: { source: "pdf_text_line", line: trimmed.slice(0, 500) },
      parserRowIndex: idx++,
    })
  }

  if (out.length === 0) {
    throw new Error(
      "No transactions parsed from PDF. Text-based statements work best; scanned PDFs are not supported yet.",
    )
  }

  return out
}
