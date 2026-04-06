"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { InfoTooltip } from "@/components/info-tooltip"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  getSummaryData,
  SummaryGoalOption,
  SummaryPageData,
} from "@/lib/data/summary"
import { dashboardRoutes } from "@/lib/routes"
import { PieChart } from "lucide-react"

type SummaryData = Awaited<ReturnType<typeof getSummaryData>>

export function SummaryPageControls({
  data,
  goalOptions,
  summaryCurrencyOptions,
}: {
  data: SummaryData
  goalOptions: SummaryGoalOption[]
  summaryCurrencyOptions: SummaryPageData["summaryCurrencyOptions"]
}) {
  const router = useRouter()
  const ccy = data.reportingCurrency
  const primaryDrilldown =
    data.reportingGoalId == null || data.goalFundable === false
      ? { href: dashboardRoutes.goal, label: "Review Goal" }
      : { href: dashboardRoutes.cashFlow, label: "Review Cash Flow" }

  return (
    <div className="flex w-full flex-nowrap items-center justify-between gap-2">
      <div className="text-muted-foreground flex min-w-0 flex-1 flex-nowrap items-center gap-2 text-sm">
        {goalOptions.length === 0 ? (
          <span className="text-muted-foreground min-w-0 truncate">
            Add a saved goal to see projections here.
          </span>
        ) : (
          <>
            <Select
              value={data.reportingGoalId ?? goalOptions[0]!.id}
              onValueChange={(id) => {
                const p = new URLSearchParams()
                p.set("goalId", id)
                p.set("ccy", data.reportingCurrency)
                router.push(`${dashboardRoutes.fiSummary}?${p.toString()}`)
              }}
            >
              <SelectTrigger
                className="h-8 min-w-0 max-w-[20rem] shrink"
                aria-label="Choose goal for FI summary"
              >
                <SelectValue placeholder="Select a goal" />
              </SelectTrigger>
              <SelectContent>
                {goalOptions.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <InfoTooltip>
              <p>
                Summary uses this goal&apos;s FI date, withdrawal rate, and monthly funding target. Amounts are
                in {ccy}, converted from asset and flow line currencies (ECB reference rates via Frankfurter).
              </p>
              {(data.goalFiDate || data.fxAsOfDate) && (
                <p className="text-muted-foreground mt-2">
                  {[data.goalFiDate ? `FI ${data.goalFiDate}` : null, data.fxAsOfDate ? `FX ${data.fxAsOfDate}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </InfoTooltip>
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-2">
        <div
          className="bg-muted/40 inline-flex rounded-lg border p-0.5"
          role="group"
          aria-label="Reporting currency for FI summary amounts"
        >
          {summaryCurrencyOptions.map((code) => (
            <Button
              key={code}
              type="button"
              size="sm"
              variant={data.reportingCurrency === code ? "secondary" : "ghost"}
              className="h-7 min-w-12 px-2.5 text-xs font-medium"
              onClick={() => {
                const p = new URLSearchParams()
                if (data.reportingGoalId) p.set("goalId", data.reportingGoalId)
                p.set("ccy", code)
                router.push(`${dashboardRoutes.fiSummary}?${p.toString()}`)
              }}
            >
              {code}
            </Button>
          ))}
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={primaryDrilldown.href}>{primaryDrilldown.label}</Link>
        </Button>
        <Button asChild size="sm" className="gap-1.5">
          <Link href={dashboardRoutes.netWorth}>
            <PieChart className="size-4 shrink-0" aria-hidden />
            Net Worth
          </Link>
        </Button>
      </div>
    </div>
  )
}
