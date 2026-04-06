"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react"
import { useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import {
  createExpenseCategory,
  createExpenseLine,
  createExpenseRecord,
  createIncomeLine,
  createIncomeRecord,
  deleteExpenseCategory,
  deleteExpenseLine,
  deleteExpenseRecord,
  deleteIncomeLine,
  deleteIncomeRecord,
  updateExpenseCategory,
  updateExpenseLine,
  updateExpenseRecord,
  updateIncomeLine,
} from "@/lib/actions/budget"
import { SUPPORTED_CURRENCIES } from "@/lib/currency/iso4217"
import {
  BUDGET_FREQUENCY_LABELS,
  BUDGET_RECURRING_FREQUENCIES,
  normalizeRecurringAnchorDate,
  parseBudgetFrequency,
  type BudgetRecurringFrequency,
} from "@/lib/budget/recurring"
import {
  coalesceSupportedCurrency,
  defaultExpenseCategoryRecordCurrency,
  defaultIncomeLineRecordCurrency,
} from "@/lib/budget/cashflow-input-currency"
import type { getBudgetPageData } from "@/lib/data/budget"
import { formatCurrency } from "@/lib/format"
import {
  CASH_FLOW_TYPES,
  expenseCategorySchema,
  expenseLineSchema,
  expenseRecordSchema,
  incomeLineSchema,
  incomeRecordSchema,
  updateExpenseCategorySchema,
  updateExpenseLineSchema,
  updateExpenseRecordSchema,
  updateIncomeLineSchema,
} from "@/lib/validations/budget"
import { Button } from "@/components/ui/button"
import { CardHeaderTitleRow, InfoTooltip } from "@/components/info-tooltip"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ImportTransactionsPanel } from "@/components/budget/transactions-tab"
import { cn } from "@/lib/utils"
import {
  ClipboardList,
  FileSearch,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts"
import { z } from "zod"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]
type CashFlowType = (typeof CASH_FLOW_TYPES)[number]

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

function formatSummaryCcyValue(ccy: string, value: number) {
  const code = ccy.toUpperCase()
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
  return `${code} ${n}`
}

function PlannedActualSummaryPair({
  ccy,
  planned,
  actual,
}: {
  ccy: string
  planned: number
  actual: number
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="font-heading truncate text-3xl font-semibold leading-tight tabular-nums xl:text-4xl">
        {formatSummaryCcyValue(ccy, actual)}
      </p>
      <p className="text-muted-foreground truncate text-sm tabular-nums leading-snug">
        {formatSummaryCcyValue(ccy, planned)}
        <span className="font-medium">/Planned</span>
      </p>
    </div>
  )
}

function formatNativeLineTotals(buckets: Record<string, number> | undefined) {
  if (!buckets || Object.keys(buckets).length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  const keys = Object.keys(buckets).sort()
  return (
    <span className="tabular-nums">
      {keys.map((ccy, i) => (
        <span key={ccy}>
          {i > 0 ? " · " : null}
          {formatCurrency(buckets[ccy], ccy, { maximumFractionDigits: 0 })}
        </span>
      ))}
    </span>
  )
}

function nativeVarianceBuckets(
  planned: Record<string, number> | undefined,
  actual: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const keys = new Set([...Object.keys(planned ?? {}), ...Object.keys(actual ?? {})])
  if (keys.size === 0) return undefined
  const out: Record<string, number> = {}
  for (const c of keys) {
    out[c] = (actual?.[c] ?? 0) - (planned?.[c] ?? 0)
  }
  return out
}

function plannedBucketsWithPositiveAmount(
  planned: Record<string, number> | undefined,
): { currency: string; amount: number }[] {
  if (!planned) return []
  return Object.entries(planned)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([currency, amount]) => ({ currency, amount }))
}

/** Prefer today when it falls in the budget month; otherwise use month end (UTC). */
function defaultBudgetRecordDateForMonth(monthStart: string, monthEnd: string): string {
  const today = new Date().toISOString().slice(0, 10)
  if (today >= monthStart && today <= monthEnd) return today
  return monthEnd
}

type IncomeLineDialogState =
  | "create"
  | { edit: BudgetData["incomeLines"][number] }
  | null

type ExpenseCatDialogState =
  | { createType: CashFlowType }
  | { edit: BudgetData["expenseCategories"][number] }
  | null

type ExpenseLineDialogState =
  | "create"
  | { createCategoryId: string }
  | { edit: BudgetData["expenseLines"][number] }
  | null

function ExpenseCategoryPieCard({
  data,
  onManageCategories,
}: {
  data: BudgetData
  onManageCategories: () => void
}) {
  const ccy = data.summaryCurrency
  const chartRows = data.expenseCategories
    .map((c) => ({
      id: c.id,
      name: c.name,
      planned: data.expensePlannedByCategoryId[c.id] ?? 0,
      actual: data.expenseActualByCategoryId[c.id] ?? 0,
    }))
    .filter((d) => d.planned > 0 || d.actual > 0)
    .map((d) => ({
      ...d,
      value: Math.max(d.planned, d.actual),
      variance: d.actual - d.planned,
      status: d.planned <= 0 ? "unbudgeted" : d.actual <= d.planned ? "under" : "over",
    }))
    .sort((a, b) => b.value - a.value)

  const totalActual = chartRows.reduce((s, d) => s + d.actual, 0)

  return (
    <Card size="sm">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardHeaderTitleRow
          title={<CardTitle>Expense categories</CardTitle>}
          info="Actual spend by category for this month in your selected summary currency. Bars turn green when spend is within budget, red when over, and neutral when no category budget is set."
        />
        <Button size="sm" variant="default" className="shrink-0" onClick={onManageCategories}>
          Manage categories
        </Button>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        {chartRows.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {data.expenseCategories.length === 0
              ? "Add categories (with optional recurring budgets), then lines, to see spending by category."
              : "No category spending or budgets yet for this month."}
          </p>
        ) : (
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 8, right: 12, left: 4, bottom: 24 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.35} />
                <XAxis
                  dataKey="name"
                  interval={0}
                  height={72}
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => {
                    const amount = Number(value)
                    if (amount >= 1000) return `${Math.round(amount / 1000)}k`
                    return String(Math.round(amount))
                  }}
                />
                <Bar dataKey="value" shape={<ExpenseBudgetBarShape />} />
                <RechartsTooltip
                  content={({ active, payload }) => (
                    <ExpensePieTooltip
                      active={active}
                      payload={payload}
                      total={totalActual}
                      currency={ccy}
                    />
                  )}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ExpenseBudgetBarShape(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: {
    planned?: number
    actual?: number
    status?: string
  }
}) {
  const x = Number(props.x ?? 0)
  const y = Number(props.y ?? 0)
  const width = Number(props.width ?? 0)
  const height = Number(props.height ?? 0)
  const planned = Number(props.payload?.planned ?? 0)
  const actual = Number(props.payload?.actual ?? 0)
  const status = props.payload?.status ?? "unbudgeted"

  if (width <= 0 || height <= 0) return null

  const radius = 6
  if (status === "over") {
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        ry={radius}
        fill="var(--destructive)"
      />
    )
  }

  if (status === "unbudgeted" || planned <= 0) {
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        ry={radius}
        fill="var(--muted)"
      />
    )
  }

  const fillRatio = planned > 0 ? Math.max(0, Math.min(1, actual / planned)) : 0
  const fillHeight = height * fillRatio
  const fillY = y + height - fillHeight

  return (
    <>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        ry={radius}
        fill="var(--muted)"
      />
      {fillHeight > 0 ? (
        <rect
          x={x}
          y={fillY}
          width={width}
          height={fillHeight}
          rx={radius}
          ry={radius}
          fill="var(--primary)"
        />
      ) : null}
    </>
  )
}

function ExpensePieTooltip({
  active,
  payload,
  total,
  currency,
}: {
  active?: boolean
  payload?: readonly { name?: unknown; value?: unknown }[]
  total: number
  currency: string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const name = p?.name != null ? String(p.name) : ""
  const row = (p as { payload?: { planned?: number; actual?: number; variance?: number; status?: string } })
    .payload
  const actual = row?.actual ?? 0
  const planned = row?.planned ?? 0
  const variance = row?.variance ?? 0
  const status = row?.status ?? "unbudgeted"
  const pct = total > 0 ? (actual / total) * 100 : 0
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-sm shadow-md"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="font-medium">{name}</div>
      <div className="text-muted-foreground tabular-nums">
        Actual: {formatCurrency(actual, currency, { maximumFractionDigits: 0 })} ({pct.toFixed(1)}%)
      </div>
      <div className="text-muted-foreground tabular-nums">
        Budget: {formatCurrency(planned, currency, { maximumFractionDigits: 0 })}
      </div>
      <div
        className={cn(
          "tabular-nums",
          status === "over"
            ? "text-destructive"
            : status === "under"
              ? "text-primary"
              : "text-muted-foreground",
        )}
      >
        {status === "over" ? "Over" : status === "under" ? "Under" : "Unbudgeted"} by{" "}
        {formatCurrency(Math.abs(variance), currency, { maximumFractionDigits: 0 })}
      </div>
    </div>
  )
}

type ExpenseCategoryDraft = {
  name: string
  cashFlowType: CashFlowType
  linkedLiabilityId: string
  isRecurring: boolean
  frequency: BudgetRecurringFrequency
  recurringAmount: string
  recurringCurrency: string
}

function normalizeWholeCurrencyAmountInput(value: string | number | null | undefined) {
  if (value == null || value === "") return ""
  return String(value).replace(/\..*$/, "")
}

function normalizeExpenseCategoryCurrency(code: string | null | undefined): SupportedCurrency {
  return coalesceSupportedCurrency(code, "AED")
}

function expenseCategoryToDraft(c: BudgetData["expenseCategories"][number]): ExpenseCategoryDraft {
  return {
    name: c.name,
    cashFlowType: (c.cashFlowType ?? "expense") as CashFlowType,
    linkedLiabilityId: c.linkedLiabilityId ?? "",
    isRecurring: c.isRecurring,
    frequency: parseBudgetFrequency(c.frequency) ?? "monthly",
    recurringAmount: normalizeWholeCurrencyAmountInput(c.recurringAmount),
    recurringCurrency: c.isRecurring ? normalizeExpenseCategoryCurrency(c.recurringCurrency) : "AED",
  }
}

function expenseCategoryDraftMatchesServer(
  draft: ExpenseCategoryDraft,
  c: BudgetData["expenseCategories"][number],
): boolean {
  const s = expenseCategoryToDraft(c)
  return (
    draft.name === s.name &&
    draft.cashFlowType === s.cashFlowType &&
    draft.linkedLiabilityId === s.linkedLiabilityId &&
    draft.isRecurring === s.isRecurring &&
    draft.frequency === s.frequency &&
    draft.recurringAmount === s.recurringAmount &&
    draft.recurringCurrency === s.recurringCurrency
  )
}

function buildExpenseCategoryUpdatePayload(
  c: BudgetData["expenseCategories"][number],
  draft: ExpenseCategoryDraft,
) {
  const parsedAmount =
    draft.isRecurring && draft.recurringAmount.trim() !== "" ? Number(draft.recurringAmount) : null

  return updateExpenseCategorySchema.safeParse({
    id: c.id,
    name: draft.name.trim(),
    sortOrder: c.sortOrder,
    cashFlowType: draft.cashFlowType,
    linkedLiabilityId: draft.cashFlowType === "debt_payment" ? draft.linkedLiabilityId : "",
    isRecurring: draft.isRecurring,
    frequency: draft.isRecurring ? draft.frequency : null,
    recurringAmount: parsedAmount,
    recurringCurrency: draft.isRecurring ? normalizeExpenseCategoryCurrency(draft.recurringCurrency) : null,
  })
}

function ExpenseCategoryInlineManageRow({
  c,
  draft,
  onDraftChange,
  onRequestDelete,
  disabled = false,
}: {
  c: BudgetData["expenseCategories"][number]
  draft: ExpenseCategoryDraft
  onDraftChange: (next: ExpenseCategoryDraft) => void
  onRequestDelete: (id: string) => void
  disabled?: boolean
}) {
  const controlH = "h-9"
  const planEnabled = draft.isRecurring

  return (
    <div className="border-border/70 flex flex-nowrap items-center gap-2 border-b py-2.5 last:border-b-0 md:gap-2.5">
      <div className="min-w-0 flex-1">
        <Label htmlFor={`ecat-name-${c.id}`} className="sr-only">
          Name
        </Label>
        <Input
          id={`ecat-name-${c.id}`}
          value={draft.name}
          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
          className={cn(controlH, "min-w-0")}
          disabled={disabled}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-9 w-11 shrink-0 items-center justify-center">
          <Switch
            id={`ecat-plan-${c.id}`}
            checked={draft.isRecurring}
            onCheckedChange={(checked) =>
              onDraftChange({
                ...draft,
                isRecurring: checked,
                recurringCurrency: checked ? (draft.recurringCurrency || "AED") : "AED",
              })
            }
            aria-label={`Enable planned budget for ${c.name}`}
            disabled={disabled}
          />
        </div>
        <Select
          disabled={disabled || !planEnabled}
          value={draft.frequency}
          onValueChange={(v) => onDraftChange({ ...draft, frequency: v as BudgetRecurringFrequency })}
        >
          <SelectTrigger className={cn(controlH, "w-[7.25rem] shrink-0 px-2")}>
            <SelectValue placeholder="Freq" />
          </SelectTrigger>
          <SelectContent>
            {BUDGET_RECURRING_FREQUENCIES.map((f) => (
              <SelectItem key={f} value={f}>
                {BUDGET_FREQUENCY_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="1"
          min="0"
          disabled={disabled || !planEnabled}
          value={draft.recurringAmount}
          onChange={(e) =>
            onDraftChange({
              ...draft,
              recurringAmount: normalizeWholeCurrencyAmountInput(e.target.value),
            })
          }
          className={cn(controlH, "w-24 shrink-0 tabular-nums")}
          aria-label="Amount per period"
        />
        <Select
          disabled={disabled || !planEnabled}
          value={draft.recurringCurrency}
          onValueChange={(v) => onDraftChange({ ...draft, recurringCurrency: v })}
        >
          <SelectTrigger className={cn(controlH, "w-16 shrink-0 px-2")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_CURRENCIES.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="ml-auto flex w-9 shrink-0 items-center justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-lg" aria-label="More actions" disabled={disabled}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault()
                onRequestDelete(c.id)
              }}
            >
              <Trash2 className="size-4 opacity-70" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function ExpenseCategoriesManageDialog({
  open,
  onOpenChange,
  categories,
  onAdd,
  onRequestDelete,
  refresh,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  categories: BudgetData["expenseCategories"]
  onAdd: () => void
  onRequestDelete: (id: string) => void
  refresh: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, ExpenseCategoryDraft>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, expenseCategoryToDraft(c)])) as Record<
      string,
      ExpenseCategoryDraft
    >,
  )
  const [isSavingAll, startSavingAll] = useTransition()

  useEffect(() => {
    if (!open) return
    setDrafts(
      Object.fromEntries(categories.map((c) => [c.id, expenseCategoryToDraft(c)])) as Record<
        string,
        ExpenseCategoryDraft
      >,
    )
  }, [categories, open])

  const dirtyCategories = useMemo(
    () =>
      categories.filter((c) => {
        const draft = drafts[c.id]
        return draft ? !expenseCategoryDraftMatchesServer(draft, c) : false
      }),
    [categories, drafts],
  )

  function setDraftFor(id: string, next: ExpenseCategoryDraft) {
    setDrafts((current) => ({ ...current, [id]: next }))
  }

  function saveAll() {
    if (dirtyCategories.length === 0) return

    const prepared = dirtyCategories.map((c) => {
      const draft = drafts[c.id] ?? expenseCategoryToDraft(c)
      return { c, parsed: buildExpenseCategoryUpdatePayload(c, draft) }
    })

    const invalid = prepared.find(({ parsed }) => !parsed.success)
    if (invalid && !invalid.parsed.success) {
      toast.error(invalid.parsed.error.issues.map((i) => i.message).join(" "))
      return
    }

    startSavingAll(() => {
      void (async () => {
        for (const item of prepared) {
          if (!item.parsed.success) continue
          const result = await updateExpenseCategory(item.parsed.data)
          if (!result.ok) {
            toast.error(result.error)
            return
          }
        }

        toast.success(
          dirtyCategories.length === 1
            ? "1 category saved"
            : `${dirtyCategories.length} categories saved`,
        )
        refresh()
      })()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton fullViewport>
        <div className="border-b px-4 py-3 pr-14 shrink-0">
          <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 text-left">
            <DialogTitle className="pr-0">Categories</DialogTitle>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => {
                onOpenChange(false)
                onAdd()
              }}
            >
              Add category
            </Button>
          </DialogHeader>
          <p className="text-muted-foreground mt-2 text-sm">
            Edit name and planned budget per row, then <span className="font-medium">Save</span>. Actual
            spend rolls up directly into these categories.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto px-4 pb-6 pt-4">
          {categories.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">None yet — use Add category.</p>
          ) : (
            <div className="min-w-[660px]">
              <div className="text-muted-foreground mb-1 flex flex-nowrap items-center gap-2 border-b pb-2 text-xs font-medium md:gap-2.5">
                <span className="min-w-0 flex-1">Name</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex w-11 justify-center" title="Plan">
                    Plan
                  </span>
                  <span className="inline-block w-[7.25rem] shrink-0">Frequency</span>
                  <span className="inline-block w-24 shrink-0">Amount</span>
                  <span className="inline-block w-16 shrink-0">Ccy</span>
                </span>
                <span className="ml-auto w-[116px] shrink-0 text-end">Actions</span>
              </div>
              <div>
                {categories.map((c) => (
                  <ExpenseCategoryInlineManageRow
                    key={c.id}
                    c={c}
                    draft={drafts[c.id] ?? expenseCategoryToDraft(c)}
                    onDraftChange={(next) => setDraftFor(c.id, next)}
                    onRequestDelete={onRequestDelete}
                    disabled={isSavingAll}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="bg-background/95 border-t px-4 py-3 shrink-0 backdrop-blur supports-backdrop-filter:bg-background/80">
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="lg"
              disabled={dirtyCategories.length === 0 || isSavingAll}
              onClick={saveAll}
            >
              {isSavingAll ? "Saving…" : `Save changes${dirtyCategories.length ? ` (${dirtyCategories.length})` : ""}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function BudgetManager({ data }: { data: BudgetData }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  const expenseCategories = useMemo(
    () => data.expenseCategories.filter((category) => category.cashFlowType !== "debt_payment"),
    [data.expenseCategories],
  )
  const debtPaymentCategories = useMemo(
    () => data.expenseCategories.filter((category) => category.cashFlowType === "debt_payment"),
    [data.expenseCategories],
  )

  const [activeTab, setActiveTab] = useState("income")
  const mounted = useClientMounted()
  const [incomeLineDialog, setIncomeLineDialog] = useState<IncomeLineDialogState>(null)
  const [expenseCatDialog, setExpenseCatDialog] = useState<ExpenseCatDialogState>(null)
  const [expenseLineDialog, setExpenseLineDialog] = useState<ExpenseLineDialogState>(null)
  const [expenseCategoriesManageOpen, setExpenseCategoriesManageOpen] = useState(false)

  return (
    <div id="budget-detail" className="space-y-6 scroll-mt-4">
      {data.isPastMonth && !data.planUsesSnapshot ? (
        <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-sm">
          This month is in the past: planned amounts use live rules until you finalize (income lines +
          expense categories; then the snapshot stays locked).
        </p>
      ) : null}
      {data.fxWarning ? (
        <p className="text-destructive bg-destructive/10 rounded-md border border-destructive/20 px-3 py-2 text-sm">
          {data.fxWarning}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Card size="sm" className="border-primary/20 bg-primary/5">
          <CardHeader className="gap-0 pb-1 pt-3">
            <CardHeaderTitleRow
              title={<CardTitle className="text-sm leading-tight">Investable</CardTitle>}
              info="Actual income minus actual expenses for the UTC month (recorded flows only), in the selected summary currency."
            />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <p className="font-heading text-primary text-3xl font-semibold leading-tight tabular-nums xl:text-4xl">
              {formatCurrency(data.totals.investableActual, data.summaryCurrency)}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="gap-0 pb-1 pt-3">
            <CardHeaderTitleRow
              title={<CardTitle className="text-sm leading-tight">Income</CardTitle>}
              info="Planned from recurring rules or a finalized snapshot; actual from income records in this UTC month. Amounts use the summary currency you select."
            />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <PlannedActualSummaryPair
              ccy={data.summaryCurrency}
              planned={data.totals.incomePlanned}
              actual={data.totals.incomeActual}
            />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="gap-0 pb-1 pt-3">
            <CardHeaderTitleRow
              title={<CardTitle className="text-sm leading-tight">Expenses</CardTitle>}
              info="Planned from recurring rules on each spending category (or a finalized snapshot); actual from posted spending records in this UTC month. Amounts use the summary currency you select."
            />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <PlannedActualSummaryPair
              ccy={data.summaryCurrency}
              planned={data.totals.expensePlanned}
              actual={data.totals.expenseActual}
            />
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader className="gap-0 pb-1 pt-3">
            <CardHeaderTitleRow
              title={<CardTitle className="text-sm leading-tight">Debt payments</CardTitle>}
              info="Planned from recurring debt-payment categories; actual from posted debt-service records. These cash outflows reduce investable capital and can reduce linked fixed-installment liabilities."
            />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <PlannedActualSummaryPair
              ccy={data.summaryCurrency}
              planned={data.totals.debtPaymentPlanned}
              actual={data.totals.debtPaymentActual}
            />
          </CardContent>
        </Card>
      </div>

      {!mounted ? (
        <div className="space-y-4">
          <div className="bg-muted inline-flex h-8 w-fit items-center rounded-lg p-[3px] text-sm text-muted-foreground">
            <span className="bg-background text-foreground rounded-md px-3 py-1 font-medium shadow-sm">
              Income
            </span>
            <span className="px-3 py-1">Expenses</span>
            <span className="px-3 py-1">Debt payments</span>
          </div>
          <div className="rounded-lg border p-6 text-sm text-muted-foreground">
            Loading budget tools…
          </div>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="income">Income</TabsTrigger>
            <TabsTrigger value="expenses">Expenses</TabsTrigger>
            <TabsTrigger value="debt-payments">Debt payments</TabsTrigger>
          </TabsList>
          <TabsContent value="income" className="mt-4">
            <IncomeTab
              data={data}
              refresh={refresh}
              lineDialog={incomeLineDialog}
              setLineDialog={setIncomeLineDialog}
            />
          </TabsContent>
          <TabsContent value="expenses" className="mt-4">
            <ExpensesTab
              data={data}
              cashFlowType="expense"
              categories={expenseCategories}
              refresh={refresh}
              catDialog={expenseCatDialog}
              setCatDialog={setExpenseCatDialog}
              lineDialog={expenseLineDialog}
              setLineDialog={setExpenseLineDialog}
              categoriesManageOpen={expenseCategoriesManageOpen}
              setCategoriesManageOpen={setExpenseCategoriesManageOpen}
            />
          </TabsContent>
          <TabsContent value="debt-payments" className="mt-4">
            <ExpensesTab
              data={data}
              cashFlowType="debt_payment"
              categories={debtPaymentCategories}
              refresh={refresh}
              catDialog={expenseCatDialog}
              setCatDialog={setExpenseCatDialog}
              lineDialog={expenseLineDialog}
              setLineDialog={setExpenseLineDialog}
              categoriesManageOpen={expenseCategoriesManageOpen}
              setCategoriesManageOpen={setExpenseCategoriesManageOpen}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function IncomeTab({
  data,
  refresh,
  lineDialog,
  setLineDialog,
}: {
  data: BudgetData
  refresh: () => void
  lineDialog: IncomeLineDialogState
  setLineDialog: Dispatch<SetStateAction<IncomeLineDialogState>>
}) {
  const [recLine, setRecLine] = useState<(typeof data.incomeLines)[0] | null>(null)
  const [delLine, setDelLine] = useState<string | null>(null)
  const [recordingPlannedForLineId, setRecordingPlannedForLineId] = useState<string | null>(null)

  async function recordPlannedForIncomeLine(line: BudgetData["incomeLines"][number]) {
    const planned = data.incomePlannedByLineNative[line.id]
    const plannedParts = plannedBucketsWithPositiveAmount(planned)
    if (plannedParts.length === 0) return
    const occurredOn = defaultBudgetRecordDateForMonth(data.monthStart, data.monthEnd)
    setRecordingPlannedForLineId(line.id)
    try {
      for (const { currency, amount } of plannedParts) {
        const r = await createIncomeRecord({
          incomeLineId: line.id,
          amount,
          currency,
          occurredOn,
        })
        if (!r.ok) {
          toast.error(r.error)
          return
        }
      }
      toast.success(
        plannedParts.length > 1 ? "Planned amounts recorded" : "Planned amount recorded",
      )
      refresh()
    } finally {
      setRecordingPlannedForLineId(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardHeaderTitleRow
            title={<CardTitle>Income lines</CardTitle>}
            info={
              <>
                Planned column uses recurring rules (or a finalized snapshot for past months). Actual column is
                from records only. Line cells stay in native currencies (not converted to your goal currency). Use
                the + button in Actions (or Record planned in the menu) to post actuals matching this month&apos;s
                planned amounts.
              </>
            }
          />
          <Button size="sm" variant="default" className="shrink-0" onClick={() => setLineDialog("create")}>
            Add income line
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.incomeLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground h-16 text-center">
                    No income lines yet.
                  </TableCell>
                </TableRow>
              ) : (
                data.incomeLines.map((line) => {
                  const freq = parseBudgetFrequency(line.frequency)
                  const planned = data.incomePlannedByLineNative[line.id]
                  const actual = data.incomeActualByLineNative[line.id]
                  const plannedParts = plannedBucketsWithPositiveAmount(planned)
                  const canRecordPlanned = plannedParts.length > 0
                  return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="font-medium">{line.name}</div>
                      {line.isRecurring && freq ? (
                        <div className="text-muted-foreground text-xs">
                          Recurring · {BUDGET_FREQUENCY_LABELS[freq]}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNativeLineTotals(planned)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNativeLineTotals(actual)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatNativeLineTotals(nativeVarianceBuckets(planned, actual))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
                              disabled={!canRecordPlanned || recordingPlannedForLineId === line.id}
                              aria-label="Record planned amount as actual"
                              onClick={() => void recordPlannedForIncomeLine(line)}
                            >
                              <Plus className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">Record planned amount</TooltipContent>
                        </Tooltip>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="More actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setRecLine(line)}>
                              <ClipboardList className="size-4 opacity-70" />
                              Records
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!canRecordPlanned || recordingPlannedForLineId === line.id}
                              onClick={() => void recordPlannedForIncomeLine(line)}
                            >
                              <Plus className="size-4 opacity-70" />
                              Record planned
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLineDialog({ edit: line })}>
                              <Pencil className="size-4 opacity-70" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={(e) => {
                                e.preventDefault()
                                setDelLine(line.id)
                              }}
                            >
                              <Trash2 className="size-4 opacity-70" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <IncomeLineFormDialog
        open={lineDialog !== null}
        onOpenChange={(o) => !o && setLineDialog(null)}
        mode={lineDialog === "create" ? "create" : lineDialog ? "edit" : "create"}
        line={lineDialog && lineDialog !== "create" ? lineDialog.edit : undefined}
        onSaved={() => {
          setLineDialog(null)
          refresh()
        }}
      />

      {recLine ? (
        <IncomeRecordsDialog
          line={recLine}
          records={data.incomeRecordsByLineId[recLine.id] ?? []}
          defaultCurrency={defaultIncomeLineRecordCurrency(recLine, data.summaryCurrency)}
          open={!!recLine}
          onOpenChange={(o) => !o && setRecLine(null)}
          onSaved={refresh}
        />
      ) : null}

      <AlertDialog open={!!delLine} onOpenChange={(o) => !o && setDelLine(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete income line?</AlertDialogTitle>
            <AlertDialogDescription>Deletes all records for this line.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!delLine) return
                const r = await deleteIncomeLine(delLine)
                setDelLine(null)
                if (r.ok) {
                  toast.success("Line deleted")
                  refresh()
                } else toast.error(r.error)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type IncomeLineFormValues = {
  name: string
  isRecurring: boolean
  frequency: BudgetRecurringFrequency
  recurringAmount: string
  recurringCurrency: string
  /** YYYY-MM-DD; empty means smooth into every month */
  recurringAnchorDate: string
}

function IncomeLineFormDialog({
  open,
  onOpenChange,
  mode,
  line,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mode: "create" | "edit"
  line?: BudgetData["incomeLines"][number]
  onSaved: () => void
}) {
  const isEdit = mode === "edit" && line
  const form = useForm<IncomeLineFormValues>({
    defaultValues: {
      name: "",
      isRecurring: false,
      frequency: "monthly",
      recurringAmount: "",
      recurringCurrency: "AED",
      recurringAnchorDate: "",
    },
  })
  const isRecurring = useWatch({ control: form.control, name: "isRecurring" })

  useEffect(() => {
    if (open) {
      const freq = parseBudgetFrequency(line?.frequency ?? null) ?? "monthly"
      form.reset({
        name: line?.name ?? "",
        isRecurring: line?.isRecurring ?? false,
        frequency: freq,
        recurringAmount:
          line?.recurringAmount != null && line.recurringAmount !== ""
            ? String(line.recurringAmount)
            : "",
        recurringCurrency: line?.recurringCurrency ?? "AED",
        recurringAnchorDate: normalizeRecurringAnchorDate(line?.recurringAnchorDate) ?? "",
      })
    }
  }, [open, line, form])

  async function onSubmit(values: IncomeLineFormValues) {
    const parsedAmount =
      values.isRecurring && values.recurringAmount.trim() !== ""
        ? Number(values.recurringAmount)
        : null
    const anchorTrim = values.recurringAnchorDate.trim()
    const body = {
      name: values.name,
      isRecurring: values.isRecurring,
      frequency: values.isRecurring ? values.frequency : null,
      recurringAmount: parsedAmount,
      recurringCurrency: values.isRecurring ? values.recurringCurrency : null,
      recurringAnchorDate:
        values.isRecurring && anchorTrim !== "" ? anchorTrim.slice(0, 10) : null,
    }
    if (isEdit && line) {
      const p = updateIncomeLineSchema.safeParse({ ...body, id: line.id })
      if (!p.success) {
        toast.error(p.error.issues.map((i: { message: string }) => i.message).join(" "))
        return
      }
      const r = await updateIncomeLine(p.data)
      if (r.ok) {
        toast.success("Line updated")
        onOpenChange(false)
        onSaved()
      } else toast.error(r.error)
    } else {
      const p = incomeLineSchema.safeParse(body)
      if (!p.success) {
        toast.error(p.error.issues.map((i: { message: string }) => i.message).join(" "))
        return
      }
      const r = await createIncomeLine(p.data)
      if (r.ok) {
        toast.success("Line created")
        onOpenChange(false)
        onSaved()
      } else toast.error(r.error)
    }
  }

  const formId = isEdit ? "budget-income-line-edit" : "budget-income-line-create"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">
            {isEdit ? "Edit income line" : "New income line"}
          </DialogTitle>
          <Button type="submit" form={formId} size="sm" className="shrink-0">
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isRecurring"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <input
                      type="checkbox"
                      className="border-input size-4 rounded border"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                  </FormControl>
                  <FormLabel className="font-normal">Recurring income</FormLabel>
                </FormItem>
              )}
            />
            {isRecurring ? (
              <>
                <FormField
                  control={form.control}
                  name="frequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>How often</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BUDGET_RECURRING_FREQUENCIES.map((f: BudgetRecurringFrequency) => (
                            <SelectItem key={f} value={f}>
                              {BUDGET_FREQUENCY_LABELS[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recurringAnchorDate"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-1">
                        <FormLabel>Payment anchor (optional)</FormLabel>
                        <InfoTooltip>
                          Pick any real payment date on this schedule. The budget includes this amount
                          only in months when a payment occurs (e.g. quarterly bonus, dividend date).
                          Leave empty to spread the average into every month.
                        </InfoTooltip>
                      </div>
                      <FormControl>
                        <Input type="date" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recurringAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount per pay period</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recurringCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-1">
                        <FormLabel>Pay currency</FormLabel>
                        <InfoTooltip>
                          Weekly and biweekly amounts are averaged into a monthly total in this currency.
                        </InfoTooltip>
                      </div>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SUPPORTED_CURRENCIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function IncomeRecordsDialog({
  line,
  records,
  defaultCurrency,
  open,
  onOpenChange,
  onSaved,
}: {
  line: { id: string; name: string; isRecurring: boolean }
  records: { id: string; amount: string; occurredOn: string; currency: string | null }[]
  defaultCurrency: SupportedCurrency
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const addForm = useForm<z.infer<typeof incomeRecordSchema>>({
    resolver: zodResolver(incomeRecordSchema),
    defaultValues: {
      incomeLineId: line.id,
      amount: 0,
      currency: defaultCurrency,
      occurredOn: new Date().toISOString().slice(0, 10),
    },
  })

  useEffect(() => {
    if (open) {
      addForm.reset({
        incomeLineId: line.id,
        amount: 0,
        currency: defaultCurrency,
        occurredOn: new Date().toISOString().slice(0, 10),
      })
    }
  }, [open, line.id, defaultCurrency, addForm])

  async function addRec(values: z.infer<typeof incomeRecordSchema>) {
    const r = await createIncomeRecord({ ...values, incomeLineId: line.id })
    if (r.ok) {
      toast.success("Record added")
      addForm.reset({
        incomeLineId: line.id,
        amount: 0,
        currency: defaultCurrency,
        occurredOn: new Date().toISOString().slice(0, 10),
      })
      onSaved()
    } else toast.error(r.error)
  }

  const recordFormId = `budget-income-record-${line.id}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-8">
            <DialogTitle>Records — {line.name}</DialogTitle>
            {line.isRecurring ? (
              <InfoTooltip>
                Planned pay comes from the line’s recurring rule (or snapshot). Add records here for actual cash
                received; they count only toward actual, not planned.
              </InfoTooltip>
            ) : null}
          </div>
          <Button type="submit" form={recordFormId} size="sm" className="shrink-0">
            Add record
          </Button>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground h-14 text-center">
                  No records.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.occurredOn}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(Number(r.amount), r.currency ?? "AED")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={async () => {
                        const res = await deleteIncomeRecord(r.id)
                        if (res.ok) {
                          toast.success("Removed")
                          onSaved()
                        } else toast.error(res.error)
                      }}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Form {...addForm}>
          <form
            id={recordFormId}
            onSubmit={addForm.handleSubmit(addRec)}
            className="flex flex-wrap gap-2 border-t pt-4"
          >
            <input type="hidden" {...addForm.register("incomeLineId")} />
            <FormField
              control={addForm.control}
              name="amount"
              render={({ field }) => (
                <FormItem className="min-w-[100px] flex-1">
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={addForm.control}
              name="currency"
              render={({ field }) => (
                <FormItem className="min-w-[100px]">
                  <FormLabel>CCY</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={addForm.control}
              name="occurredOn"
              render={({ field }) => (
                <FormItem className="min-w-[140px]">
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ExpensesTab({
  data,
  cashFlowType,
  categories,
  refresh,
  catDialog,
  setCatDialog,
  lineDialog,
  setLineDialog,
  categoriesManageOpen,
  setCategoriesManageOpen,
}: {
  data: BudgetData
  cashFlowType: CashFlowType
  categories: BudgetData["expenseCategories"]
  refresh: () => void
  catDialog: ExpenseCatDialogState
  setCatDialog: Dispatch<SetStateAction<ExpenseCatDialogState>>
  lineDialog: ExpenseLineDialogState
  setLineDialog: Dispatch<SetStateAction<ExpenseLineDialogState>>
  categoriesManageOpen: boolean
  setCategoriesManageOpen: Dispatch<SetStateAction<boolean>>
}) {
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({})
  const [delCat, setDelCat] = useState<string | null>(null)
  const [importTxOpen, setImportTxOpen] = useState(false)
  const [recExpenseLine, setRecExpenseLine] = useState<BudgetData["expenseLines"][number] | null>(
    null,
  )
  const [delExpenseLineId, setDelExpenseLineId] = useState<string | null>(null)
  const [editRecord, setEditRecord] = useState<{
    id: string
    categoryId: string
    categoryName: string
    amount: string
    currency?: string | null
    occurredOn: string
    description: string
    lineId?: string | null
    lineName?: string | null
  } | null>(null)

  const isDebtPayments = cashFlowType === "debt_payment"

  const debtCategoryIdSet = useMemo(() => new Set(categories.map((c) => c.id)), [categories])
  const debtPaymentLines = useMemo(
    () => data.expenseLines.filter((l) => debtCategoryIdSet.has(l.categoryId)),
    [data.expenseLines, debtCategoryIdSet],
  )

  const liabilityCurrencyById = useMemo(
    () => new Map(data.liabilityOptions.map((l) => [l.id, l.currency])),
    [data.liabilityOptions],
  )

  return (
    <div className="space-y-6">
      {!isDebtPayments ? (
        <ExpenseCategoryPieCard
          data={{
            ...data,
            expenseCategories: categories,
          }}
          onManageCategories={() => setCategoriesManageOpen(true)}
        />
      ) : null}

      <ExpenseCategoriesManageDialog
        key={`${cashFlowType}-${categories
          .map(
            (c) =>
              `${c.id}:${c.name}:${c.sortOrder}:${c.cashFlowType ?? "expense"}:${c.linkedLiabilityId ?? ""}:${c.isRecurring}:${c.frequency ?? ""}:${c.recurringAmount ?? ""}:${c.recurringCurrency ?? ""}`,
          )
          .join("|")}`}
        open={categoriesManageOpen}
        onOpenChange={setCategoriesManageOpen}
        categories={categories}
        onAdd={() => setCatDialog({ createType: cashFlowType })}
        onRequestDelete={(id) => {
          setCategoriesManageOpen(false)
          setDelCat(id)
        }}
        refresh={refresh}
      />

      {isDebtPayments ? (
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardHeaderTitleRow
              title={<CardTitle>Debt payment lines</CardTitle>}
              info={
                <>
                  Each line sits under a debt category (linked to a fixed-installment liability). Use{" "}
                  <span className="font-medium">Records</span> to post payments for the month, like income lines.
                  Category planned amounts stay on the rollup table below.
                </>
              }
            />
            <Button
              size="sm"
              variant="default"
              className="shrink-0"
              onClick={() => setLineDialog("create")}
              disabled={categories.length === 0}
            >
              Add line
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {debtPaymentLines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground h-16 text-center">
                      {categories.length === 0
                        ? "Add a debt payment category first, then add lines to post payments."
                        : "No lines yet. Use Add line or the + on a category row."}
                    </TableCell>
                  </TableRow>
                ) : (
                  debtPaymentLines.map((line) => {
                    const actual = data.expenseActualByLineNative[line.id]
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium">{line.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{line.categoryName}</TableCell>
                        <TableCell className="text-right">{formatNativeLineTotals(actual)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-0.5">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setRecExpenseLine(line)}>
                                  <ClipboardList className="size-4 opacity-70" />
                                  Records
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setLineDialog({ edit: line })}>
                                  <Pencil className="size-4 opacity-70" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={(e) => {
                                    e.preventDefault()
                                    setDelExpenseLineId(line.id)
                                  }}
                                >
                                  <Trash2 className="size-4 opacity-70" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardHeaderTitleRow
            title={<CardTitle>{isDebtPayments ? "Debt payments by category" : "Expenses by category"}</CardTitle>}
            info={
              isDebtPayments
                ? "Linked debt-payment categories with rolled-up actuals in the selected summary currency. Toggle a row to reveal posted transactions for this month."
                : "Compact category table with rolled-up actuals in the selected summary currency. Toggle a row to reveal posted transactions for this month."
            }
          />
          <div className="flex shrink-0 flex-wrap gap-2">
            {!isDebtPayments ? (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setImportTxOpen(true)}
              >
                <FileSearch className="size-4" />
                Import &amp; match
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="default"
              className="shrink-0"
              onClick={() => setCatDialog({ createType: cashFlowType })}
            >
              Add category
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="w-24 text-right">Tx</TableHead>
                <TableHead className="w-36 text-right">Actual</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground h-16 text-center">
                    No categories yet.
                  </TableCell>
                </TableRow>
              ) : (
                categories.flatMap((cat) => {
                  const txs = data.expenseTransactionsByCategoryId[cat.id] ?? []
                  const isOpen = expandedCats[cat.id] ?? false
                  const total = data.expenseActualByCategoryId[cat.id] ?? 0

                  const rows: React.ReactNode[] = [
                    <TableRow
                      key={cat.id}
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedCats((current) => ({ ...current, [cat.id]: !isOpen }))
                      }
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground inline-block w-3 text-center text-xs">
                            {isOpen ? "−" : "+"}
                          </span>
                          <span>{cat.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {txs.length}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(total, data.summaryCurrency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Add expense line to ${cat.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setLineDialog({ createCategoryId: cat.id })
                            }}
                          >
                            <Plus className="size-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Category actions for ${cat.name}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.preventDefault()
                                  setCatDialog({ edit: cat })
                                }}
                              >
                                <Pencil className="size-4 opacity-70" />
                                Edit category
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={(e) => {
                                  e.preventDefault()
                                  setDelCat(cat.id)
                                }}
                              >
                                <Trash2 className="size-4 opacity-70" />
                                Delete category
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>,
                  ]

                  if (isOpen) {
                    rows.push(
                      <TableRow key={`${cat.id}-details`}>
                        <TableCell colSpan={4} className="bg-muted/20 p-0">
                          {txs.length === 0 ? (
                            <div className="text-muted-foreground px-4 py-3 text-sm">
                              No posted transactions yet.
                            </div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-28">Date</TableHead>
                                  <TableHead className="w-40">Line</TableHead>
                                  <TableHead>Description</TableHead>
                                  <TableHead className="w-32 text-right">Amount</TableHead>
                                  <TableHead className="w-24 text-right">Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {txs.map((tx) => (
                                  <TableRow key={tx.id}>
                                    <TableCell className="text-muted-foreground py-2 font-mono text-xs">
                                      {tx.occurredOn}
                                    </TableCell>
                                    <TableCell className="py-2 text-xs">
                                      {tx.lineName ?? (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </TableCell>
                                    <TableCell
                                      className="max-w-0 py-2 truncate"
                                      title={tx.description}
                                    >
                                      {tx.description}
                                    </TableCell>
                                    <TableCell className="py-2 text-right tabular-nums">
                                      {formatCurrency(
                                        Number(tx.amount),
                                        tx.currency ?? data.summaryCurrency,
                                      )}
                                    </TableCell>
                                    <TableCell className="py-2 text-right">
                                      {tx.isManual ? (
                                        <div className="flex justify-end gap-1">
                                          <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            aria-label={`Edit manual expense entry ${tx.description}`}
                                            onClick={() =>
                                              setEditRecord({
                                                id: tx.id,
                                                categoryId: cat.id,
                                                categoryName: cat.name,
                                                amount: tx.amount,
                                                currency: tx.currency ?? data.summaryCurrency,
                                                occurredOn: tx.occurredOn,
                                                description: tx.description,
                                                lineId: tx.lineId ?? null,
                                                lineName: tx.lineName ?? null,
                                              })
                                            }
                                          >
                                            <Pencil className="size-4" />
                                          </Button>
                                          <Button
                                            type="button"
                                            size="icon-sm"
                                            variant="ghost"
                                            className="text-destructive"
                                            aria-label={`Delete manual expense entry ${tx.description}`}
                                            onClick={async () => {
                                              const res = await deleteExpenseRecord(tx.id)
                                              if (res.ok) {
                                                toast.success("Manual expense deleted")
                                                refresh()
                                              } else toast.error(res.error)
                                            }}
                                          >
                                            <Trash2 className="size-4" />
                                          </Button>
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground text-xs">Imported</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TableCell>
                      </TableRow>,
                    )
                  }

                  return rows
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={importTxOpen} onOpenChange={setImportTxOpen}>
        <DialogContent showCloseButton fullViewport>
          <DialogHeader className="border-b px-4 py-3 pr-14 shrink-0 space-y-0 text-left">
            <DialogTitle>Import &amp; match transactions</DialogTitle>
            <p className="text-muted-foreground text-sm font-normal">
              Cash flow month {data.ym} (UTC). Posted expense categories update actuals on this tab.
            </p>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
            <ImportTransactionsPanel data={data} refresh={refresh} />
          </div>
        </DialogContent>
      </Dialog>

      <ExpenseCategoryFormDialog
        open={catDialog !== null}
        onOpenChange={(o) => !o && setCatDialog(null)}
        category={catDialog && "edit" in catDialog ? catDialog.edit : undefined}
        defaultCashFlowType={
          catDialog && "createType" in catDialog ? catDialog.createType : "expense"
        }
        liabilityOptions={data.liabilityOptions}
        onSaved={() => {
          setCatDialog(null)
          refresh()
        }}
      />

      <ExpenseLineFormDialog
        open={lineDialog !== null}
        onOpenChange={(o) => !o && setLineDialog(null)}
        categories={categories}
        emptyCategoriesScope={isDebtPayments ? "debt_payment" : "expense"}
        prefillCategoryId={
          lineDialog && lineDialog !== "create" && "createCategoryId" in lineDialog
            ? lineDialog.createCategoryId
            : undefined
        }
        liabilityOptions={data.liabilityOptions}
        fallbackCurrency={data.summaryCurrency}
        defaultOccurredOn={defaultBudgetRecordDateForMonth(data.monthStart, data.monthEnd)}
        line={
          lineDialog && lineDialog !== "create" && "edit" in lineDialog
            ? lineDialog.edit
            : undefined
        }
        onSaved={() => {
          setLineDialog(null)
          refresh()
        }}
      />

      {editRecord ? (
        <EditExpenseRecordDialog
          record={editRecord}
          open={!!editRecord}
          onOpenChange={(o) => !o && setEditRecord(null)}
          onSaved={() => {
            setEditRecord(null)
            refresh()
          }}
        />
      ) : null}

      {recExpenseLine ? (
        <ExpenseRecordsDialog
          line={recExpenseLine}
          records={data.expenseRecordsByLineId[recExpenseLine.id] ?? []}
          defaultCurrency={defaultExpenseCategoryRecordCurrency({
            category: data.expenseCategories.find((c) => c.id === recExpenseLine.categoryId),
            liabilityCurrencyById,
            fallbackCurrency: data.summaryCurrency,
          })}
          open={!!recExpenseLine}
          onOpenChange={(o) => !o && setRecExpenseLine(null)}
          onSaved={refresh}
        />
      ) : null}

      <AlertDialog open={!!delExpenseLineId} onOpenChange={(o) => !o && setDelExpenseLineId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense line?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes this line. Posted expense records stay on the category with no line label.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!delExpenseLineId) return
                const r = await deleteExpenseLine(delExpenseLineId)
                setDelExpenseLineId(null)
                if (r.ok) {
                  toast.success("Line deleted")
                  refresh()
                } else toast.error(r.error)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!delCat} onOpenChange={(o) => !o && setDelCat(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete category?</AlertDialogTitle>
            <AlertDialogDescription>Deletes lines and records in this category.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!delCat) return
                const r = await deleteExpenseCategory(delCat)
                setDelCat(null)
                if (r.ok) {
                  toast.success("Category deleted")
                  refresh()
                } else toast.error(r.error)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}

type ExpenseCategoryFormValues = {
  name: string
  sortOrder: number
  cashFlowType: CashFlowType
  linkedLiabilityId: string
  isRecurring: boolean
  frequency: BudgetRecurringFrequency
  recurringAmount: string
  recurringCurrency: string
}

function ExpenseCategoryFormDialog({
  open,
  onOpenChange,
  category,
  defaultCashFlowType,
  liabilityOptions,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  category?: BudgetData["expenseCategories"][number]
  defaultCashFlowType: CashFlowType
  liabilityOptions: BudgetData["liabilityOptions"]
  onSaved: () => void
}) {
  const isEdit = !!category
  const form = useForm<ExpenseCategoryFormValues>({
    defaultValues: {
      name: "",
      sortOrder: 0,
      cashFlowType: defaultCashFlowType,
      linkedLiabilityId: "",
      isRecurring: false,
      frequency: "monthly",
      recurringAmount: "",
      recurringCurrency: "AED",
    },
  })
  const catIsRecurring = useWatch({ control: form.control, name: "isRecurring" })
  const cashFlowType = useWatch({ control: form.control, name: "cashFlowType" })

  useEffect(() => {
    if (open) {
      const freq = parseBudgetFrequency(category?.frequency ?? null) ?? "monthly"
      form.reset({
        name: category?.name ?? "",
        sortOrder: category?.sortOrder ?? 0,
        cashFlowType: (category?.cashFlowType ?? defaultCashFlowType) as CashFlowType,
        linkedLiabilityId: category?.linkedLiabilityId ?? "",
        isRecurring: category?.isRecurring ?? false,
        frequency: freq,
        recurringAmount:
          category?.recurringAmount != null && category.recurringAmount !== ""
            ? String(category.recurringAmount)
            : "",
        recurringCurrency: normalizeExpenseCategoryCurrency(category?.recurringCurrency),
      })
    }
  }, [open, category, defaultCashFlowType, form])

  async function onSubmit(values: ExpenseCategoryFormValues) {
    const parsedAmount =
      values.isRecurring && values.recurringAmount.trim() !== ""
        ? Number(values.recurringAmount)
        : null
    const body = {
      name: values.name,
      sortOrder: values.sortOrder,
      cashFlowType: values.cashFlowType,
      linkedLiabilityId: values.cashFlowType === "debt_payment" ? values.linkedLiabilityId : "",
      isRecurring: values.isRecurring,
      frequency: values.isRecurring ? values.frequency : null,
      recurringAmount: parsedAmount,
      recurringCurrency: values.isRecurring ? normalizeExpenseCategoryCurrency(values.recurringCurrency) : null,
    }
    if (isEdit && category) {
      const p = updateExpenseCategorySchema.safeParse({ ...body, id: category.id })
      if (!p.success) {
        toast.error(p.error.issues.map((i) => i.message).join(" "))
        return
      }
      const r = await updateExpenseCategory(p.data)
      if (r.ok) {
        toast.success("Category updated")
        onOpenChange(false)
        onSaved()
      } else toast.error(r.error)
    } else {
      const p = expenseCategorySchema.safeParse(body)
      if (!p.success) {
        toast.error(p.error.issues.map((i) => i.message).join(" "))
        return
      }
      const r = await createExpenseCategory(p.data)
      if (r.ok) {
        toast.success("Category created")
        onOpenChange(false)
        onSaved()
      } else toast.error(r.error)
    }
  }

  const catFormId = isEdit ? "budget-expense-cat-edit" : "budget-expense-cat-create"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">{isEdit ? "Edit category" : "New category"}</DialogTitle>
          <Button type="submit" form={catFormId} size="sm" className="shrink-0">
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form id={catFormId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sort order</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cashFlowType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="debt_payment">Debt payment</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {cashFlowType === "debt_payment" ? (
              <FormField
                control={form.control}
                name="linkedLiabilityId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Linked liability</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose liability" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {liabilityOptions
                          .filter((row) => row.trackingMode === "fixed_installment")
                          .map((row) => (
                            <SelectItem key={row.id} value={row.id}>
                              {row.name} · {row.currency}
                              {row.securedByAssetName
                                ? ` · secures: ${row.securedByAssetName}`
                                : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            <FormField
              control={form.control}
              name="isRecurring"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <input
                      type="checkbox"
                      className="border-input size-4 rounded border"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                    />
                  </FormControl>
                  <div className="flex items-center gap-1">
                    <FormLabel className="font-normal">Planned budget for this category</FormLabel>
                    <InfoTooltip>
                      Uses a smoothed monthly total from the schedule below (weekly/biweekly convert to an
                      average month). Lines under this category only track actual spend.
                    </InfoTooltip>
                  </div>
                </FormItem>
              )}
            />
            {catIsRecurring ? (
              <>
                <FormField
                  control={form.control}
                  name="frequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>How often</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {BUDGET_RECURRING_FREQUENCIES.map((f: BudgetRecurringFrequency) => (
                            <SelectItem key={f} value={f}>
                              {BUDGET_FREQUENCY_LABELS[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recurringAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount per period</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="recurringCurrency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Currency</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SUPPORTED_CURRENCIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : null}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

type ExpenseLineFormValues = {
  categoryId: string
  name: string
  initialAmount: string
}

function ExpenseLineFormDialog({
  open,
  onOpenChange,
  categories,
  emptyCategoriesScope = "expense",
  prefillCategoryId,
  liabilityOptions,
  fallbackCurrency,
  defaultOccurredOn,
  line,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  categories: BudgetData["expenseCategories"]
  emptyCategoriesScope?: "expense" | "debt_payment"
  prefillCategoryId?: string
  liabilityOptions: BudgetData["liabilityOptions"]
  fallbackCurrency: SupportedCurrency
  defaultOccurredOn: string
  line?: BudgetData["expenseLines"][number]
  onSaved: () => void
}) {
  const isEdit = !!line
  const form = useForm<ExpenseLineFormValues>({
    defaultValues: {
      categoryId: line?.categoryId ?? prefillCategoryId ?? categories[0]?.id ?? "",
      name: "",
      initialAmount: "",
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        categoryId: line?.categoryId ?? prefillCategoryId ?? categories[0]?.id ?? "",
        name: line?.name ?? "",
        initialAmount: "",
      })
    }
  }, [open, line, categories, prefillCategoryId, form])

  const liabilityCurrencyById = useMemo(
    () => new Map(liabilityOptions.map((l) => [l.id, l.currency])),
    [liabilityOptions],
  )
  const categoryIdWatched = useWatch({ control: form.control, name: "categoryId" })
  const recordCurrency = useMemo(
    () =>
      defaultExpenseCategoryRecordCurrency({
        category: categories.find((c) => c.id === categoryIdWatched),
        liabilityCurrencyById,
        fallbackCurrency,
      }),
    [categories, categoryIdWatched, liabilityCurrencyById, fallbackCurrency],
  )

  async function onSubmit(values: ExpenseLineFormValues) {
    const body = {
      categoryId: values.categoryId,
      name: values.name,
    }
    if (isEdit && line) {
      const p = updateExpenseLineSchema.safeParse({ ...body, id: line.id })
      if (!p.success) {
        toast.error(p.error.issues.map((i: { message: string }) => i.message).join(" "))
        return
      }
      const r = await updateExpenseLine(p.data)
      if (r.ok) {
        toast.success("Line updated")
        onOpenChange(false)
        onSaved()
      } else toast.error(r.error)
    } else {
      const amount = Number(values.initialAmount)
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error("Enter a value greater than 0")
        return
      }
      const p = expenseLineSchema.safeParse(body)
      if (!p.success) {
        toast.error(p.error.issues.map((i: { message: string }) => i.message).join(" "))
        return
      }
      const r = await createExpenseLine(p.data)
      if (r.ok) {
        const createdLineId = r.data?.id
        if (!createdLineId) {
          toast.error("Line created but its ID was not returned")
          onOpenChange(false)
          onSaved()
          return
        }
        const currency = defaultExpenseCategoryRecordCurrency({
          category: categories.find((c) => c.id === values.categoryId),
          liabilityCurrencyById,
          fallbackCurrency,
        })
        const record = await createExpenseRecord({
          expenseCategoryId: p.data.categoryId,
          expenseLineId: createdLineId,
          amount,
          currency,
          occurredOn: defaultOccurredOn,
        })
        if (!record.ok) {
          toast.error(`Line created, but value could not be posted: ${record.error}`)
          onOpenChange(false)
          onSaved()
          return
        }
        toast.success("Line created")
        onOpenChange(false)
        onSaved()
      } else toast.error(r.error)
    }
  }

  if (!isEdit && categories.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-1.5">
              <DialogTitle>Category required</DialogTitle>
              <InfoTooltip>
                {emptyCategoriesScope === "debt_payment"
                  ? "Add a debt payment category with Add category before creating a line."
                  : "Add an expense category from the Expenses tab before creating a line."}
              </InfoTooltip>
            </div>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }

  const expLineFormId = isEdit ? "budget-expense-line-edit" : "budget-expense-line-create"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">
            {isEdit ? "Edit expense line" : "New expense line"}
          </DialogTitle>
          <Button type="submit" form={expLineFormId} size="sm" className="shrink-0">
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form id={expLineFormId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Line name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!isEdit ? (
              <FormField
                control={form.control}
                name="initialAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Value ({recordCurrency})</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditExpenseRecordDialog({
  record,
  open,
  onOpenChange,
  onSaved,
}: {
  record: {
    id: string
    categoryId: string
    categoryName: string
    amount: string
    currency?: string | null
    occurredOn: string
    description: string
    lineId?: string | null
    lineName?: string | null
  }
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const form = useForm<z.infer<typeof updateExpenseRecordSchema>>({
    resolver: zodResolver(updateExpenseRecordSchema),
    defaultValues: {
      id: record.id,
      expenseCategoryId: record.categoryId,
      expenseLineId: record.lineId ?? undefined,
      amount: Number(record.amount),
      currency: (record.currency ?? "AED") as SupportedCurrency,
      occurredOn: record.occurredOn,
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        id: record.id,
        expenseCategoryId: record.categoryId,
        expenseLineId: record.lineId ?? undefined,
        amount: Number(record.amount),
        currency: (record.currency ?? "AED") as SupportedCurrency,
        occurredOn: record.occurredOn,
      })
    }
  }, [open, record, form])

  async function onSubmit(values: z.infer<typeof updateExpenseRecordSchema>) {
    const res = await updateExpenseRecord(values)
    if (res.ok) {
      toast.success("Manual expense updated")
      onOpenChange(false)
      onSaved()
    } else toast.error(res.error)
  }

  const formId = `edit-expense-record-${record.id}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="min-w-0 flex-1 pr-8">
            <DialogTitle>Edit manual expense</DialogTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              {record.categoryName}
              {record.lineName ? ` · ${record.lineName}` : ""}
            </p>
            <p className="text-muted-foreground truncate text-sm" title={record.description}>
              {record.description}
            </p>
          </div>
          <Button type="submit" form={formId} size="sm" className="shrink-0">
            Save
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <input type="hidden" {...form.register("id")} />
            <input type="hidden" {...form.register("expenseCategoryId")} />
            <input type="hidden" {...form.register("expenseLineId")} />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="occurredOn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ExpenseRecordsDialog({
  line,
  records,
  defaultCurrency,
  open,
  onOpenChange,
  onSaved,
}: {
  line: { id: string; name: string; categoryId: string }
  records: { id: string; amount: string; occurredOn: string; currency?: string | null }[]
  defaultCurrency: SupportedCurrency
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const addForm = useForm<z.infer<typeof expenseRecordSchema>>({
    resolver: zodResolver(expenseRecordSchema),
    defaultValues: {
      expenseCategoryId: line.categoryId,
      expenseLineId: line.id,
      amount: 0,
      currency: defaultCurrency,
      occurredOn: new Date().toISOString().slice(0, 10),
    },
  })

  useEffect(() => {
    if (open) {
      addForm.reset({
        expenseCategoryId: line.categoryId,
        expenseLineId: line.id,
        amount: 0,
        currency: defaultCurrency,
        occurredOn: new Date().toISOString().slice(0, 10),
      })
    }
  }, [open, line.id, line.categoryId, defaultCurrency, addForm])

  async function addRec(values: z.infer<typeof expenseRecordSchema>) {
    const r = await createExpenseRecord({
      ...values,
      expenseCategoryId: line.categoryId,
      expenseLineId: line.id,
    })
    if (r.ok) {
      toast.success("Record added")
      addForm.reset({
        expenseCategoryId: line.categoryId,
        expenseLineId: line.id,
        amount: 0,
        currency: defaultCurrency,
        occurredOn: new Date().toISOString().slice(0, 10),
      })
      onSaved()
    } else toast.error(r.error)
  }

  const expRecordFormId = `budget-expense-record-${line.id}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">Records — {line.name}</DialogTitle>
          <Button type="submit" form={expRecordFormId} size="sm" className="shrink-0">
            Add record
          </Button>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground h-14 text-center">
                  No records.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.occurredOn}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(Number(r.amount), r.currency ?? "AED")}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={async () => {
                        const res = await deleteExpenseRecord(r.id)
                        if (res.ok) {
                          toast.success("Removed")
                          onSaved()
                        } else toast.error(res.error)
                      }}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <Form {...addForm}>
          <form
            id={expRecordFormId}
            onSubmit={addForm.handleSubmit(addRec)}
            className="flex flex-wrap gap-2 border-t pt-4"
          >
            <input type="hidden" {...addForm.register("expenseCategoryId")} />
            <input type="hidden" {...addForm.register("expenseLineId")} />
            <FormField
              control={addForm.control}
              name="amount"
              render={({ field }) => (
                <FormItem className="min-w-[100px] flex-1">
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={addForm.control}
              name="currency"
              render={({ field }) => (
                <FormItem className="min-w-[100px]">
                  <FormLabel>CCY</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={addForm.control}
              name="occurredOn"
              render={({ field }) => (
                <FormItem className="min-w-[140px]">
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
