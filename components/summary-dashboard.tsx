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
import type { getSummaryData } from "@/lib/data/summary"
import { formatCurrency, formatMonths, formatPercent } from "@/lib/format"

type SummaryData = Awaited<ReturnType<typeof getSummaryData>>

export function SummaryDashboard({ data }: { data: SummaryData }) {
  const ccy = data.reportingCurrency

  return (
    <>
      {data.fxWarning ? (
        <p className="text-destructive bg-destructive/10 rounded-md border border-destructive/20 px-3 py-2 text-sm">
          {data.fxWarning}
        </p>
      ) : null}
      {data.fxAsOfDate ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-foreground font-medium">{ccy}</span>
          <span>·</span>
          <span>ECB {data.fxAsOfDate}</span>
          <InfoTooltip>
            Amounts use your goal currency, converted from asset and flow currencies with ECB rates as of
            this date.
          </InfoTooltip>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Goal status"
          info="Whether current portfolio trajectory can fund your target lifestyle at the FI date."
          value={data.goalFundable === null ? "—" : data.goalFundable ? "On track" : "Gap"}
          detail={
            data.goalFundable === false && data.shortfall != null
              ? `${formatCurrency(data.shortfall, ccy)} below target`
              : undefined
          }
        />
        <MetricCard
          title="Net worth"
          info="Total portfolio value in goal currency (converted per asset currency)."
          value={formatCurrency(data.netWorth, ccy)}
        />
        <MetricCard
          title="Months to FI"
          info="Calendar months from today to your goal FI date."
          value={formatMonths(data.monthsToFi)}
        />
        <MetricCard
          title="Required portfolio"
          info="Portfolio size implied by lifestyle funding and your withdrawal rate."
          value={formatCurrency(data.requiredPrincipal ?? null, ccy)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardHeaderTitleRow
            title={<CardTitle>Portfolio vs projection</CardTitle>}
            info={
              <>
                Projected growth using assumed returns, capital maturities, and monthly contributions. Withdrawal
                target: {formatPercent(data.assumedWithdrawalRate)}.
              </>
            }
          />
        </CardHeader>
        <CardContent className="pt-2">
          {data.chartSeries.length > 0 ? (
            <SummaryChart
              series={data.chartSeries}
              requiredPrincipal={data.requiredPrincipal ?? 0}
              currencyCode={ccy}
            />
          ) : (
            <div className="bg-muted/30 flex aspect-[21/9] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6">
              <Skeleton className="h-32 w-full max-w-md" />
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <span>No projection data yet.</span>
                <InfoTooltip>Add a goal, assets, and an active strategy to see the curve.</InfoTooltip>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
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
