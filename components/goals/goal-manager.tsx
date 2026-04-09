"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { type Control, useFieldArray, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import {
  createGoal,
  deleteGoal,
  setActiveGoal,
  updateGoal,
} from "@/lib/actions/goal"
import { SUPPORTED_CURRENCIES } from "@/lib/currency/iso4217"
import type { BudgetCategoryPlannedForGoalCopy } from "@/lib/data/budget-categories-for-goal"
import type { FiPlanPageData } from "@/lib/data/fi-plan"
import type { GoalWithLifestyle } from "@/lib/data/goals"
import { convertAmount } from "@/lib/currency/convert"
import { formatGoalDisplayName } from "@/lib/goals/labels"
import { formatCurrency } from "@/lib/format"
import {
  createGoalSchema,
  goalInputSchema,
  updateGoalSchema,
  type CreateGoalInput,
  type GoalInput,
  type UpdateGoalInput,
} from "@/lib/validations/goal"
import { goals } from "@/lib/db/schema"
import { dashboardRoutes } from "@/lib/routes"
import { CardHeaderTitleRow, InfoTooltip } from "@/components/info-tooltip"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { IntegerInput, PercentInput } from "@/components/ui/numeric-input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { CheckCircle2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"

type BudgetCategoriesForLifestyleCopyPayload = {
  categories: BudgetCategoryPlannedForGoalCopy[]
  fxRatesFromBase: Record<string, number> | null
  fxAsOfDate: string | null
}

type CopyRow = BudgetCategoryPlannedForGoalCopy & {
  amountInGoal: number | null
  selectable: boolean
  reasonDisabled: string | null
}

function roundToSingleDecimal(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.round(value * 10) / 10
}

function normalizeGoalPercentValues<T extends {
  withdrawalRatePercent: number
  targetSavingsRatePercent: number | null | undefined
}>(values: T): T {
  return {
    ...values,
    withdrawalRatePercent: roundToSingleDecimal(values.withdrawalRatePercent) ?? values.withdrawalRatePercent,
    targetSavingsRatePercent:
      values.targetSavingsRatePercent == null
        ? null
        : (roundToSingleDecimal(values.targetSavingsRatePercent) ?? values.targetSavingsRatePercent),
  }
}

function GoalPlanMetric({
  title,
  value,
  detail,
}: {
  title: string
  value: string
  detail?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
        {detail ? <p className="text-muted-foreground mt-1 text-xs">{detail}</p> : null}
      </CardContent>
    </Card>
  )
}

function CopyBudgetCategoriesIntoLifestyle({
  categories,
  fxRatesFromBase,
  fxAsOfDate,
  goalCurrency,
  onAppendLines,
}: {
  categories: BudgetCategoryPlannedForGoalCopy[]
  fxRatesFromBase: Record<string, number> | null
  fxAsOfDate: string | null
  goalCurrency: string
  onAppendLines: (lines: { name: string; monthlyAmount: number }[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const rateMap = useMemo(
    () => (fxRatesFromBase ? new Map(Object.entries(fxRatesFromBase)) : null),
    [fxRatesFromBase],
  )

  const rows: CopyRow[] = useMemo(() => {
    const g = goalCurrency.trim().toUpperCase()
    return categories.map((c) => {
      const native = c.monthlyAmountNative
      const from = c.nativeCurrency.trim().toUpperCase()
      let amountInGoal: number | null = native
      let reasonDisabled: string | null = null

      if (native <= 0) {
        reasonDisabled = "No recurring budget on this category"
      } else if (from !== g) {
        if (!rateMap) {
          amountInGoal = null
          reasonDisabled = "FX rates unavailable — cannot convert to goal currency"
        } else {
          const conv = convertAmount(native, from, g, rateMap)
          if (conv == null || !Number.isFinite(conv)) {
            amountInGoal = null
            reasonDisabled = `Could not convert ${from} to ${g}`
          } else {
            amountInGoal = Math.round(conv * 100) / 100
          }
        }
      } else {
        amountInGoal = Math.round(native * 100) / 100
      }

      if (reasonDisabled == null && native > 0 && amountInGoal != null && amountInGoal < 0.01) {
        reasonDisabled = "Planned amount below 0.01 in goal currency"
      }

      const selectable = reasonDisabled == null && amountInGoal != null && amountInGoal >= 0.01

      return {
        ...c,
        amountInGoal,
        selectable,
        reasonDisabled: selectable ? null : reasonDisabled,
      }
    })
  }, [categories, goalCurrency, rateMap])

  const selectableIds = useMemo(() => rows.filter((r) => r.selectable).map((r) => r.id), [rows])
  const needsFx = useMemo(
    () =>
      categories.some(
        (c) =>
          c.monthlyAmountNative > 0 &&
          c.nativeCurrency.trim().toUpperCase() !== goalCurrency.trim().toUpperCase(),
      ),
    [categories, goalCurrency],
  )

  function toggleId(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllSelectable() {
    setSelected(new Set(selectableIds))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setSelected(new Set())
  }

  function apply() {
    const toAdd = rows
      .filter((r) => r.selectable && selected.has(r.id))
      .map((r) => ({
        name: r.name,
        monthlyAmount: r.amountInGoal!,
      }))
    if (toAdd.length === 0) return
    onAppendLines(toAdd)
    setOpen(false)
    setSelected(new Set())
  }

  const selectedCount = rows.filter((r) => r.selectable && selected.has(r.id)).length

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1">
          <Plus className="size-4" />
          Copy from budget categories
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex w-[min(100vw-2rem,42rem)] max-w-none flex-col gap-0 overflow-hidden p-0"
        align="start"
        sideOffset={8}
      >
        <div className="border-border shrink-0 border-b px-4 py-3">
          <p className="text-sm font-semibold">Copy budget into lifestyle</p>
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
            Uses each category&apos;s smoothed monthly plan (same as Cash Flow). New lines are appended; edit or remove
            afterward. Goal currency: <span className="text-foreground font-medium">{goalCurrency}</span>
            {fxAsOfDate ? (
              <span className="mt-1 block">FX as of {fxAsOfDate} when converting.</span>
            ) : needsFx ? (
              <span className="text-destructive mt-1 block">
                No FX snapshot — run <code className="text-xs">pnpm fx:sync</code> to convert other currencies.
              </span>
            ) : null}
          </p>
        </div>
        <div className="max-h-[min(20rem,50vh)] overflow-y-auto px-4 py-2">
          {categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No expense categories yet. Add them under Cash Flow, then set recurring plans on categories you want here.
            </p>
          ) : selectableIds.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No categories have a convertible monthly plan for {goalCurrency}. Set recurring category budgets under
              Cash Flow first.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={selectAllSelectable}>
                  Select all with budget
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
              <div className="space-y-0.5">
                <div className="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 text-xs font-medium">
                  <span className="sr-only">Include</span>
                  <span>Category</span>
                  <span className="whitespace-nowrap text-end">/ mo ({goalCurrency})</span>
                </div>
                <ul className="divide-border divide-y">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 py-2.5"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 shrink-0 accent-primary"
                        checked={selected.has(r.id)}
                        disabled={!r.selectable}
                        onChange={() => toggleId(r.id)}
                        aria-label={`Include ${r.name}`}
                      />
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm leading-snug font-medium wrap-break-word">{r.name}</p>
                        {!r.selectable && r.reasonDisabled ? (
                          <p className="text-muted-foreground text-xs leading-snug wrap-break-word">
                            {r.reasonDisabled}
                          </p>
                        ) : r.nativeCurrency.trim().toUpperCase() !== goalCurrency.trim().toUpperCase() ? (
                          <p className="text-muted-foreground text-xs leading-snug wrap-break-word tabular-nums">
                            {formatCurrency(r.monthlyAmountNative, r.nativeCurrency)} planned
                          </p>
                        ) : null}
                      </div>
                      <p className="text-foreground shrink-0 self-center text-end text-sm whitespace-nowrap tabular-nums">
                        {r.amountInGoal != null ? formatCurrency(r.amountInGoal, goalCurrency) : "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        <div className="border-border flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
          <Button type="button" size="sm" disabled={selectedCount === 0} onClick={apply}>
            Add {selectedCount || "…"} {selectedCount === 1 ? "line" : "lines"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type GoalRow = typeof goals.$inferSelect

/** Narrow slice shared by create/update goal forms for `useFieldArray`. */
type GoalLifestyleFormValues = {
  lifestyleLines: { name: string; monthlyAmount: number }[]
}

function LifestyleLinesFields({
  control,
  currencyCode,
  budgetCategoriesForLifestyleCopy,
}: {
  control: Control<GoalLifestyleFormValues>
  currencyCode: string
  budgetCategoriesForLifestyleCopy: BudgetCategoriesForLifestyleCopyPayload
}) {
  const { fields, append, remove } = useFieldArray<GoalLifestyleFormValues, "lifestyleLines">({
    control,
    name: "lifestyleLines",
  })
  const lines = useWatch({ control, name: "lifestyleLines" })
  const total =
    lines?.reduce((s: number, l: { monthlyAmount?: unknown }) => {
      const n = typeof l?.monthlyAmount === "number" ? l.monthlyAmount : Number(l?.monthlyAmount)
      return s + (Number.isFinite(n) ? n : 0)
    }, 0) ?? 0

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <Label className="text-foreground">Lifestyle lines</Label>
          <InfoTooltip>
            Name each part of your target lifestyle. Amounts are monthly costs in your goal currency (
            {currencyCode}).
          </InfoTooltip>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          <span className="text-foreground font-medium">{formatCurrency(total, currencyCode)}</span>
          <span className="text-muted-foreground"> / mo</span>
        </p>
      </div>
      <div className="space-y-2">
        <div className="hidden text-sm font-medium sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_2.25rem] sm:gap-2">
          <span>Line</span>
          <span>Amount/mo</span>
          <span className="sr-only">Remove</span>
        </div>
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_2.25rem] sm:items-center sm:gap-2"
          >
            <FormField
              control={control}
              name={`lifestyleLines.${index}.name`}
              render={({ field: f }) => (
                <FormItem className="min-w-0 gap-1.5">
                  <FormLabel className="sr-only">Line {index + 1}</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Housing" {...f} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`lifestyleLines.${index}.monthlyAmount`}
              render={({ field: f }) => (
                <FormItem className="w-full gap-1.5 sm:w-36">
                  <FormLabel className="sr-only">Monthly cost (line {index + 1})</FormLabel>
                  <FormControl>
                    <IntegerInput min={1} placeholder="0" {...f} onValueChange={f.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end sm:justify-center">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-9 shrink-0"
                disabled={fields.length <= 1}
                onClick={() => remove(index)}
                aria-label={`Remove lifestyle line ${index + 1}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => append({ name: "", monthlyAmount: 1 })}
        >
          <Plus className="size-4" />
          Add line
        </Button>
        <CopyBudgetCategoriesIntoLifestyle
          categories={budgetCategoriesForLifestyleCopy.categories}
          fxRatesFromBase={budgetCategoriesForLifestyleCopy.fxRatesFromBase}
          fxAsOfDate={budgetCategoriesForLifestyleCopy.fxAsOfDate}
          goalCurrency={currencyCode}
          onAppendLines={(lines) => {
            for (const line of lines) {
              append(line)
            }
          }}
        />
      </div>
    </div>
  )
}

export function GoalManager({
  items,
  budgetCategoriesForLifestyleCopy,
  planningData,
}: {
  items: GoalWithLifestyle[]
  budgetCategoriesForLifestyleCopy: BudgetCategoriesForLifestyleCopyPayload
  planningData: FiPlanPageData
}) {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editing, setEditing] = useState<GoalWithLifestyle | null>(null)

  const refresh = () => router.refresh()
  const activeGoal = items.find((item) => item.goal.id === planningData.summary.reportingGoalId) ?? null

  return (
    <div className="space-y-8">
      <PageHeader
        title="Goal"
        contentMaxWidth="3xl"
        description="Set your FI date, lifestyle funding, and withdrawal rate. The active goal powers FI Summary and projections; achievability and status live there."
        controls={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-muted-foreground min-w-0 flex-1 text-sm">
              {activeGoal ? (
                <div className="min-w-0 space-y-0.5">
                  <p className="text-foreground font-semibold leading-tight">
                    {formatGoalDisplayName(activeGoal.goal)}
                  </p>
                  <p>Active plan for FI Summary and projection outputs.</p>
                </div>
              ) : (
                <p className="leading-snug">
                  No active goal yet — mark one below to power FI Summary and projections.
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <div
                className="bg-muted/40 inline-flex rounded-lg border p-0.5"
                role="group"
                aria-label="Reporting currency for projection snapshot"
              >
                {planningData.summaryCurrencyOptions.map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    variant={planningData.summary.reportingCurrency === code ? "secondary" : "ghost"}
                    className="h-7 min-w-12 px-2.5 text-xs font-medium"
                    onClick={() => {
                      router.push(`${dashboardRoutes.goal}?ccy=${encodeURIComponent(code)}`)
                    }}
                  >
                    {code}
                  </Button>
                ))}
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="size-4 shrink-0" aria-hidden />
                New goal
              </Button>
            </div>
          </div>
        }
      />

      {planningData.summary.fxWarning ? (
        <p className="text-destructive bg-destructive/10 rounded-md border border-destructive/20 px-3 py-2 text-sm">
          {planningData.summary.fxWarning}
        </p>
      ) : null}

      {activeGoal ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <GoalPlanMetric
            title="Required FI number"
            value={formatCurrency(
              planningData.summary.requiredPrincipal ?? null,
              planningData.summary.reportingCurrency,
              {
                maximumFractionDigits: 0,
              },
            )}
          />
          <GoalPlanMetric
            title="Projected at FI date"
            value={formatCurrency(
              planningData.projectedNetWorthAtFi ?? null,
              planningData.summary.reportingCurrency,
              {
                maximumFractionDigits: 0,
              },
            )}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardHeaderTitleRow
            title={<CardTitle>Saved goals</CardTitle>}
            info={
              <>
                The goal marked <span className="text-foreground font-medium">Active</span> is used for FI summary and
                projections. Required portfolio uses: (sum of lifestyle lines × 12) ÷ withdrawal rate. Withdrawal rate
                is stored as a decimal; you enter percent when editing.
              </>
            }
          />
        </CardHeader>
        <CardContent>
          {items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>FI date</TableHead>
                  <TableHead>Monthly need</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(({ goal: g }) => (
                  <TableRow key={g.id}>
                    <TableCell className="max-w-48 min-w-0 font-medium wrap-break-word">
                      {formatGoalDisplayName(g)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{g.fiDate}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatCurrency(Number(g.monthlyFundingRequirement), g.currency ?? "USD")}
                    </TableCell>
                    <TableCell>
                      {g.isActive ? (
                        <span className="bg-primary/15 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              const row = items.find((i) => i.goal.id === g.id)
                              if (row) setEditing(row)
                            }}
                          >
                            <Pencil className="size-4 opacity-70" />
                            Edit
                          </DropdownMenuItem>
                          {!g.isActive ? (
                            <DropdownMenuItem
                              onClick={async () => {
                                const r = await setActiveGoal(g.id)
                                if (r.ok) {
                                  toast.success("Goal activated")
                                  refresh()
                                } else toast.error(r.error)
                              }}
                            >
                              <CheckCircle2 className="size-4 opacity-70" />
                              Set active
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={(e) => {
                              e.preventDefault()
                              setPendingDelete(g.id)
                            }}
                          >
                            <Trash2 className="size-4 opacity-70" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">
              No goals yet. Create one with <span className="text-foreground font-medium">New goal</span>.
            </p>
          )}
        </CardContent>
      </Card>

      <EditGoalDialog
        item={editing}
        open={editing != null}
        onOpenChange={(o) => {
          if (!o) setEditing(null)
        }}
        budgetCategoriesForLifestyleCopy={budgetCategoriesForLifestyleCopy}
        onSaved={() => {
          setEditing(null)
          refresh()
        }}
      />

      <CreateGoalDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={refresh}
        budgetCategoriesForLifestyleCopy={budgetCategoriesForLifestyleCopy}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete goal?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!pendingDelete) return
                const r = await deleteGoal(pendingDelete)
                setPendingDelete(null)
                if (r.ok) {
                  toast.success("Goal deleted")
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

function defaultLifestyleLines(
  goal: GoalRow,
  lines: GoalWithLifestyle["lifestyleLines"],
): GoalInput["lifestyleLines"] {
  if (lines.length > 0) {
    return lines.map((l) => ({
      name: l.name,
      monthlyAmount: Number(l.monthlyAmount),
    }))
  }
  return [{ name: "Lifestyle", monthlyAmount: Number(goal.monthlyFundingRequirement) }]
}

function GoalEditForm({
  goal,
  lifestyleLines,
  budgetCategoriesForLifestyleCopy,
  onSuccess,
  formId,
}: {
  goal: GoalRow
  lifestyleLines: GoalWithLifestyle["lifestyleLines"]
  budgetCategoriesForLifestyleCopy: BudgetCategoriesForLifestyleCopyPayload
  onSuccess: () => void
  formId: string
}) {
  const form = useForm<UpdateGoalInput>({
    resolver: zodResolver(updateGoalSchema),
    defaultValues: {
      id: goal.id,
      name: goal.name?.trim() ? goal.name : "",
      currency: (goal.currency ?? "USD") as UpdateGoalInput["currency"],
      fiDate: goal.fiDate,
      withdrawalRatePercent: Number(goal.withdrawalRate) * 100,
      targetSavingsRatePercent:
        goal.targetSavingsRate != null ? Number(goal.targetSavingsRate) * 100 : null,
      lifestyleLines: defaultLifestyleLines(goal, lifestyleLines),
    },
  })
  const goalCurrency = useWatch({ control: form.control, name: "currency" }) ?? "USD"

  async function onSubmit(values: UpdateGoalInput) {
    const r = await updateGoal(normalizeGoalPercentValues(values))
    if (r.ok) {
      toast.success("Goal updated")
      onSuccess()
    } else toast.error(r.error)
  }

  return (
    <Form {...form}>
      <form id={formId} onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center gap-1">
                <FormLabel>Goal name</FormLabel>
                <InfoTooltip>Shown in FI summary and goal lists. Use something you’ll recognize (e.g. Lean FIRE, NZ base).</InfoTooltip>
              </div>
              <FormControl>
                <Input placeholder="e.g. Coast FI — NZ" autoComplete="off" {...field} />
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
                  <div className="flex items-center gap-1">
                    <FormLabel>Goal currency</FormLabel>
                    <InfoTooltip>Lifestyle amounts and FI summary use this currency.</InfoTooltip>
                  </div>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Currency" />
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
          name="fiDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>FI date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
            <FormField
              control={form.control}
              name="withdrawalRatePercent"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-1">
                    <FormLabel>Withdrawal rate (%)</FormLabel>
                    <InfoTooltip>Annual rate; enter 4 for the 4% rule (stored as a decimal internally).</InfoTooltip>
                  </div>
                  <FormControl>
                    <PercentInput
                      min={0.1}
                      max={50}
                      {...field}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="targetSavingsRatePercent"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-1">
                    <FormLabel>Target savings rate (%)</FormLabel>
                    <InfoTooltip>
                      Optional benchmark for the Summary dashboard savings-rate card. Leave blank to
                      use the default 40%.
                    </InfoTooltip>
                  </div>
                  <FormControl>
                    <PercentInput
                      min={0}
                      max={100}
                      placeholder="40.0"
                      {...field}
                      value={typeof field.value === "number" || typeof field.value === "string" ? field.value : ""}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
        <LifestyleLinesFields
          control={form.control as unknown as Control<GoalLifestyleFormValues>}
          currencyCode={goalCurrency}
          budgetCategoriesForLifestyleCopy={budgetCategoriesForLifestyleCopy}
        />
      </form>
    </Form>
  )
}

function EditGoalDialog({
  item,
  open,
  onOpenChange,
  budgetCategoriesForLifestyleCopy,
  onSaved,
}: {
  item: GoalWithLifestyle | null
  open: boolean
  onOpenChange: (open: boolean) => void
  budgetCategoriesForLifestyleCopy: BudgetCategoriesForLifestyleCopyPayload
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullViewport
        className="inset-4 max-h-[calc(100dvh-2rem)] sm:inset-6 sm:max-h-[calc(100dvh-3rem)]"
      >
        <DialogHeader className="border-border flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b px-6 py-4 pr-14">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <DialogTitle>Edit goal</DialogTitle>
            <InfoTooltip>
              Updates this plan only. The row marked <span className="text-foreground font-medium">Active</span> in
              the table is what FI summary uses.
            </InfoTooltip>
          </div>
          <Button type="submit" form="goal-edit-form" size="sm" className="shrink-0">
            Save
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {item ? (
            <GoalEditForm
              key={item.goal.id}
              goal={item.goal}
              lifestyleLines={item.lifestyleLines}
              formId="goal-edit-form"
              budgetCategoriesForLifestyleCopy={budgetCategoriesForLifestyleCopy}
              onSuccess={onSaved}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CreateGoalDialog({
  open,
  onOpenChange,
  onCreated,
  budgetCategoriesForLifestyleCopy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  budgetCategoriesForLifestyleCopy: BudgetCategoriesForLifestyleCopyPayload
}) {
  const [makeActive, setMakeActive] = useState(true)

  const form = useForm<GoalInput>({
    resolver: zodResolver(goalInputSchema),
    defaultValues: {
      name: "",
      currency: "USD",
      fiDate: "",
      withdrawalRatePercent: 4,
      targetSavingsRatePercent: null,
      lifestyleLines: [
        { name: "Core living", monthlyAmount: 3000 },
        { name: "Discretionary", monthlyAmount: 2000 },
      ],
    },
  })
  const createCurrency = useWatch({ control: form.control, name: "currency" }) ?? "USD"

  async function onSubmit(values: GoalInput) {
    const payload: CreateGoalInput = { ...normalizeGoalPercentValues(values), makeActive }
    const parsed = createGoalSchema.safeParse(payload)
    if (!parsed.success) {
      toast.error(parsed.error.issues.map((i) => i.message).join(" "))
      return
    }
    const r = await createGoal(parsed.data)
    if (r.ok) {
      toast.success("Goal created")
      onOpenChange(false)
      form.reset({
        name: "",
        currency: "USD",
        fiDate: "",
        withdrawalRatePercent: 4,
        targetSavingsRatePercent: null,
        lifestyleLines: [
          { name: "Core living", monthlyAmount: 3000 },
          { name: "Discretionary", monthlyAmount: 2000 },
        ],
      })
      setMakeActive(true)
      onCreated()
    } else toast.error(r.error)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullViewport
        className="inset-4 max-h-[calc(100dvh-2rem)] sm:inset-6 sm:max-h-[calc(100dvh-3rem)]"
      >
        <DialogHeader className="border-border flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b px-6 py-4 pr-14">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <DialogTitle>Create goal</DialogTitle>
            <InfoTooltip>
              Set FI date, withdrawal rate, and lifestyle lines that sum to your monthly funding target.
            </InfoTooltip>
          </div>
          <Button type="submit" form="goal-create-form" size="sm" className="shrink-0">
            Create
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form id="goal-create-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1">
                      <FormLabel>Goal name</FormLabel>
                      <InfoTooltip>How this goal appears in FI summary and lists.</InfoTooltip>
                    </div>
                    <FormControl>
                      <Input placeholder="e.g. Baseline plan" autoComplete="off" {...field} />
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
                    <FormLabel>Goal currency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Currency" />
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
                name="fiDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>FI date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="withdrawalRatePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Withdrawal rate (%)</FormLabel>
                    <FormControl>
                      <PercentInput
                        min={0.1}
                        max={50}
                        {...field}
                        onValueChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="targetSavingsRatePercent"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1">
                      <FormLabel>Target savings rate (%)</FormLabel>
                      <InfoTooltip>
                        Optional benchmark for the Summary dashboard savings-rate card. Leave blank to
                        use the default 40%.
                      </InfoTooltip>
                    </div>
                    <FormControl>
                      <PercentInput
                        min={0}
                        max={100}
                        placeholder="40.0"
                        {...field}
                        value={typeof field.value === "number" || typeof field.value === "string" ? field.value : ""}
                        onValueChange={field.onChange}
                        onBlur={field.onBlur}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <LifestyleLinesFields
                control={form.control as unknown as Control<GoalLifestyleFormValues>}
                currencyCode={createCurrency}
                budgetCategoriesForLifestyleCopy={budgetCategoriesForLifestyleCopy}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={makeActive}
                  onChange={(e) => setMakeActive(e.target.checked)}
                />
                Set as active goal (deactivates others)
              </label>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
