import { eq } from "drizzle-orm"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"

import type * as schema from "@/lib/db/schema"
import { budgetMonthTransactions, importedTransactions } from "@/lib/db/schema"

export type AppDb = NodePgDatabase<typeof schema>

export function periodMonthFromOccurredOn(occurredOn: string): string {
  return `${occurredOn.slice(0, 7)}-01`
}

export async function syncLedgerFromImportedTransaction(
  db: AppDb,
  row: typeof importedTransactions.$inferSelect,
) {
  const periodMonth = periodMonthFromOccurredOn(row.occurredOn)
  const postedExpense =
    row.postedRecordKind === "expense" && row.postedRecordId ? row.postedRecordId : null
  const postedIncome =
    row.postedRecordKind === "income" && row.postedRecordId ? row.postedRecordId : null

  const existing = await db
    .select({ id: budgetMonthTransactions.id })
    .from(budgetMonthTransactions)
    .where(eq(budgetMonthTransactions.importedTransactionId, row.id))
    .limit(1)

  const base = {
    periodMonth,
    occurredOn: row.occurredOn,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    direction: row.direction,
    source: "import" as const,
    importedTransactionId: row.id,
    suggestedExpenseLineId: row.suggestedExpenseLineId,
    suggestedIncomeLineId: row.suggestedIncomeLineId,
    postedExpenseRecordId: postedExpense,
    postedIncomeRecordId: postedIncome,
    matchStatus: row.matchStatus,
    rawPayload: row.rawPayload,
    updatedAt: new Date(),
  }

  if (existing[0]) {
    await db
      .update(budgetMonthTransactions)
      .set(base)
      .where(eq(budgetMonthTransactions.id, existing[0].id))
  } else {
    await db.insert(budgetMonthTransactions).values(base)
  }
}

export async function syncLedgerByImportedTransactionId(db: AppDb, importedId: string) {
  const [row] = await db
    .select()
    .from(importedTransactions)
    .where(eq(importedTransactions.id, importedId))
    .limit(1)
  if (row) await syncLedgerFromImportedTransaction(db, row)
}
