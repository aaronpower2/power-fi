import { GoalManager } from "@/components/goals/goal-manager"
import { listBudgetCategoriesPlannedForGoalCopy } from "@/lib/data/budget-categories-for-goal"
import { listGoalsWithLifestyle } from "@/lib/data/goals"

export const dynamic = "force-dynamic"

export default async function GoalPage() {
  const [goalItems, budgetCategoriesForLifestyleCopy] = await Promise.all([
    listGoalsWithLifestyle(),
    listBudgetCategoriesPlannedForGoalCopy(),
  ])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <GoalManager items={goalItems} budgetCategoriesForLifestyleCopy={budgetCategoriesForLifestyleCopy} />
    </div>
  )
}
