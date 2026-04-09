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
import { SavingsRateStat } from "@/components/summary/savings-rate-card"
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
      <div className="grid gap-4 lg:grid-cols-3">
        <HeroMetricCard
          title="Goal status"
          info="Whether current portfolio trajectory can fund your target lifestyle at the FI date."
          value={data.goalFundable === null ? "—" : data.goalFundable ? "On track" : "Off Target"}
          tone={
            data.goalFundable == null ? "neutral" : data.goalFundable ? "positive" : "negative"
          }
          detail={
            data.goalFundable === false && data.shortfall != null
              ? `${formatCurrency(data.shortfall, ccy, { maximumFractionDigits: 0 })} below target`
              : undefined
          }
        />
        <HeroMetricCard
          title="Net worth"
          info="Full balance sheet: all asset balances minus all liabilities, in the reporting currency you select in the control bar (converted from each line’s currency)."
          value={formatCurrency(data.netWorth, ccy, { maximumFractionDigits: 0 })}
        />
        <HeroMetricCard
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
              : "Used as the recurring contribution in the FI projection."
          }
        />
      </div>
      <div
        className={cn(
          "grid gap-3",
          data.coastFiNumber != null ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        <CompactMetricStat
          title="Months to FI"
          info="Calendar months from today to your goal FI date."
          value={formatMonths(data.monthsToFi)}
        />
        <CompactMetricStat
          title="Required portfolio"
          info="Portfolio size implied by lifestyle funding and your withdrawal rate. This is the Target reference line on the chart below."
          value={formatCurrency(data.requiredPrincipal ?? null, ccy, {
            maximumFractionDigits: 0,
          })}
          detail="Shown as Target on the chart"
        />
        <SavingsRateStat
          currentRate={data.savingsRateCurrent}
          rollingAvg={data.savingsRateRolling3Month}
          targetRate={data.savingsRateTarget}
          targetIsDefault={data.savingsRateTargetIsDefault}
          currentMonth={data.savingsRateCurrentLabel}
        />
        {data.coastFiNumber != null ? (
          <CoastFiStat
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

function CoastFiStat({
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
  const alreadyReached = progressValue >= 100
  const progressLabel = coastFiProgress == null ? null : `${formatPercent(coastFiProgress)} reached`
  const reachedLabel = alreadyReached
    ? "Already reached"
    : coastFiReachedMonth
      ? `~${formatYearMonthLabel(coastFiReachedMonth)}`
      : "Not reached by FI date"

  return (
    <CompactMetricStat
      title="Coast FI"
      info={
        <>
          <p>
            The FI-plan balance where you could stop contributing and let compounding carry you to
            your full FI target by the goal date.
          </p>
          <p className="text-muted-foreground mt-2">
            Uses FI-scoped assets and the same liability-adjusted basis as the projection chart. The
            same threshold is marked as Coast FI on the chart below.
          </p>
        </>
      }
      value={formatCurrency(coastFiNumber, currencyCode, { maximumFractionDigits: 0 })}
      detail={[progressLabel, reachedLabel].filter(Boolean).join(" · ")}
    />
  )
}

function HeroMetricCard({
  title,
  info,
  value,
  tone = "neutral",
  detail,
}: {
  title: string
  info: ReactNode
  value: string
  tone?: "neutral" | "positive" | "negative"
  detail?: string
}) {
  const toneClasses =
    tone === "positive"
      ? {
          card: "border-primary/20 bg-primary/5",
          value: "text-primary",
          detail: "text-primary/80",
        }
      : tone === "negative"
        ? {
            card: "border-destructive/20 bg-destructive/5",
            value: "text-destructive",
            detail: "text-destructive/80",
          }
        : {
            card: "",
            value: "",
            detail: "text-muted-foreground",
          }

  return (
    <Card className={toneClasses.card}>
      <CardHeader className="pb-2">
        <CardHeaderTitleRow
          title={<CardTitle className="text-base">{title}</CardTitle>}
          info={info}
        />
      </CardHeader>
      <CardContent className="space-y-1">
        <p className={cn("font-heading text-3xl font-semibold tabular-nums", toneClasses.value)}>
          {value}
        </p>
        {detail ? (
          <p className={cn("text-xs", toneClasses.detail)}>{detail}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CompactMetricStat({
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
    <div className="bg-muted/20 rounded-lg border px-4 py-3">
      <div className="mb-2 flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{title}</p>
        <InfoTooltip className="size-5">{info}</InfoTooltip>
      </div>
      <p className="font-heading text-xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-muted-foreground mt-1 text-xs">{detail}</p> : null}
    </div>
  )
}
