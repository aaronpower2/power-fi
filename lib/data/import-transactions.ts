import { desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  importedTransactions,
  transactionImportBatches,
  transactionImportFiles,
} from "@/lib/db/schema"

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

export async function getImportBatchDetail(batchId: string) {
  const db = getDb()
  if (!db) return null

  try {
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

    const txns = await db
      .select()
      .from(importedTransactions)
      .where(eq(importedTransactions.batchId, batchId))

    const fileMap = Object.fromEntries(files.map((f) => [f.id, f]))

    return {
      batch,
      files,
      transactions: txns.map((t) => ({
        ...t,
        file: fileMap[t.fileId] ?? null,
      })),
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
