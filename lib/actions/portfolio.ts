"use server"

import { revalidatePath } from "next/cache"
import { eq, sql } from "drizzle-orm"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { convertAmount } from "@/lib/currency/convert"
import { loadRatesOnOrBefore } from "@/lib/currency/rates"
import { getBudgetPageData } from "@/lib/data/budget"
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

function rev() {
  revalidatePath("/portfolio")
  revalidatePath("/summary")
}

function toDbAsset(v: {
  name: string
  assetType: string
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
    assetType: v.assetType,
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
  const row = toDbAsset(parsed.data)
  const [a] = await db
    .insert(assets)
    .values({
      ...row,
      createdAt: new Date(),
    })
    .returning({ id: assets.id })
  rev()
  return ok({ id: a.id })
}

export async function updateAsset(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = updateAssetSchema.safeParse(input)
  if (!parsed.success) {
    return err(parsed.error.issues.map((i: { message: string }) => i.message).join(" "))
  }
  const { id, ...rest } = parsed.data
  const row = toDbAsset(rest)
  await db.update(assets).set(row).where(eq(assets.id, id))
  rev()
  return ok()
}

export async function deleteAsset(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
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
    const [row] = await db
      .insert(liabilities)
      .values({
        name: v.name,
        liabilityType: v.liabilityType?.trim() || null,
        currency: v.currency,
        currentBalance: v.currentBalance.toFixed(2),
        securedByAssetId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: liabilities.id })
    rev()
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
    await db
      .update(liabilities)
      .set({
        name: rest.name,
        liabilityType: rest.liabilityType?.trim() || null,
        currency: rest.currency,
        currentBalance: rest.currentBalance.toFixed(2),
        securedByAssetId,
        updatedAt: new Date(),
      })
      .where(eq(liabilities.id, id))
    rev()
    return ok()
  } catch (e) {
    if (isUniqueSecuredAssetError(e)) {
      return err("Another liability is already linked to that asset.")
    }
    throw e
  }
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

export async function deleteLiability(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(liabilities).where(eq(liabilities.id, id))
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
  const [row] = await db
    .insert(allocationRecords)
    .values({
      assetId: v.assetId,
      amount: v.amount.toFixed(2),
      allocatedOn: v.allocatedOn,
      createdAt: new Date(),
    })
    .returning({ id: allocationRecords.id })
  rev()
  return ok({ id: row.id })
}

export async function deleteAllocationRecord(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db.delete(allocationRecords).where(eq(allocationRecords.id, id))
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
  const budget = await getBudgetPageData({
    yearMonth,
    summaryCurrency,
  })

  if (budget.ym !== yearMonth) {
    return err("Could not load that budget month.")
  }

  const investable = budget.totals.investableActual
  if (investable <= 0) {
    return err("No investable amount for this month (income minus expenses).")
  }

  const [strat] = await db
    .select()
    .from(allocationStrategies)
    .where(eq(allocationStrategies.isActive, true))
    .limit(1)

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
    .where(eq(allocationTargets.strategyId, strat.id))

  if (targets.length === 0) {
    return err("Active strategy has no allocation targets.")
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

  const ymParts = parseYearMonthYm(yearMonth)
  if (!ymParts) {
    return err("Invalid month.")
  }
  const { end: allocatedOn } = utcMonthBoundsForCalendarMonth(
    ymParts.year,
    ymParts.monthIndex0,
  )

  const fx = await loadRatesOnOrBefore(db, utcIsoDateString(new Date()))
  if (!fx) {
    return err("FX rates unavailable; cannot convert to asset currencies.")
  }

  const n = splitTargets.length
  const rawShares = splitTargets.map((t) => investable * (t.weightPercent / sumW))
  const cents = rawShares.map((x) => Math.round(x * 100))
  const targetCents = Math.round(investable * 100)
  const drift = targetCents - cents.reduce((a, b) => a + b, 0)
  cents[n - 1] += drift
  const sharesReporting = cents.map((c) => c / 100)

  try {
    let created = 0
    await db.transaction(async (tx) => {
      for (let i = 0; i < splitTargets.length; i++) {
        const shareReporting = sharesReporting[i]!
        if (shareReporting <= 0) continue
        const assetCcy = splitTargets[i]!.currency ?? "USD"
        const inAsset = convertAmount(shareReporting, summaryCurrency, assetCcy, fx.rates)
        if (inAsset == null) {
          throw new Error(
            `Could not convert ${summaryCurrency} to ${assetCcy} for an asset. Check FX pairs.`,
          )
        }
        const amt = Math.round(inAsset * 100) / 100
        if (amt <= 0) continue
        await tx.insert(allocationRecords).values({
          assetId: splitTargets[i]!.assetId,
          amount: amt.toFixed(2),
          allocatedOn,
          createdAt: new Date(),
        })
        created += 1
      }
    })

    if (created === 0) {
      return err("All split amounts rounded to zero in asset currencies.")
    }

    revalidatePath("/budget")
    rev()
    return ok({ created })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Allocation failed."
    return err(msg)
  }
}
