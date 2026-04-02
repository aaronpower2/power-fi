/** One logical row after parsing (before DB insert). */
export type NormalizedImportRow = {
  occurredOn: string
  /** Signed: negative = inflow on typical card statements. */
  amount: number
  currency: string
  description: string
  rawPayload: Record<string, unknown>
  parserRowIndex: number
}

export type ParserKind = "pdf_text" | "xlsx" | "csv" | "unknown"
