"use client"

import type { ReactNode } from "react"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CardHeaderTitleRow, InfoTooltip } from "@/components/info-tooltip"
import { SummaryChart } from "@/components/summary-chart"
import { Progress } from "@/components/ui/progress"
import type { getSummaryData } from "@/lib/data/summary"
import {
  formatCurrency,
  formatMonths,
  formatPercent,
  formatYearMonthLabel,
} from "@/lib/format"
import { cn } from "@/lib/utils"

type SummaryData = Awaited<ReturnType<typeof getSummaryData>>

function FiProjectionPathTooltip({ data }: { data: SummaryData }) {
  const meta: string[] = []
  if (data.goalFiDate) meta.push(`FI ${data.goalFiDate}`)
  if (data.fxAsOfDate) meta.push(`FX ${data.fxAsOfDate}`)
  return (
    <>
      <p>
        FI-scoped path: assets marked &quot;in FI plan&quot; plus monthly investable, minus projected
        liabilities. Full balance-sheet net worth is in the cards above and on FI Summary.
      </p>
      {meta.length > 0 ? (
        <p className="text-muted-foreground mt-2">{meta.join(" · ")}</p>
      ) : null}
      <p className="mt-2">
        Withdrawal target (lifestyle funding): {formatPercent(data.assumedWithdrawalRate)}.
      </p>
    </>
  )
}

export function SummaryDashboard({ data }: { data: SummaryData }) {
  const ccy = data.reportingCurrency

  return (
    <>
      {data.fxWarning ? (
        <p className="text-destructive bg-destructive/10 rounded-md border border-destructive/20 px-3 py-2 text-sm">
          {data.fxWarning}
        </p>
      ) : null}
      <div
        className={cn(
          "grid gap-4 sm:grid-cols-2",
          data.coastFiNumber != null ? "xl:grid-cols-6" : "xl:grid-cols-5",
        )}
      >
        <MetricCard
          title="Goal status"
          info="Whether current portfolio trajectory can fund your target lifestyle at the FI date."
          value={data.goalFundable === null ? "—" : data.goalFundable ? "On track" : "Gap"}
          detail={
            data.goalFundable === false && data.shortfall != null
              ? `${formatCurrency(data.shortfall, ccy, { maximumFractionDigits: 0 })} below target`
              : undefined
          }
        />
        <MetricCard
          title="Net worth"
          info="Full balance sheet: all asset balances minus all liabilities, in the reporting currency you select in the control bar (converted from each line’s currency)."
          value={formatCurrency(data.netWorth, ccy, { maximumFractionDigits: 0 })}
        />
        <MetricCard
          title="Months to FI"
          info="Calendar months from today to your goal FI date."
          value={formatMonths(data.monthsToFi)}
        />
        <MetricCard
          title="Required portfolio"
          info="Portfolio size implied by lifestyle funding and your withdrawal rate."
          value={formatCurrency(data.requiredPrincipal ?? null, ccy, {
            maximumFractionDigits: 0,
          })}
        />
        <MetricCard
          title="Monthly investable"
          info="Planned recurring income minus planned recurring expenses. This value drives the projection; current-month actuals are shown as context."
          value={formatCurrency(data.monthlyInvestable, ccy, {
            maximumFractionDigits: 0,
          })}
          detail={
            data.currentMonthActualInvestable != null
              ? `This month so far: ${formatCurrency(data.currentMonthActualInvestable, ccy, {
                  maximumFractionDigits: 0,
                })}`
              : undefined
          }
        />
        {data.coastFiNumber != null ? (
          <CoastFiCard
            coastFiNumber={data.coastFiNumber}
            coastFiProgress={data.coastFiProgress}
            coastFiReachedMonth={data.coastFiReachedMonth}
            currencyCode={ccy}
          />
        ) : null}
      </div>
      {data.monthlyInvestableFallbackMessage ? (
        <p className="text-muted-foreground border-border bg-muted/40 rounded-lg border px-3 py-2 text-sm">
          {data.monthlyInvestableFallbackMessage}
        </p>
      ) : null}
      {data.setupIssues.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Setup health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.setupIssues.map((issue) => (
              <p key={`${issue.href}-${issue.message}`} className="text-muted-foreground">
                {issue.message}{" "}
                <a href={issue.href} className="text-primary underline-offset-4 hover:underline">
                  Fix
                </a>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardHeaderTitleRow
            title={<CardTitle>Net worth vs projection</CardTitle>}
            info={<FiProjectionPathTooltip data={data} />}
          />
        </CardHeader>
        <CardContent className="pt-2">
          {data.chartSeries.length > 0 ? (
            <SummaryChart
              series={data.chartSeries}
              coastFiNumber={data.coastFiNumber}
              requiredPrincipal={data.requiredPrincipal ?? 0}
              currencyCode={ccy}
            />
          ) : (
            <div className="bg-muted/30 flex aspect-[21/9] w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6">
              <Skeleton className="h-32 w-full max-w-md" />
              <InfoTooltip>
                <>
                  <p className="font-medium">No projection data yet.</p>
                  <p className="mt-2 text-muted-foreground">
                    Add a goal, assets included in FI projection, and an active allocation strategy to see
                    the curve.
                  </p>
                </>
              </InfoTooltip>
            </div>
          )}
        </CardContent>
      </Card>
      {data.staleLiabilityNames.length > 0 ? (
        <p className="text-amber-700 dark:text-amber-400 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm">
          {data.staleLiabilityNames.join(", ")}{" "}
          {data.staleLiabilityNames.length === 1 ? "has" : "have"} not been updated in 60+ days.
        </p>
      ) : null}
      {data.liabilitiesWithNoPaydownTracking.length > 0 ? (
        <p className="text-muted-foreground rounded-lg border px-3 py-2 text-sm">
          Untracked liabilities stay flat in the projection:{" "}
          {data.liabilitiesWithNoPaydownTracking
            .map((row) => `${row.name} (${formatCurrency(row.balance, ccy, { maximumFractionDigits: 0 })})`)
            .join(", ")}
          .
        </p>
      ) : null}
      {data.paydownDivergenceNotes.length > 0 ? (
        <div className="space-y-2">
          {data.paydownDivergenceNotes.map((note) => (
            <p key={note} className="text-muted-foreground rounded-lg border px-3 py-2 text-sm">
              {note}
            </p>
          ))}
        </div>
      ) : null}
    </>
  )
}

function CoastFiCard({
  coastFiNumber,
  coastFiProgress,
  coastFiReachedMonth,
  currencyCode,
}: {
  coastFiNumber: number
  coastFiProgress: number | null
  coastFiReachedMonth: string | null
  currencyCode: string
}) {
  const progressValue = Math.max(0, Math.min(100, Math.round((coastFiProgress ?? 0) * 100)))
  const remainingGap =
    coastFiProgress != null ? Math.max(0, coastFiNumber * (1 - coastFiProgress)) : null
  const alreadyReached = progressValue >= 100
  const reachedLabel = alreadyReached
    ? "Already reached"
    : coastFiReachedMonth
      ? `Reached: ~${formatYearMonthLabel(coastFiReachedMonth)}`
      : "Not reached by FI date"

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardHeaderTitleRow
          title={<CardTitle className="text-base">Coast FI</CardTitle>}
          info={
            <>
              <p>
                The FI-plan balance where you could stop contributing and let compounding carry you
                to your full FI target by the goal date.
              </p>
              <p className="mt-2 text-muted-foreground">
                Uses FI-scoped assets and the same liability-adjusted basis as the projection chart.
              </p>
            </>
          }
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="font-heading text-2xl font-semibold tabular-nums">
          {formatCurrency(coastFiNumber, currencyCode, { maximumFractionDigits: 0 })}
        </p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Progress
              value={progressValue}
              className="h-2 flex-1"
              aria-label={`Coast FI progress ${progressValue}%`}
            />
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatPercent((coastFiProgress ?? 0) / 1)}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            {alreadyReached
              ? "Your FI plan is already at the Coast FI threshold."
              : remainingGap != null
                ? `${formatCurrency(remainingGap, currencyCode, { maximumFractionDigits: 0 })} remaining`
                : "—"}
          </p>
          <p className="text-muted-foreground text-xs">{reachedLabel}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function MetricCard({
  title,
  info,
  value,
  detail,
}: {
  title: string
  info: ReactNode
  value: string
  detail?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardHeaderTitleRow
          title={<CardTitle className="text-base">{title}</CardTitle>}
          info={info}
        />
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
        {detail ? (
          <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
