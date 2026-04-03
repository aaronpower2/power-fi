import { and, asc, desc, eq, sql } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  importedTransactions,
  transactionImportBatches,
  transactionImportFiles,
} from "@/lib/db/schema"

export type ImportBatchFilterKey =
  | "all"
  | "pending"
  | "suggested_line"
  | "needs_new_line"
  | "posted"
  | "rejected"

export async function listRecentImportBatches(limit = 20) {
  const db = getDb()
  if (!db) return []
  try {
    return await db
      .select()
      .from(transactionImportBatches)
      .orderBy(desc(transactionImportBatches.createdAt))
      .limit(limit)
  } catch (e) {
    console.warn(
      "[import] listRecentImportBatches failed (run migrations if tables are missing):",
      e instanceof Error ? e.message : e,
    )
    return []
  }
}

export async function getImportBatchDetail(
  batchId: string,
  opts?: {
    filter?: ImportBatchFilterKey
    limit?: number
    offset?: number
  },
) {
  const db = getDb()
  if (!db) return null

  try {
    const filter = opts?.filter ?? "all"
    const limit = Math.max(1, Math.min(250, opts?.limit ?? 100))
    const offset = Math.max(0, opts?.offset ?? 0)

    const [batch] = await db
      .select()
      .from(transactionImportBatches)
      .where(eq(transactionImportBatches.id, batchId))
      .limit(1)
    if (!batch) return null

    const files = await db
      .select()
      .from(transactionImportFiles)
      .where(eq(transactionImportFiles.batchId, batchId))
      .orderBy(asc(transactionImportFiles.createdAt))

    const txnWhere =
      filter === "all"
        ? eq(importedTransactions.batchId, batchId)
        : and(
            eq(importedTransactions.batchId, batchId),
            eq(importedTransactions.matchStatus, filter),
          )

    const txns = await db
      .select()
      .from(importedTransactions)
      .where(txnWhere)
      .orderBy(asc(importedTransactions.occurredOn), asc(importedTransactions.id))
      .limit(limit)
      .offset(offset)

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(importedTransactions)
      .where(txnWhere)

    const statusCountRows = await db
      .select({
        matchStatus: importedTransactions.matchStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(importedTransactions)
      .where(eq(importedTransactions.batchId, batchId))
      .groupBy(importedTransactions.matchStatus)

    const fileMap = Object.fromEntries(files.map((f) => [f.id, f]))
    const statusCounts: Record<ImportBatchFilterKey, number> = {
      all: 0,
      pending: 0,
      suggested_line: 0,
      needs_new_line: 0,
      posted: 0,
      rejected: 0,
    }
    for (const row of statusCountRows) {
      if (row.matchStatus in statusCounts) {
        statusCounts[row.matchStatus as ImportBatchFilterKey] = Number(row.count ?? 0)
      }
    }
    statusCounts.all = Object.values(statusCounts).reduce((sum, value) => sum + value, 0)
    const total = Number(countRow?.count ?? 0)

    return {
      batch,
      files,
      transactions: txns.map((t) => ({
        ...t,
        file: fileMap[t.fileId] ?? null,
      })),
      statusCounts,
      page: {
        filter,
        limit,
        offset,
        total,
        hasMore: offset + txns.length < total,
      },
    }
  } catch (e) {
    console.warn(
      "[import] getImportBatchDetail failed (run migrations if tables are missing):",
      e instanceof Error ? e.message : e,
    )
    return null
  }
}

export type ImportBatchDetail = NonNullable<Awaited<ReturnType<typeof getImportBatchDetail>>>
