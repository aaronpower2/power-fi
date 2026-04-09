"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  useForm,
  useWatch,
  type Control,
  type FieldValues,
  type Resolver,
} from "react-hook-form"
import { toast } from "sonner"
import type { z } from "zod"

import {
  createAllocationRecord,
  createAsset,
  createLiability,
  createStrategy,
  deleteAllocationRecord,
  deleteAllocationTarget,
  deleteAsset,
  deleteLiability,
  deleteStrategy,
  setActiveStrategy,
  updateAsset,
  updateLiability,
  updateStrategy,
  upsertAllocationTarget,
} from "@/lib/actions/portfolio"
import {
  allocationTargetSchema,
  createAllocationRecordSchema,
  createAssetSchema,
  createLiabilitySchema,
  createStrategySchema,
  LIABILITY_TRACKING_MODES,
  strategyNameSchema,
  updateAssetSchema,
  updateLiabilitySchema,
  updateStrategySchema,
  type UpdateAssetInput,
} from "@/lib/validations/portfolio"
import {
  ASSET_CATEGORY_GROUP_HEADINGS,
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_VALUES,
  allowedGrowthTypesForCategory,
  defaultGrowthType,
  defaultIncludeInFi,
  growthTypeLabel,
  isGrowthTypeAllowedForCategory,
  isRealEstateAssetCategory,
  type AssetGrowthType,
  type AssetCategory,
} from "@/lib/portfolio/asset-category"
import { parseAssetMeta } from "@/lib/types/asset-meta"
import { SUPPORTED_CURRENCIES } from "@/lib/currency/iso4217"
import {
  getPortfolioData,
  type PortfolioAllocationRecordRow,
} from "@/lib/data/portfolio"
import { formatCurrency } from "@/lib/format"
import { dashboardRoutes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { CardHeaderTitleRow, InfoTooltip } from "@/components/info-tooltip"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  DecimalMoneyInput,
  IntegerInput,
  PercentInput,
} from "@/components/ui/numeric-input"
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
import { tabsListVariants } from "@/components/ui/tabs"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react"

type PortfolioPayload = Awaited<ReturnType<typeof getPortfolioData>>
type AssetRow = PortfolioPayload["assets"][number]
type LiabilityRow = PortfolioPayload["liabilities"][number]
type CreateAssetForm = z.infer<typeof createAssetSchema>
type CreateLiabilityForm = z.input<typeof createLiabilitySchema>
type UpdateLiabilityInput = z.input<typeof updateLiabilitySchema>

type SecuredRow = PortfolioPayload["securedLiabilityByAssetId"][string]
type PendingDeleteState = {
  id: string
  requiresConfirmation: boolean
  message?: string
}

const ASSET_TABLE_CATEGORY_ORDER: AssetCategory[] = [
  "investment",
  "cash",
  "real_estate_rental",
  "real_estate_primary",
  "vehicle",
  "depreciating_other",
  "other",
]

function assetValueLabel(category: unknown): string {
  return isRealEstateAssetCategory(category)
    ? "Current market value"
    : "Current value"
}

function assetValueDescription(category: unknown): string {
  if (isRealEstateAssetCategory(category)) {
    return "Enter the property's gross market value or your claim's current resale value. Do not enter only the booking fee or equity paid in. Loans stay under Liabilities."
  }
  return "Enter the asset's current gross value in its native currency. Liabilities are tracked separately."
}

function roundToSingleDecimal(
  value: number | null | undefined
): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.round(value * 10) / 10
}

const portfolioTabTriggerCn =
  "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

function PortfolioSummaryCurrencySwitch({
  summaryCurrency,
  summaryCurrencyOptions,
}: {
  summaryCurrency: PortfolioPayload["summaryCurrency"]
  summaryCurrencyOptions: PortfolioPayload["summaryCurrencyOptions"]
}) {
  const router = useRouter()
  return (
    <div
      className="inline-flex rounded-lg border bg-muted/40 p-0.5"
      role="group"
      aria-label="Reporting currency for portfolio totals"
    >
      {summaryCurrencyOptions.map((ccy) => (
        <Button
          key={ccy}
          type="button"
          size="sm"
          variant={summaryCurrency === ccy ? "secondary" : "ghost"}
          className="h-7 min-w-12 px-2.5 text-xs font-medium"
          onClick={() => router.push(`${dashboardRoutes.netWorth}?ccy=${ccy}`)}
        >
          {ccy}
        </Button>
      ))}
    </div>
  )
}

export function PortfolioManager({ data }: { data: PortfolioPayload }) {
  const router = useRouter()
  const refresh = () => router.refresh()
  const {
    assets,
    liabilities,
    strategies,
    activeStrategy,
    targets,
    allocationRecordsByAssetId,
    totalInvestedReporting,
    currentPositionReporting,
    totalLiabilitiesReporting,
    netPositionReporting,
    yearlyProjectedReporting,
    summaryCurrency,
    summaryCurrencyOptions,
    goalReportingCurrency,
    fiDateLabel,
    portfolioFxWarning,
    fxAsOfDate,
    securedLiabilityByAssetId,
    allocationHealthSummary,
  } = data

  const assetsGrouped = useMemo(() => {
    const by = new Map<AssetCategory, AssetRow[]>()
    for (const c of ASSET_CATEGORY_VALUES) {
      by.set(c, [])
    }
    for (const a of assets) {
      const cat = (a.assetCategory ?? "other") as AssetCategory
      const list = by.get(cat)
      if (list) list.push(a)
    }
    return ASSET_TABLE_CATEGORY_ORDER.filter(
      (c) => (by.get(c)?.length ?? 0) > 0
    ).map((c) => ({
      category: c,
      items: by.get(c) ?? [],
    }))
  }, [assets])

  const targetSum = useMemo(
    () => targets.reduce((s, t) => s + Number(t.weightPercent), 0),
    [targets]
  )

  const [mainTab, setMainTab] = useState("assets")
  const [pendingDeleteAsset, setPendingDeleteAsset] =
    useState<PendingDeleteState | null>(null)
  const [pendingDeleteStrategy, setPendingDeleteStrategy] = useState<
    string | null
  >(null)
  const [assetToEdit, setAssetToEdit] = useState<AssetRow | null>(null)
  const [assetForRecords, setAssetForRecords] = useState<AssetRow | null>(null)
  const [strategyToRename, setStrategyToRename] = useState<{
    id: string
    name: string
  } | null>(null)
  const [liabilityToEdit, setLiabilityToEdit] = useState<LiabilityRow | null>(
    null
  )
  const [pendingDeleteLiability, setPendingDeleteLiability] =
    useState<PendingDeleteState | null>(null)

  const reportingCcy = goalReportingCurrency ?? summaryCurrency
  const tabBaseId = useId()
  const panelAssetsId = `${tabBaseId}-panel-assets`
  const panelLiabilitiesId = `${tabBaseId}-panel-liabilities`
  const panelStrategyId = `${tabBaseId}-panel-strategy`
  const triggerAssetsId = `${tabBaseId}-trigger-assets`
  const triggerLiabilitiesId = `${tabBaseId}-trigger-liabilities`
  const triggerStrategyId = `${tabBaseId}-trigger-strategy`

  return (
    <div
      data-slot="tabs"
      data-orientation="horizontal"
      className="group/tabs flex w-full flex-col gap-8"
    >
      <PageHeader
        title="Net Worth"
        description="Track what you own, what you owe, and how your allocation strategy shapes projected net worth through FI."
        controls={
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              role="tablist"
              aria-orientation="horizontal"
              data-slot="tabs-list"
              data-variant="default"
              className={tabsListVariants({ variant: "default" })}
            >
              <button
                type="button"
                role="tab"
                id={triggerAssetsId}
                aria-selected={mainTab === "assets"}
                aria-controls={panelAssetsId}
                tabIndex={mainTab === "assets" ? 0 : -1}
                data-slot="tabs-trigger"
                onClick={() => setMainTab("assets")}
                className={cn(
                  portfolioTabTriggerCn,
                  mainTab === "assets"
                    ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground"
                    : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
                )}
              >
                Assets
              </button>
              <button
                type="button"
                role="tab"
                id={triggerLiabilitiesId}
                aria-selected={mainTab === "liabilities"}
                aria-controls={panelLiabilitiesId}
                tabIndex={mainTab === "liabilities" ? 0 : -1}
                data-slot="tabs-trigger"
                onClick={() => setMainTab("liabilities")}
                className={cn(
                  portfolioTabTriggerCn,
                  mainTab === "liabilities"
                    ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground"
                    : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
                )}
              >
                Liabilities
              </button>
              <button
                type="button"
                role="tab"
                id={triggerStrategyId}
                aria-selected={mainTab === "strategy"}
                aria-controls={panelStrategyId}
                tabIndex={mainTab === "strategy" ? 0 : -1}
                data-slot="tabs-trigger"
                onClick={() => setMainTab("strategy")}
                className={cn(
                  portfolioTabTriggerCn,
                  mainTab === "strategy"
                    ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground"
                    : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
                )}
              >
                Strategy
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <PortfolioSummaryCurrencySwitch
                summaryCurrency={summaryCurrency}
                summaryCurrencyOptions={summaryCurrencyOptions}
              />
              {mainTab === "assets" ? (
                <AddAssetDialog onSaved={refresh} />
              ) : null}
              {mainTab === "liabilities" ? (
                <AddLiabilityDialog assets={assets} onSaved={refresh} />
              ) : null}
              {mainTab === "strategy" ? (
                <StrategyCreateDialog onCreated={refresh} />
              ) : null}
            </div>
          </div>
        }
      />

      {portfolioFxWarning ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {portfolioFxWarning}
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
        <div className="grid w-full min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="min-w-0">
            <CardHeader className="gap-0 pt-3 pb-1">
              <CardTitle className="text-sm leading-tight font-medium">
                Total invested
              </CardTitle>
              <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                Allocation records
                {goalReportingCurrency ? ` · ${goalReportingCurrency}` : ""}
              </p>
            </CardHeader>
            <CardContent className="pt-0 pb-3">
              <p className="font-heading text-lg font-semibold tabular-nums sm:text-xl md:text-2xl">
                {totalInvestedReporting != null
                  ? formatCurrency(totalInvestedReporting, reportingCcy)
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="gap-0 pt-3 pb-1">
              <CardTitle className="text-sm leading-tight font-medium">
                Gross position
              </CardTitle>
              <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                Assets only · {summaryCurrency}
              </p>
            </CardHeader>
            <CardContent className="pt-0 pb-3">
              <p className="font-heading text-lg font-semibold tabular-nums sm:text-xl md:text-2xl">
                {currentPositionReporting != null
                  ? formatCurrency(currentPositionReporting, reportingCcy)
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="gap-0 pt-3 pb-1">
              <CardTitle className="text-sm leading-tight font-medium">
                Total liabilities
              </CardTitle>
              <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                Remaining owed
              </p>
            </CardHeader>
            <CardContent className="pt-0 pb-3">
              <p className="font-heading text-lg font-semibold tabular-nums sm:text-xl md:text-2xl">
                {totalLiabilitiesReporting != null
                  ? formatCurrency(totalLiabilitiesReporting, reportingCcy)
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="gap-0 pt-3 pb-1">
              <CardTitle className="text-sm leading-tight font-medium">
                Net position
              </CardTitle>
              <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                Assets − liabilities
              </p>
            </CardHeader>
            <CardContent className="pt-0 pb-3">
              <p className="font-heading text-lg font-semibold tabular-nums sm:text-xl md:text-2xl">
                {netPositionReporting != null
                  ? formatCurrency(netPositionReporting, reportingCcy)
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardHeaderTitleRow
              title={
                <CardTitle className="text-base font-medium">
                  Projected total by year
                </CardTitle>
              }
              info={
                <>
                  <p>
                    FI-scoped path: assets marked &quot;in FI plan&quot; plus
                    monthly investable, minus projected liabilities. Full
                    balance-sheet net worth is in the cards above and on FI
                    Summary.
                  </p>
                  {(fiDateLabel || fxAsOfDate) && (
                    <p className="mt-2 text-muted-foreground">
                      {[
                        fiDateLabel ? `FI ${fiDateLabel}` : null,
                        fxAsOfDate ? `FX ${fxAsOfDate}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </>
              }
            />
          </CardHeader>
          <CardContent>
            <PortfolioYearlyBarChart
              data={yearlyProjectedReporting}
              currencyCode={reportingCcy}
            />
          </CardContent>
        </Card>
      </div>

      <div
        role="tabpanel"
        id={panelAssetsId}
        aria-labelledby={triggerAssetsId}
        hidden={mainTab !== "assets"}
        tabIndex={0}
        data-slot="tabs-content"
        className="mt-0 flex-1 space-y-4 text-sm outline-none"
      >
        <EditAssetDialog
          asset={assetToEdit}
          secured={
            assetToEdit ? securedLiabilityByAssetId[assetToEdit.id] : undefined
          }
          open={!!assetToEdit}
          onOpenChange={(o) => {
            if (!o) setAssetToEdit(null)
          }}
          onSaved={() => {
            setAssetToEdit(null)
            refresh()
          }}
        />
        {assetForRecords ? (
          <AllocationRecordsDialog
            asset={assetForRecords}
            records={allocationRecordsByAssetId[assetForRecords.id] ?? []}
            open={!!assetForRecords}
            onOpenChange={(o) => {
              if (!o) setAssetForRecords(null)
            }}
            onSaved={refresh}
          />
        ) : null}
        <Card>
          <CardHeader>
            <CardHeaderTitleRow
              title={<CardTitle>Assets</CardTitle>}
              info="Rows are grouped by category. Included shows whether the asset feeds FI Summary and strategy projections. Snapshot shows the asset's annual growth or future revaluation model. Current value is the gross asset value before liabilities. For real estate, use market or claim value; equity is implied after debts."
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36%]">Asset</TableHead>
                  <TableHead>Snapshot</TableHead>
                  <TableHead
                    className="w-[18%] text-right"
                    title="Gross current asset value before liabilities. For real estate, use market or claim value."
                  >
                    Current value
                  </TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-20 text-center text-muted-foreground"
                    >
                      No assets yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  assetsGrouped.map(({ category, items }) => (
                    <Fragment key={category}>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell
                          colSpan={4}
                          className="py-2 text-xs font-semibold text-muted-foreground"
                        >
                          {ASSET_CATEGORY_GROUP_HEADINGS[category]}
                        </TableCell>
                      </TableRow>
                      {items.map((a) => {
                        const recs = allocationRecordsByAssetId[a.id] ?? []
                        const allocated = recs.reduce(
                          (s, r) => s + Number(r.amount),
                          0
                        )
                        const link = parseAssetMeta(a.meta).linkToManage
                        const externalLabel =
                          link?.label && link.label !== a.name
                            ? link.label
                            : null
                        return (
                          <TableRow key={a.id}>
                            <TableCell className="min-w-0 py-3 align-top font-medium whitespace-normal">
                              <div
                                className="flex items-center gap-1.5"
                                title={link?.credentialsHint || undefined}
                              >
                                <span className="min-w-0 truncate">
                                  {a.name}
                                </span>
                                {link?.url ? (
                                  <a
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
                                    aria-label={
                                      link.label
                                        ? `Open ${link.label}`
                                        : "Open link to manage"
                                    }
                                    title={link.label ?? "Manage externally"}
                                  >
                                    <ExternalLink className="size-3.5" />
                                  </a>
                                ) : null}
                              </div>
                              {externalLabel ? (
                                <div className="mt-0.5 max-w-[16rem] truncate text-[11px] text-muted-foreground">
                                  {externalLabel}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell className="py-3 align-top whitespace-normal">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-full border px-2 py-0.5 font-medium",
                                    a.includeInFiProjection
                                      ? "border-transparent bg-foreground text-background"
                                      : "border-border bg-muted text-muted-foreground"
                                  )}
                                  title={
                                    a.includeInFiProjection
                                      ? "Included in projections"
                                      : "Excluded from projections"
                                  }
                                >
                                  {a.includeInFiProjection
                                    ? "Included"
                                    : "Excluded"}
                                </span>
                                <span className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-muted-foreground">
                                  {a.currency ?? "USD"}
                                </span>
                                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-muted-foreground">
                                  {growthTypeLabel(a.growthType)}
                                </span>
                                <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-muted-foreground tabular-nums">
                                  Allocated{" "}
                                  {formatCurrency(
                                    allocated,
                                    a.currency ?? "USD"
                                  )}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell
                              className="py-3 text-right align-top tabular-nums"
                              title={
                                isRealEstateAssetCategory(a.assetCategory)
                                  ? "Gross property or claim value before loans"
                                  : "Current gross asset value"
                              }
                            >
                              <div className="flex items-center justify-end gap-2">
                                <span>
                                  {formatCurrency(
                                    Number(a.currentBalance),
                                    a.currency ?? "USD"
                                  )}
                                </span>
                                {isRealEstateAssetCategory(a.assetCategory) ? (
                                  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                                    Gross
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="py-3 align-top">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Actions"
                                  >
                                    <MoreHorizontal />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={(e) => {
                                      e.preventDefault()
                                      setAssetForRecords(a)
                                    }}
                                  >
                                    <ClipboardList className="size-4 opacity-70" />
                                    Records
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={(e) => {
                                      e.preventDefault()
                                      setAssetToEdit(a)
                                    }}
                                  >
                                    <Pencil className="size-4 opacity-70" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={(e) => {
                                      e.preventDefault()
                                      setPendingDeleteAsset({
                                        id: a.id,
                                        requiresConfirmation: false,
                                      })
                                    }}
                                  >
                                    <Trash2 className="size-4 opacity-70" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div
        role="tabpanel"
        id={panelLiabilitiesId}
        aria-labelledby={triggerLiabilitiesId}
        hidden={mainTab !== "liabilities"}
        tabIndex={0}
        data-slot="tabs-content"
        className="mt-0 flex-1 space-y-4 text-sm outline-none"
      >
        <EditLiabilityDialog
          liability={liabilityToEdit}
          assets={assets}
          open={!!liabilityToEdit}
          onOpenChange={(o) => {
            if (!o) setLiabilityToEdit(null)
          }}
          onSaved={() => {
            setLiabilityToEdit(null)
            refresh()
          }}
        />
        <Card>
          <CardHeader>
            <CardHeaderTitleRow
              title={<CardTitle>Liabilities</CardTitle>}
              info="Track what you still owe. Loans tied to an asset are usually edited from that asset’s dialog. Fixed-installment rows can decline via linked debt payment lines in Cash Flow; revolving balances stay manual unless you update them here."
            />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>CCY</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Secured by</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {liabilities.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-20 text-center text-muted-foreground"
                    >
                      No liabilities yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  liabilities.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        <div>{row.name}</div>
                        <div className="mt-1">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                              row.hasDebtPaymentLine
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            )}
                          >
                            {row.hasDebtPaymentLine
                              ? "Debt line tracked in Cash Flow"
                              : "No debt payment line"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.liabilityType ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.currency ?? "USD"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(
                          Number(row.currentBalance),
                          row.currency ?? "USD"
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.securedByAssetName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Actions"
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault()
                                setLiabilityToEdit(row)
                              }}
                            >
                              <Pencil className="size-4 opacity-70" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={(e) => {
                                e.preventDefault()
                                setPendingDeleteLiability({
                                  id: row.id,
                                  requiresConfirmation: false,
                                })
                              }}
                            >
                              <Trash2 className="size-4 opacity-70" />
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
      </div>

      <div
        role="tabpanel"
        id={panelStrategyId}
        aria-labelledby={triggerStrategyId}
        hidden={mainTab !== "strategy"}
        tabIndex={0}
        data-slot="tabs-content"
        className="mt-0 flex-1 space-y-6 text-sm outline-none"
      >
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
        <Card>
          <CardHeader>
            <CardHeaderTitleRow
              title={<CardTitle>Allocation setup</CardTitle>}
              info="Shows whether the active strategy is ready for Cash Flow allocation and when capital was last allocated."
            />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <p className="font-medium">
                {allocationHealthSummary.strategyName
                  ? `Active strategy: ${allocationHealthSummary.strategyName}`
                  : "No active strategy"}
              </p>
              <p className="text-sm text-muted-foreground">
                {allocationHealthSummary.strategyName
                  ? `${allocationHealthSummary.targetCount} target${allocationHealthSummary.targetCount === 1 ? "" : "s"} · weights ${allocationHealthSummary.weightSum.toFixed(1)}%`
                  : "Set up a strategy here before allocating in Cash Flow."}
              </p>
              <p className="text-sm text-muted-foreground">
                {allocationHealthSummary.lastAllocatedOn
                  ? `Last allocated: ${allocationHealthSummary.lastAllocatedOn}`
                  : "No allocation history yet."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Link
                href={dashboardRoutes.cashFlow}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Allocate in Cash Flow
              </Link>
              {allocationHealthSummary.strategyName && targetSum !== 100 ? (
                <span className="text-amber-700 dark:text-amber-400">
                  Weights do not sum to 100%; allocation will be rescaled.
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
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
                    <TableCell
                      colSpan={3}
                      className="h-16 text-center text-muted-foreground"
                    >
                      No strategies yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  strategies.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>
                        {s.isActive ? "Active" : "Inactive"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Actions"
                            >
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
                                <CheckCircle2 className="size-4 opacity-70" />
                                Set active
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault()
                                setStrategyToRename({ id: s.id, name: s.name })
                              }}
                            >
                              <PencilLine className="size-4 opacity-70" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={(e) => {
                                e.preventDefault()
                                setPendingDeleteStrategy(s.id)
                              }}
                            >
                              <Trash2 className="size-4 opacity-70" />
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
              title={
                <CardTitle>Allocation targets (active strategy)</CardTitle>
              }
              info="Weights should sum to 100% for full deployment of investable capital."
            />
            <p
              className={
                targetSum !== 100
                  ? "text-sm font-medium text-destructive tabular-nums"
                  : "text-sm text-muted-foreground tabular-nums"
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
                        <TableCell
                          colSpan={3}
                          className="h-16 text-center text-muted-foreground"
                        >
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
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span>No active strategy</span>
                <InfoTooltip>
                  Activate a strategy to edit allocation targets.
                </InfoTooltip>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
              {pendingDeleteAsset?.requiresConfirmation
                ? pendingDeleteAsset.message
                : "Removes the asset and related allocation targets. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                if (!pendingDeleteAsset) return
                const r = await deleteAsset(
                  pendingDeleteAsset.requiresConfirmation
                    ? { id: pendingDeleteAsset.id, force: true }
                    : pendingDeleteAsset.id
                )
                if (r.ok && r.data?.requiresConfirmation) {
                  setPendingDeleteAsset({
                    id: pendingDeleteAsset.id,
                    requiresConfirmation: true,
                    message: r.data.message,
                  })
                  return
                }
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
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
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

      <AlertDialog
        open={!!pendingDeleteLiability}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteLiability(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete liability?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteLiability?.requiresConfirmation
                ? pendingDeleteLiability.message
                : "Removes this liability row. Securing links are cleared. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                if (!pendingDeleteLiability) return
                const r = await deleteLiability(
                  pendingDeleteLiability.requiresConfirmation
                    ? { id: pendingDeleteLiability.id, force: true }
                    : pendingDeleteLiability.id
                )
                if (r.ok && r.data?.requiresConfirmation) {
                  setPendingDeleteLiability({
                    id: pendingDeleteLiability.id,
                    requiresConfirmation: true,
                    message: r.data.message,
                  })
                  return
                }
                setPendingDeleteLiability(null)
                if (r.ok) {
                  toast.success("Liability deleted")
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

function PortfolioYearlyBarChart({
  data,
  currencyCode,
}: {
  data: { year: number; projectedTotal: number }[]
  currencyCode: string
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">—</p>
  }

  const chartData = data.map((d) => ({
    year: String(d.year),
    total: d.projectedTotal,
  }))

  return (
    <div className="h-[280px] w-full text-foreground sm:h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--border)"
            vertical={false}
          />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) =>
              v >= 1_000_000
                ? `${Math.round(v / 1_000_000)}M`
                : `${Math.round(v / 1000)}k`
            }
          />
          <Tooltip
            contentStyle={{
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              background: "var(--card)",
            }}
            formatter={(value) => [
              formatCurrency(
                typeof value === "number" ? value : Number(value),
                currencyCode,
                { maximumFractionDigits: 0 }
              ),
              "Projected",
            ]}
            labelFormatter={(label) => `Year ${label}`}
          />
          <Bar
            dataKey="total"
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            name="Projected"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function liabilityToFormValues(row: LiabilityRow): UpdateLiabilityInput {
  return {
    id: row.id,
    name: row.name,
    liabilityType: row.liabilityType ?? "",
    currency: (row.currency ?? "USD") as UpdateLiabilityInput["currency"],
    trackingMode: (row.trackingMode ??
      "fixed_installment") as UpdateLiabilityInput["trackingMode"],
    currentBalance: Number(row.currentBalance),
    securedByAssetId: row.securedByAssetId ?? "",
    autoCreateBudgetCategory: false,
  }
}

function LiabilityFormFields({
  control,
  assets,
  showAutoCreateBudgetCategory = false,
}: {
  control: Control<FieldValues>
  assets: AssetRow[]
  showAutoCreateBudgetCategory?: boolean
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
        name="liabilityType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Type</FormLabel>
            <FormControl>
              <Input
                placeholder="Mortgage, margin, loan…"
                {...field}
                value={field.value ?? ""}
              />
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
        name="currentBalance"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Amount still owed</FormLabel>
            <FormControl>
              <IntegerInput min={0} {...field} onValueChange={field.onChange} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="trackingMode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tracking mode</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {LIABILITY_TRACKING_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {mode === "fixed_installment"
                      ? "Fixed installment"
                      : "Revolving"}
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
        name="securedByAssetId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Secured by asset</FormLabel>
            <Select
              onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
              value={
                field.value && field.value !== "" ? field.value : "__none__"
              }
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {assets.map((a) => (
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
      {showAutoCreateBudgetCategory ? (
        <FormField
          control={control}
          name="autoCreateBudgetCategory"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-2 space-y-0">
              <FormControl>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
              </FormControl>
              <div className="space-y-1">
                <FormLabel className="font-normal">
                  Create debt payment line
                </FormLabel>
                <p className="text-xs text-muted-foreground">
                  Creates a linked debt payment line in Cash Flow using this
                  liability name.
                </p>
              </div>
            </FormItem>
          )}
        />
      ) : null}
    </>
  )
}

function AddLiabilityDialog({
  assets,
  onSaved,
}: {
  assets: AssetRow[]
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const form = useForm<CreateLiabilityForm>({
    resolver: zodResolver(createLiabilitySchema),
    defaultValues: {
      name: "",
      liabilityType: "",
      currency: "USD",
      trackingMode: "fixed_installment",
      currentBalance: 0,
      securedByAssetId: "",
      autoCreateBudgetCategory: false,
    },
  })

  async function onSubmit(values: CreateLiabilityForm) {
    const r = await createLiability(values)
    if (r.ok) {
      toast.success("Liability created")
      setOpen(false)
      form.reset({
        name: "",
        liabilityType: "",
        currency: "USD",
        trackingMode: "fixed_installment",
        currentBalance: 0,
        securedByAssetId: "",
        autoCreateBudgetCategory: false,
      })
      onSaved()
    } else toast.error(r.error)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4 shrink-0" aria-hidden />
          Add liability
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">
            New liability
          </DialogTitle>
          <Button
            type="submit"
            form="portfolio-liability-create"
            size="sm"
            className="shrink-0"
          >
            Create
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form
            id="portfolio-liability-create"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-3"
          >
            <LiabilityFormFields
              control={form.control as unknown as Control<FieldValues>}
              assets={assets}
              showAutoCreateBudgetCategory
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function EditLiabilityDialog({
  liability,
  assets,
  open,
  onOpenChange,
  onSaved,
}: {
  liability: LiabilityRow | null
  assets: AssetRow[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const form = useForm<UpdateLiabilityInput>({
    resolver: zodResolver(updateLiabilitySchema),
    defaultValues: liability ? liabilityToFormValues(liability) : undefined,
  })

  useEffect(() => {
    if (liability && open) {
      form.reset(liabilityToFormValues(liability))
    }
  }, [liability, open, form])

  async function onSubmit(values: UpdateLiabilityInput) {
    const r = await updateLiability(values)
    if (r.ok) {
      toast.success("Liability updated")
      onOpenChange(false)
      onSaved()
    } else toast.error(r.error)
  }

  if (!liability) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">
            Edit liability
          </DialogTitle>
          <Button
            type="submit"
            form="portfolio-liability-edit"
            size="sm"
            className="shrink-0"
          >
            Save
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form
            id="portfolio-liability-edit"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-3"
          >
            <input type="hidden" {...form.register("id")} />
            <LiabilityFormFields
              control={form.control as unknown as Control<FieldValues>}
              assets={assets}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

function assetToFormValues(
  asset: AssetRow,
  secured: SecuredRow | undefined
): UpdateAssetInput {
  const m = parseAssetMeta(asset.meta)
  return {
    id: asset.id,
    name: asset.name,
    assetCategory: asset.assetCategory,
    includeInFiProjection: asset.includeInFiProjection,
    currency: (asset.currency ?? "USD") as UpdateAssetInput["currency"],
    growthType: asset.growthType,
    assumedAnnualReturnPercent: asset.assumedAnnualReturn
      ? roundToSingleDecimal(Number(asset.assumedAnnualReturn) * 100)
      : undefined,
    assumedTerminalValue: asset.assumedTerminalValue
      ? Number(asset.assumedTerminalValue)
      : undefined,
    maturationDate: asset.maturationDate ?? undefined,
    currentBalance: Number(asset.currentBalance),
    meta: {
      linkToManage: {
        url: m.linkToManage?.url ?? "",
        label: m.linkToManage?.label ?? "",
        credentialsHint: m.linkToManage?.credentialsHint ?? "",
      },
    },
    securedLiability: secured
      ? {
          name: secured.name,
          liabilityType: secured.liabilityType ?? "",
          currency: secured.currency as UpdateAssetInput["currency"],
          trackingMode: secured.trackingMode as
            | "fixed_installment"
            | "revolving",
          currentBalance: Number(secured.currentBalance),
          autoCreateBudgetCategory: false,
        }
      : undefined,
  }
}

function AllocationRecordsDialog({
  asset,
  records,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: AssetRow
  records: PortfolioAllocationRecordRow[]
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const ccy = asset.currency ?? "USD"
  const addForm = useForm<z.infer<typeof createAllocationRecordSchema>>({
    resolver: zodResolver(createAllocationRecordSchema),
    defaultValues: {
      assetId: asset.id,
      amount: 0,
      allocatedOn: new Date().toISOString().slice(0, 10),
    },
  })

  useEffect(() => {
    if (open) {
      addForm.reset({
        assetId: asset.id,
        amount: 0,
        allocatedOn: new Date().toISOString().slice(0, 10),
      })
    }
  }, [open, asset.id, addForm])

  async function addRec(values: z.infer<typeof createAllocationRecordSchema>) {
    const r = await createAllocationRecord({ ...values, assetId: asset.id })
    if (r.ok) {
      toast.success("Record added")
      addForm.reset({
        assetId: asset.id,
        amount: 0,
        allocatedOn: new Date().toISOString().slice(0, 10),
      })
      onSaved()
    } else toast.error(r.error)
  }

  const allocRecordFormId = `portfolio-alloc-record-${asset.id}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-8">
            <DialogTitle>Allocation records — {asset.name}</DialogTitle>
            <InfoTooltip>
              Log capital you move into this asset (contributions). Amounts are
              in the asset’s currency.
            </InfoTooltip>
          </div>
          <Button
            type="submit"
            form={allocRecordFormId}
            size="sm"
            className="shrink-0"
            disabled={!asset.includeInFiProjection}
          >
            Add record
          </Button>
        </DialogHeader>
        {!asset.includeInFiProjection ? (
          <p className="text-xs text-muted-foreground">
            This asset is not in your FI plan — allocation records cannot be
            added (remove old rows if needed).
          </p>
        ) : null}
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
                <TableCell
                  colSpan={3}
                  className="h-14 text-center text-muted-foreground"
                >
                  No records.
                </TableCell>
              </TableRow>
            ) : (
              records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {r.allocatedOn}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(Number(r.amount), ccy)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={async () => {
                        const res = await deleteAllocationRecord(r.id)
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
            id={allocRecordFormId}
            onSubmit={addForm.handleSubmit(addRec)}
            className="flex flex-wrap gap-2 border-t pt-4"
          >
            <input type="hidden" {...addForm.register("assetId")} />
            <FormField
              control={addForm.control}
              name="amount"
              render={({ field }) => (
                <FormItem className="min-w-[100px] flex-1">
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <DecimalMoneyInput
                      min={0}
                      {...field}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={addForm.control}
              name="allocatedOn"
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

const createAssetFormDefaults: CreateAssetForm = {
  name: "",
  assetCategory: "investment",
  includeInFiProjection: true,
  currency: "USD",
  growthType: "compound",
  assumedAnnualReturnPercent: 7,
  currentBalance: 0,
  meta: {
    linkToManage: { url: "", label: "", credentialsHint: "" },
  },
}

function AddAssetDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [loanLinked, setLoanLinked] = useState(false)
  const [customizeFi, setCustomizeFi] = useState(false)
  const form = useForm<CreateAssetForm>({
    resolver: zodResolver(createAssetSchema) as Resolver<CreateAssetForm>,
    defaultValues: createAssetFormDefaults,
  })
  const growthType = form.watch("growthType")
  const assetCategory = form.watch("assetCategory")
  const previousAssetCategoryRef = useRef<AssetCategory>(
    createAssetFormDefaults.assetCategory
  )

  useEffect(() => {
    if (!customizeFi) {
      form.setValue(
        "includeInFiProjection",
        defaultIncludeInFi(assetCategory as AssetCategory)
      )
    }
  }, [assetCategory, customizeFi, form])

  useEffect(() => {
    const nextCategory = assetCategory as AssetCategory
    const prevCategory = previousAssetCategoryRef.current
    const currentGrowthType = form.getValues("growthType") as AssetGrowthType
    const prevDefault = defaultGrowthType(prevCategory)

    if (
      !isGrowthTypeAllowedForCategory(nextCategory, currentGrowthType) ||
      currentGrowthType === prevDefault
    ) {
      form.setValue("growthType", defaultGrowthType(nextCategory))
    }

    previousAssetCategoryRef.current = nextCategory
  }, [assetCategory, form])

  useEffect(() => {
    if (loanLinked) {
      const ccy = form.getValues("currency") ?? "USD"
      form.setValue("securedLiability", {
        name: "",
        liabilityType: "",
        currency: ccy as CreateAssetForm["currency"],
        trackingMode: "fixed_installment",
        currentBalance: 0,
        autoCreateBudgetCategory: false,
      })
    } else {
      form.setValue("securedLiability", undefined)
    }
  }, [loanLinked, form])

  async function onSubmit(values: CreateAssetForm) {
    if (loanLinked) {
      const sl = values.securedLiability
      if (!sl?.name?.trim()) {
        toast.error("Loan name is required when linking a loan.")
        return
      }
    }
    const payload: CreateAssetForm = {
      ...values,
      assumedAnnualReturnPercent: roundToSingleDecimal(
        values.assumedAnnualReturnPercent
      ),
      securedLiability:
        loanLinked && values.securedLiability?.name?.trim()
          ? values.securedLiability
          : undefined,
    }
    const r = await createAsset(payload)
    if (r.ok) {
      toast.success("Asset created")
      setOpen(false)
      setLoanLinked(false)
      setCustomizeFi(false)
      form.reset(createAssetFormDefaults)
      previousAssetCategoryRef.current = createAssetFormDefaults.assetCategory
      onSaved()
    } else toast.error(r.error)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4 shrink-0" aria-hidden />
          Add asset
        </Button>
      </DialogTrigger>
      <DialogContent
        fullViewport
        className="inset-4 max-h-[calc(100dvh-2rem)] sm:inset-6 sm:max-h-[calc(100dvh-3rem)]"
      >
        <DialogHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b border-border px-6 py-4 pr-14">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <DialogTitle>New asset</DialogTitle>
            <InfoTooltip>
              Category sets FI inclusion defaults and the recommended growth
              model. Real estate always uses annual appreciation.
            </InfoTooltip>
          </div>
          <Button
            type="submit"
            form="portfolio-asset-create"
            size="sm"
            className="shrink-0"
          >
            Create
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form
              id="portfolio-asset-create"
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <AssetFormFields
                control={form.control as unknown as Control<FieldValues>}
                growthType={growthType}
                variant="create"
                loanLinked={loanLinked}
                setLoanLinked={setLoanLinked}
                customizeFi={customizeFi}
                setCustomizeFi={setCustomizeFi}
              />
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditAssetDialog({
  asset,
  secured,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: AssetRow | null
  secured?: SecuredRow
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [loanLinked, setLoanLinked] = useState(false)
  const form = useForm<UpdateAssetInput>({
    resolver: zodResolver(updateAssetSchema) as Resolver<UpdateAssetInput>,
    defaultValues: asset ? assetToFormValues(asset, secured) : undefined,
  })
  const growthType = form.watch("growthType")
  const assetCategory = form.watch("assetCategory")
  const previousAssetCategoryRef = useRef<AssetCategory>(
    asset?.assetCategory ?? "investment"
  )

  useEffect(() => {
    if (asset && open) {
      setLoanLinked(!!secured)
      form.reset(assetToFormValues(asset, secured))
      previousAssetCategoryRef.current = asset.assetCategory
    }
  }, [asset, secured, open, form])

  useEffect(() => {
    if (!asset || !open) return

    const nextCategory = assetCategory as AssetCategory
    const prevCategory = previousAssetCategoryRef.current
    const currentGrowthType = form.getValues("growthType") as AssetGrowthType
    const prevDefault = defaultGrowthType(prevCategory)

    if (
      !isGrowthTypeAllowedForCategory(nextCategory, currentGrowthType) ||
      currentGrowthType === prevDefault
    ) {
      form.setValue("growthType", defaultGrowthType(nextCategory))
    }

    previousAssetCategoryRef.current = nextCategory
  }, [asset, open, assetCategory, form])

  useEffect(() => {
    if (!asset || !open) return
    if (loanLinked) {
      const ccy = form.getValues("currency") ?? "USD"
      const cur = form.getValues("securedLiability")
      if (!cur) {
        form.setValue("securedLiability", {
          name: "",
          liabilityType: "",
          currency: ccy as UpdateAssetInput["currency"],
          trackingMode: "fixed_installment",
          currentBalance: 0,
          autoCreateBudgetCategory: false,
        })
      }
    } else {
      form.setValue("securedLiability", undefined)
    }
  }, [loanLinked, asset, open, form])

  async function onSubmit(values: UpdateAssetInput) {
    const had = !!secured
    if (loanLinked) {
      const sl = values.securedLiability
      if (!sl?.name?.trim()) {
        toast.error("Loan name is required when linking a loan.")
        return
      }
    }
    let securedLiability: UpdateAssetInput["securedLiability"]
    if (had) {
      securedLiability = loanLinked ? values.securedLiability : null
    } else if (loanLinked && values.securedLiability?.name?.trim()) {
      securedLiability = values.securedLiability
    } else {
      securedLiability = undefined
    }
    const r = await updateAsset({
      ...values,
      assumedAnnualReturnPercent: roundToSingleDecimal(
        values.assumedAnnualReturnPercent
      ),
      securedLiability,
    })
    if (r.ok) {
      toast.success("Asset updated")
      onOpenChange(false)
      onSaved()
    } else toast.error(r.error)
  }

  if (!asset) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullViewport
        className="inset-4 max-h-[calc(100dvh-2rem)] sm:inset-6 sm:max-h-[calc(100dvh-3rem)]"
      >
        <DialogHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b border-border px-6 py-4 pr-14">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <DialogTitle>Edit asset</DialogTitle>
            <InfoTooltip>
              FI inclusion and linked loans affect projections separately. Real
              estate uses annual appreciation, while future revaluation remains
              for special non-property cases.
            </InfoTooltip>
          </div>
          <Button
            type="submit"
            form="portfolio-asset-edit"
            size="sm"
            className="shrink-0"
          >
            Save
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <Form {...form}>
            <form
              id="portfolio-asset-edit"
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
            >
              <input type="hidden" {...form.register("id")} />
              <AssetFormFields
                control={form.control as unknown as Control<FieldValues>}
                growthType={growthType}
                variant="edit"
                loanLinked={loanLinked}
                setLoanLinked={setLoanLinked}
                customizeFi={false}
                setCustomizeFi={() => {}}
              />
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AssetFormFields({
  control,
  growthType,
  variant,
  loanLinked,
  setLoanLinked,
  customizeFi,
  setCustomizeFi,
}: {
  control: Control<FieldValues>
  growthType: AssetGrowthType
  variant: "create" | "edit"
  loanLinked: boolean
  setLoanLinked: (v: boolean) => void
  customizeFi: boolean
  setCustomizeFi: (v: boolean) => void
}) {
  const assetCategory = useWatch({ control, name: "assetCategory" })
  const selectedCategory =
    (assetCategory as AssetCategory | undefined) ?? "investment"
  const allowedGrowthTypes = allowedGrowthTypesForCategory(selectedCategory)
  const growthMetricLabel = isRealEstateAssetCategory(selectedCategory)
    ? "Annual appreciation (%)"
    : "Annual growth (%)"

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
        name="assetCategory"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Category</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Choose category" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {ASSET_CATEGORY_VALUES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {ASSET_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      {variant === "create" ? (
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={customizeFi}
            onChange={(e) => setCustomizeFi(e.target.checked)}
          />
          <span className="leading-snug text-muted-foreground">
            Customize “in FI plan” (stop syncing from category when you change
            category)
          </span>
        </label>
      ) : null}
      <FormField
        control={control}
        name="includeInFiProjection"
        render={({ field }) => (
          <FormItem className="flex flex-row items-start gap-2 space-y-0">
            <FormControl>
              <input
                type="checkbox"
                className="mt-1"
                checked={field.value}
                onChange={field.onChange}
              />
            </FormControl>
            <div className="space-y-1">
              <FormLabel className="font-normal">
                Include in FI plan &amp; strategy targets
              </FormLabel>
              <p className="text-xs text-muted-foreground">
                When off, the asset still counts toward net worth but is
                excluded from Summary projections and allocation weights.
              </p>
            </div>
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
                {allowedGrowthTypes.includes("compound") ? (
                  <SelectItem value="compound">
                    {growthTypeLabel("compound")}
                  </SelectItem>
                ) : null}
                {allowedGrowthTypes.includes("capital") ? (
                  <SelectItem value="capital">
                    {growthTypeLabel("capital")}
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <FormDescription>
              {isRealEstateAssetCategory(selectedCategory)
                ? "Real estate projects with annual appreciation. Future revaluation is reserved for special non-property cases."
                : "Use annual growth for ongoing appreciation or return assumptions. Use future revaluation for one-off repricing or exit scenarios."}
            </FormDescription>
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
              <FormLabel>{growthMetricLabel}</FormLabel>
              <FormControl>
                <PercentInput
                  min={0}
                  max={100}
                  {...field}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormDescription>
                {isRealEstateAssetCategory(selectedCategory)
                  ? "Used to project property appreciation from the current market value."
                  : "Used to project ongoing growth from the current value. Rounded to one decimal place."}
              </FormDescription>
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
                <FormLabel>Projected value</FormLabel>
                <FormControl>
                  <IntegerInput
                    min={0}
                    {...field}
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                  />
                </FormControl>
                <FormDescription>
                  Use when you expect a discrete revaluation, exit, or resale
                  value at a future date.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="maturationDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Revaluation date</FormLabel>
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
            <FormLabel>{assetValueLabel(assetCategory)}</FormLabel>
            <FormControl>
              <IntegerInput min={0} {...field} onValueChange={field.onChange} />
            </FormControl>
            <FormDescription>
              {assetValueDescription(assetCategory)}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="space-y-3 border-t pt-3">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={loanLinked}
            onChange={(e) => setLoanLinked(e.target.checked)}
          />
          <span>
            <span className="font-medium">Linked secured loan</span>
            <span className="block text-xs text-muted-foreground">
              Optional. Creates or updates one liability secured by this asset.
              The asset value above stays gross; equity is implied after
              liabilities. Additional loans can be tracked under Liabilities.
            </span>
          </span>
        </label>
        {loanLinked ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <FormField
              control={control}
              name="securedLiability.name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Car loan"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="securedLiability.liabilityType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan type (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Auto, mortgage…"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name="securedLiability.currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan currency</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? "USD"}
                  >
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
              name="securedLiability.trackingMode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Loan tracking</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value ?? "fixed_installment"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LIABILITY_TRACKING_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {mode === "fixed_installment"
                            ? "Fixed installment"
                            : "Revolving"}
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
              name="securedLiability.currentBalance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount still owed</FormLabel>
                  <FormControl>
                    <IntegerInput
                      min={0}
                      {...field}
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {variant === "create" ? (
              <FormField
                control={control}
                name="securedLiability.autoCreateBudgetCategory"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-2 space-y-0">
                    <FormControl>
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel className="font-normal">
                        Create debt payment line
                      </FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Creates a linked debt payment line in Cash Flow for this
                        loan.
                      </p>
                    </div>
                  </FormItem>
                )}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-3 border-t pt-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Link to manage
        </p>
        <p className="text-xs text-muted-foreground">
          Optional pointer to the broker or app and a credentials hint (stored
          in your database — use references, not secrets).
        </p>
        <FormField
          control={control}
          name="meta.linkToManage.label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Platform label</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g. Interactive Brokers"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="meta.linkToManage.url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>URL</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  inputMode="url"
                  placeholder="https://…"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="meta.linkToManage.credentialsHint"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Credentials hint</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  value={field.value ?? ""}
                  rows={3}
                  className={cn(
                    "flex w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30"
                  )}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
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
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4 shrink-0" aria-hidden />
          New strategy
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">
            New strategy
          </DialogTitle>
          <Button
            type="submit"
            form="portfolio-strategy-create"
            size="sm"
            className="shrink-0"
          >
            Create
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form
            id="portfolio-strategy-create"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-3"
          >
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
        <DialogHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <DialogTitle className="min-w-0 flex-1 pr-8">
            Rename strategy
          </DialogTitle>
          <Button
            type="submit"
            form="portfolio-strategy-rename"
            size="sm"
            className="shrink-0"
          >
            Save
          </Button>
        </DialogHeader>
        <Form {...form}>
          <form
            id="portfolio-strategy-rename"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-3"
          >
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
  const available = assets.filter(
    (a) => !existingAssetIds.includes(a.id) && a.includeInFiProjection
  )

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
    const r = await upsertAllocationTarget({
      ...values,
      weightPercent:
        roundToSingleDecimal(values.weightPercent) ?? values.weightPercent,
    })
    if (r.ok) {
      toast.success("Target saved")
      form.reset({
        strategyId,
        assetId: available[0]?.id ?? "",
        weightPercent: 0,
      })
      onAdded()
    } else toast.error(r.error)
  }

  if (available.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>—</span>
        <InfoTooltip>
          All FI-plan assets already have a target, or add/mark assets for FI
          under Net Worth.
        </InfoTooltip>
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
                <PercentInput
                  min={0}
                  max={100}
                  {...field}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
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
