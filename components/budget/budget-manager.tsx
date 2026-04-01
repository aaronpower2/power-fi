"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
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
  DialogFooter,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TransactionsTab } from "@/components/budget/transactions-tab"
import { MoreHorizontal } from "lucide-react"
import { z } from "zod"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>

function formatSummaryCcyValue(ccy: string, value: number) {
  const code = ccy.toUpperCase()
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
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
    <div className="min-w-0 space-y-0.5">
      <div className="font-heading grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-1 text-sm font-semibold tabular-nums leading-tight">
        <span className="min-w-0 truncate">{formatSummaryCcyValue(ccy, planned)}</span>
        <span className="text-muted-foreground shrink-0 font-normal">/</span>
        <span className="min-w-0 truncate text-end">{formatSummaryCcyValue(ccy, actual)}</span>
      </div>
      <div className="text-muted-foreground grid grid-cols-[1fr_auto_1fr] gap-x-1 text-[10px] font-medium tracking-wide uppercase">
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
          {formatCurrency(buckets[ccy], ccy)}
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

export function BudgetManager({ data }: { data: BudgetData }) {
  const router = useRouter()
  const refresh = () => router.refresh()

  const [activeTab, setActiveTab] = useState("income")
  const [incomeLineDialog, setIncomeLineDialog] = useState<IncomeLineDialogState>(null)
  const [expenseCatDialog, setExpenseCatDialog] = useState<ExpenseCatDialogState>(null)
  const [expenseLineDialog, setExpenseLineDialog] = useState<ExpenseLineDialogState>(null)

  return (
    <div className="space-y-6">
      {data.isPastMonth && !data.planUsesSnapshot ? (
        <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-sm">
          This month is in the past: planned column uses live line rules until you finalize (then it stays
          locked).
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
            <p className="font-heading text-primary text-2xl font-semibold leading-tight tabular-nums xl:text-3xl">
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
              info="Planned from recurring budget lines or a finalized snapshot; actual from expense records in this UTC month. Amounts use the summary currency you select."
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="income">Income</TabsTrigger>
            <TabsTrigger value="expenses">Expenses</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {activeTab === "income" ? (
              <Button size="sm" onClick={() => setIncomeLineDialog("create")}>
                Add income line
              </Button>
            ) : activeTab === "expenses" ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setExpenseCatDialog("create")}>
                  Add category
                </Button>
                <Button size="sm" onClick={() => setExpenseLineDialog("create")}>
                  Add expense line
                </Button>
              </>
            ) : null}
          </div>
        </div>
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
          />
        </TabsContent>
        <TabsContent value="transactions" className="mt-4">
          <TransactionsTab />
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardHeaderTitleRow
            title={<CardTitle>Income lines</CardTitle>}
            info={
              <>
                Planned column uses recurring rules (or a finalized snapshot for past months). Actual column is
                from records only. Line cells stay in native currencies (not converted to your goal currency).
              </>
            }
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="w-12" />
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setRecLine(line)}>Records</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLineDialog({ edit: line })}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={(e) => {
                              e.preventDefault()
                              setDelLine(line.id)
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
      recurringCurrency: "USD",
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
        recurringCurrency: line?.recurringCurrency ?? "USD",
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit income line" : "New income line"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
            <DialogFooter>
              <Button type="submit">{isEdit ? "Save" : "Create"}</Button>
            </DialogFooter>
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
      currency: "USD",
      occurredOn: new Date().toISOString().slice(0, 10),
    },
  })

  useEffect(() => {
    if (open) {
      addForm.reset({
        incomeLineId: line.id,
        amount: 0,
        currency: "USD",
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
        currency: "USD",
        occurredOn: new Date().toISOString().slice(0, 10),
      })
      onSaved()
    } else toast.error(r.error)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-1.5 pr-8">
            <DialogTitle>Records — {line.name}</DialogTitle>
            {line.isRecurring ? (
              <InfoTooltip>
                Planned pay comes from the line’s recurring rule (or snapshot). Add records here for actual cash
                received; they count only toward actual, not planned.
              </InfoTooltip>
            ) : null}
          </div>
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
                    {formatCurrency(Number(r.amount), r.currency ?? "USD")}
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
          <form onSubmit={addForm.handleSubmit(addRec)} className="flex flex-wrap gap-2 border-t pt-4">
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
            <div className="flex w-full items-end sm:w-auto">
              <Button type="submit" size="sm">
                Add record
              </Button>
            </div>
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
}: {
  data: BudgetData
  refresh: () => void
  catDialog: ExpenseCatDialogState
  setCatDialog: Dispatch<SetStateAction<ExpenseCatDialogState>>
  lineDialog: ExpenseLineDialogState
  setLineDialog: Dispatch<SetStateAction<ExpenseLineDialogState>>
}) {
  const [recLine, setRecLine] = useState<(typeof data.expenseLines)[0] | null>(null)
  const [delCat, setDelCat] = useState<string | null>(null)
  const [delLine, setDelLine] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardHeaderTitleRow
            title={<CardTitle>Categories</CardTitle>}
            info="Expense lines are grouped under a category. Add at least one category before creating lines."
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expenseCategories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-muted-foreground h-14 text-center">
                    None yet
                  </TableCell>
                </TableRow>
              ) : (
                data.expenseCategories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setCatDialog({ edit: c })}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={(e) => {
                              e.preventDefault()
                              setDelCat(c.id)
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardHeaderTitleRow
            title={<CardTitle>Expense lines</CardTitle>}
            info="Planned uses recurring rules or a finalized snapshot; actual is from records. Native currencies per line (not converted to goal currency)."
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Line</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expenseLines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-16 text-center">
                    <span className="inline-flex items-center gap-1">
                      None yet
                      <InfoTooltip>Add a category, then add lines from the toolbar.</InfoTooltip>
                    </span>
                  </TableCell>
                </TableRow>
              ) : (
                data.expenseLines.map((el) => {
                  const freq = parseBudgetFrequency(el.frequency)
                  const planned = data.expensePlannedByLineNative[el.id]
                  const actual = data.expenseActualByLineNative[el.id]
                  return (
                  <TableRow key={el.id}>
                    <TableCell className="text-muted-foreground text-sm">{el.categoryName}</TableCell>
                    <TableCell className="font-medium">
                      <div>{el.name}</div>
                      {el.isRecurring && freq ? (
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setRecLine(el)}>Records</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLineDialog({ edit: el })}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={(e) => {
                              e.preventDefault()
                              setDelLine(el.id)
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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

function ExpenseCategoryFormDialog({
  open,
  onOpenChange,
  category,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  category?: { id: string; name: string; sortOrder: number }
  onSaved: () => void
}) {
  const isEdit = !!category
  const form = useForm<{ name: string; sortOrder: number }>({
    defaultValues: { name: category?.name ?? "", sortOrder: category?.sortOrder ?? 0 },
  })

  useEffect(() => {
    if (open) {
      form.reset({ name: category?.name ?? "", sortOrder: category?.sortOrder ?? 0 })
    }
  }, [open, category, form])

  async function onSubmit(values: { name: string; sortOrder: number }) {
    if (isEdit && category) {
      const p = updateExpenseCategorySchema.safeParse({ ...values, id: category.id })
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
      const p = expenseCategorySchema.safeParse(values)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
            <DialogFooter>
              <Button type="submit">{isEdit ? "Save" : "Create"}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

type ExpenseLineFormValues = {
  categoryId: string
  name: string
  isRecurring: boolean
  frequency: BudgetRecurringFrequency
  recurringAmount: string
  recurringCurrency: string
  recurringAnchorDate: string
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
      isRecurring: false,
      frequency: "monthly",
      recurringAmount: "",
      recurringCurrency: "USD",
      recurringAnchorDate: "",
    },
  })
  const isRecurring = useWatch({ control: form.control, name: "isRecurring" })

  useEffect(() => {
    if (open) {
      const freq = parseBudgetFrequency(line?.frequency ?? null) ?? "monthly"
      form.reset({
        categoryId: line?.categoryId ?? categories[0]?.id ?? "",
        name: line?.name ?? "",
        isRecurring: line?.isRecurring ?? false,
        frequency: freq,
        recurringAmount:
          line?.recurringAmount != null && line.recurringAmount !== ""
            ? String(line.recurringAmount)
            : "",
        recurringCurrency: line?.recurringCurrency ?? "USD",
        recurringAnchorDate: normalizeRecurringAnchorDate(line?.recurringAnchorDate) ?? "",
      })
    }
  }, [open, line, categories, form])

  async function onSubmit(values: ExpenseLineFormValues) {
    const parsedAmount =
      values.isRecurring && values.recurringAmount.trim() !== ""
        ? Number(values.recurringAmount)
        : null
    const anchorTrim = values.recurringAnchorDate.trim()
    const body = {
      categoryId: values.categoryId,
      name: values.name,
      isRecurring: values.isRecurring,
      frequency: values.isRecurring ? values.frequency : null,
      recurringAmount: parsedAmount,
      recurringCurrency: values.isRecurring ? values.recurringCurrency : null,
      recurringAnchorDate:
        values.isRecurring && anchorTrim !== "" ? anchorTrim.slice(0, 10) : null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit expense line" : "New expense line"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
                  <FormLabel className="font-normal">Recurring budget</FormLabel>
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
                          Count this amount only in months when a payment falls on the schedule (e.g.
                          quarterly bill). Leave empty to use a smoothed monthly average.
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
            <DialogFooter>
              <Button type="submit">{isEdit ? "Save" : "Create"}</Button>
            </DialogFooter>
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
      currency: "USD",
      occurredOn: new Date().toISOString().slice(0, 10),
    },
  })

  useEffect(() => {
    if (open) {
      addForm.reset({
        expenseLineId: line.id,
        amount: 0,
        currency: "USD",
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
        currency: "USD",
        occurredOn: new Date().toISOString().slice(0, 10),
      })
      onSaved()
    } else toast.error(r.error)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Records — {line.name}</DialogTitle>
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
                    {formatCurrency(Number(r.amount), r.currency ?? "USD")}
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
          <form onSubmit={addForm.handleSubmit(addRec)} className="flex flex-wrap gap-2 border-t pt-4">
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
            <div className="flex w-full items-end sm:w-auto">
              <Button type="submit" size="sm">
                Add record
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
