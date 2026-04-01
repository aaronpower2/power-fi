"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import {
  useForm,
  type Control,
  type FieldValues,
} from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"

import {
  createAsset,
  createStrategy,
  deleteAllocationTarget,
  deleteAsset,
  deleteStrategy,
  setActiveStrategy,
  updateAsset,
  updateStrategy,
  upsertAllocationTarget,
} from "@/lib/actions/portfolio"
import {
  allocationTargetSchema,
  createAssetSchema,
  createStrategySchema,
  strategyNameSchema,
  updateAssetSchema,
  updateStrategySchema,
  type UpdateAssetInput,
} from "@/lib/validations/portfolio"
import { SUPPORTED_CURRENCIES } from "@/lib/currency/iso4217"
import { getPortfolioData } from "@/lib/data/portfolio"
import { formatCurrency } from "@/lib/format"
import { CardHeaderTitleRow, InfoTooltip } from "@/components/info-tooltip"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { MoreHorizontal } from "lucide-react"

type PortfolioPayload = Awaited<ReturnType<typeof getPortfolioData>>
type AssetRow = PortfolioPayload["assets"][number]
type CreateAssetForm = z.infer<typeof createAssetSchema>

export function PortfolioManager({ data }: { data: PortfolioPayload }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  const { assets, strategies, activeStrategy, targets } = data

  const targetSum = useMemo(
    () => targets.reduce((s, t) => s + Number(t.weightPercent), 0),
    [targets],
  )

  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<string | null>(null)
  const [pendingDeleteStrategy, setPendingDeleteStrategy] = useState<string | null>(null)
  const [assetToEdit, setAssetToEdit] = useState<AssetRow | null>(null)
  const [strategyToRename, setStrategyToRename] = useState<{
    id: string
    name: string
  } | null>(null)

  return (
    <Tabs defaultValue="assets" className="w-full">
      <TabsList>
        <TabsTrigger value="assets">Assets</TabsTrigger>
        <TabsTrigger value="strategy">Strategy</TabsTrigger>
      </TabsList>

      <TabsContent value="assets" className="mt-4 space-y-4">
        <div className="flex justify-end">
          <AddAssetDialog onSaved={refresh} />
        </div>
        <EditAssetDialog
          asset={assetToEdit}
          open={!!assetToEdit}
          onOpenChange={(o) => {
            if (!o) setAssetToEdit(null)
          }}
          onSaved={() => {
            setAssetToEdit(null)
            refresh()
          }}
        />
        <Card>
          <CardHeader>
            <CardHeaderTitleRow
              title={<CardTitle>Assets</CardTitle>}
              info="Compound growth uses an annual return (%). Capital growth uses a terminal value and maturation date."
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>CCY</TableHead>
                  <TableHead>Growth</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.length === 0 ? (
                    <TableRow>
                    <TableCell colSpan={6} className="text-muted-foreground h-20 text-center">
                      No assets yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  assets.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>{a.assetType}</TableCell>
                      <TableCell className="font-mono text-xs">{a.currency ?? "USD"}</TableCell>
                      <TableCell className="capitalize">{a.growthType}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          Number(a.currentBalance),
                          a.currency ?? "USD",
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
                              onSelect={(e) => {
                                e.preventDefault()
                                setAssetToEdit(a)
                              }}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={(e) => {
                                e.preventDefault()
                                setPendingDeleteAsset(a.id)
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
      </TabsContent>

      <TabsContent value="strategy" className="mt-4 space-y-6">
        <RenameStrategyDialog
          strategy={strategyToRename}
          open={!!strategyToRename}
          onOpenChange={(o) => {
            if (!o) setStrategyToRename(null)
          }}
          onSaved={() => {
            setStrategyToRename(null)
            refresh()
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StrategyCreateDialog onCreated={refresh} />
        </div>
        <Card>
          <CardHeader>
            <CardHeaderTitleRow
              title={<CardTitle>Strategies</CardTitle>}
              info="One active strategy drives allocation targets in the engine."
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {strategies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground h-16 text-center">
                      No strategies yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  strategies.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.isActive ? "Active" : "Inactive"}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label="Actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!s.isActive ? (
                              <DropdownMenuItem
                                onClick={async () => {
                                  const r = await setActiveStrategy(s.id)
                                  if (r.ok) {
                                    toast.success("Strategy activated")
                                    refresh()
                                  } else toast.error(r.error)
                                }}
                              >
                                Set active
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault()
                                setStrategyToRename({ id: s.id, name: s.name })
                              }}
                            >
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={(e) => {
                                e.preventDefault()
                                setPendingDeleteStrategy(s.id)
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
          <CardHeader className="space-y-2">
            <CardHeaderTitleRow
              title={<CardTitle>Allocation targets (active strategy)</CardTitle>}
              info="Weights should sum to 100% for full deployment of investable capital."
            />
            <p
              className={
                targetSum !== 100
                  ? "text-destructive text-sm font-medium tabular-nums"
                  : "text-muted-foreground text-sm tabular-nums"
              }
            >
              Sum: {targetSum.toFixed(1)}%
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeStrategy ? (
              <>
                <TargetAddForm
                  strategyId={activeStrategy.id}
                  assets={assets}
                  existingAssetIds={targets.map((t) => t.assetId)}
                  onAdded={refresh}
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead className="text-right">Weight %</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {targets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-muted-foreground h-16 text-center">
                          No targets yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      targets.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>{t.assetName}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {Number(t.weightPercent).toFixed(1)}%
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={async () => {
                                const r = await deleteAllocationTarget(t.id)
                                if (r.ok) {
                                  toast.success("Target removed")
                                  refresh()
                                } else toast.error(r.error)
                              }}
                            >
                              Remove
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </>
            ) : (
              <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <span>No active strategy</span>
                <InfoTooltip>Activate a strategy to edit allocation targets.</InfoTooltip>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <AlertDialog
        open={!!pendingDeleteAsset}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteAsset(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the asset and related allocation targets. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!pendingDeleteAsset) return
                const r = await deleteAsset(pendingDeleteAsset)
                setPendingDeleteAsset(null)
                if (r.ok) {
                  toast.success("Asset deleted")
                  refresh()
                } else toast.error(r.error)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!pendingDeleteStrategy}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteStrategy(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete strategy?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes all allocation targets for this strategy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (!pendingDeleteStrategy) return
                const r = await deleteStrategy(pendingDeleteStrategy)
                setPendingDeleteStrategy(null)
                if (r.ok) {
                  toast.success("Strategy deleted")
                  refresh()
                } else toast.error(r.error)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  )
}

function assetToFormValues(asset: AssetRow): UpdateAssetInput {
  return {
    id: asset.id,
    name: asset.name,
    assetType: asset.assetType,
    currency: (asset.currency ?? "USD") as UpdateAssetInput["currency"],
    growthType: asset.growthType,
    assumedAnnualReturnPercent: asset.assumedAnnualReturn
      ? Number(asset.assumedAnnualReturn) * 100
      : undefined,
    assumedTerminalValue: asset.assumedTerminalValue
      ? Number(asset.assumedTerminalValue)
      : undefined,
    maturationDate: asset.maturationDate ?? undefined,
    currentBalance: Number(asset.currentBalance),
  }
}

function AddAssetDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const form = useForm<CreateAssetForm>({
    resolver: zodResolver(createAssetSchema),
    defaultValues: {
      name: "",
      assetType: "Equity",
      currency: "USD",
      growthType: "compound",
      assumedAnnualReturnPercent: 7,
      currentBalance: 0,
    },
  })
  const growthType = form.watch("growthType")

  async function onSubmit(values: CreateAssetForm) {
    const r = await createAsset(values)
    if (r.ok) {
      toast.success("Asset created")
      setOpen(false)
      form.reset({
        name: "",
        assetType: "Equity",
        currency: "USD",
        growthType: "compound",
        assumedAnnualReturnPercent: 7,
        currentBalance: 0,
      })
      onSaved()
    } else toast.error(r.error)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add asset</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-1.5 pr-8">
            <DialogTitle>New asset</DialogTitle>
            <InfoTooltip>Balances and assumptions feed the projection engine.</InfoTooltip>
          </div>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <AssetFormFields
              control={form.control as unknown as Control<FieldValues>}
              growthType={growthType}
            />
            <DialogFooter>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditAssetDialog({
  asset,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: AssetRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const form = useForm<UpdateAssetInput>({
    resolver: zodResolver(updateAssetSchema),
    defaultValues: asset ? assetToFormValues(asset) : undefined,
  })
  const growthType = form.watch("growthType")

  useEffect(() => {
    if (asset && open) {
      form.reset(assetToFormValues(asset))
    }
  }, [asset, open, form])

  async function onSubmit(values: UpdateAssetInput) {
    const r = await updateAsset(values)
    if (r.ok) {
      toast.success("Asset updated")
      onOpenChange(false)
      onSaved()
    } else toast.error(r.error)
  }

  if (!asset) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-1.5 pr-8">
            <DialogTitle>Edit asset</DialogTitle>
            <InfoTooltip>Balances and assumptions feed the projection engine.</InfoTooltip>
          </div>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <input type="hidden" {...form.register("id")} />
            <AssetFormFields
              control={form.control as unknown as Control<FieldValues>}
              growthType={growthType}
            />
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function AssetFormFields({
  control,
  growthType,
}: {
  control: Control<FieldValues>
  growthType: "compound" | "capital"
}) {
  return (
    <>
      <FormField
        control={control}
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
        control={control}
        name="assetType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Asset type</FormLabel>
            <FormControl>
              <Input placeholder="Equity, Real estate…" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="currency"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Currency</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="CCY" />
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
        control={control}
        name="growthType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Growth model</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="compound">Compound</SelectItem>
                <SelectItem value="capital">Capital (maturity)</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {growthType === "compound" ? (
        <FormField
          control={control}
          name="assumedAnnualReturnPercent"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Assumed annual return (%)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}
      {growthType === "capital" ? (
        <>
          <FormField
            control={control}
            name="assumedTerminalValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Terminal value</FormLabel>
                <FormControl>
                  <Input type="number" step="1" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="maturationDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Maturation date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      ) : null}
      <FormField
        control={control}
        name="currentBalance"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Current balance</FormLabel>
            <FormControl>
              <Input type="number" step="1" min={0} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

function StrategyCreateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [makeActive, setMakeActive] = useState(false)

  const form = useForm({
    resolver: zodResolver(strategyNameSchema),
    defaultValues: { name: "" },
  })

  async function onSubmit(values: { name: string }) {
    const parsed = createStrategySchema.safeParse({ ...values, makeActive })
    if (!parsed.success) {
      toast.error(parsed.error.issues.map((i) => i.message).join(" "))
      return
    }
    const r = await createStrategy(parsed.data)
    if (r.ok) {
      toast.success("Strategy created")
      setOpen(false)
      form.reset()
      setMakeActive(false)
      onCreated()
    } else toast.error(r.error)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          New strategy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New strategy</DialogTitle>
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={makeActive}
                onChange={(e) => setMakeActive(e.target.checked)}
              />
              Set as active (deactivates others)
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

function RenameStrategyDialog({
  strategy,
  open,
  onOpenChange,
  onSaved,
}: {
  strategy: { id: string; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const form = useForm({
    resolver: zodResolver(updateStrategySchema),
    defaultValues: { id: "", name: "" },
  })

  useEffect(() => {
    if (strategy && open) {
      form.reset({ id: strategy.id, name: strategy.name })
    }
  }, [strategy, open, form])

  async function onSubmit(values: { id: string; name: string }) {
    const r = await updateStrategy(values)
    if (r.ok) {
      toast.success("Strategy renamed")
      onOpenChange(false)
      onSaved()
    } else toast.error(r.error)
  }

  if (!strategy) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename strategy</DialogTitle>
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
            <DialogFooter>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function TargetAddForm({
  strategyId,
  assets,
  existingAssetIds,
  onAdded,
}: {
  strategyId: string
  assets: AssetRow[]
  existingAssetIds: string[]
  onAdded: () => void
}) {
  const available = assets.filter((a) => !existingAssetIds.includes(a.id))

  const form = useForm({
    resolver: zodResolver(allocationTargetSchema),
    defaultValues: {
      strategyId,
      assetId: available[0]?.id ?? "",
      weightPercent: 0,
    },
  })

  async function onSubmit(values: {
    strategyId: string
    assetId: string
    weightPercent: number
  }) {
    const r = await upsertAllocationTarget(values)
    if (r.ok) {
      toast.success("Target saved")
      form.reset({ strategyId, assetId: available[0]?.id ?? "", weightPercent: 0 })
      onAdded()
    } else toast.error(r.error)
  }

  if (available.length === 0) {
    return (
      <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <span>—</span>
        <InfoTooltip>All assets already have a target, or add assets first.</InfoTooltip>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <FormField
          control={form.control}
          name="assetId"
          render={({ field }) => (
            <FormItem className="min-w-[180px] flex-1">
              <FormLabel>Asset</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick asset" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {available.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
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
          name="weightPercent"
          render={({ field }) => (
            <FormItem className="w-full sm:w-28">
              <FormLabel>Weight %</FormLabel>
              <FormControl>
                <Input type="number" step="0.1" min={0} max={100} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="sm:mb-0.5">
          Add / update
        </Button>
      </form>
    </Form>
  )
}
