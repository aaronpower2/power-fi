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
import type { getSummaryData, SummaryGoalOption } from "@/lib/data/summary"
import { PieChart } from "lucide-react"

type SummaryData = Awaited<ReturnType<typeof getSummaryData>>

export function SummaryPageControls({
  data,
  goalOptions,
}: {
  data: SummaryData
  goalOptions: SummaryGoalOption[]
}) {
  const router = useRouter()
  const ccy = data.reportingCurrency

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
                router.push(`/summary?goalId=${encodeURIComponent(id)}`)
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
              Summary uses this goal&apos;s FI date, withdrawal rate, and monthly funding target. Amounts are
              in {ccy}, converted from asset and flow line currencies
              {data.fxAsOfDate ? ` using ECB reference rates as of ${data.fxAsOfDate}` : ""}.
            </InfoTooltip>
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-nowrap items-center gap-2">
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/portfolio">
            <PieChart className="size-4 shrink-0" aria-hidden />
            Portfolio
          </Link>
        </Button>
      </div>
    </div>
  )
}
