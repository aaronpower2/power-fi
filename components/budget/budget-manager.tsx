"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import {
  useEffect,
  useMemo,
  useState,
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
import type { getBudgetPageData } from "@/lib/data/budget"
import { formatCurrency } from "@/lib/format"
import {
  expenseCategorySchema,
  expenseLineSchema,
  expenseRecordSchema,
  incomeLineSchema,
  incomeRecordSchema,
  updateExpenseCategorySchema,
  updateExpenseLineSchema,
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
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts"
import { z } from "zod"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>

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
      <div className="font-heading grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-1 text-lg font-semibold tabular-nums leading-tight xl:text-xl">
        <span className="min-w-0 truncate">{formatSummaryCcyValue(ccy, planned)}</span>
        <span className="text-muted-foreground shrink-0 text-base font-normal xl:text-lg">/</span>
        <span className="min-w-0 truncate text-end">{formatSummaryCcyValue(ccy, actual)}</span>
      </div>
      <div className="text-muted-foreground grid grid-cols-[1fr_auto_1fr] gap-x-1 text-xs font-medium tracking-wide uppercase">
        <span className="min-w-0 truncate">Planned</span>
        <span aria-hidden className="pointer-events-none shrink-0 select-none opacity-0">
          /
        </span>
        <span className="min-w-0 truncate text-end">Actual</span>
      </div>
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
  | "create"
  | { edit: BudgetData["expenseCategories"][number] }
  | null

type ExpenseLineDialogState =
  | "create"
  | { edit: BudgetData["expenseLines"][number] }
  | null

const EXPENSE_PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
]

function ExpenseCategoryPieCard({
  data,
  onManageCategories,
}: {
  data: BudgetData
  onManageCategories: () => void
}) {
  const ccy = data.summaryCurrency
  const pieRows = data.expenseCategories
    .map((c) => ({
      id: c.id,
      name: c.name,
      value: data.expensePlannedByCategoryId[c.id] ?? 0,
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)

  const totalPlanned = pieRows.reduce((s, d) => s + d.value, 0)

  return (
    <Card size="sm">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardHeaderTitleRow
          title={<CardTitle>Expense categories</CardTitle>}
          info="Planned amounts for this month, rolled up by category and converted to your summary currency (same as the summary cards)."
        />
        <Button size="sm" variant="default" className="shrink-0" onClick={onManageCategories}>
          Manage categories
        </Button>
      </CardHeader>
      <CardContent className="pt-0 pb-3">
        {pieRows.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            {data.expenseCategories.length === 0
              ? "Add categories (with optional recurring budgets), then lines, to see planned spending by category."
              : "No planned amounts this month yet — set a recurring budget on categories or finalize a past month."}
          </p>
        ) : (
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
            <div className="h-[168px] w-full max-w-[200px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieRows}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={38}
                    outerRadius={64}
                    paddingAngle={2}
                  >
                    {pieRows.map((_, i) => (
                      <Cell key={pieRows[i]!.id} fill={EXPENSE_PIE_COLORS[i % EXPENSE_PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    content={({ active, payload }) => (
                      <ExpensePieTooltip
                        active={active}
                        payload={payload}
                        total={totalPlanned}
                        currency={ccy}
                      />
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="text-muted-foreground w-full max-w-md space-y-1 text-xs sm:flex-1 sm:text-sm">
              {pieRows.map((row, i) => {
                const pct = totalPlanned > 0 ? (row.value / totalPlanned) * 100 : 0
                return (
                  <li key={row.id} className="flex items-center gap-1.5">
                    <span
                      className="size-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: EXPENSE_PIE_COLORS[i % EXPENSE_PIE_COLORS.length] }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.name}</span>
                    <span className="tabular-nums">{pct.toFixed(0)}%</span>
                    <span className="text-foreground w-28 shrink-0 text-right tabular-nums">
                      {formatCurrency(row.value, ccy, { maximumFractionDigits: 0 })}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
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
  const raw = p?.value
  const value = typeof raw === "number" ? raw : Number(raw ?? 0)
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div
      className="rounded-md border bg-card px-3 py-2 text-sm shadow-md"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="font-medium">{name}</div>
      <div className="text-muted-foreground tabular-nums">
        {formatCurrency(value, currency, { maximumFractionDigits: 0 })} ({pct.toFixed(1)}%)
      </div>
    </div>
  )
}

type ExpenseCategoryDraft = {
  name: string
  isRecurring: boolean
  frequency: BudgetRecurringFrequency
  recurringAmount: string
  recurringCurrency: string
}

function normalizeWholeCurrencyAmountInput(value: string | number | null | undefined) {
  if (value == null || value === "") return ""
  return String(value).replace(/\..*$/, "")
}

function expenseCategoryToDraft(c: BudgetData["expenseCategories"][number]): ExpenseCategoryDraft {
  return {
    name: c.name,
    isRecurring: c.isRecurring,
    frequency: parseBudgetFrequency(c.frequency) ?? "monthly",
    recurringAmount: normalizeWholeCurrencyAmountInput(c.recurringAmount),
    recurringCurrency: c.isRecurring ? (c.recurringCurrency ?? "AED") : "AED",
  }
}

function expenseCategoryDraftMatchesServer(
  draft: ExpenseCategoryDraft,
  c: BudgetData["expenseCategories"][number],
): boolean {
  const s = expenseCategoryToDraft(c)
  return (
    draft.name === s.name &&
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
    isRecurring: draft.isRecurring,
    frequency: draft.isRecurring ? draft.frequency : null,
    recurringAmount: parsedAmount,
    recurringCurrency: draft.isRecurring ? draft.recurringCurrency : null,
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
  const [drafts, setDrafts] = useState<Record<string, ExpenseCategoryDraft>>({})
  const [isSavingAll, startSavingAll] = useTransition()

  const categoriesKey = useMemo(
    () =>
      categories
        .map((c) =>
          [c.id, c.name, c.sortOrder, c.isRecurring, c.frequency ?? "", c.recurringAmount ?? "", c.recurringCurrency ?? ""].join(
            "\0",
          ),
        )
        .join("\n"),
    [categories],
  )

  useEffect(() => {
    setDrafts(
      Object.fromEntries(categories.map((c) => [c.id, expenseCategoryToDraft(c)])) as Record<
        string,
        ExpenseCategoryDraft
      >,
    )
  }, [categoriesKey, categories, open])

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
            Edit name and planned budget per row, then <span className="font-medium">Save</span>. Expense
            lines under each category track actual spend.
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

  const [activeTab, setActiveTab] = useState("income")
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
              info="Planned from recurring rules on each expense category (or a finalized snapshot); actual from expense line records in this UTC month. Amounts use the summary currency you select."
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
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
  open,
  onOpenChange,
  onSaved,
}: {
  line: { id: string; name: string; isRecurring: boolean }
  records: { id: string; amount: string; occurredOn: string; currency: string | null }[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const addForm = useForm<z.infer<typeof incomeRecordSchema>>({
    resolver: zodResolver(incomeRecordSchema),
    defaultValues: {
      incomeLineId: line.id,
      amount: 0,
      currency: "AED",
      occurredOn: new Date().toISOString().slice(0, 10),
    },
  })

  useEffect(() => {
    if (open) {
      addForm.reset({
        incomeLineId: line.id,
        amount: 0,
        currency: "AED",
        occurredOn: new Date().toISOString().slice(0, 10),
      })
    }
  }, [open, line.id, addForm])

  async function addRec(values: z.infer<typeof incomeRecordSchema>) {
    const r = await createIncomeRecord({ ...values, incomeLineId: line.id })
    if (r.ok) {
      toast.success("Record added")
      addForm.reset({
        incomeLineId: line.id,
        amount: 0,
        currency: "AED",
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
  refresh,
  catDialog,
  setCatDialog,
  lineDialog,
  setLineDialog,
  categoriesManageOpen,
  setCategoriesManageOpen,
}: {
  data: BudgetData
  refresh: () => void
  catDialog: ExpenseCatDialogState
  setCatDialog: Dispatch<SetStateAction<ExpenseCatDialogState>>
  lineDialog: ExpenseLineDialogState
  setLineDialog: Dispatch<SetStateAction<ExpenseLineDialogState>>
  categoriesManageOpen: boolean
  setCategoriesManageOpen: Dispatch<SetStateAction<boolean>>
}) {
  const [recLine, setRecLine] = useState<(typeof data.expenseLines)[0] | null>(null)
  const [delCat, setDelCat] = useState<string | null>(null)
  const [delLine, setDelLine] = useState<string | null>(null)
  const [importTxOpen, setImportTxOpen] = useState(false)

  return (
    <div className="space-y-6">
      <ExpenseCategoryPieCard
        data={data}
        onManageCategories={() => setCategoriesManageOpen(true)}
      />

      <ExpenseCategoriesManageDialog
        open={categoriesManageOpen}
        onOpenChange={setCategoriesManageOpen}
        categories={data.expenseCategories}
        onAdd={() => setCatDialog("create")}
        onRequestDelete={(id) => {
          setCategoriesManageOpen(false)
          setDelCat(id)
        }}
        refresh={refresh}
      />

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardHeaderTitleRow
            title={<CardTitle>Expense lines</CardTitle>}
            info={
              <>
                Planned budgets are set on each category (see pie card). Lines are for detail: post actuals
                here or use Import &amp; match transactions. Amounts stay in each line&apos;s native
                currencies.
              </>
            }
          />
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => setImportTxOpen(true)}
            >
              <FileSearch className="size-4" />
              Import &amp; match
            </Button>
            <Button size="sm" variant="default" className="shrink-0" onClick={() => setLineDialog("create")}>
              Add expense line
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expenseLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground h-16 text-center">
                    <span className="inline-flex items-center gap-1">
                      None yet
                      <InfoTooltip>Add a category, then use the card header buttons above.</InfoTooltip>
                    </span>
                  </TableCell>
                </TableRow>
              ) : (
                data.expenseLines.map((el) => {
                  const actual = data.expenseActualByLineNative[el.id]
                  return (
                    <TableRow key={el.id}>
                      <TableCell className="text-muted-foreground text-sm">{el.categoryName}</TableCell>
                      <TableCell className="font-medium">{el.name}</TableCell>
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
                              <DropdownMenuItem onClick={() => setRecLine(el)}>
                                <ClipboardList className="size-4 opacity-70" />
                                Records
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setLineDialog({ edit: el })}>
                                <Pencil className="size-4 opacity-70" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={(e) => {
                                  e.preventDefault()
                                  setDelLine(el.id)
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

      <Dialog open={importTxOpen} onOpenChange={setImportTxOpen}>
        <DialogContent showCloseButton fullViewport>
          <DialogHeader className="border-b px-4 py-3 pr-14 shrink-0 space-y-0 text-left">
            <DialogTitle>Import &amp; match transactions</DialogTitle>
            <p className="text-muted-foreground text-sm font-normal">
              Budget month {data.ym} (UTC). Posted expense lines update actuals on this tab.
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
        category={catDialog && catDialog !== "create" ? catDialog.edit : undefined}
        onSaved={() => {
          setCatDialog(null)
          refresh()
        }}
      />

      <ExpenseLineFormDialog
        open={lineDialog !== null}
        onOpenChange={(o) => !o && setLineDialog(null)}
        categories={data.expenseCategories}
        line={lineDialog && lineDialog !== "create" ? lineDialog.edit : undefined}
        onSaved={() => {
          setLineDialog(null)
          refresh()
        }}
      />

      {recLine ? (
        <ExpenseRecordsDialog
          line={recLine}
          records={data.expenseRecordsByLineId[recLine.id] ?? []}
          open={!!recLine}
          onOpenChange={(o) => !o && setRecLine(null)}
          onSaved={refresh}
        />
      ) : null}

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

      <AlertDialog open={!!delLine} onOpenChange={(o) => !o && setDelLine(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense line?</AlertDialogTitle>
            <AlertDialogDescription>Deletes all records for this line.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!delLine) return
                const r = await deleteExpenseLine(delLine)
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

type ExpenseCategoryFormValues = {
  name: string
  sortOrder: number
  isRecurring: boolean
  frequency: BudgetRecurringFrequency
  recurringAmount: string
  recurringCurrency: string
}

function ExpenseCategoryFormDialog({
  open,
  onOpenChange,
  category,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  category?: BudgetData["expenseCategories"][number]
  onSaved: () => void
}) {
  const isEdit = !!category
  const form = useForm<ExpenseCategoryFormValues>({
    defaultValues: {
      name: "",
      sortOrder: 0,
      isRecurring: false,
      frequency: "monthly",
      recurringAmount: "",
      recurringCurrency: "AED",
    },
  })
  const catIsRecurring = useWatch({ control: form.control, name: "isRecurring" })

  useEffect(() => {
    if (open) {
      const freq = parseBudgetFrequency(category?.frequency ?? null) ?? "monthly"
      form.reset({
        name: category?.name ?? "",
        sortOrder: category?.sortOrder ?? 0,
        isRecurring: category?.isRecurring ?? false,
        frequency: freq,
        recurringAmount:
          category?.recurringAmount != null && category.recurringAmount !== ""
            ? String(category.recurringAmount)
            : "",
        recurringCurrency: category?.recurringCurrency ?? "AED",
      })
    }
  }, [open, category, form])

  async function onSubmit(values: ExpenseCategoryFormValues) {
    const parsedAmount =
      values.isRecurring && values.recurringAmount.trim() !== ""
        ? Number(values.recurringAmount)
        : null
    const body = {
      name: values.name,
      sortOrder: values.sortOrder,
      isRecurring: values.isRecurring,
      frequency: values.isRecurring ? values.frequency : null,
      recurringAmount: parsedAmount,
      recurringCurrency: values.isRecurring ? values.recurringCurrency : null,
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
}

function ExpenseLineFormDialog({
  open,
  onOpenChange,
  categories,
  line,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  categories: { id: string; name: string }[]
  line?: BudgetData["expenseLines"][number]
  onSaved: () => void
}) {
  const isEdit = !!line
  const form = useForm<ExpenseLineFormValues>({
    defaultValues: {
      categoryId: line?.categoryId ?? categories[0]?.id ?? "",
      name: "",
    },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        categoryId: line?.categoryId ?? categories[0]?.id ?? "",
        name: line?.name ?? "",
      })
    }
  }, [open, line, categories, form])

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
      const p = expenseLineSchema.safeParse(body)
      if (!p.success) {
        toast.error(p.error.issues.map((i: { message: string }) => i.message).join(" "))
        return
      }
      const r = await createExpenseLine(p.data)
      if (r.ok) {
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
              <InfoTooltip>Add an expense category from the Expenses tab before creating a line.</InfoTooltip>
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
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function ExpenseRecordsDialog({
  line,
  records,
  open,
  onOpenChange,
  onSaved,
}: {
  line: { id: string; name: string }
  records: { id: string; amount: string; occurredOn: string; currency?: string | null }[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const addForm = useForm<z.infer<typeof expenseRecordSchema>>({
    resolver: zodResolver(expenseRecordSchema),
    defaultValues: {
      expenseLineId: line.id,
      amount: 0,
      currency: "AED",
      occurredOn: new Date().toISOString().slice(0, 10),
    },
  })

  useEffect(() => {
    if (open) {
      addForm.reset({
        expenseLineId: line.id,
        amount: 0,
        currency: "AED",
        occurredOn: new Date().toISOString().slice(0, 10),
      })
    }
  }, [open, line.id, addForm])

  async function addRec(values: z.infer<typeof expenseRecordSchema>) {
    const r = await createExpenseRecord({ ...values, expenseLineId: line.id })
    if (r.ok) {
      toast.success("Record added")
      addForm.reset({
        expenseLineId: line.id,
        amount: 0,
        currency: "AED",
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
