import { PageHeader } from "@/components/page-header"
import { SummaryDashboard } from "@/components/summary-dashboard"
import { SummaryPageControls } from "@/components/summary/summary-page-controls"
import { getSummaryPageData } from "@/lib/data/summary"

export const dynamic = "force-dynamic"

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ goalId?: string }>
}) {
  const sp = await searchParams
  const { summary, goalOptions } = await getSummaryPageData({
    goalId: sp.goalId ?? null,
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        title="FI Summary"
        description="Progress toward your target: net worth, runway, and projected path versus the portfolio you need."
        controls={<SummaryPageControls data={summary} goalOptions={goalOptions} />}
      />
      <SummaryDashboard data={summary} />
    </div>
  )
}
