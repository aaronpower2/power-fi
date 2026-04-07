"use client"

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { ChartPoint } from "@/lib/fi/types"
import { formatCurrency } from "@/lib/format"

type Props = {
  series: ChartPoint[]
  coastFiNumber?: number | null
  requiredPrincipal: number
  currencyCode: string
}

export function SummaryChart({ series, coastFiNumber, requiredPrincipal, currencyCode }: Props) {
  const data = series.map((p) => ({
    label: p.label,
    projected: p.projectedTotal,
  }))

  return (
    <div className="text-foreground w-full">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) =>
              v >= 1_000_000 ? `${Math.round(v / 1_000_000)}M` : `${Math.round(v / 1000)}k`
            }
          />
          <Tooltip
            contentStyle={{
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--card)",
            }}
            formatter={(value) => [
              formatCurrency(
                typeof value === "number" ? value : Number(value),
                currencyCode,
                { maximumFractionDigits: 0 },
              ),
              "Projected",
            ]}
            labelFormatter={(label) => label}
          />
          {coastFiNumber != null && coastFiNumber > 0 ? (
            <ReferenceLine
              y={coastFiNumber}
              stroke="var(--color-chart-3)"
              strokeDasharray="4 4"
              label={{
                value: "Coast FI",
                position: "insideTopRight",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          ) : null}
          {requiredPrincipal > 0 ? (
            <ReferenceLine
              y={requiredPrincipal}
              stroke="var(--color-chart-2)"
              strokeDasharray="4 4"
              label={{
                value: "Target",
                position: "insideTopRight",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="projected"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            name="Projected"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
