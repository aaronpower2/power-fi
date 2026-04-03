"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { monthlyPlannedForExpenseCategory, monthlyPlannedForLine } from "@/lib/budget/planned-line"
import {
  parseYearMonthYm,
  utcMonthBoundsForCalendarMonth,
  utcMonthRangeStrings,
} from "@/lib/dates"
import { getDb } from "@/lib/db"
import {
  budgetMonthPlanLines,
  expenseCategories,
  expenseLines,
  expenseRecords,
  incomeLines,
  incomeRecords,
} from "@/lib/db/schema"
import {
  expenseCategorySchema,
  expenseLineSchema,
  expenseRecordSchema,
  incomeLineSchema,
  incomeRecordSchema,
  updateExpenseCategorySchema,
  updateExpenseLineSchema,
  updateExpenseRecordSchema,
  updateIncomeLineSchema,
  updateIncomeRecordSchema,
} from "@/lib/validations/budget"

function rev() {
  revalidatePath("/budget")
  revalidatePath("/summary")
}

function parseIssues(e: { issues: { message: string }[] }) {
  return e.issues.map((i: { message: string }) => i.message).join(" ")
}

export async function createIncomeLine(input: unknown): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = incomeLineSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  const [row] = await db
    .insert(incomeLines)
    .values({
      name: v.name,
      isRecurring: v.isRecurring,
      frequency: v.frequency,
      recurringAmount:
        v.recurringAmount != null ? v.recurringAmount.toFixed(2) : null,
      recurringCurrency: v.recurringCurrency ?? "AED",
      recurringAnchorDate: v.recurringAnchorDate ?? null,
    })
    .returning({ id: incomeLines.id })
  rev()
  return ok({ id: row.id })
}

export async function updateIncomeLine(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateIncomeLineSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  await db
    .update(incomeLines)
    .set({
      name: v.name,
      isRecurring: v.isRecurring,
      frequency: v.frequency,
      recurringAmount:
        v.recurringAmount != null ? v.recurringAmount.toFixed(2) : null,
      recurringCurrency: v.recurringCurrency ?? "AED",
      recurringAnchorDate: v.recurringAnchorDate ?? null,
    })
    .where(eq(incomeLines.id, v.id))
  rev()
  return ok()
}

export async function deleteIncomeLine(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(incomeLines).where(eq(incomeLines.id, id))
  rev()
  return ok()
}

export async function createIncomeRecord(input: unknown): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = incomeRecordSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  const [row] = await db
    .insert(incomeRecords)
    .values({
      incomeLineId: v.incomeLineId,
      amount: v.amount.toFixed(2),
      currency: v.currency,
      occurredOn: v.occurredOn,
    })
    .returning({ id: incomeRecords.id })
  rev()
  return ok({ id: row.id })
}

export async function updateIncomeRecord(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateIncomeRecordSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  await db
    .update(incomeRecords)
    .set({
      amount: v.amount.toFixed(2),
      currency: v.currency,
      occurredOn: v.occurredOn,
    })
    .where(eq(incomeRecords.id, v.id))
  rev()
  return ok()
}

export async function deleteIncomeRecord(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(incomeRecords).where(eq(incomeRecords.id, id))
  rev()
  return ok()
}

export async function createExpenseCategory(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = expenseCategorySchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  const [row] = await db
    .insert(expenseCategories)
    .values({
      name: v.name,
      sortOrder: v.sortOrder,
      isRecurring: v.isRecurring,
      frequency: v.frequency,
      recurringAmount:
        v.recurringAmount != null ? v.recurringAmount.toFixed(2) : null,
      recurringCurrency: v.recurringCurrency ?? "AED",
    })
    .returning({ id: expenseCategories.id })
  rev()
  return ok({ id: row.id })
}

export async function updateExpenseCategory(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateExpenseCategorySchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  await db
    .update(expenseCategories)
    .set({
      name: v.name,
      sortOrder: v.sortOrder,
      isRecurring: v.isRecurring,
      frequency: v.frequency,
      recurringAmount:
        v.recurringAmount != null ? v.recurringAmount.toFixed(2) : null,
      recurringCurrency: v.recurringCurrency ?? "AED",
    })
    .where(eq(expenseCategories.id, v.id))
  rev()
  return ok()
}

export async function deleteExpenseCategory(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(expenseCategories).where(eq(expenseCategories.id, id))
  rev()
  return ok()
}

export async function createExpenseLine(input: unknown): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = expenseLineSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  const [row] = await db
    .insert(expenseLines)
    .values({
      categoryId: v.categoryId,
      name: v.name,
    })
    .returning({ id: expenseLines.id })
  rev()
  return ok({ id: row.id })
}

export async function updateExpenseLine(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateExpenseLineSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  await db
    .update(expenseLines)
    .set({
      categoryId: v.categoryId,
      name: v.name,
    })
    .where(eq(expenseLines.id, v.id))
  rev()
  return ok()
}

export async function deleteExpenseLine(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(expenseLines).where(eq(expenseLines.id, id))
  rev()
  return ok()
}

export async function createExpenseRecord(input: unknown): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = expenseRecordSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  const [row] = await db
    .insert(expenseRecords)
    .values({
      expenseCategoryId: v.expenseCategoryId,
      expenseLineId: v.expenseLineId,
      amount: v.amount.toFixed(2),
      currency: v.currency,
      occurredOn: v.occurredOn,
    })
    .returning({ id: expenseRecords.id })
  rev()
  return ok({ id: row.id })
}

export async function updateExpenseRecord(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateExpenseRecordSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  await db
    .update(expenseRecords)
    .set({
      amount: v.amount.toFixed(2),
      currency: v.currency,
      occurredOn: v.occurredOn,
    })
    .where(eq(expenseRecords.id, v.id))
  rev()
  return ok()
}

export async function deleteExpenseRecord(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(expenseRecords).where(eq(expenseRecords.id, id))
  rev()
  return ok()
}

const finalizeYmSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Use YYYY-MM")

/**
 * Lock planned amounts for a closed UTC month from current line definitions (replaces any prior snapshot).
 */
export async function finalizeBudgetMonth(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsedYm = finalizeYmSchema.safeParse(input)
  if (!parsedYm.success) return err("Use YYYY-MM for the month to finalize.")
  const parts = parseYearMonthYm(parsedYm.data)
  if (!parts) return err("Invalid month.")

  const { start } = utcMonthBoundsForCalendarMonth(parts.year, parts.monthIndex0)
  const currentStart = utcMonthRangeStrings(new Date()).start
  if (start >= currentStart) {
    return err("Only months before the current UTC month can be finalized.")
  }

  const incomeRows = await db.select().from(incomeLines)
  const expenseCategoryRows = await db.select().from(expenseCategories)
  const { end } = utcMonthBoundsForCalendarMonth(parts.year, parts.monthIndex0)

  await db.transaction(async (tx) => {
    await tx.delete(budgetMonthPlanLines).where(eq(budgetMonthPlanLines.periodMonth, start))

    for (const line of incomeRows) {
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      await tx.insert(budgetMonthPlanLines).values({
        periodMonth: start,
        lineKind: "income",
        incomeLineId: line.id,
        expenseLineId: null,
        expenseCategoryId: null,
        currency,
        plannedAmount: amount.toFixed(2),
      })
    }

    for (const cat of expenseCategoryRows) {
      const { currency, amount } = monthlyPlannedForExpenseCategory(cat)
      await tx.insert(budgetMonthPlanLines).values({
        periodMonth: start,
        lineKind: "expense_category",
        incomeLineId: null,
        expenseLineId: null,
        expenseCategoryId: cat.id,
        currency,
        plannedAmount: amount.toFixed(2),
      })
    }
  })

  rev()
  return ok()
}
