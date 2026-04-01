"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { type Control, useFieldArray, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import {
  createGoal,
  deleteGoal,
  setActiveGoal,
  updateGoal,
} from "@/lib/actions/goal"
import { SUPPORTED_CURRENCIES } from "@/lib/currency/iso4217"
import type { GoalWithLifestyle } from "@/lib/data/goals"
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
import { CardHeaderTitleRow, InfoTooltip } from "@/components/info-tooltip"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MoreHorizontal, Plus, Trash2 } from "lucide-react"

type GoalRow = typeof goals.$inferSelect

/** Narrow slice shared by create/update goal forms for `useFieldArray`. */
type GoalLifestyleFormValues = {
  lifestyleLines: { name: string; monthlyAmount: number }[]
}

function LifestyleLinesFields({
  control,
  currencyCode,
}: {
  control: Control<GoalLifestyleFormValues>
  currencyCode: string
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
                    <Input type="number" step="1" min={1} placeholder="0" {...f} />
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
    </div>
  )
}

export function GoalManager({ items }: { items: GoalWithLifestyle[] }) {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("active")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const active = items.find((i) => i.goal.isActive)
  const inactive = items.filter((i) => !i.goal.isActive)

  const refresh = () => router.refresh()

  return (
    <div className="space-y-8">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex w-full flex-col gap-8">
        <PageHeader
          title="Goal"
          description="Define your FI date, safe withdrawal rate, and lifestyle lines (expected monthly costs). Their sum is goal monthly funding and drives the independence target."
          controls={
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList>
                <TabsTrigger value="active">Active goal</TabsTrigger>
                <TabsTrigger value="other">Other goals</TabsTrigger>
              </TabsList>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="size-4 shrink-0" aria-hidden />
                  New goal
                </Button>
              </div>
            </div>
          }
        />

        <Card>
          <CardHeader>
            <CardHeaderTitleRow
              title={<CardTitle>Independence target</CardTitle>}
              info={
                <>
                  One active goal drives projections. Withdrawal rate is stored as a decimal; you enter percent in
                  the form. Required portfolio on the summary uses: (sum of lifestyle lines × 12) ÷ withdrawal
                  rate.
                </>
              }
            />
          </CardHeader>
          <CardContent>
            <TabsContent value="active" className="mt-0 outline-none">
              {active ? (
                <ActiveGoalForm
                  goal={active.goal}
                  lifestyleLines={active.lifestyleLines}
                  onSuccess={refresh}
                />
              ) : (
                <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <span>No active goal</span>
                  <InfoTooltip>
                    Create one with New goal, or activate an existing goal under Other goals.
                  </InfoTooltip>
                </div>
              )}
            </TabsContent>

            <TabsContent value="other" className="mt-0 outline-none">
              {inactive.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>FI date</TableHead>
                      <TableHead>Monthly need</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inactive.map(({ goal: g }) => (
                      <TableRow key={g.id}>
                        <TableCell className="font-mono text-xs">{g.fiDate}</TableCell>
                        <TableCell>
                          {formatCurrency(
                            Number(g.monthlyFundingRequirement),
                            g.currency ?? "USD",
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
                                onClick={async () => {
                                  const r = await setActiveGoal(g.id)
                                  if (r.ok) {
                                    toast.success("Goal activated")
                                    refresh()
                                  } else toast.error(r.error)
                                }}
                              >
                                Set active
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={(e) => {
                                  e.preventDefault()
                                  setPendingDelete(g.id)
                                }}
                              >
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
                <p className="text-muted-foreground text-sm">None</p>
              )}
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>

      <CreateGoalDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={refresh}
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

function ActiveGoalForm({
  goal,
  lifestyleLines,
  onSuccess,
}: {
  goal: GoalRow
  lifestyleLines: GoalWithLifestyle["lifestyleLines"]
  onSuccess: () => void
}) {
  const form = useForm<UpdateGoalInput>({
    resolver: zodResolver(updateGoalSchema),
    defaultValues: {
      id: goal.id,
      currency: (goal.currency ?? "USD") as UpdateGoalInput["currency"],
      fiDate: goal.fiDate,
      withdrawalRatePercent: Number(goal.withdrawalRate) * 100,
      lifestyleLines: defaultLifestyleLines(goal, lifestyleLines),
    },
  })
  const goalCurrency = useWatch({ control: form.control, name: "currency" }) ?? "USD"

  async function onSubmit(values: UpdateGoalInput) {
    const r = await updateGoal(values)
    if (r.ok) {
      toast.success("Goal updated")
      onSuccess()
    } else toast.error(r.error)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                    <Input type="number" step="0.01" min={0.1} max={50} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
        <LifestyleLinesFields
          control={form.control as unknown as Control<GoalLifestyleFormValues>}
          currencyCode={goalCurrency}
        />
        <Button type="submit" size="sm">
          Save active goal
        </Button>
      </form>
    </Form>
  )
}

function CreateGoalDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [makeActive, setMakeActive] = useState(true)

  const form = useForm<GoalInput>({
    resolver: zodResolver(goalInputSchema),
    defaultValues: {
      currency: "USD",
      fiDate: "",
      withdrawalRatePercent: 4,
      lifestyleLines: [
        { name: "Core living", monthlyAmount: 3000 },
        { name: "Discretionary", monthlyAmount: 2000 },
      ],
    },
  })
  const createCurrency = useWatch({ control: form.control, name: "currency" }) ?? "USD"

  async function onSubmit(values: GoalInput) {
    const payload: CreateGoalInput = { ...values, makeActive }
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
        currency: "USD",
        fiDate: "",
        withdrawalRatePercent: 4,
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-1.5 pr-8">
            <DialogTitle>Create goal</DialogTitle>
            <InfoTooltip>
              Set FI date, withdrawal rate, and lifestyle lines that sum to your monthly funding target.
            </InfoTooltip>
          </div>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                    <Input type="number" step="0.01" min={0.1} max={50} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <LifestyleLinesFields
              control={form.control as unknown as Control<GoalLifestyleFormValues>}
              currencyCode={createCurrency}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={makeActive}
                onChange={(e) => setMakeActive(e.target.checked)}
              />
              Set as active goal (deactivates others)
            </label>
            <DialogFooter>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
