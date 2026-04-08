"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { CardHeaderTitleRow } from "@/components/info-tooltip"
import { formatPercent, formatYearMonthLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SavingsRateCard({
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
  const progressValue =
    currentRate != null ? Math.max(0, Math.min(100, Math.round(currentRate * 100))) : 0
  const targetMarkerValue = Math.max(0, Math.min(100, Math.round(targetRate * 100)))
  const toneClass =
    currentRate == null
      ? "text-muted-foreground"
      : currentRate >= targetRate
        ? "text-primary"
        : "text-destructive"
  const indicatorClass =
    currentRate == null
      ? "bg-muted-foreground"
      : currentRate >= targetRate
        ? "bg-primary"
        : "bg-destructive"

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardHeaderTitleRow
          title={<CardTitle className="text-base">Savings Rate</CardTitle>}
          info="Current month-to-date savings rate and a rolling average over the last three closed months. Savings rate is income minus expenses, divided by income."
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          {currentMonth ? `${formatYearMonthLabel(currentMonth)} month-to-date` : "Current month-to-date"}
        </p>
        {currentRate == null ? (
          <div className="space-y-2">
            <p className="font-heading text-2xl font-semibold tabular-nums">—</p>
            <p className="text-muted-foreground text-xs">
              No data yet — add income and expenses in Cash Flow.
            </p>
          </div>
        ) : (
          <>
            <p className={cn("font-heading text-2xl font-semibold tabular-nums", toneClass)}>
              {formatPercent(currentRate)}
            </p>
            <div className="space-y-2">
              <div className="relative">
                <Progress
                  value={progressValue}
                  indicatorClassName={indicatorClass}
                  className="h-2"
                  aria-label={`Savings rate ${progressValue}% with target marker at ${targetMarkerValue}%`}
                />
                <div
                  className="bg-foreground/80 absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ left: `${targetMarkerValue}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                3-month avg: {formatPercent(rollingAvg)}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
