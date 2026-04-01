import { PortfolioManager } from "@/components/portfolio/portfolio-manager"
import { PageHeader } from "@/components/page-header"
import { getPortfolioData } from "@/lib/data/portfolio"

export const dynamic = "force-dynamic"

export default async function PortfolioPage() {
  const data = await getPortfolioData()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        title="Portfolio"
        description="Assets by type and growth model. Strategy splits drive how investable capital is allocated each month."
      />
      <PortfolioManager data={data} />
    </div>
  )
}
