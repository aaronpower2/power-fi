import { z } from "zod"

import { supportedCurrencySchema } from "@/lib/currency/iso4217"

const dateStr = z
  .string()
  .min(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")

export const lifestyleLineInputSchema = z.object({
  name: z.string().trim().min(1, "Line name required").max(256),
  monthlyAmount: z.coerce.number().positive("Monthly cost must be positive"),
})

export const goalInputSchema = z.object({
  currency: supportedCurrencySchema,
  fiDate: dateStr,
  withdrawalRatePercent: z.coerce
    .number()
    .min(0.1, "At least 0.1%")
    .max(50, "At most 50%"),
  lifestyleLines: z
    .array(lifestyleLineInputSchema)
    .min(1, "Add at least one lifestyle line"),
})

export const createGoalSchema = goalInputSchema.extend({
  makeActive: z.boolean().default(true),
})

export const updateGoalSchema = goalInputSchema.extend({
  id: z.string().uuid(),
})

export function sumLifestyleMonthly(lines: { monthlyAmount: number }[]): number {
  return lines.reduce((s, l) => s + l.monthlyAmount, 0)
}

export type LifestyleLineInput = z.infer<typeof lifestyleLineInputSchema>
export type GoalInput = z.infer<typeof goalInputSchema>
export type CreateGoalInput = z.infer<typeof createGoalSchema>
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>
