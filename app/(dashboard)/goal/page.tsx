import { GoalManager } from "@/components/goals/goal-manager"
import { listGoalsWithLifestyle } from "@/lib/data/goals"

export const dynamic = "force-dynamic"

export default async function GoalPage() {
  const goalItems = await listGoalsWithLifestyle()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <GoalManager items={goalItems} />
    </div>
  )
}
