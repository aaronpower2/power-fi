import { desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { goals } from "@/lib/db/schema"

/**
 * Currency for parsed statement rows when the file has no per-row currency.
 * Active goal currency first, then DEFAULT_IMPORT_CURRENCY env, then AED.
 */
export async function getDefaultStatementCurrency(): Promise<string> {
  const db = getDb()
  if (db) {
    const [activeGoal] = await db
      .select({ currency: goals.currency })
      .from(goals)
      .where(eq(goals.isActive, true))
      .orderBy(desc(goals.updatedAt))
      .limit(1)
    if (activeGoal?.currency) return activeGoal.currency.toUpperCase().slice(0, 3)
  }

  const env = process.env.DEFAULT_IMPORT_CURRENCY?.trim().toUpperCase()
  if (env && env.length === 3) return env

  return "AED"
}
