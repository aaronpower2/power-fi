"use server"

import { revalidatePath } from "next/cache"
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { INTERNAL_DEBT_CATEGORY_NAME } from "@/lib/budget/debt-payment"
import { resolveBudgetSummaryCurrency } from "@/lib/budget/summary-currency"
import { convertAmount } from "@/lib/currency/convert"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"
import {
  parseYearMonthYm,
  utcIsoDateString,
  utcMonthBoundsForCalendarMonth,
} from "@/lib/dates"
import { getDb } from "@/lib/db"
import {
  allocationRecords,
  allocationStrategies,
  allocationTargets,
  assets,
  expenseCategories,
  expenseLines,
  expenseRecords,
  goals,
  incomeRecords,
  liabilities,
} from "@/lib/db/schema"
import {
  allocateInvestableFromBudgetSchema,
  allocationTargetSchema,
  createAllocationRecordSchema,
  createAssetSchema,
  createLiabilitySchema,
  createStrategySchema,
  normalizeAssetMetaForDb,
  updateAssetSchema,
  updateLiabilitySchema,
  updateStrategySchema,
} from "@/lib/validations/portfolio"
import { dashboardRoutes } from "@/lib/routes"

function rev() {
  revalidatePath(dashboardRoutes.netWorth)
  revalidatePath(dashboardRoutes.fiSummary)
}

function isUniqueSecuredAssetError(e: unknown): boolean {
  const chain: unknown[] = [e]
  let cur: unknown = e
  for (let i = 0; i < 5 && cur && typeof cur === "object" && "cause" in cur; i++) {
    cur = (cur as { cause: unknown }).cause
    chain.push(cur)
  }
  for (const err of chain) {
    if (!err || typeof err !== "object") continue
    const o = err as { code?: string; constraint?: string }
    if (o.code === "23505" && /liabilities_secured/i.test(String(o.constraint ?? ""))) {
      return true
    }
  }
  return false
}

function isLockTimeoutError(e: unknown): boolean {
  const chain: unknown[] = [e]
  let cur: unknown = e
  for (let i = 0; i < 5 && cur && typeof cur === "object" && "cause" in cur; i++) {
    cur = (cur as { cause: unknown }).cause
    chain.push(cur)
  }
  for (const err of chain) {
    if (!err || typeof err !== "object") continue
    const o = err as { code?: string; message?: string }
    if (o.code === "55P03") return true
    if (typeof o.message === "string" && /lock timeout|lock not available/i.test(o.message)) {
      return true
    }
  }
  return false
}

function sumConvertedRecordAmounts(args: {
  rows: { amount: string; currency: string | null }[]
  reportingCurrency: string
  rates: Map<string, number>
}): number | null {
  const { rows, reportingCurrency, rates } = args
  let total = 0
  for (const row of rows) {
    const converted = convertAmount(Number(row.amount), row.currency ?? "USD", reportingCurrency, rates)
    if (converted == null) return null
    total += converted
  }
  return total
}

type AllocationInsertRow = {
  assetId: string
  amount: string
  allocatedOn: string
  createdAt: Date
}

type AppDb = NonNullable<ReturnType<typeof getDb>>
type AppTx = Parameters<Parameters<AppDb["transaction"]>[0]>[0]

type DeleteConfirmationData = {
  requiresConfirmation: true
  message: string
  affectedCategoryNames?: string[]
  affectedStrategyCount?: number
}

function normalizeDeleteInput(input: string | { id: string; force?: boolean }) {
  return typeof input === "string" ? { id: input, force: false } : input
}

async function ensureInternalDebtCategory(
  tx: AppTx,
): Promise<string> {
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
      recurringCurrency: "USD",
      createdAt: new Date(),
    })
    .returning({ id: expenseCategories.id })
  return created.id
}

async function createLinkedDebtPaymentLine(
  tx: AppTx,
  input: { liabilityId: string; liabilityName: string; currency: string },
) {
  const categoryId = await ensureInternalDebtCategory(tx)
  await tx.insert(expenseLines).values({
    categoryId,
    name: input.liabilityName.trim() || "Debt payment",
    linkedLiabilityId: input.liabilityId,
    isRecurring: false,
    recurringCurrency: input.currency,
    createdAt: new Date(),
  })
}

async function insertAllocationRowsAndUpdateBalances(
  tx: AppTx,
  rows: AllocationInsertRow[],
) {
  if (rows.length === 0) return
  await tx.insert(allocationRecords).values(rows)
  for (const row of rows) {
    await tx
      .update(assets)
      .set({
        currentBalance: sql`${assets.currentBalance} + ${row.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, row.assetId))
  }
}

function toDbAsset(v: {
  name: string
  assetCategory: (typeof assets.$inferInsert)["assetCategory"]
  includeInFiProjection: boolean
  currency: string
  growthType: "compound" | "capital"
  assumedAnnualReturnPercent?: number
  assumedTerminalValue?: number
  maturationDate?: string
  currentBalance: number
  meta?: Parameters<typeof normalizeAssetMetaForDb>[0]
}) {
  const assumedAnnualReturn =
    v.growthType === "compound" && v.assumedAnnualReturnPercent != null
      ? (v.assumedAnnualReturnPercent / 100).toFixed(6)
      : null
  const assumedTerminalValue =
    v.growthType === "capital" && v.assumedTerminalValue != null
      ? v.assumedTerminalValue.toFixed(2)
      : null
  const maturationDate =
    v.growthType === "capital" && v.maturationDate ? v.maturationDate : null

  return {
    name: v.name,
    assetCategory: v.assetCategory,
    includeInFiProjection: v.includeInFiProjection,
    currency: v.currency,
    growthType: v.growthType,
    assumedAnnualReturn,
    assumedTerminalValue,
    maturationDate,
    currentBalance: v.currentBalance.toFixed(2),
    meta: normalizeAssetMetaForDb(v.meta) as Record<string, unknown>,
    updatedAt: new Date(),
  }
}

export async function createAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = createAssetSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const { securedLiability, ...assetInput } = parsed.data
  const row = toDbAsset(assetInput)
  try {
    const id = await db.transaction(async (tx) => {
      const [a] = await tx
        .insert(assets)
        .values({
          ...row,
          createdAt: new Date(),
        })
        .returning({ id: assets.id })
      if (securedLiability) {
        const [liabilityRow] = await tx
          .insert(liabilities)
          .values({
          name: securedLiability.name,
          liabilityType: securedLiability.liabilityType?.trim() || null,
          trackingMode: securedLiability.trackingMode,
          currency: securedLiability.currency,
          currentBalance: securedLiability.currentBalance.toFixed(2),
          securedByAssetId: a.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          })
          .returning({ id: liabilities.id })
        if (securedLiability.autoCreateBudgetCategory) {
          await createLinkedDebtPaymentLine(tx, {
            liabilityId: liabilityRow.id,
            liabilityName: securedLiability.name,
            currency: securedLiability.currency,
          })
        }
      }
      return a.id
    })
    rev()
    if (securedLiability?.autoCreateBudgetCategory) {
      revalidatePath(dashboardRoutes.cashFlow)
    }
    return ok({ id })
  } catch (e) {
    if (isUniqueSecuredAssetError(e)) {
      return err("Another liability is already linked to that asset.")
    }
    throw e
  }
}

export async function updateAsset(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateAssetSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const { id, securedLiability, ...rest } = parsed.data
  const row = toDbAsset(rest)
  try {
    await db.transaction(async (tx) => {
      await tx.update(assets).set(row).where(eq(assets.id, id))
      if (securedLiability === null) {
        await tx.delete(liabilities).where(eq(liabilities.securedByAssetId, id))
      } else if (securedLiability !== undefined) {
        const [existing] = await tx
          .select({ id: liabilities.id })
          .from(liabilities)
          .where(eq(liabilities.securedByAssetId, id))
          .limit(1)
        if (existing) {
          await tx
            .update(liabilities)
            .set({
              name: securedLiability.name,
              liabilityType: securedLiability.liabilityType?.trim() || null,
              trackingMode: securedLiability.trackingMode,
              currency: securedLiability.currency,
              currentBalance: securedLiability.currentBalance.toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(liabilities.id, existing.id))
        } else {
          await tx.insert(liabilities).values({
            name: securedLiability.name,
            liabilityType: securedLiability.liabilityType?.trim() || null,
            trackingMode: securedLiability.trackingMode,
            currency: securedLiability.currency,
            currentBalance: securedLiability.currentBalance.toFixed(2),
            securedByAssetId: id,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }
      }
    })
    rev()
    return ok()
  } catch (e) {
    if (isUniqueSecuredAssetError(e)) {
      return err("Another liability is already linked to that asset.")
    }
    throw e
  }
}

export async function deleteAsset(
  input: string | { id: string; force?: boolean },
): Promise<ActionResult<DeleteConfirmationData>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const { id, force = false } = normalizeDeleteInput(input)
  if (!force) {
    const targets = await db
      .select({ strategyId: allocationTargets.strategyId })
      .from(allocationTargets)
      .where(eq(allocationTargets.assetId, id))
    if (targets.length > 0) {
      return ok({
        requiresConfirmation: true,
        message: `This asset has allocation targets in ${targets.length} strateg${targets.length === 1 ? "y" : "ies"}. Deleting it will remove those targets and may leave your weights misaligned.`,
        affectedStrategyCount: targets.length,
      })
    }
  }
  await db.delete(liabilities).where(eq(liabilities.securedByAssetId, id))
  await db.delete(assets).where(eq(assets.id, id))
  rev()
  return ok()
}

function normalizeSecuredByAssetId(
  id: string | undefined | null,
): string | null {
  if (id == null) return null
  const t = id.trim()
  return t === "" ? null : t
}

export async function createLiability(input: unknown): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = createLiabilitySchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const v = parsed.data
  const securedByAssetId = normalizeSecuredByAssetId(v.securedByAssetId)
  if (securedByAssetId) {
    const [a] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, securedByAssetId))
    if (!a) return err("Secured asset not found.")
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(liabilities)
        .values({
          name: v.name,
          liabilityType: v.liabilityType?.trim() || null,
          trackingMode: v.trackingMode,
          currency: v.currency,
          currentBalance: v.currentBalance.toFixed(2),
          securedByAssetId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: liabilities.id })
      if (v.autoCreateBudgetCategory) {
        await createLinkedDebtPaymentLine(tx, {
          liabilityId: created.id,
          liabilityName: v.name,
          currency: v.currency,
        })
      }
      return created
    })
    rev()
    if (v.autoCreateBudgetCategory) {
      revalidatePath(dashboardRoutes.cashFlow)
    }
    return ok({ id: row.id })
  } catch (e) {
    if (isUniqueSecuredAssetError(e)) {
      return err("Another liability is already linked to that asset.")
    }
    throw e
  }
}

export async function updateLiability(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateLiabilitySchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const { id, ...rest } = parsed.data
  const securedByAssetId = normalizeSecuredByAssetId(rest.securedByAssetId)
  if (securedByAssetId) {
    const [a] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, securedByAssetId))
    if (!a) return err("Secured asset not found.")
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`)
      await tx
        .update(liabilities)
        .set({
          name: rest.name,
          liabilityType: rest.liabilityType?.trim() || null,
          trackingMode: rest.trackingMode,
          currency: rest.currency,
          currentBalance: rest.currentBalance.toFixed(2),
          securedByAssetId,
          updatedAt: new Date(),
        })
        .where(eq(liabilities.id, id))
    })
    rev()
    return ok()
  } catch (e) {
    if (isUniqueSecuredAssetError(e)) {
      return err("Another liability is already linked to that asset.")
    }
    if (isLockTimeoutError(e)) {
      return err("This liability is currently locked by another request. Please wait a few seconds and try again.")
    }
    throw e
  }
}

export async function deleteLiability(
  input: string | { id: string; force?: boolean },
): Promise<ActionResult<DeleteConfirmationData>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const { id, force = false } = normalizeDeleteInput(input)
  if (!force) {
    const linked = await db
      .select({ id: expenseLines.id, name: expenseLines.name })
      .from(expenseLines)
      .where(eq(expenseLines.linkedLiabilityId, id))
    if (linked.length > 0) {
      return ok({
        requiresConfirmation: true,
        message: `${linked.map((row) => `"${row.name}"`).join(", ")} in Cash Flow ${linked.length === 1 ? "is" : "are"} linked to this liability. Deleting it will leave ${linked.length === 1 ? "that debt payment line" : "those debt payment lines"} unlinked.`,
        affectedCategoryNames: linked.map((row) => row.name),
      })
    }
  }
  await db.delete(liabilities).where(eq(liabilities.id, id))
  revalidatePath(dashboardRoutes.cashFlow)
  rev()
  return ok()
}

export async function createStrategy(input: unknown): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = createStrategySchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const v = parsed.data
  if (v.makeActive) {
    await db.update(allocationStrategies).set({ isActive: false })
  }
  const [s] = await db
    .insert(allocationStrategies)
    .values({
      name: v.name,
      isActive: v.makeActive,
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    .returning({ id: allocationStrategies.id })
  rev()
  return ok({ id: s.id })
}

export async function updateStrategy(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateStrategySchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const v = parsed.data
  await db
    .update(allocationStrategies)
    .set({ name: v.name, updatedAt: new Date() })
    .where(eq(allocationStrategies.id, v.id))
  rev()
  return ok()
}

export async function deleteStrategy(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(allocationStrategies).where(eq(allocationStrategies.id, id))
  rev()
  return ok()
}

export async function setActiveStrategy(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.update(allocationStrategies).set({ isActive: false })
  await db
    .update(allocationStrategies)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(allocationStrategies.id, id))
  rev()
  return ok()
}

export async function upsertAllocationTarget(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = allocationTargetSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const v = parsed.data
  const [a] = await db
    .select({ includeInFiProjection: assets.includeInFiProjection })
    .from(assets)
    .where(eq(assets.id, v.assetId))
  if (!a) return err("Asset not found.")
  if (!a.includeInFiProjection) {
    return err("Only assets included in your FI plan can have allocation targets.")
  }
  const w = v.weightPercent.toFixed(3)
  await db
    .insert(allocationTargets)
    .values({
      strategyId: v.strategyId,
      assetId: v.assetId,
      weightPercent: w,
    })
    .onConflictDoUpdate({
      target: [allocationTargets.strategyId, allocationTargets.assetId],
      set: { weightPercent: sql`excluded.weight_percent` },
    })
  rev()
  return ok()
}

export async function deleteAllocationTarget(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(allocationTargets).where(eq(allocationTargets.id, id))
  rev()
  return ok()
}

export async function createAllocationRecord(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = createAllocationRecordSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const v = parsed.data
  const [assetRow] = await db
    .select({ includeInFiProjection: assets.includeInFiProjection })
    .from(assets)
    .where(eq(assets.id, v.assetId))
  if (!assetRow) return err("Asset not found.")
  if (!assetRow.includeInFiProjection) {
    return err("Allocation records apply to assets in your FI plan only.")
  }
  const [row] = await db.transaction(async (tx) => {
    const rowsToInsert: AllocationInsertRow[] = [
      {
        assetId: v.assetId,
        amount: v.amount.toFixed(2),
        allocatedOn: v.allocatedOn,
        createdAt: new Date(),
      },
    ]
    const created = await tx
      .insert(allocationRecords)
      .values(rowsToInsert)
      .returning({ id: allocationRecords.id, assetId: allocationRecords.assetId, amount: allocationRecords.amount })
    for (const createdRow of created) {
      await tx
        .update(assets)
        .set({
          currentBalance: sql`${assets.currentBalance} + ${createdRow.amount}`,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, createdRow.assetId))
    }
    return created
  })
  if (!row) return err("Allocation record could not be created.")
  rev()
  return ok({ id: row.id })
}

export async function deleteAllocationRecord(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const deleted = await db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        id: allocationRecords.id,
        assetId: allocationRecords.assetId,
        amount: allocationRecords.amount,
      })
      .from(allocationRecords)
      .where(eq(allocationRecords.id, id))
      .limit(1)
    if (!record) return false
    await tx
      .update(assets)
      .set({
        currentBalance: sql`GREATEST(${assets.currentBalance} - ${record.amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, record.assetId))
    await tx.delete(allocationRecords).where(eq(allocationRecords.id, id))
    return true
  })
  if (!deleted) return err("Allocation record not found.")
  rev()
  return ok()
}

/**
 * Recomputes this month’s investable (same as the budget summary card), splits it by the active
 * strategy’s target weights — or by optional `weights` when provided (same assets as targets;
 * normalized if they don’t sum to 100) — converts each slice to the asset’s currency, and inserts
 * one allocation record per asset dated on the last day of the budget month. Does not persist
 * weight changes to the strategy.
 */
export async function allocateInvestablePerStrategy(
  input: unknown,
): Promise<ActionResult<{ created: number }>> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  const parsed = allocateInvestableFromBudgetSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }

  const { yearMonth, summaryCurrency, weights: weightsOverride } = parsed.data
  const ymParts = parseYearMonthYm(yearMonth)
  if (!ymParts) {
    return err("Invalid month.")
  }
  const { start, end: allocatedOn } = utcMonthBoundsForCalendarMonth(
    ymParts.year,
    ymParts.monthIndex0,
  )

  const [activeGoalRows, incomeRows, expenseRows, fx, stratRows] = await Promise.all([
    db
      .select({ currency: goals.currency })
      .from(goals)
      .where(eq(goals.isActive, true))
      .orderBy(desc(goals.updatedAt))
      .limit(1),
    db
      .select({ amount: incomeRecords.amount, currency: incomeRecords.currency })
      .from(incomeRecords)
      .where(and(gte(incomeRecords.occurredOn, start), lte(incomeRecords.occurredOn, allocatedOn))),
    db
      .select({ amount: expenseRecords.amount, currency: expenseRecords.currency })
      .from(expenseRecords)
      .where(and(gte(expenseRecords.occurredOn, start), lte(expenseRecords.occurredOn, allocatedOn))),
    loadRatesOnOrBefore(db, utcIsoDateString(new Date())),
    db
      .select()
      .from(allocationStrategies)
      .where(eq(allocationStrategies.isActive, true))
      .limit(1),
  ])

  const reportingCurrency = resolveBudgetSummaryCurrency(summaryCurrency)

  if (!fx) {
    return err("FX rates unavailable; cannot convert to asset currencies.")
  }

  const incomeTotal = sumConvertedRecordAmounts({
    rows: incomeRows,
    reportingCurrency,
    rates: fx.rates,
  })
  if (incomeTotal == null) {
    return err(`Could not convert some income rows to ${reportingCurrency}.`)
  }

  const expenseTotal = sumConvertedRecordAmounts({
    rows: expenseRows,
    reportingCurrency,
    rates: fx.rates,
  })
  if (expenseTotal == null) {
    return err(`Could not convert some expense rows to ${reportingCurrency}.`)
  }

  const investable = Math.max(0, incomeTotal - expenseTotal)
  if (investable <= 0) {
    return err("No investable amount for this month (income minus expenses).")
  }

  const strat = stratRows[0]

  if (!strat) {
    return err("No active portfolio strategy.")
  }

  const targets = await db
    .select({
      assetId: allocationTargets.assetId,
      weightPercent: allocationTargets.weightPercent,
      currency: assets.currency,
    })
    .from(allocationTargets)
    .innerJoin(assets, eq(allocationTargets.assetId, assets.id))
    .where(
      and(
        eq(allocationTargets.strategyId, strat.id),
        eq(assets.includeInFiProjection, true),
      ),
    )

  if (targets.length === 0) {
    return err(
      "Active strategy has no allocation targets on FI-plan assets. Add targets or mark assets for FI.",
    )
  }

  type SplitRow = { assetId: string; weightPercent: number; currency: string | null }
  let splitTargets: SplitRow[]

  if (weightsOverride != null && weightsOverride.length > 0) {
    if (weightsOverride.length !== targets.length) {
      return err("Send one weight per strategy target asset.")
    }
    const targetIds = new Set(targets.map((t) => t.assetId))
    const byAsset = new Map(weightsOverride.map((w) => [w.assetId, w.weightPercent] as const))
    if (byAsset.size !== weightsOverride.length) {
      return err("Duplicate asset in weights.")
    }
    for (const id of targetIds) {
      if (!byAsset.has(id)) {
        return err("Weights must include every strategy target asset.")
      }
    }
    for (const w of weightsOverride) {
      if (!targetIds.has(w.assetId)) {
        return err("Weights include an asset that is not in the active strategy.")
      }
    }
    splitTargets = targets.map((t) => ({
      assetId: t.assetId,
      weightPercent: byAsset.get(t.assetId)!,
      currency: t.currency,
    }))
  } else {
    splitTargets = targets.map((t) => ({
      assetId: t.assetId,
      weightPercent: Number(t.weightPercent),
      currency: t.currency,
    }))
  }

  const sumW = splitTargets.reduce((s, t) => s + t.weightPercent, 0)
  if (sumW <= 0) {
    return err("Allocation weights must sum to a positive total.")
  }

  const n = splitTargets.length
  const rawShares = splitTargets.map((t) => investable * (t.weightPercent / sumW))
  const cents = rawShares.map((x) => Math.round(x * 100))
  const targetCents = Math.round(investable * 100)
  const drift = targetCents - cents.reduce((a, b) => a + b, 0)
  cents[n - 1] += drift
  const sharesReporting = cents.map((c) => c / 100)

  try {
    const rowsToInsert = splitTargets.flatMap((target, i) => {
      const shareReporting = sharesReporting[i]!
      if (shareReporting <= 0) return []
      const assetCcy = target.currency ?? "USD"
      const inAsset = convertAmount(shareReporting, reportingCurrency, assetCcy, fx.rates)
      if (inAsset == null) {
        throw new Error(
          `Could not convert ${reportingCurrency} to ${assetCcy} for an asset. Check FX pairs.`,
        )
      }
      const amt = Math.round(inAsset * 100) / 100
      if (amt <= 0) return []
      return [
        {
          assetId: target.assetId,
          amount: amt.toFixed(2),
          allocatedOn,
          createdAt: new Date(),
        },
      ]
    })

    if (rowsToInsert.length === 0) {
      return err("All split amounts rounded to zero in asset currencies.")
    }

    const targetAssetIds = rowsToInsert.map((row) => row.assetId)
    const existingThisMonth = await db
      .select({ id: allocationRecords.id })
      .from(allocationRecords)
      .where(
        and(
          gte(allocationRecords.allocatedOn, start),
          lte(allocationRecords.allocatedOn, allocatedOn),
          inArray(allocationRecords.assetId, targetAssetIds),
        ),
      )
      .limit(1)
    if (existingThisMonth.length > 0) {
      return err(
        "This month already has allocation records for one or more target assets. Delete the existing records first, or adjust balances manually.",
      )
    }

    await db.transaction(async (tx) => {
      await insertAllocationRowsAndUpdateBalances(tx, rowsToInsert)
    })

    revalidatePath(dashboardRoutes.cashFlow)
    rev()
    return ok({ created: rowsToInsert.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Allocation failed."
    return err(msg)
  }
}
