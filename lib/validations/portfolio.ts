import { z } from "zod"

import { supportedCurrencySchema } from "@/lib/currency/iso4217"

const dateOpt = z
  .string()
  .optional()
  .refine((s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s), "Use YYYY-MM-DD")

const assetObject = z.object({
  name: z.string().min(1).max(256),
  assetType: z.string().min(1).max(128),
  currency: supportedCurrencySchema,
  growthType: z.enum(["compound", "capital"]),
  assumedAnnualReturnPercent: z.coerce.number().optional(),
  assumedTerminalValue: z.coerce.number().optional(),
  maturationDate: dateOpt,
  currentBalance: z.coerce.number().min(0),
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

export type AssetFormInput = z.infer<typeof createAssetSchema>
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>
