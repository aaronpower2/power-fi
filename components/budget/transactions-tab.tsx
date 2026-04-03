"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  acceptBulkSuggestedFromImport,
  acceptImportMatch,
  acceptNewCategoryAndPost,
  acceptSuggestedCategoryFromImport,
  acceptSuggestedMatchFromImport,
  createImportBatch,
  deleteImportBatch,
  dismissImportedTransaction,
  getImportBatchDetailAction,
  listImportBatchesAction,
  parseImportBatch,
  runAnthropicMatch,
} from "@/lib/actions/import-transactions"
import type { getBudgetPageData } from "@/lib/data/budget"
import type { ImportBatchDetail, ImportBatchFilterKey } from "@/lib/data/import-transactions"
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Check, FileSearch, FolderInput, Loader2, Trash2, Upload } from "lucide-react"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>

type BatchRow = {
  id: string
  label: string | null
  status: string
  createdAt: Date
}

type FilterKey = ImportBatchFilterKey
const PAGE_SIZE = 100

/** Long server actions (upload/parse/match) — keep separate so "Run AI match" does not show the Upload spinner. */
type BatchActionBusy = "idle" | "upload" | "parse" | "match" | "delete" | "bulk_post"

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
  const [pageOffset, setPageOffset] = useState(0)
  const [uploadLabel, setUploadLabel] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [matchOverrides, setMatchOverrides] = useState<Record<string, string>>({})
  const [manualCategoryTxId, setManualCategoryTxId] = useState<string | null>(null)
  const [manualCategoryId, setManualCategoryId] = useState<string>("_")
  const [manualNewCategoryName, setManualNewCategoryName] = useState("")
  const [manualCategorySubmitting, setManualCategorySubmitting] = useState(false)

  const loadBatches = useCallback(() => {
    startListTransition(async () => {
      const r = await listImportBatchesAction()
      if (r.ok && r.data) {
        setBatches(r.data as BatchRow[])
      }
    })
  }, [])

  const loadDetail = useCallback((id: string, nextFilter: FilterKey, nextOffset: number) => {
    startListTransition(async () => {
      const r = await getImportBatchDetailAction({
        batchId: id,
        filter: nextFilter,
        limit: PAGE_SIZE,
        offset: nextOffset,
      })
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
    if (batchId) loadDetail(batchId, filter, pageOffset)
  }, [batchId, filter, loadDetail, pageOffset])

  const filteredTx = useMemo(() => detail?.transactions ?? [], [detail])

  const bulkMatchedCount = useMemo(
    () => detail?.statusCounts.suggested_line ?? 0,
    [detail],
  )

  const bulkAllSuggestedCount = useMemo(
    () => (detail?.statusCounts.suggested_line ?? 0) + (detail?.statusCounts.needs_new_line ?? 0),
    [detail],
  )

  async function onUpload(formData: FormData) {
    if (uploadLabel.trim()) formData.set("label", uploadLabel.trim())
    setBatchActionBusy("upload")
    try {
      const r = await createImportBatch(formData)
      if (r.ok && r.data) {
        toast.success("Upload saved")
        setBatchId(r.data.batchId)
        setPageOffset(0)
        loadBatches()
        loadDetail(r.data.batchId, filter, 0)
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
        loadDetail(batchId, filter, pageOffset)
        loadBatches()
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
        loadDetail(batchId, filter, pageOffset)
        loadBatches()
      } else toast.error(r.error)
    } finally {
      setBatchActionBusy("idle")
    }
  }

  async function onBulkPost(scope: "matched" | "all") {
    if (!batchId) return
    setBatchActionBusy("bulk_post")
    try {
      const r = await acceptBulkSuggestedFromImport({ batchId, scope })
      if (r.ok && r.data) {
        const { posted, failed, errors } = r.data
        if (batchId) loadDetail(batchId, filter, pageOffset)
        refreshBudget()
        if (posted === 0 && failed === 0) {
          toast.message("No rows to post for that option.")
        } else if (failed === 0) {
          toast.success(`Posted ${posted} transaction${posted === 1 ? "" : "s"}.`)
        } else if (posted === 0) {
          toast.error(
            errors.length > 0 ? errors.slice(0, 2).join(" · ") : `Could not post ${failed} row(s).`,
          )
        } else {
          const hint = errors.length > 0 ? ` ${errors[0]}` : ""
          toast.success(`Posted ${posted}; ${failed} failed.${hint}`)
        }
      } else toast.error(r.ok === false ? r.error : "Bulk post failed")
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
      } else toast.error(r.error)
    } finally {
      setBatchActionBusy("idle")
    }
  }

  const expenseOptions = useMemo(
    () =>
      data.expenseCategories.map((c) => ({
        value: `e:${c.id}`,
        label: c.name,
      })),
    [data.expenseCategories],
  )

  const incomeOptions = useMemo(
    () => data.incomeLines.map((l) => ({ value: `i:${l.id}`, label: l.name })),
    [data.incomeLines],
  )

  function suggestedMatchLabel(t: ImportBatchDetail["transactions"][number]): string {
    if (t.suggestedExpenseCategoryId) {
      const category = data.expenseCategories.find((c) => c.id === t.suggestedExpenseCategoryId)
      return category?.name ?? t.suggestedExpenseCategoryId
    }
    if (t.suggestedIncomeLineId) {
      const line = data.incomeLines.find((l) => l.id === t.suggestedIncomeLineId)
      return line ? line.name : t.suggestedIncomeLineId
    }
    return "—"
  }

  async function postOverride(importedId: string) {
    const v = matchOverrides[importedId]
    if (!v || v === "_") {
      toast.error("Choose a category or income line")
      return
    }
    const [kind, targetId] = v.split(":")
    startListTransition(async () => {
      const r =
        kind === "e"
          ? await acceptImportMatch({ importedTransactionId: importedId, expenseCategoryId: targetId })
          : await acceptImportMatch({ importedTransactionId: importedId, incomeLineId: targetId })
      if (r.ok) {
        toast.success("Posted")
        if (batchId) loadDetail(batchId, filter, pageOffset)
        refreshBudget()
      } else toast.error(r.error)
    })
  }

  const batchControlsLocked = batchActionBusy !== "idle" || listPending
  const tableActionsLocked =
    batchActionBusy === "match" ||
    batchActionBusy === "parse" ||
    batchActionBusy === "delete" ||
    batchActionBusy === "bulk_post"

  function openManualCategoryDialog(importedId: string) {
    setManualCategoryTxId(importedId)
    setManualCategoryId("_")
    setManualNewCategoryName("")
  }

  async function submitManualCategory() {
    if (!manualCategoryTxId) return
    const newCat = manualNewCategoryName.trim()
    const catId = manualCategoryId !== "_" ? manualCategoryId : undefined
    if (!newCat && !catId) {
      toast.error("Pick an expense category or enter a new category name")
      return
    }

    setManualCategorySubmitting(true)
    try {
      const r = await acceptNewCategoryAndPost({
        importedTransactionId: manualCategoryTxId,
        ...(newCat ? { categoryName: newCat } : { categoryId: catId }),
      })
      if (r.ok) {
        toast.success("Expense category posted")
        setManualCategoryTxId(null)
        if (batchId) loadDetail(batchId, filter, pageOffset)
        refreshBudget()
      } else toast.error(r.error)
    } finally {
      setManualCategorySubmitting(false)
    }
  }

  const manualCategoryTarget = useMemo(() => {
    if (!manualCategoryTxId || !detail?.transactions) return null
    return detail.transactions.find((t) => t.id === manualCategoryTxId) ?? null
  }, [manualCategoryTxId, detail])

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
                rows to expense categories or income lines. Text-based PDFs work best; scanned statements
                are not supported yet.
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
                  setPageOffset(0)
                } else {
                  setPageOffset(0)
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
            <TooltipProvider delayDuration={400}>
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
                      ["suggested_line", "Suggested match"],
                      ["needs_new_line", "Review"],
                      ["posted", "Posted"],
                      ["rejected", "Dismissed"],
                    ] as const
                  ).map(([k, lab]) => (
                    <Button
                      key={k}
                      type="button"
                      variant={filter === k ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setFilter(k)
                        setPageOffset(0)
                      }}
                    >
                      {lab}
                      {detail ? ` (${detail.statusCounts[k]})` : ""}
                    </Button>
                  ))}
                </div>

                {detail.page.total > detail.page.limit ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Showing {detail.page.offset + 1}-{detail.page.offset + filteredTx.length} of{" "}
                      {detail.page.total}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={batchControlsLocked || detail.page.offset === 0}
                        onClick={() => setPageOffset(Math.max(0, detail.page.offset - detail.page.limit))}
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={batchControlsLocked || !detail.page.hasMore}
                        onClick={() => setPageOffset(detail.page.offset + detail.page.limit)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="bg-muted/40 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    Post from suggestions
                    {batchActionBusy === "bulk_post" ? (
                      <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={batchControlsLocked || bulkMatchedCount === 0}
                      title="Existing category or income line only"
                      onClick={() => void onBulkPost("matched")}
                    >
                      Matched{bulkMatchedCount > 0 ? ` (${bulkMatchedCount})` : ""}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={batchControlsLocked || bulkAllSuggestedCount === 0}
                      title="Matched rows plus review rows with a suggested category name"
                      onClick={() => void onBulkPost("all")}
                    >
                      All{bulkAllSuggestedCount > 0 ? ` (${bulkAllSuggestedCount})` : ""}
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs">
                  <span className="font-medium text-foreground">Matched</span> posts rows mapped to an
                  existing category or income line.{" "}
                  <span className="font-medium text-foreground">All</span> also creates categories from AI
                  review suggestions when needed.
                </p>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Match</TableHead>
                        <TableHead className="w-[1%] whitespace-nowrap">Actions</TableHead>
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
                          <TableCell className="max-w-60 truncate" title={t.description}>
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
                                {t.direction === "income" ? "Income line" : "Expense category"}:{" "}
                                {suggestedMatchLabel(t)}
                              </span>
                            ) : t.matchStatus === "needs_new_line" ? (
                              <span className="text-amber-700 dark:text-amber-400">
                                Review: {t.suggestedCategoryName || "Choose category manually"}
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
                          <TableCell className="align-top">
                            {t.postedRecordId ? null : (
                              <div className="flex max-w-[min(100vw-4rem,20rem)] flex-col gap-2 py-0.5">
                                <div className="flex flex-wrap items-center gap-1">
                                  {t.matchStatus === "suggested_line" ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          size="icon"
                                          variant="default"
                                          className="size-8 shrink-0"
                                          disabled={tableActionsLocked}
                                          aria-label="Accept suggested match"
                                          onClick={() =>
                                            startListTransition(async () => {
                                              const r = await acceptSuggestedMatchFromImport(t.id)
                                              if (r.ok) {
                                                toast.success("Posted")
                                                if (batchId) loadDetail(batchId, filter, pageOffset)
                                                refreshBudget()
                                              } else toast.error(r.error)
                                            })
                                          }
                                        >
                                          <Check className="size-4" aria-hidden />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">Accept suggested match</TooltipContent>
                                    </Tooltip>
                                  ) : null}
                                  {t.matchStatus === "needs_new_line" ? (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="secondary"
                                          className="h-8 shrink-0 px-2 text-xs"
                                          disabled={tableActionsLocked}
                                          onClick={() =>
                                            startListTransition(async () => {
                                              const r = await acceptSuggestedCategoryFromImport(t.id)
                                              if (r.ok) {
                                                toast.success("Posted")
                                                if (batchId) loadDetail(batchId, filter, pageOffset)
                                                refreshBudget()
                                              } else toast.error(r.error)
                                            })
                                          }
                                        >
                                          Post category
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">Post using suggested category</TooltipContent>
                                    </Tooltip>
                                  ) : null}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="outline"
                                        className="size-8 shrink-0"
                                        disabled={tableActionsLocked}
                                        aria-label="Choose expense category"
                                        onClick={() => openManualCategoryDialog(t.id)}
                                      >
                                        <FolderInput className="size-4" aria-hidden />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Pick expense category…</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="text-muted-foreground size-8 shrink-0"
                                        disabled={tableActionsLocked}
                                        aria-label="Dismiss import row"
                                        onClick={() =>
                                          startListTransition(async () => {
                                            const r = await dismissImportedTransaction(t.id)
                                            if (r.ok) {
                                              toast.message("Dismissed")
                                              if (batchId) loadDetail(batchId, filter, pageOffset)
                                            } else toast.error(r.error)
                                          })
                                        }
                                      >
                                        <Trash2 className="size-4" aria-hidden />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Dismiss</TooltipContent>
                                  </Tooltip>
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                  <Select
                                    value={matchOverrides[t.id] ?? "_"}
                                    onValueChange={(v) =>
                                      setMatchOverrides((o) => ({ ...o, [t.id]: v }))
                                    }
                                  >
                                    <SelectTrigger className="h-8 min-w-0 flex-1 sm:max-w-44">
                                      <SelectValue placeholder="Override…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="_">Override…</SelectItem>
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
                                    className="h-8 shrink-0 px-2"
                                    disabled={tableActionsLocked}
                                    onClick={() => postOverride(t.id)}
                                  >
                                    Post
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
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={manualCategoryTxId != null}
        onOpenChange={(open) => {
          if (!open && !manualCategorySubmitting) setManualCategoryTxId(null)
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!manualCategorySubmitting}>
          <DialogHeader>
            <DialogTitle>Post to expense category</DialogTitle>
            <DialogDescription>
              Assign this import row to an existing or new expense category.
              {manualCategoryTarget ? (
                <span className="text-foreground mt-2 block truncate font-normal">
                  {manualCategoryTarget.description}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={manualCategoryId}
                onValueChange={setManualCategoryId}
                disabled={manualCategorySubmitting || tableActionsLocked}
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
                disabled={manualCategorySubmitting || tableActionsLocked}
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
              disabled={manualCategorySubmitting}
              onClick={() => setManualCategoryTxId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={manualCategorySubmitting || tableActionsLocked}
              onClick={() => void submitManualCategory()}
            >
              {manualCategorySubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              Post expense
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
