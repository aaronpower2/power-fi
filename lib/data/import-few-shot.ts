import { and, eq, isNotNull } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  expenseCategories,
  expenseLines,
  importedTransactions,
  incomeLines,
} from "@/lib/db/schema"

export type ImportFewShotExample = {
  description_snippet: string
  line_id: string
  line_kind: "expense" | "income"
  line_label: string
}

/** Normalize bank description for grouping similar strings. */
export function normalizeImportDescriptionForFewShot(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 100)
}

function fewShotLimit(): number {
  const raw = process.env.IMPORT_FEW_SHOT_LIMIT?.trim()
  const n = raw ? Number.parseInt(raw, 10) : 24
  if (!Number.isFinite(n) || n < 1) return 24
  return Math.min(n, 80)
}

/**
 * Posted import rows aggregated by normalized description + line → top examples for the matcher prompt.
 */
export async function loadImportFewShotExamples(): Promise<ImportFewShotExample[]> {
  const db = getDb()
  if (!db) return []

  const rows = await db
    .select({
      description: importedTransactions.description,
      postedRecordKind: importedTransactions.postedRecordKind,
      expenseLineId: importedTransactions.suggestedExpenseLineId,
      incomeLineId: importedTransactions.suggestedIncomeLineId,
      expenseLineName: expenseLines.name,
      expenseCatName: expenseCategories.name,
      incomeLineName: incomeLines.name,
    })
    .from(importedTransactions)
    .leftJoin(expenseLines, eq(importedTransactions.suggestedExpenseLineId, expenseLines.id))
    .leftJoin(expenseCategories, eq(expenseLines.categoryId, expenseCategories.id))
    .leftJoin(incomeLines, eq(importedTransactions.suggestedIncomeLineId, incomeLines.id))
    .where(
      and(
        eq(importedTransactions.matchStatus, "posted"),
        isNotNull(importedTransactions.postedRecordId),
      ),
    )

  type Agg = {
    count: number
    line_id: string
    line_kind: "expense" | "income"
    line_label: string
    example_snippet: string
  }

  const byKey = new Map<string, Agg>()

  for (const r of rows) {
    const kind = r.postedRecordKind
    if (kind !== "expense" && kind !== "income") continue

    const lineId =
      kind === "expense" ? r.expenseLineId : r.incomeLineId
    if (!lineId) continue

    const norm = normalizeImportDescriptionForFewShot(r.description)
    if (!norm) continue

    const lineLabel =
      kind === "expense"
        ? r.expenseLineName && r.expenseCatName
          ? `${r.expenseCatName} — ${r.expenseLineName}`
          : (r.expenseLineName ?? lineId)
        : (r.incomeLineName ?? lineId)

    const key = `${norm}|${lineId}|${kind}`
    const existing = byKey.get(key)
    const snippet = r.description.trim().slice(0, 120)
    if (existing) {
      existing.count += 1
      if (snippet.length > existing.example_snippet.length) {
        existing.example_snippet = snippet
      }
    } else {
      byKey.set(key, {
        count: 1,
        line_id: lineId,
        line_kind: kind,
        line_label: lineLabel,
        example_snippet: snippet,
      })
    }
  }

  const limit = fewShotLimit()
  const sorted = [...byKey.values()].sort((a, b) => b.count - a.count)

  return sorted.slice(0, limit).map((a) => ({
    description_snippet: a.example_snippet,
    line_id: a.line_id,
    line_kind: a.line_kind,
    line_label: a.line_label.slice(0, 200),
  }))
}
