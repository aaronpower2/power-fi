import { inArray, sql } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import type * as schema from "@/lib/db/schema"
import { budgetMonthTransactions, importedTransactions } from "@/lib/db/schema"

export type AppDb = NodePgDatabase<typeof schema>
export type AppDbTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0]
export type AppDbLike = AppDb | AppDbTx

export function periodMonthFromOccurredOn(occurredOn: string): string {
  return `${occurredOn.slice(0, 7)}-01`
}

function toLedgerRow(row: typeof importedTransactions.$inferSelect, updatedAt: Date) {
  return {
    periodMonth: periodMonthFromOccurredOn(row.occurredOn),
    occurredOn: row.occurredOn,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    direction: row.direction,
    source: "import" as const,
    importedTransactionId: row.id,
    suggestedExpenseCategoryId: row.suggestedExpenseCategoryId,
    suggestedExpenseLineId: row.suggestedExpenseLineId,
    suggestedIncomeLineId: row.suggestedIncomeLineId,
    postedExpenseRecordId:
      row.postedRecordKind === "expense" && row.postedRecordId ? row.postedRecordId : null,
    postedIncomeRecordId:
      row.postedRecordKind === "income" && row.postedRecordId ? row.postedRecordId : null,
    matchStatus: row.matchStatus,
    rawPayload: row.rawPayload,
    updatedAt,
  }
}

export async function syncLedgerFromImportedTransactions(
  db: AppDbLike,
  rows: readonly (typeof importedTransactions.$inferSelect)[],
) {
  if (rows.length === 0) return
  const updatedAt = new Date()
  await db
    .insert(budgetMonthTransactions)
    .values(rows.map((row) => toLedgerRow(row, updatedAt)))
    .onConflictDoUpdate({
      target: budgetMonthTransactions.importedTransactionId,
      set: {
        periodMonth: sql`excluded.period_month`,
        occurredOn: sql`excluded.occurred_on`,
        amount: sql`excluded.amount`,
        currency: sql`excluded.currency`,
        description: sql`excluded.description`,
        direction: sql`excluded.direction`,
        source: sql`excluded.source`,
        suggestedExpenseCategoryId: sql`excluded.suggested_expense_category_id`,
        suggestedExpenseLineId: sql`excluded.suggested_expense_line_id`,
        suggestedIncomeLineId: sql`excluded.suggested_income_line_id`,
        postedExpenseRecordId: sql`excluded.posted_expense_record_id`,
        postedIncomeRecordId: sql`excluded.posted_income_record_id`,
        matchStatus: sql`excluded.match_status`,
        rawPayload: sql`excluded.raw_payload`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
}

export async function syncLedgerFromImportedTransaction(
  db: AppDbLike,
  row: typeof importedTransactions.$inferSelect,
) {
  await syncLedgerFromImportedTransactions(db, [row])
}

export async function syncLedgerByImportedTransactionId(db: AppDbLike, importedId: string) {
  await syncLedgerByImportedTransactionIds(db, [importedId])
}

export async function syncLedgerByImportedTransactionIds(db: AppDbLike, importedIds: readonly string[]) {
  if (importedIds.length === 0) return
  const rows = await db
    .select()
    .from(importedTransactions)
    .where(inArray(importedTransactions.id, [...new Set(importedIds)]))
  await syncLedgerFromImportedTransactions(db, rows)
}
