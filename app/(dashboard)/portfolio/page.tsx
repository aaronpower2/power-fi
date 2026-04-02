import { PortfolioManager } from "@/components/portfolio/portfolio-manager"
import { getPortfolioData } from "@/lib/data/portfolio"

export const dynamic = "force-dynamic"

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ ccy?: string }>
}) {
  const sp = await searchParams
  const data = await getPortfolioData({ summaryCurrency: sp.ccy ?? null })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PortfolioManager data={data} />
    </div>
  )
}
