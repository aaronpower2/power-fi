import { and, eq, isNotNull } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  expenseCategories,
  importedTransactions,
  incomeLines,
} from "@/lib/db/schema"

export type ImportFewShotExample = {
  description_snippet: string
  target_id: string
  target_kind: "expense_category" | "income_line"
  target_label: string
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
 * Posted import rows aggregated by normalized description + category/line → top examples for the matcher prompt.
 */
export async function loadImportFewShotExamples(): Promise<ImportFewShotExample[]> {
  const db = getDb()
  if (!db) return []

  const rows = await db
    .select({
      description: importedTransactions.description,
      postedRecordKind: importedTransactions.postedRecordKind,
      expenseCategoryId: importedTransactions.suggestedExpenseCategoryId,
      incomeLineId: importedTransactions.suggestedIncomeLineId,
      expenseCategoryName: expenseCategories.name,
      incomeLineName: incomeLines.name,
    })
    .from(importedTransactions)
    .leftJoin(expenseCategories, eq(importedTransactions.suggestedExpenseCategoryId, expenseCategories.id))
    .leftJoin(incomeLines, eq(importedTransactions.suggestedIncomeLineId, incomeLines.id))
    .where(
      and(
        eq(importedTransactions.matchStatus, "posted"),
        isNotNull(importedTransactions.postedRecordId),
      ),
    )

  type Agg = {
    count: number
    target_id: string
    target_kind: "expense_category" | "income_line"
    target_label: string
    example_snippet: string
  }

  const byKey = new Map<string, Agg>()

  for (const r of rows) {
    const kind = r.postedRecordKind
    if (kind !== "expense" && kind !== "income") continue

    const targetId = kind === "expense" ? r.expenseCategoryId : r.incomeLineId
    if (!targetId) continue

    const norm = normalizeImportDescriptionForFewShot(r.description)
    if (!norm) continue

    const targetLabel =
      kind === "expense"
        ? (r.expenseCategoryName ?? targetId)
        : (r.incomeLineName ?? targetId)

    const targetKind = kind === "expense" ? "expense_category" : "income_line"
    const key = `${norm}|${targetId}|${targetKind}`
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
        target_id: targetId,
        target_kind: targetKind,
        target_label: targetLabel,
        example_snippet: snippet,
      })
    }
  }

  const limit = fewShotLimit()
  const sorted = [...byKey.values()].sort((a, b) => b.count - a.count)

  return sorted.slice(0, limit).map((a) => ({
    description_snippet: a.example_snippet,
    target_id: a.target_id,
    target_kind: a.target_kind,
    target_label: a.target_label.slice(0, 200),
  }))
}
