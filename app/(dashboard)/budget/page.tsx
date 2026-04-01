import { BudgetManager } from "@/components/budget/budget-manager"
import { BudgetPageControls } from "@/components/budget/budget-page-controls"
import { PageHeader } from "@/components/page-header"
import { getBudgetPageData } from "@/lib/data/budget"

export const dynamic = "force-dynamic"

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; ccy?: string }>
}) {
  const sp = await searchParams
  const data = await getBudgetPageData({
    yearMonth: sp.ym ?? null,
    summaryCurrency: sp.ccy ?? null,
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        title="Budget"
        description="Planned amounts come from recurring lines (or locked past-month snapshots). Actuals come from records. Summary cards use AED, NZD, or AUD (toggle in the toolbar). Investable is actual income minus actual expenses."
        controls={<BudgetPageControls data={data} />}
      />
      <BudgetManager data={data} />
    </div>
  )
}
