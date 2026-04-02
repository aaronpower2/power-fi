"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  acceptImportMatch,
  acceptNewLineAndPost,
  acceptSuggestedLineFromImport,
  acceptSuggestedNewLineFromImport,
  createImportBatch,
  deleteImportBatch,
  dismissImportedTransaction,
  getImportBatchDetailAction,
  listImportBatchesAction,
  parseImportBatch,
  runAnthropicMatch,
} from "@/lib/actions/import-transactions"
import type { getBudgetPageData } from "@/lib/data/budget"
import type { ImportBatchDetail } from "@/lib/data/import-transactions"
import { formatCurrency } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FileSearch, Loader2, Trash2, Upload } from "lucide-react"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>

type BatchRow = {
  id: string
  label: string | null
  status: string
  createdAt: Date
}

type FilterKey = "all" | "pending" | "suggested_line" | "needs_new_line" | "posted" | "rejected"

/** Long server actions (upload/parse/match) — keep separate so "Run AI match" does not show the Upload spinner. */
type BatchActionBusy = "idle" | "upload" | "parse" | "match" | "delete"

export function ImportTransactionsPanel({
  data,
  refresh: refreshBudget,
}: {
  data: BudgetData
  refresh: () => void
}) {
  const [listPending, startListTransition] = useTransition()
  const [batchActionBusy, setBatchActionBusy] = useState<BatchActionBusy>("idle")
  const [batches, setBatches] = useState<BatchRow[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ImportBatchDetail | null>(null)
  const [filter, setFilter] = useState<FilterKey>("all")
  const [uploadLabel, setUploadLabel] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [lineOverrides, setLineOverrides] = useState<Record<string, string>>({})
  const [manualLineTxId, setManualLineTxId] = useState<string | null>(null)
  const [manualLineName, setManualLineName] = useState("")
  const [manualCategoryId, setManualCategoryId] = useState<string>("_")
  const [manualNewCategoryName, setManualNewCategoryName] = useState("")
  const [manualLineSubmitting, setManualLineSubmitting] = useState(false)

  const loadBatches = useCallback(() => {
    startListTransition(async () => {
      const r = await listImportBatchesAction()
      if (r.ok && r.data) {
        setBatches(r.data as BatchRow[])
      }
    })
  }, [])

  const loadDetail = useCallback((id: string) => {
    startListTransition(async () => {
      const r = await getImportBatchDetailAction(id)
      if (r.ok && r.data) {
        setDetail(r.data as ImportBatchDetail)
      } else {
        setDetail(null)
        if (!r.ok) toast.error(r.error)
      }
    })
  }, [])

  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  useEffect(() => {
    if (batchId) loadDetail(batchId)
  }, [batchId, loadDetail])

  const filteredTx = useMemo(() => {
    if (!detail?.transactions) return []
    if (filter === "all") return detail.transactions
    return detail.transactions.filter((t) => t.matchStatus === filter)
  }, [detail, filter])

  async function onUpload(formData: FormData) {
    if (uploadLabel.trim()) formData.set("label", uploadLabel.trim())
    setBatchActionBusy("upload")
    try {
      const r = await createImportBatch(formData)
      if (r.ok && r.data) {
        toast.success("Upload saved")
        setBatchId(r.data.batchId)
        loadBatches()
        loadDetail(r.data.batchId)
        refreshBudget()
      } else toast.error(r.ok === false ? r.error : "Upload failed")
    } finally {
      setBatchActionBusy("idle")
    }
  }

  async function onParse() {
    if (!batchId) return
    setBatchActionBusy("parse")
    try {
      const r = await parseImportBatch(batchId)
      if (r.ok) {
        toast.success("Parse finished")
        loadDetail(batchId)
        loadBatches()
        refreshBudget()
      } else toast.error(r.error)
    } finally {
      setBatchActionBusy("idle")
    }
  }

  async function onMatch() {
    if (!batchId) return
    const pendingCount =
      detail?.transactions.filter((t) => t.matchStatus === "pending" && !t.postedRecordId).length ?? 0
    const chunks = Math.max(1, Math.ceil(pendingCount / 24))
    toast.message(
      pendingCount > 0
        ? `Matching ${pendingCount} row(s) across ~${chunks} API request(s) (several run in parallel). Large imports may still take a minute or two.`
        : "Running AI match…",
      { duration: 8000 },
    )
    setBatchActionBusy("match")
    try {
      const r = await runAnthropicMatch(batchId)
      if (r.ok) {
        toast.success("AI matching finished")
        loadDetail(batchId)
        loadBatches()
      } else toast.error(r.error)
    } finally {
      setBatchActionBusy("idle")
    }
  }

  async function onDeleteBatch() {
    if (!deleteId) return
    const id = deleteId
    setDeleteId(null)
    setBatchActionBusy("delete")
    try {
      const r = await deleteImportBatch(id)
      if (r.ok) {
        toast.success("Batch deleted")
        if (batchId === id) setBatchId(null)
        loadBatches()
        refreshBudget()
      } else toast.error(r.error)
    } finally {
      setBatchActionBusy("idle")
    }
  }

  const expenseOptions = useMemo(
    () =>
      data.expenseLines.map((l) => ({
        value: `e:${l.id}`,
        label: `${l.categoryName} — ${l.name}`,
      })),
    [data.expenseLines],
  )

  const incomeOptions = useMemo(
    () => data.incomeLines.map((l) => ({ value: `i:${l.id}`, label: l.name })),
    [data.incomeLines],
  )

  function suggestedLineLabel(t: ImportBatchDetail["transactions"][number]): string {
    if (t.suggestedExpenseLineId) {
      const line = data.expenseLines.find((l) => l.id === t.suggestedExpenseLineId)
      return line ? `${line.categoryName} — ${line.name}` : t.suggestedExpenseLineId
    }
    if (t.suggestedIncomeLineId) {
      const line = data.incomeLines.find((l) => l.id === t.suggestedIncomeLineId)
      return line ? line.name : t.suggestedIncomeLineId
    }
    return "—"
  }

  async function postOverride(importedId: string) {
    const v = lineOverrides[importedId]
    if (!v || v === "_") {
      toast.error("Choose a budget line")
      return
    }
    const [kind, lineId] = v.split(":")
    startListTransition(async () => {
      const r =
        kind === "e"
          ? await acceptImportMatch({ importedTransactionId: importedId, expenseLineId: lineId })
          : await acceptImportMatch({ importedTransactionId: importedId, incomeLineId: lineId })
      if (r.ok) {
        toast.success("Posted")
        if (batchId) loadDetail(batchId)
        refreshBudget()
      } else toast.error(r.error)
    })
  }

  const batchControlsLocked = batchActionBusy !== "idle" || listPending
  const tableActionsLocked =
    batchActionBusy === "match" ||
    batchActionBusy === "parse" ||
    batchActionBusy === "delete"

  function openManualNewLineDialog(importedId: string) {
    setManualLineTxId(importedId)
    setManualLineName("")
    setManualCategoryId("_")
    setManualNewCategoryName("")
  }

  async function submitManualNewLine() {
    if (!manualLineTxId) return
    const lineName = manualLineName.trim()
    if (!lineName) {
      toast.error("Enter a line name")
      return
    }
    const newCat = manualNewCategoryName.trim()
    const catId = manualCategoryId !== "_" ? manualCategoryId : undefined
    if (!newCat && !catId) {
      toast.error("Pick an expense category or enter a new category name")
      return
    }

    setManualLineSubmitting(true)
    try {
      const r = await acceptNewLineAndPost({
        importedTransactionId: manualLineTxId,
        lineName,
        ...(newCat ? { categoryName: newCat } : { categoryId: catId }),
      })
      if (r.ok) {
        toast.success("Expense line created & posted")
        setManualLineTxId(null)
        if (batchId) loadDetail(batchId)
        refreshBudget()
      } else toast.error(r.error)
    } finally {
      setManualLineSubmitting(false)
    }
  }

  const manualLineTarget = useMemo(() => {
    if (!manualLineTxId || !detail?.transactions) return null
    return detail.transactions.find((t) => t.id === manualLineTxId) ?? null
  }, [manualLineTxId, detail])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FileSearch className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base">Bank & card statements</CardTitle>
              <CardDescription>
                Upload PDF bank exports, Excel/CSV card activity, then parse and run AI matching to map
                rows to budget lines. Text-based PDFs work best; scanned statements are not supported yet.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-label">Batch label (optional)</Label>
            <Input
              id="import-label"
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
              placeholder="e.g. March 2026"
              className="max-w-xs"
            />
          </div>
          <form
            className="flex w-full min-w-0 flex-row flex-nowrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              onUpload(new FormData(e.currentTarget))
            }}
          >
            <div className="min-w-0 flex-1">
              <Input
                type="file"
                name="files"
                multiple
                accept=".pdf,.xls,.xlsx,.csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="w-full min-w-0 cursor-pointer"
                required
              />
            </div>
            <Button type="submit" disabled={batchControlsLocked} className="shrink-0">
              {batchActionBusy === "upload" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              <span className="ml-2">Upload</span>
            </Button>
          </form>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Label className="shrink-0">Active batch</Label>
            <Select
              value={batchId ?? "_"}
              onValueChange={(v) => {
                if (v === "_") {
                  setBatchId(null)
                  setDetail(null)
                } else {
                  setBatchId(v)
                }
              }}
            >
              <SelectTrigger className="w-full max-w-md sm:w-[320px]">
                <SelectValue placeholder="Select a batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">None</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {(b.label || "Untitled") + ` · ${b.status} · ${new Date(b.createdAt).toLocaleString()}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {batchId && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onParse}
                  disabled={batchControlsLocked}
                  className="gap-1.5"
                >
                  {batchActionBusy === "parse" ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Parse all files
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onMatch}
                  disabled={batchControlsLocked}
                  className="gap-1.5"
                >
                  {batchActionBusy === "match" ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Run AI match
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="text-destructive"
                  title="Delete batch"
                  onClick={() => setDeleteId(batchId)}
                  disabled={batchControlsLocked}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>

          {detail && (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Batch status: <span className="text-foreground font-medium">{detail.batch.status}</span>
              </p>
              <ul className="text-muted-foreground space-y-1 text-sm">
                {detail.files.map((f) => (
                  <li key={f.id}>
                    <span className="text-foreground">{f.originalName}</span> — {f.parserKind} —{" "}
                    {f.parseStatus}
                    {f.parseError ? (
                      <span className="text-destructive"> — {f.parseError}</span>
                    ) : null}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Filter</span>
                {(
                  [
                    ["all", "All"],
                    ["pending", "Pending"],
                    ["suggested_line", "Suggested line"],
                    ["needs_new_line", "New line"],
                    ["posted", "Posted"],
                    ["rejected", "Dismissed"],
                  ] as const
                ).map(([k, lab]) => (
                  <Button
                    key={k}
                    type="button"
                    variant={filter === k ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter(k)}
                  >
                    {lab}
                  </Button>
                ))}
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead className="min-w-[220px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTx.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground text-center">
                          No rows in this filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTx.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="whitespace-nowrap">{t.occurredOn}</TableCell>
                          <TableCell className="max-w-[240px] truncate" title={t.description}>
                            {t.description}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(t.amount), t.currency, {
                              maximumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell className="text-sm">
                            {t.matchStatus === "posted" ? (
                              <span className="text-muted-foreground">Posted</span>
                            ) : t.matchStatus === "suggested_line" ? (
                              <span>
                                {t.direction === "income" ? "Income" : "Expense"}:{" "}
                                {suggestedLineLabel(t)}
                              </span>
                            ) : t.matchStatus === "needs_new_line" ? (
                              <span className="text-amber-700 dark:text-amber-400">
                                New:{" "}
                                {t.suggestedCategoryName ||
                                  (t.suggestedUseExistingCategoryId ? "Existing category" : "?")}{" "}
                                › {t.suggestedLineName}
                              </span>
                            ) : t.matchStatus === "rejected" ? (
                              <span className="text-muted-foreground">Dismissed</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            {t.modelConfidence ? (
                              <span className="text-muted-foreground block text-xs">
                                {t.modelConfidence}
                                {t.modelNotes ? ` · ${t.modelNotes}` : ""}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            {t.postedRecordId ? null : (
                              <div className="flex flex-col gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="w-full sm:w-auto"
                                  disabled={tableActionsLocked}
                                  onClick={() => openManualNewLineDialog(t.id)}
                                >
                                  New line…
                                </Button>
                                {t.matchStatus === "suggested_line" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="w-full sm:w-auto"
                                    disabled={tableActionsLocked}
                                    onClick={() =>
                                      startListTransition(async () => {
                                        const r = await acceptSuggestedLineFromImport(t.id)
                                        if (r.ok) {
                                          toast.success("Posted")
                                          if (batchId) loadDetail(batchId)
                                          refreshBudget()
                                        } else toast.error(r.error)
                                      })
                                    }
                                  >
                                    Accept match
                                  </Button>
                                )}
                                {t.matchStatus === "needs_new_line" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="w-full sm:w-auto"
                                    disabled={tableActionsLocked}
                                    onClick={() =>
                                      startListTransition(async () => {
                                        const r = await acceptSuggestedNewLineFromImport(t.id)
                                        if (r.ok) {
                                          toast.success("Line added & posted")
                                          if (batchId) loadDetail(batchId)
                                          refreshBudget()
                                        } else toast.error(r.error)
                                      })
                                    }
                                  >
                                    Add line & post
                                  </Button>
                                )}
                                <div className="flex flex-wrap items-center gap-1">
                                  <Select
                                    value={lineOverrides[t.id] ?? "_"}
                                    onValueChange={(v) =>
                                      setLineOverrides((o) => ({ ...o, [t.id]: v }))
                                    }
                                  >
                                    <SelectTrigger className="h-8 w-[180px]">
                                      <SelectValue placeholder="Pick line…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="_">Pick line…</SelectItem>
                                      {expenseOptions.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                          {o.label}
                                        </SelectItem>
                                      ))}
                                      {incomeOptions.map((o) => (
                                        <SelectItem key={o.value} value={o.value}>
                                          Income: {o.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={tableActionsLocked}
                                    onClick={() => postOverride(t.id)}
                                  >
                                    Post
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="text-muted-foreground"
                                    disabled={tableActionsLocked}
                                    onClick={() =>
                                      startListTransition(async () => {
                                        const r = await dismissImportedTransaction(t.id)
                                        if (r.ok) {
                                          toast.message("Dismissed")
                                          if (batchId) loadDetail(batchId)
                                        } else toast.error(r.error)
                                      })
                                    }
                                  >
                                    Dismiss
                                  </Button>
                                </div>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={manualLineTxId != null}
        onOpenChange={(open) => {
          if (!open && !manualLineSubmitting) setManualLineTxId(null)
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!manualLineSubmitting}>
          <DialogHeader>
            <DialogTitle>Create expense line & post</DialogTitle>
            <DialogDescription>
              Adds a new expense line under an existing or new category, then posts this import row to it.
              {manualLineTarget ? (
                <span className="text-foreground mt-2 block truncate font-normal">
                  {manualLineTarget.description}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-2">
              <Label htmlFor="manual-line-name">Line name</Label>
              <Input
                id="manual-line-name"
                value={manualLineName}
                onChange={(e) => setManualLineName(e.target.value)}
                placeholder="e.g. Pharmacy"
                disabled={manualLineSubmitting || tableActionsLocked}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={manualCategoryId}
                onValueChange={setManualCategoryId}
                disabled={manualLineSubmitting || tableActionsLocked}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Existing category…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">Choose existing…</SelectItem>
                  {data.expenseCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-new-cat">Or new category name</Label>
              <Input
                id="manual-new-cat"
                value={manualNewCategoryName}
                onChange={(e) => setManualNewCategoryName(e.target.value)}
                placeholder="Optional — creates a category if set"
                disabled={manualLineSubmitting || tableActionsLocked}
              />
              <p className="text-muted-foreground text-xs">
                If you fill this, it is used instead of the category picker.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={manualLineSubmitting}
              onClick={() => setManualLineTxId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={manualLineSubmitting || tableActionsLocked}
              onClick={() => void submitManualNewLine()}
            >
              {manualLineSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Create & post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId != null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete import batch?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes uploaded files metadata and staged rows. Posted budget records are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleteBatch}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
