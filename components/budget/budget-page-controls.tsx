"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { InfoTooltip } from "@/components/info-tooltip"
import { Button } from "@/components/ui/button"
import { finalizeBudgetMonth } from "@/lib/actions/budget"
import type { getBudgetPageData } from "@/lib/data/budget"
import { addMonthsToYm } from "@/lib/dates"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>

function BudgetSummaryCurrencySwitch({ data }: { data: BudgetData }) {
  const router = useRouter()
  function setCcy(ccy: string) {
    const p = new URLSearchParams()
    p.set("ym", data.ym)
    p.set("ccy", ccy)
    router.push(`/budget?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground hidden text-xs font-medium sm:inline">Summary</span>
      <div
        className="bg-muted/40 inline-flex rounded-lg border p-0.5"
        role="group"
        aria-label="Summary reporting currency"
      >
        {data.summaryCurrencyOptions.map((ccy) => (
          <Button
            key={ccy}
            type="button"
            size="sm"
            variant={data.summaryCurrency === ccy ? "secondary" : "ghost"}
            className="h-7 min-w-[3rem] px-2.5 text-xs font-medium"
            onClick={() => setCcy(ccy)}
          >
            {ccy}
          </Button>
        ))}
      </div>
    </div>
  )
}

export function BudgetPageControls({ data }: { data: BudgetData }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  const [finalizing, setFinalizing] = useState(false)

  function budgetQuery(nextYm: string) {
    const p = new URLSearchParams()
    p.set("ym", nextYm)
    p.set("ccy", data.summaryCurrency)
    return p.toString()
  }

  function goMonth(delta: number) {
    const next = addMonthsToYm(data.ym, delta)
    router.push(`/budget?${budgetQuery(next)}`)
  }

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => goMonth(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-foreground font-medium">{data.monthLabel}</span>
          <span className="text-muted-foreground font-mono text-xs">({data.ym})</span>
          <InfoTooltip>
            Calendar month uses UTC boundaries. Planned vs actual uses native currencies on each line;
            summary amounts use the currency you choose (AED / NZD / AUD). Past months can lock planned
            totals with Finalize (snapshot from current line rules).
          </InfoTooltip>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => goMonth(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <BudgetSummaryCurrencySwitch data={data} />
        {data.isPastMonth ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={finalizing}
              onClick={async () => {
                setFinalizing(true)
                const r = await finalizeBudgetMonth(data.ym)
                setFinalizing(false)
                if (r.ok) {
                  toast.success(
                    data.planUsesSnapshot
                      ? "Plan snapshot updated for this month."
                      : "Plan locked for this month.",
                  )
                  refresh()
                } else toast.error(r.error)
              }}
            >
              {finalizing ? "Finalizing…" : data.planUsesSnapshot ? "Re-finalize plan" : "Finalize plan"}
            </Button>
            <InfoTooltip>
              Saves planned amounts for every income and expense line for this UTC month using your current
              recurring rules. Use soon after month-end if you change line settings often.
            </InfoTooltip>
          </div>
        ) : null}
      </div>
    </div>
  )
}
