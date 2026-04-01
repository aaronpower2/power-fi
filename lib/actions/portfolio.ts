"use server"

import { revalidatePath } from "next/cache"
import { eq, sql } from "drizzle-orm"

import { err, ok, type ActionResult } from "@/lib/action-result"
import { getDb } from "@/lib/db"
import {
  allocationStrategies,
  allocationTargets,
  assets,
} from "@/lib/db/schema"
import {
  allocationTargetSchema,
  createAssetSchema,
  createStrategySchema,
  updateAssetSchema,
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
