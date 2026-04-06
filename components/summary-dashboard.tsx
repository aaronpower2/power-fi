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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      </div>
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
