"use server"

import { revalidatePath } from "next/cache"
import { eq, sql } from "drizzle-orm"
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
  liabilities,
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
import { dashboardRoutes } from "@/lib/routes"

function rev() {
  revalidatePath(dashboardRoutes.cashFlow)
  revalidatePath(dashboardRoutes.fiSummary)
}

function parseIssues(e: { issues: { message: string }[] }) {
  return e.issues.map((i: { message: string }) => i.message).join(" ")
}

type AppDb = NonNullable<ReturnType<typeof getDb>>
type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0]

async function reverseExpenseRecordLiability(
  tx: AppTx,
  row: {
    appliedLiabilityId?: string | null
    appliedLiabilityAmount?: string | null
  },
) {
  if (!row.appliedLiabilityId) return
  const applied = Number(row.appliedLiabilityAmount ?? 0)
  if (!Number.isFinite(applied) || applied <= 0) return
  await tx
    .update(liabilities)
    .set({
      currentBalance: sql`${liabilities.currentBalance} + ${applied.toFixed(2)}`,
      updatedAt: new Date(),
    })
    .where(eq(liabilities.id, row.appliedLiabilityId))
}

async function applyExpenseRecordLiability(
  tx: AppTx,
  expenseCategoryId: string,
  amount: number,
): Promise<{ appliedLiabilityId: string | null; appliedLiabilityAmount: string | null }> {
  const [category] = await tx
    .select({
      cashFlowType: expenseCategories.cashFlowType,
      linkedLiabilityId: expenseCategories.linkedLiabilityId,
      liabilityTrackingMode: liabilities.trackingMode,
      liabilityCurrentBalance: liabilities.currentBalance,
    })
    .from(expenseCategories)
    .leftJoin(liabilities, eq(expenseCategories.linkedLiabilityId, liabilities.id))
    .where(eq(expenseCategories.id, expenseCategoryId))

  if (!category) return { appliedLiabilityId: null, appliedLiabilityAmount: null }
  if (
    category.cashFlowType !== "debt_payment" ||
    !category.linkedLiabilityId ||
    category.liabilityTrackingMode !== "fixed_installment"
  ) {
    return { appliedLiabilityId: null, appliedLiabilityAmount: null }
  }

  const currentBalance = Number(category.liabilityCurrentBalance ?? 0)
  const applied = Math.max(0, Math.min(currentBalance, amount))
  if (applied <= 0) {
    return { appliedLiabilityId: null, appliedLiabilityAmount: null }
  }

  await tx
    .update(liabilities)
    .set({
      currentBalance: sql`GREATEST(${liabilities.currentBalance} - ${applied.toFixed(2)}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(liabilities.id, category.linkedLiabilityId))

  return {
    appliedLiabilityId: category.linkedLiabilityId,
    appliedLiabilityAmount: applied.toFixed(2),
  }
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
      cashFlowType: v.cashFlowType,
      linkedLiabilityId: v.linkedLiabilityId,
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
      cashFlowType: v.cashFlowType,
      linkedLiabilityId: v.linkedLiabilityId,
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
  await db.transaction(async (tx) => {
    const records = await tx
      .select({
        appliedLiabilityId: expenseRecords.appliedLiabilityId,
        appliedLiabilityAmount: expenseRecords.appliedLiabilityAmount,
      })
      .from(expenseRecords)
      .where(eq(expenseRecords.expenseCategoryId, id))

    for (const row of records) {
      await reverseExpenseRecordLiability(tx, row)
    }
    await tx.delete(expenseCategories).where(eq(expenseCategories.id, id))
  })
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
  const [row] = await db.transaction(async (tx) => {
    const liabilityEffect = await applyExpenseRecordLiability(tx, v.expenseCategoryId, v.amount)
    return tx
      .insert(expenseRecords)
      .values({
        expenseCategoryId: v.expenseCategoryId,
        expenseLineId: v.expenseLineId,
        appliedLiabilityId: liabilityEffect.appliedLiabilityId,
        appliedLiabilityAmount: liabilityEffect.appliedLiabilityAmount,
        amount: v.amount.toFixed(2),
        currency: v.currency,
        occurredOn: v.occurredOn,
      })
      .returning({ id: expenseRecords.id })
  })
  rev()
  return ok({ id: row.id })
}

export async function updateExpenseRecord(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateExpenseRecordSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(expenseRecords)
      .where(eq(expenseRecords.id, v.id))
    if (!existing) return
    await reverseExpenseRecordLiability(tx, existing)
    const liabilityEffect = await applyExpenseRecordLiability(
      tx,
      existing.expenseCategoryId,
      v.amount,
    )
    await tx
      .update(expenseRecords)
      .set({
        appliedLiabilityId: liabilityEffect.appliedLiabilityId,
        appliedLiabilityAmount: liabilityEffect.appliedLiabilityAmount,
        amount: v.amount.toFixed(2),
        currency: v.currency,
        occurredOn: v.occurredOn,
      })
      .where(eq(expenseRecords.id, v.id))
  })
  rev()
  return ok()
}

export async function deleteExpenseRecord(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        appliedLiabilityId: expenseRecords.appliedLiabilityId,
        appliedLiabilityAmount: expenseRecords.appliedLiabilityAmount,
      })
      .from(expenseRecords)
      .where(eq(expenseRecords.id, id))
    if (existing) await reverseExpenseRecordLiability(tx, existing)
    await tx.delete(expenseRecords).where(eq(expenseRecords.id, id))
  })
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
  const snapshotValues = [
    ...incomeRows.map((line) => {
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      return {
        periodMonth: start,
        lineKind: "income" as const,
        incomeLineId: line.id,
        expenseLineId: null,
        expenseCategoryId: null,
        currency,
        plannedAmount: amount.toFixed(2),
      }
    }),
    ...expenseCategoryRows.map((cat) => {
      const { currency, amount } = monthlyPlannedForExpenseCategory(cat)
      return {
        periodMonth: start,
        lineKind: "expense_category" as const,
        incomeLineId: null,
        expenseLineId: null,
        expenseCategoryId: cat.id,
        currency,
        plannedAmount: amount.toFixed(2),
      }
    }),
  ]

  await db.transaction(async (tx) => {
    await tx.delete(budgetMonthPlanLines).where(eq(budgetMonthPlanLines.periodMonth, start))
    if (snapshotValues.length > 0) {
      await tx.insert(budgetMonthPlanLines).values(snapshotValues)
    }
  })

  rev()
  return ok()
}
