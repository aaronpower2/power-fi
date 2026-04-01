import { asc, desc, inArray } from "drizzle-orm"

import { getDb } from "@/lib/db"
import { goalLifestyleLines, goals } from "@/lib/db/schema"

export type GoalWithLifestyle = {
  goal: typeof goals.$inferSelect
  lifestyleLines: (typeof goalLifestyleLines.$inferSelect)[]
}

export async function listGoalsWithLifestyle(): Promise<GoalWithLifestyle[]> {
  const db = getDb()
  if (!db) return []

  const goalRows = await db
    .select()
    .from(goals)
    .orderBy(desc(goals.isActive), desc(goals.updatedAt))

  if (goalRows.length === 0) return []

  const ids = goalRows.map((g) => g.id)
  const lineRows = await db
    .select()
    .from(goalLifestyleLines)
    .where(inArray(goalLifestyleLines.goalId, ids))
    .orderBy(asc(goalLifestyleLines.sortOrder), asc(goalLifestyleLines.name))

  const byGoal = new Map<string, (typeof goalLifestyleLines.$inferSelect)[]>()
  for (const row of lineRows) {
    const list = byGoal.get(row.goalId) ?? []
    list.push(row)
    byGoal.set(row.goalId, list)
  }

  return goalRows.map((goal) => ({
    goal,
    lifestyleLines: byGoal.get(goal.id) ?? [],
  }))
}
