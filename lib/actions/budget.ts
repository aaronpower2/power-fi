"use server"

import { revalidatePath } from "next/cache"
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { z } from "zod"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { INTERNAL_DEBT_CATEGORY_NAME, isInternalDebtCategoryName } from "@/lib/budget/debt-payment"
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

function defaultOccurredOnForMonth(monthStart: string, monthEnd: string): string {
  const today = new Date().toISOString().slice(0, 10)
  if (today >= monthStart && today <= monthEnd) return today
  return monthEnd
}

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

async function ensureInternalDebtCategory(tx: AppTx): Promise<string> {
  const [existing] = await tx
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(eq(expenseCategories.name, INTERNAL_DEBT_CATEGORY_NAME))
    .limit(1)
  if (existing) return existing.id
  const [created] = await tx
    .insert(expenseCategories)
    .values({
      name: INTERNAL_DEBT_CATEGORY_NAME,
      sortOrder: 999999,
      cashFlowType: "expense",
      linkedLiabilityId: null,
      isRecurring: false,
      frequency: null,
      recurringAmount: null,
      recurringCurrency: "USD",
    })
    .returning({ id: expenseCategories.id })
  return created.id
}

async function resolveExpenseRecordCategoryId(
  tx: AppTx,
  input: { expenseCategoryId: string; expenseLineId?: string | null; linkedLiabilityId?: string | null },
): Promise<string> {
  if (input.linkedLiabilityId) {
    return ensureInternalDebtCategory(tx)
  }
  if (!input.expenseLineId) return input.expenseCategoryId
  const [line] = await tx
    .select({ categoryId: expenseLines.categoryId })
    .from(expenseLines)
    .where(eq(expenseLines.id, input.expenseLineId))
    .limit(1)
  return line?.categoryId ?? input.expenseCategoryId
}

async function applyExpenseRecordLiability(
  tx: AppTx,
  input: {
    expenseCategoryId: string
    expenseLineId?: string | null
    amount: number
  },
): Promise<{ appliedLiabilityId: string | null; appliedLiabilityAmount: string | null }> {
  if (input.expenseLineId) {
    const [line] = await tx
      .select({
        linkedLiabilityId: expenseLines.linkedLiabilityId,
        liabilityTrackingMode: liabilities.trackingMode,
        liabilityCurrentBalance: liabilities.currentBalance,
      })
      .from(expenseLines)
      .leftJoin(liabilities, eq(expenseLines.linkedLiabilityId, liabilities.id))
      .where(eq(expenseLines.id, input.expenseLineId))
      .limit(1)

    if (
      line?.linkedLiabilityId &&
      line.liabilityTrackingMode === "fixed_installment"
    ) {
      const currentBalance = Number(line.liabilityCurrentBalance ?? 0)
      const applied = Math.max(0, Math.min(currentBalance, input.amount))
      if (applied <= 0) {
        return { appliedLiabilityId: null, appliedLiabilityAmount: null }
      }

      await tx
        .update(liabilities)
        .set({
          currentBalance: sql`GREATEST(${liabilities.currentBalance} - ${applied.toFixed(2)}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(liabilities.id, line.linkedLiabilityId))

      return {
        appliedLiabilityId: line.linkedLiabilityId,
        appliedLiabilityAmount: applied.toFixed(2),
      }
    }
  }

  return applyExpenseRecordLiabilityFromCategory(tx, input.expenseCategoryId, input.amount)
}

async function applyExpenseRecordLiabilityFromCategory(
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

async function insertExpenseRecordInTx(
  tx: AppTx,
  input: {
    expenseCategoryId: string
    expenseLineId?: string
    amount: number
    currency: string
    occurredOn: string
  },
) {
  const [line] = input.expenseLineId
    ? await tx
        .select({
          categoryId: expenseLines.categoryId,
          linkedLiabilityId: expenseLines.linkedLiabilityId,
        })
        .from(expenseLines)
        .where(eq(expenseLines.id, input.expenseLineId))
        .limit(1)
    : [null]
  const expenseCategoryId = await resolveExpenseRecordCategoryId(tx, {
    expenseCategoryId: input.expenseCategoryId,
    expenseLineId: input.expenseLineId,
    linkedLiabilityId: line?.linkedLiabilityId ?? null,
  })
  const liabilityEffect = await applyExpenseRecordLiability(tx, {
    expenseCategoryId,
    expenseLineId: input.expenseLineId,
    amount: input.amount,
  })
  const [row] = await tx
    .insert(expenseRecords)
    .values({
      expenseCategoryId,
      expenseLineId: input.expenseLineId,
      appliedLiabilityId: liabilityEffect.appliedLiabilityId,
      appliedLiabilityAmount: liabilityEffect.appliedLiabilityAmount,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      occurredOn: input.occurredOn,
    })
    .returning({ id: expenseRecords.id })
  return row
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
  const [row] = await db.transaction(async (tx) => {
    const categoryId = v.linkedLiabilityId
      ? await ensureInternalDebtCategory(tx)
      : (v.categoryId ?? await ensureInternalDebtCategory(tx))
    return tx
      .insert(expenseLines)
      .values({
        categoryId,
        name: v.name,
        linkedLiabilityId: v.linkedLiabilityId,
        isRecurring: v.isRecurring,
        frequency: v.frequency,
        recurringAmount: v.recurringAmount != null ? v.recurringAmount.toFixed(2) : null,
        recurringCurrency: v.recurringCurrency ?? "AED",
        recurringAnchorDate: v.recurringAnchorDate ?? null,
      })
      .returning({ id: expenseLines.id })
  })
  rev()
  return ok({ id: row.id })
}

export async function updateExpenseLine(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateExpenseLineSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const v = parsed.data
  await db.transaction(async (tx) => {
    const categoryId = v.linkedLiabilityId
      ? await ensureInternalDebtCategory(tx)
      : (v.categoryId ?? await ensureInternalDebtCategory(tx))
    await tx
      .update(expenseLines)
      .set({
        categoryId,
        name: v.name,
        linkedLiabilityId: v.linkedLiabilityId,
        isRecurring: v.isRecurring,
        frequency: v.frequency,
        recurringAmount: v.recurringAmount != null ? v.recurringAmount.toFixed(2) : null,
        recurringCurrency: v.recurringCurrency ?? "AED",
        recurringAnchorDate: v.recurringAnchorDate ?? null,
      })
      .where(eq(expenseLines.id, v.id))
  })
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
  const row = await db.transaction((tx) => insertExpenseRecordInTx(tx, v))
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
    const expenseLineId = v.expenseLineId ?? existing.expenseLineId ?? undefined
    const [line] = expenseLineId
      ? await tx
          .select({
            categoryId: expenseLines.categoryId,
            linkedLiabilityId: expenseLines.linkedLiabilityId,
          })
          .from(expenseLines)
          .where(eq(expenseLines.id, expenseLineId))
          .limit(1)
      : [null]
    const expenseCategoryId = await resolveExpenseRecordCategoryId(tx, {
      expenseCategoryId: v.expenseCategoryId,
      expenseLineId,
      linkedLiabilityId: line?.linkedLiabilityId ?? null,
    })
    const liabilityEffect = await applyExpenseRecordLiability(tx, {
      expenseCategoryId,
      expenseLineId,
      amount: v.amount,
    })
    await tx
      .update(expenseRecords)
      .set({
        expenseCategoryId,
        expenseLineId,
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
  const expenseLineRows = await db.select().from(expenseLines)
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
      if (cat.cashFlowType === "debt_payment" || isInternalDebtCategoryName(cat.name)) return null
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
    ...expenseLineRows
      .filter((line) => !!line.linkedLiabilityId)
      .map((line) => {
        const { currency, amount } = monthlyPlannedForLine(line, start, end)
        return {
          periodMonth: start,
          lineKind: "expense" as const,
          incomeLineId: null,
          expenseLineId: line.id,
          expenseCategoryId: null,
          currency,
          plannedAmount: amount.toFixed(2),
        }
      }),
  ].filter((value): value is NonNullable<typeof value> => value !== null)

  await db.transaction(async (tx) => {
    await tx.delete(budgetMonthPlanLines).where(eq(budgetMonthPlanLines.periodMonth, start))
    if (snapshotValues.length > 0) {
      await tx.insert(budgetMonthPlanLines).values(snapshotValues)
    }
  })

  rev()
  return ok()
}

const postPlannedDebtPaymentsSchema = z.object({
  yearMonth: finalizeYmSchema,
  expenseLineIds: z.array(z.string().uuid()).optional(),
})

export async function postPlannedDebtPayments(
  input: unknown,
): Promise<ActionResult<{ createdCount: number; skippedCount: number }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = postPlannedDebtPaymentsSchema.safeParse(input)
  if (!parsed.success) return err(parseIssues(parsed.error))
  const parts = parseYearMonthYm(parsed.data.yearMonth)
  if (!parts) return err("Invalid month.")
  const { start, end } = utcMonthBoundsForCalendarMonth(parts.year, parts.monthIndex0)

  const selectedLineIds = parsed.data.expenseLineIds ?? null
  const debtLines = await db
    .select()
    .from(expenseLines)
    .where(
      selectedLineIds
        ? inArray(expenseLines.id, selectedLineIds)
        : sql`${expenseLines.linkedLiabilityId} IS NOT NULL`,
    )

  if (debtLines.length === 0) {
    return ok({ createdCount: 0, skippedCount: 0 })
  }

  const occurredOn = defaultOccurredOnForMonth(start, end)
  const existingRows = await db
    .select({
      expenseLineId: expenseRecords.expenseLineId,
    })
    .from(expenseRecords)
    .where(
      and(
        gte(expenseRecords.occurredOn, start),
        lte(expenseRecords.occurredOn, end),
        sql`${expenseRecords.expenseLineId} IS NOT NULL`,
      ),
    )

  const existingLineIds = new Set(existingRows.map((row) => row.expenseLineId).filter(Boolean))
  let createdCount = 0
  let skippedCount = 0

  await db.transaction(async (tx) => {
    for (const line of debtLines) {
      if (!line.linkedLiabilityId) continue
      const { currency, amount } = monthlyPlannedForLine(line, start, end)
      if (!Number.isFinite(amount) || amount <= 0) {
        skippedCount += 1
        continue
      }
      if (existingLineIds.has(line.id)) {
        skippedCount += 1
        continue
      }
      await insertExpenseRecordInTx(tx, {
        expenseCategoryId: line.categoryId,
        expenseLineId: line.id,
        amount,
        currency,
        occurredOn,
      })
      existingLineIds.add(line.id)
      createdCount += 1
    }
  })

  rev()
  return ok({ createdCount, skippedCount })
}
