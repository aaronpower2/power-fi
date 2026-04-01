import { PageHeader } from "@/components/page-header"
import { SummaryDashboard } from "@/components/summary-dashboard"

import { getSummaryData } from "@/lib/data/summary"

export const dynamic = "force-dynamic"

export default async function SummaryPage() {
  const data = await getSummaryData()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        title="FI Summary"
        description="Progress toward your target: net worth, runway, and projected path versus the portfolio you need."
      />
      <SummaryDashboard data={data} />
    </div>
  )
}
