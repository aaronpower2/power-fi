"use client"

import { useState } from "react"
import { toast } from "sonner"

import { allocateInvestablePerStrategy } from "@/lib/actions/portfolio"
import type { getBudgetPageData } from "@/lib/data/budget"
import { formatCurrency } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2, Zap } from "lucide-react"

type BudgetData = Awaited<ReturnType<typeof getBudgetPageData>>

export function AllocateInvestableCapitalCta({
  data,
  refresh,
}: {
  data: BudgetData
  refresh: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [draftWeights, setDraftWeights] = useState<Record<string, number>>({})

  const { strategyAllocate, ym, summaryCurrency, totals, monthEnd, allocatePreview } = data
  const hasInvestable = totals.investableActual > 0

  const disabledTitle =
    !strategyAllocate.canAllocate && strategyAllocate.disabledReason
      ? strategyAllocate.disabledReason
      : undefined

  function openDialog() {
    if (allocatePreview) {
      setDraftWeights(
        Object.fromEntries(allocatePreview.targets.map((t) => [t.assetId, t.weightPercent])),
      )
    }
    setDialogOpen(true)
  }

  function resetToStrategy() {
    if (!allocatePreview) return
    setDraftWeights(
      Object.fromEntries(allocatePreview.targets.map((t) => [t.assetId, t.weightPercent])),
    )
  }

  const weightSum = allocatePreview
    ? allocatePreview.targets.reduce((s, t) => s + (draftWeights[t.assetId] ?? 0), 0)
    : 0

  const canSubmit =
    strategyAllocate.canAllocate &&
    hasInvestable &&
    allocatePreview != null &&
    weightSum > 0 &&
    !pending

  async function confirm() {
    if (!allocatePreview || !canSubmit) return
    setPending(true)
    const weights = allocatePreview.targets.map((t) => ({
      assetId: t.assetId,
      weightPercent: draftWeights[t.assetId] ?? 0,
    }))
    const r = await allocateInvestablePerStrategy({ yearMonth: ym, summaryCurrency, weights })
    setPending(false)
    if (r.ok && r.data) {
      toast.success(`Created ${r.data.created} allocation record(s) in Net Worth.`)
      setDialogOpen(false)
      refresh()
    } else if (!r.ok) {
      toast.error(r.error)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="default"
        size="sm"
        className="shrink-0"
        disabled={!strategyAllocate.canAllocate || pending}
        title={disabledTitle}
        onClick={openDialog}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" aria-hidden />
        ) : (
          <Zap className="size-3.5" data-icon="inline-start" aria-hidden />
        )}
        {pending ? "Working…" : "Allocate Investable Capital"}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {allocatePreview
                ? `Allocate — ${allocatePreview.strategyName}`
                : "Allocate investable capital"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-muted-foreground space-y-1 text-sm">
                {!hasInvestable ? (
                  <p className="text-destructive">No investable amount for this month.</p>
                ) : allocatePreview ? (
                  <>
                    <p>
                      {formatCurrency(totals.investableActual, summaryCurrency)} investable · ends{" "}
                      {monthEnd}
                    </p>
                    <p>
                      Adjust weights if you want a one-off split; amounts below use your weights
                      normalized to 100%. Saved strategy targets are not changed.
                    </p>
                  </>
                ) : (
                  <p>No allocation preview available.</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {allocatePreview && allocatePreview.targets.length > 0 ? (
            <div className="max-h-[min(50vh,22rem)] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="w-28 text-right">Weight</TableHead>
                    <TableHead className="w-36 text-right tabular-nums">
                      Share ({summaryCurrency})
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allocatePreview.targets.map((t) => {
                    const w = draftWeights[t.assetId] ?? 0
                    const share =
                      weightSum > 0 ? (totals.investableActual * w) / weightSum : 0
                    return (
                      <TableRow key={t.assetId}>
                        <TableCell>
                          <div className="font-medium">{t.assetName}</div>
                          <div className="text-muted-foreground text-xs">{t.currency}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step={0.1}
                            className="tabular-nums h-8 text-right"
                            value={Number.isFinite(w) ? w : 0}
                            disabled={pending}
                            onChange={(e) => {
                              const v = Number.parseFloat(e.target.value)
                              setDraftWeights((prev) => ({
                                ...prev,
                                [t.assetId]: Number.isFinite(v) && v >= 0 ? v : 0,
                              }))
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {weightSum > 0
                            ? formatCurrency(share, summaryCurrency)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              Weight total:{" "}
              <span className="text-foreground font-medium tabular-nums">
                {weightSum.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={pending || !allocatePreview}
              onClick={resetToStrategy}
            >
              Reset to strategy
            </Button>
          </div>

          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={!canSubmit} onClick={() => void confirm()}>
              {pending ? "Working…" : "Create records"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
