"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { getDb } from "@/lib/db"
import { goalLifestyleLines, goals } from "@/lib/db/schema"
import {
  createGoalSchema,
  sumLifestyleMonthly,
  updateGoalSchema,
} from "@/lib/validations/goal"

function revalidateGoalViews() {
  revalidatePath("/goal")
  revalidatePath("/summary")
}

export async function createGoal(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  const parsed = createGoalSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(" "))
  }
  const v = parsed.data
  const withdrawalRate = (v.withdrawalRatePercent / 100).toFixed(6)
  const total = sumLifestyleMonthly(v.lifestyleLines)

  if (v.makeActive) {
    await db.update(goals).set({ isActive: false })
  }

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(goals)
      .values({
        fiDate: v.fiDate,
        withdrawalRate,
        monthlyFundingRequirement: total.toFixed(2),
        currency: v.currency,
        isActive: v.makeActive,
        updatedAt: new Date(),
      })
      .returning({ id: goals.id })

    await tx.insert(goalLifestyleLines).values(
      v.lifestyleLines.map((line, i) => ({
        goalId: row.id,
        name: line.name,
        monthlyAmount: line.monthlyAmount.toFixed(2),
        sortOrder: i,
      })),
    )

    return row.id
  })

  revalidateGoalViews()
  return ok({ id })
}

export async function updateGoal(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  const parsed = updateGoalSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => i.message).join(" "))
  }
  const v = parsed.data
  const withdrawalRate = (v.withdrawalRatePercent / 100).toFixed(6)
  const total = sumLifestyleMonthly(v.lifestyleLines)

  await db.transaction(async (tx) => {
    await tx.delete(goalLifestyleLines).where(eq(goalLifestyleLines.goalId, v.id))

    await tx.insert(goalLifestyleLines).values(
      v.lifestyleLines.map((line, i) => ({
        goalId: v.id,
        name: line.name,
        monthlyAmount: line.monthlyAmount.toFixed(2),
        sortOrder: i,
      })),
    )

    await tx
      .update(goals)
      .set({
        fiDate: v.fiDate,
        withdrawalRate,
        monthlyFundingRequirement: total.toFixed(2),
        currency: v.currency,
        updatedAt: new Date(),
      })
      .where(eq(goals.id, v.id))
  })

  revalidateGoalViews()
  return ok()
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  if (!zodUuid(id)) return err("Invalid goal id.")
  await db.delete(goals).where(eq(goals.id, id))
  revalidateGoalViews()
  return ok()
}

export async function setActiveGoal(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  if (!zodUuid(id)) return err("Invalid goal id.")
  await db.update(goals).set({ isActive: false })
  await db
    .update(goals)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(goals.id, id))

  revalidateGoalViews()
  return ok()
}

function zodUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  )
}
