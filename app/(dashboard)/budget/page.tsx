import { redirect } from "next/navigation"

import { dashboardRoutes } from "@/lib/routes"

export const dynamic = "force-dynamic"

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; ccy?: string }>
}) {
  const sp = await searchParams
  const params = new URLSearchParams()
  if (sp.ym) params.set("ym", sp.ym)
  if (sp.ccy) params.set("ccy", sp.ccy)
  redirect(`${dashboardRoutes.cashFlow}${params.size > 0 ? `?${params.toString()}` : ""}`)
}
