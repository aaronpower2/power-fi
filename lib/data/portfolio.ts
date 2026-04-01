import { asc, desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/db"
import {
  allocationStrategies,
  allocationTargets,
  assets,
} from "@/lib/db/schema"

export async function getPortfolioData() {
  const db = getDb()
  if (!db) {
    return {
      assets: [] as (typeof assets.$inferSelect)[],
      strategies: [] as (typeof allocationStrategies.$inferSelect)[],
      activeStrategy: null as (typeof allocationStrategies.$inferSelect) | null,
      targets: [] as {
        id: string
        strategyId: string
        assetId: string
        weightPercent: string
        assetName: string
      }[],
    }
  }

  const assetList = await db.select().from(assets).orderBy(asc(assets.name))
  const strategyList = await db
    .select()
    .from(allocationStrategies)
    .orderBy(desc(allocationStrategies.isActive), asc(allocationStrategies.name))

  const activeStrategy = strategyList.find((s) => s.isActive) ?? null

  let targets: {
    id: string
    strategyId: string
    assetId: string
    weightPercent: string
    assetName: string
  }[] = []

  if (activeStrategy) {
    targets = await db
      .select({
        id: allocationTargets.id,
        strategyId: allocationTargets.strategyId,
        assetId: allocationTargets.assetId,
        weightPercent: allocationTargets.weightPercent,
        assetName: assets.name,
      })
      .from(allocationTargets)
      .innerJoin(assets, eq(allocationTargets.assetId, assets.id))
      .where(eq(allocationTargets.strategyId, activeStrategy.id))
      .orderBy(asc(assets.name))
  }

  return {
    assets: assetList,
    strategies: strategyList,
    activeStrategy,
    targets,
  }
}
