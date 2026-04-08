"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { CardHeaderTitleRow } from "@/components/info-tooltip"
import { formatCurrency, formatPercent, formatYearMonthLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

export function CashFlowHealthCard({
  monthlyInvestable,
  currentMonthActualInvestable,
  currencyCode,
  currentRate,
  rollingAvg,
  targetRate,
  targetIsDefault,
  currentMonth,
}: {
  monthlyInvestable: number | null
  currentMonthActualInvestable: number | null
  currencyCode: string
  currentRate: number | null
  rollingAvg: number | null
  targetRate: number
  targetIsDefault: boolean
  currentMonth: string | null
}) {
  const hasSavingsData = currentRate != null
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
  const targetLabel = `Target: ${formatPercent(targetRate)}${targetIsDefault ? " default" : ""}`

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardHeaderTitleRow
          title={<CardTitle className="text-base">Cash flow health</CardTitle>}
          info={
            <>
              <p>
                Monthly investable is planned recurring income minus planned recurring expenses. This
                amount feeds the FI projection.
              </p>
              <p className="mt-2">
                Savings rate is income minus expenses, divided by income. The bar shows the current
                month-to-date rate against your target, plus the rolling average over the last three
                closed months.
              </p>
            </>
          }
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">Monthly investable</p>
          <p className="font-heading text-3xl font-semibold tabular-nums">
            {formatCurrency(monthlyInvestable, currencyCode, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-muted-foreground text-xs">
            {currentMonthActualInvestable != null
              ? `This month so far: ${formatCurrency(currentMonthActualInvestable, currencyCode, {
                  maximumFractionDigits: 0,
                })}`
              : "Used as the recurring contribution in the FI projection."}
          </p>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                {currentMonth
                  ? `${formatYearMonthLabel(currentMonth)} savings rate`
                  : "Current savings rate"}
              </p>
              <p className={cn("font-heading text-2xl font-semibold tabular-nums", toneClass)}>
                {hasSavingsData ? formatPercent(currentRate) : "—"}
              </p>
            </div>
            <p className="text-muted-foreground text-right text-xs">{targetLabel}</p>
          </div>
          {hasSavingsData ? (
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
                3-month avg: {rollingAvg == null ? "—" : formatPercent(rollingAvg)}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              No data yet — add income and expenses in Cash Flow.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
