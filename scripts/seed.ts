import { loadProjectEnv } from "../lib/load-env"
import { getDb } from "../lib/db"
import * as s from "../lib/db/schema"

async function main() {
  loadProjectEnv()
  const db = getDb()
  if (!db) {
    console.error("Set DATABASE_URL to run seed.")
    process.exit(1)
  }

  await db.update(s.goals).set({ isActive: false })
  await db.update(s.allocationStrategies).set({ isActive: false })

  const [seedGoal] = await db
    .insert(s.goals)
    .values({
      name: "Seed NZD goal",
      fiDate: "2040-12-01",
      withdrawalRate: "0.04",
      monthlyFundingRequirement: "6000",
      currency: "NZD",
      isActive: true,
    })
    .returning({ id: s.goals.id })

  await db.insert(s.goalLifestyleLines).values([
    {
      goalId: seedGoal.id,
      name: "Core living",
      monthlyAmount: "4000",
      sortOrder: 0,
    },
    {
      goalId: seedGoal.id,
      name: "Travel & fun",
      monthlyAmount: "2000",
      sortOrder: 1,
    },
  ])

  const [a1] = await db
    .insert(s.assets)
    .values({
      name: "Global stocks",
      assetCategory: "investment",
      includeInFiProjection: true,
      growthType: "compound",
      assumedAnnualReturn: "0.07",
      currentBalance: "250000",
      currency: "USD",
    })
    .returning()

  const [a2] = await db
    .insert(s.assets)
    .values({
      name: "Local cash",
      assetCategory: "cash",
      includeInFiProjection: true,
      growthType: "compound",
      assumedAnnualReturn: "0.02",
      currentBalance: "150000",
      currency: "AED",
    })
    .returning()

  const [strat] = await db
    .insert(s.allocationStrategies)
    .values({ name: "Default", isActive: true })
    .returning()

  await db.insert(s.allocationTargets).values([
    { strategyId: strat.id, assetId: a1.id, weightPercent: "80" },
    { strategyId: strat.id, assetId: a2.id, weightPercent: "20" },
  ])

  await db.insert(s.incomeLines).values({
    name: "Salary",
    isRecurring: true,
    frequency: "monthly",
    recurringAmount: "12000",
    recurringCurrency: "AED",
  })

  const today = new Date()
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`

  const [cat] = await db
    .insert(s.expenseCategories)
    .values({
      name: "Life",
      sortOrder: 0,
      isRecurring: true,
      frequency: "monthly",
      recurringAmount: "7500",
      recurringCurrency: "AED",
    })
    .returning()

  const [exLine] = await db
    .insert(s.expenseLines)
    .values({
      categoryId: cat.id,
      name: "All-in",
    })
    .returning()

  await db.insert(s.expenseRecords).values({
    expenseCategoryId: cat.id,
    expenseLineId: exLine.id,
    amount: "8000",
    currency: "AED",
    occurredOn: ymd,
  })

  console.log("Seed complete (goal, 2 assets, strategy, sample budget month).")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
