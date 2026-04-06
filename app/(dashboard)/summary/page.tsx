import { PageHeader } from "@/components/page-header"
import { SummaryDashboard } from "@/components/summary-dashboard"
import { SummaryPageControls } from "@/components/summary/summary-page-controls"
import { getSummaryPageData } from "@/lib/data/summary"

export const dynamic = "force-dynamic"

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string; ccy?: string }>
}) {
  const sp = await searchParams
  const { summary, goalOptions, summaryCurrencyOptions } = await getSummaryPageData({
    goalId: sp.goalId ?? null,
    reportingCurrencyRequest: sp.ccy ?? null,
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        title="FI Summary"
        description="Progress toward your target: current net worth, projected path, and whether you reach the FI number your goal requires."
        controls={
          <SummaryPageControls
            data={summary}
            goalOptions={goalOptions}
            summaryCurrencyOptions={summaryCurrencyOptions}
          />
        }
      />
      <SummaryDashboard data={summary} />
    </div>
  )
}
