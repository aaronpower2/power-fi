import { BudgetManager } from "@/components/budget/budget-manager"
import { BudgetPageControls } from "@/components/budget/budget-page-controls"
import { PageHeader } from "@/components/page-header"
import { getBudgetPageData } from "@/lib/data/budget"

export const dynamic = "force-dynamic"

export default async function CashFlowPage({
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
        title="Cash Flow"
        description="Track income, spending, debt service, and monthly surplus. Planned amounts come from recurring rules or closed-month snapshots; actuals come from posted records and imports."
        controls={<BudgetPageControls data={data} />}
      />
      <BudgetManager data={data} />
    </div>
  )
}
