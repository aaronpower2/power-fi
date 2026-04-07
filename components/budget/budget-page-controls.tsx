"use client"

import Link from "next/link"
import { useMemo, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarDays, ChevronLeft, ChevronRight, Lock } from "lucide-react"

import { InfoTooltip } from "@/components/info-tooltip"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AllocateInvestableCapitalCta } from "@/components/budget/allocate-investable-capital-cta"
import { finalizeBudgetMonth, postPlannedDebtPayments } from "@/lib/actions/budget"
import type { getBudgetPageData } from "@/lib/data/budget"
import { addMonthsToYm, formatYearMonthYm, parseYearMonthYm } from "@/lib/dates"
import { dashboardRoutes } from "@/lib/routes"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>

function subscribeToHydration(cb: () => void) {
  if (typeof window === "undefined") return () => {}
  queueMicrotask(cb)
  return () => {}
}

function useClientMounted(): boolean {
  return useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  )
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, "0"),
  label: new Date(Date.UTC(2000, i, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  }),
}))

function BudgetMonthSelector({
  data,
  budgetQuery,
  goMonth,
}: {
  data: BudgetData
  budgetQuery: (nextYm: string) => string
  goMonth: (delta: number) => void
}) {
  const router = useRouter()
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Radix Popover generates aria-controls IDs that can differ SSR vs client; mount popover after hydrate. */
  const popoverReady = useClientMounted()

  const { year, monthIndex0, monthValue } = useMemo(() => {
    const p = parseYearMonthYm(data.ym)
    const now = new Date()
    const y = p?.year ?? now.getUTCFullYear()
    const m0 = p?.monthIndex0 ?? now.getUTCMonth()
    return {
      year: y,
      monthIndex0: m0,
      monthValue: String(m0 + 1).padStart(2, "0"),
    }
  }, [data.ym])

  const yearOptions = useMemo(() => {
    const ys: number[] = []
    const lo = year - 15
    const hi = year + 8
    for (let y = lo; y <= hi; y++) ys.push(y)
    return ys
  }, [year])

  function commit(nextYear: number, nextMonthIndex0: number) {
    const ym = formatYearMonthYm(nextYear, nextMonthIndex0)
    if (ym !== data.ym) {
      router.push(`${dashboardRoutes.cashFlow}?${budgetQuery(ym)}`)
    }
    setPickerOpen(false)
  }

  const isViewingCurrentUtcMonth = useMemo(() => {
    const d = new Date()
    return data.ym === formatYearMonthYm(d.getUTCFullYear(), d.getUTCMonth())
  }, [data.ym])

  function goCurrentUtcMonth() {
    const d = new Date()
    const ym = formatYearMonthYm(d.getUTCFullYear(), d.getUTCMonth())
    if (ym !== data.ym) {
      router.push(`${dashboardRoutes.cashFlow}?${budgetQuery(ym)}`)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="bg-muted/40 relative inline-flex items-center rounded-lg border p-0.5"
        role="group"
        aria-label="Cash flow month"
      >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 self-center"
        aria-label="Previous month"
        onClick={() => goMonth(-1)}
      >
        <ChevronLeft className="size-4" />
      </Button>
      {popoverReady ? (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-foreground hover:bg-muted/80 h-7 min-w-38 gap-1.5 px-3 text-sm font-medium sm:min-w-44"
              aria-label={`Selected month ${data.monthLabel}. Open month picker.`}
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
            >
              <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="truncate">{data.monthLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto min-w-68" align="center" sideOffset={8}>
            <div className="flex flex-col gap-3">
              <Label className="text-muted-foreground text-xs font-medium">Month (UTC)</Label>
              <div className="flex gap-2">
                <Select
                  value={monthValue}
                  onValueChange={(v) => {
                    commit(year, Number.parseInt(v, 10) - 1)
                  }}
                >
                  <SelectTrigger className="min-w-0 flex-1" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-100">
                    {MONTH_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(year)}
                  onValueChange={(v) => {
                    commit(Number.parseInt(v, 10), monthIndex0)
                  }}
                >
                  <SelectTrigger className="w-20 shrink-0" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-100">
                    {yearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "text-foreground hover:bg-muted/80 h-7 min-w-38 gap-1.5 px-3 text-sm font-medium sm:min-w-44",
            "pointer-events-none select-none",
          )}
          aria-label={`Selected month ${data.monthLabel}. Open month picker.`}
          aria-haspopup="dialog"
          aria-expanded={false}
          aria-disabled
          tabIndex={-1}
        >
          <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="truncate">{data.monthLabel}</span>
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 self-center"
        aria-label="Next month"
        onClick={() => goMonth(1)}
      >
        <ChevronRight className="size-4" />
      </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-muted-foreground hover:text-foreground h-7 shrink-0 px-2.5 text-xs font-medium"
        disabled={isViewingCurrentUtcMonth}
        aria-label={
          isViewingCurrentUtcMonth
            ? "Already viewing current UTC month"
            : "Jump to current UTC month"
        }
        onClick={goCurrentUtcMonth}
      >
        This month
      </Button>
    </div>
  )
}

function BudgetSummaryCurrencySwitch({ data }: { data: BudgetData }) {
  const router = useRouter()
  function setCcy(ccy: string) {
    const p = new URLSearchParams()
    p.set("ym", data.ym)
    p.set("ccy", ccy)
    router.push(`${dashboardRoutes.cashFlow}?${p.toString()}`)
  }

  return (
    <div
      className="bg-muted/40 inline-flex rounded-lg border p-0.5"
      role="group"
      aria-label="Reporting currency for budget totals"
    >
      {data.summaryCurrencyOptions.map((ccy) => (
        <Button
          key={ccy}
          type="button"
          size="sm"
          variant={data.summaryCurrency === ccy ? "secondary" : "ghost"}
          className="h-7 min-w-12 px-2.5 text-xs font-medium"
          onClick={() => setCcy(ccy)}
        >
          {ccy}
        </Button>
      ))}
    </div>
  )
}

export function BudgetPageControls({ data }: { data: BudgetData }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  const [finalizing, setFinalizing] = useState(false)
  const [postingDebt, setPostingDebt] = useState(false)

  function budgetQuery(nextYm: string) {
    const p = new URLSearchParams()
    p.set("ym", nextYm)
    p.set("ccy", data.summaryCurrency)
    return p.toString()
  }

  function goMonth(delta: number) {
    const next = addMonthsToYm(data.ym, delta)
    router.push(`${dashboardRoutes.cashFlow}?${budgetQuery(next)}`)
  }

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <BudgetMonthSelector data={data} budgetQuery={budgetQuery} goMonth={goMonth} />
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <BudgetSummaryCurrencySwitch data={data} />
          <AllocateInvestableCapitalCta data={data} refresh={refresh} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={postingDebt || data.debtPaymentLines.length === 0}
            onClick={async () => {
              setPostingDebt(true)
              const r = await postPlannedDebtPayments({ yearMonth: data.ym })
              setPostingDebt(false)
              if (r.ok) {
                const created = r.data?.createdCount ?? 0
                const skipped = r.data?.skippedCount ?? 0
                if (created > 0) {
                  toast.success(
                    created === 1
                      ? "Debt payment posted."
                      : `${created} planned debt payments posted.`,
                  )
                  refresh()
                } else if (skipped > 0) {
                  toast.message(
                    "Nothing posted. Debt lines already have records or no planned amount for this month.",
                  )
                } else {
                  toast.message("No planned debt payments to post for this month.")
                }
              } else toast.error(r.error)
            }}
          >
            {postingDebt ? "Posting debt…" : "Post debt payments"}
          </Button>
          {data.isPastMonth ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={finalizing}
                onClick={async () => {
                  setFinalizing(true)
                  const r = await finalizeBudgetMonth(data.ym)
                  setFinalizing(false)
                  if (r.ok) {
                    toast.success(
                      data.planUsesSnapshot
                        ? "Closed month updated with current line rules."
                        : "Month closed — planned amounts saved for this month.",
                    )
                    refresh()
                  } else toast.error(r.error)
                }}
              >
                <Lock className="size-4 shrink-0" aria-hidden />
                {finalizing
                  ? data.planUsesSnapshot
                    ? "Updating…"
                    : "Closing…"
                  : data.planUsesSnapshot
                    ? "Re-close month"
                    : "Close month"}
              </Button>
              <InfoTooltip>
                Freezes planned amounts for every income line, every expense category, and every debt
                payment line for this UTC month using your current recurring rules. Past months then keep
                that plan even if you edit categories or lines later. You can re-close to refresh the
                snapshot from today&apos;s definitions.
              </InfoTooltip>
            </div>
          ) : null}
        </div>
        <div className="text-muted-foreground text-sm">
          {data.strategyContext ? (
            <>
              Strategy: &quot;{data.strategyContext.strategyName}&quot; · {data.strategyContext.targetCount} assets
              ·{" "}
              <Link
                href={data.strategyContext.href}
                className="text-primary underline-offset-4 hover:underline"
              >
                Edit in Net Worth
              </Link>
            </>
          ) : (
            <>
              No active allocation strategy.{" "}
              <Link
                href={dashboardRoutes.netWorth}
                className="text-primary underline-offset-4 hover:underline"
              >
                Set up in Net Worth
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
