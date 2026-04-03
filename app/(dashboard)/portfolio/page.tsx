import { redirect } from "next/navigation"

import { dashboardRoutes } from "@/lib/routes"

export const dynamic = "force-dynamic"

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ ccy?: string }>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  if (sp.ccy) params.set("ccy", sp.ccy)
  redirect(`${dashboardRoutes.netWorth}${params.size > 0 ? `?${params.toString()}` : ""}`)
}
