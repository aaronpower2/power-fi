import { z } from "zod"

import { BUDGET_SUMMARY_CURRENCIES } from "@/lib/budget/summary-currency"
import { supportedCurrencySchema } from "@/lib/currency/iso4217"

const budgetSummaryCurrencySchema = z.enum(BUDGET_SUMMARY_CURRENCIES)
export const LIABILITY_TRACKING_MODES = ["fixed_installment", "revolving"] as const
const liabilityTrackingModeSchema = z.enum(LIABILITY_TRACKING_MODES)

const dateOpt = z
  .string()
  .optional()
  .refine((s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s), "Use YYYY-MM-DD")

const linkToManageFields = z.object({
  url: z.string().max(2048).optional(),
  label: z.string().max(256).optional(),
  credentialsHint: z.string().max(2000).optional(),
})

const assetMetaSchema = z
  .object({
    linkToManage: linkToManageFields.optional(),
  })
  .optional()

const assetObject = z.object({
  name: z.string().min(1).max(256),
  assetType: z.string().min(1).max(128),
  currency: supportedCurrencySchema,
  growthType: z.enum(["compound", "capital"]),
  assumedAnnualReturnPercent: z.coerce.number().optional(),
  assumedTerminalValue: z.coerce.number().optional(),
  maturationDate: dateOpt,
  currentBalance: z.coerce.number().min(0),
  meta: assetMetaSchema,
})

function refineAsset<T extends z.infer<typeof assetObject>>(
  data: T,
  ctx: z.RefinementCtx,
) {
  if (data.growthType === "compound") {
    if (
      data.assumedAnnualReturnPercent == null ||
      Number.isNaN(data.assumedAnnualReturnPercent)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Annual return (%) required for compound assets",
        path: ["assumedAnnualReturnPercent"],
      })
    }
  }
  if (data.growthType === "capital") {
    if (data.assumedTerminalValue == null || Number.isNaN(data.assumedTerminalValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Terminal value required for capital assets",
        path: ["assumedTerminalValue"],
      })
    }
    if (!data.maturationDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Maturation date required for capital assets",
        path: ["maturationDate"],
      })
    }
  }
}

export const createAssetSchema = assetObject.superRefine(refineAsset)

export const updateAssetSchema = assetObject
  .extend({ id: z.string().uuid() })
  .superRefine(refineAsset)

export const strategyNameSchema = z.object({
  name: z.string().min(1).max(256),
})

export const createStrategySchema = strategyNameSchema.extend({
  makeActive: z.boolean().default(false),
})

export const updateStrategySchema = strategyNameSchema.extend({
  id: z.string().uuid(),
})

export const allocationTargetSchema = z.object({
  strategyId: z.string().uuid(),
  assetId: z.string().uuid(),
  weightPercent: z.coerce.number().min(0).max(100),
})

export const createAllocationRecordSchema = z.object({
  assetId: z.string().uuid(),
  amount: z.coerce.number().positive("Amount must be greater than zero"),
  allocatedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
})

const allocateInvestableWeightEntrySchema = z.object({
  assetId: z.string().uuid(),
  /** Relative weights; normalized on the server (need not sum to 100). */
  weightPercent: z.coerce.number().min(0).max(1_000_000),
})

/** Split this month’s budget investable across the active strategy’s targets (server recomputes investable). */
export const allocateInvestableFromBudgetSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  summaryCurrency: budgetSummaryCurrencySchema,
  weights: z.array(allocateInvestableWeightEntrySchema).optional(),
})

const optionalSecuredAssetId = z
  .union([z.string().uuid(), z.literal("")])
  .optional()
  .transform((v) => (v === "" || v == null ? undefined : v))

const liabilityObject = z.object({
  name: z.string().min(1).max(256),
  liabilityType: z
    .string()
    .max(128)
    .optional()
    .transform((s) => {
      const t = s?.trim()
      return t === "" || t == null ? undefined : t
    }),
  currency: supportedCurrencySchema,
  trackingMode: liabilityTrackingModeSchema.default("fixed_installment"),
  currentBalance: z.coerce.number().min(0),
  securedByAssetId: optionalSecuredAssetId,
})

export const createLiabilitySchema = liabilityObject

export const updateLiabilitySchema = liabilityObject.extend({
  id: z.string().uuid(),
})

export type AssetFormInput = z.infer<typeof createAssetSchema>
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>

function trimOpt(s: string | undefined): string | undefined {
  const t = s?.trim()
  return t === "" || t == null ? undefined : t
}

/** Persistable JSON for `assets.meta` (drops empty linkToManage). */
export function normalizeAssetMetaForDb(
  meta: z.infer<typeof assetMetaSchema>,
): Record<string, unknown> {
  if (!meta?.linkToManage) return {}
  const lm = meta.linkToManage
  const url = trimOpt(lm.url)
  const label = trimOpt(lm.label)
  const credentialsHint = trimOpt(lm.credentialsHint)
  if (!url && !label && !credentialsHint) return {}
  return {
    linkToManage: {
      ...(url ? { url } : {}),
      ...(label ? { label } : {}),
      ...(credentialsHint ? { credentialsHint } : {}),
    },
  }
}
