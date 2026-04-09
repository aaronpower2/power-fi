"use client"

import { InfoTooltip } from "@/components/info-tooltip"
import { formatPercent, formatYearMonthLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SavingsRateStat({
  currentRate,
  rollingAvg,
  targetRate,
  targetIsDefault,
  currentMonth,
}: {
  currentRate: number | null
  rollingAvg: number | null
  targetRate: number
  targetIsDefault: boolean
  currentMonth: string | null
}) {
  const toneClass =
    currentRate == null
      ? "text-muted-foreground"
      : currentRate >= targetRate
        ? "text-primary"
        : "text-destructive"
  const detailLabel =
    currentRate == null
      ? "No data yet — add income and expenses in Cash Flow."
      : [
          currentMonth ? formatYearMonthLabel(currentMonth) : null,
          `Target ${formatPercent(targetRate)}${targetIsDefault ? " default" : ""}`,
          `3-mo avg ${rollingAvg == null ? "—" : formatPercent(rollingAvg)}`,
        ]
          .filter(Boolean)
          .join(" · ")

  return (
    <div className="bg-muted/20 rounded-lg border px-4 py-3">
      <div className="mb-2 flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">Savings rate</p>
        <InfoTooltip className="size-5">
          <>
            <p>
              Savings rate is income minus expenses, divided by income. This is a behavioral health
              metric rather than the contribution amount used directly in the FI projection.
            </p>
            <p className="text-muted-foreground mt-2">
              Shows the current month-to-date rate, your target, and the rolling average over the
              last three closed months.
            </p>
          </>
        </InfoTooltip>
      </div>
      <p className={cn("font-heading text-xl font-semibold tabular-nums", toneClass)}>
        {currentRate == null ? "—" : formatPercent(currentRate)}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">{detailLabel}</p>
    </div>
  )
}
