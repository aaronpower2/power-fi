import { GoalManager } from "@/components/goals/goal-manager"
import { listBudgetCategoriesPlannedForGoalCopy } from "@/lib/data/budget-categories-for-goal"
import { getFiPlanPageData } from "@/lib/data/fi-plan"
import { listGoalsWithLifestyle } from "@/lib/data/goals"

export const dynamic = "force-dynamic"

export default async function GoalPage() {
  const [goalItems, budgetCategoriesForLifestyleCopy, planningData] = await Promise.all([
    listGoalsWithLifestyle(),
    listBudgetCategoriesPlannedForGoalCopy(),
    getFiPlanPageData(),
  ])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <GoalManager
        items={goalItems}
        budgetCategoriesForLifestyleCopy={budgetCategoriesForLifestyleCopy}
        planningData={planningData}
      />
    </div>
  )
}
