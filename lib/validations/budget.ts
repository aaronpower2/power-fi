import { z } from "zod"

import { BUDGET_RECURRING_FREQUENCIES } from "@/lib/budget/recurring"
import { supportedCurrencySchema } from "@/lib/currency/iso4217"

const dateStr = z
  .string()
  .min(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")

const budgetRecurringFrequencySchema = z.enum(BUDGET_RECURRING_FREQUENCIES)

const incomeLineFields = z.object({
  name: z.string().min(1).max(256),
  isRecurring: z.boolean().default(false),
  frequency: budgetRecurringFrequencySchema.optional().nullable(),
  recurringAmount: z.coerce.number().optional().nullable(),
  recurringCurrency: supportedCurrencySchema.optional().nullable(),
  /** When set, budget counts this line only in months that contain a scheduled payment. */
  recurringAnchorDate: dateStr.optional().nullable(),
})

const incomeLineRefined = incomeLineFields.superRefine((data, ctx) => {
  if (data.isRecurring) {
    if (data.frequency == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a frequency for recurring income",
        path: ["frequency"],
      })
    }
    const amt = data.recurringAmount
    if (amt == null || Number.isNaN(amt) || amt <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter amount per pay period",
        path: ["recurringAmount"],
      })
    }
  }
})

export const incomeLineSchema = incomeLineRefined.transform((data) => ({
  name: data.name,
  isRecurring: data.isRecurring,
  frequency: data.isRecurring ? data.frequency! : null,
  recurringAmount: data.isRecurring ? data.recurringAmount! : null,
  recurringCurrency: data.isRecurring ? (data.recurringCurrency ?? "USD") : null,
  recurringAnchorDate: data.isRecurring ? (data.recurringAnchorDate ?? null) : null,
}))

const updateIncomeLineInput = z
  .object({ id: z.string().uuid() })
  .merge(incomeLineFields)
  .superRefine((data, ctx) => {
    if (data.isRecurring) {
      if (data.frequency == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choose a frequency for recurring income",
          path: ["frequency"],
        })
      }
      const amt = data.recurringAmount
      if (amt == null || Number.isNaN(amt) || amt <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter amount per pay period",
          path: ["recurringAmount"],
        })
      }
    }
  })

export const updateIncomeLineSchema = updateIncomeLineInput.transform((data) => ({
  id: data.id,
  name: data.name,
  isRecurring: data.isRecurring,
  frequency: data.isRecurring ? data.frequency! : null,
  recurringAmount: data.isRecurring ? data.recurringAmount! : null,
  recurringCurrency: data.isRecurring ? (data.recurringCurrency ?? "USD") : null,
  recurringAnchorDate: data.isRecurring ? (data.recurringAnchorDate ?? null) : null,
}))

export const incomeRecordSchema = z.object({
  incomeLineId: z.string().uuid(),
  amount: z.coerce.number(),
  currency: supportedCurrencySchema,
  occurredOn: dateStr,
})

export const updateIncomeRecordSchema = incomeRecordSchema.extend({
  id: z.string().uuid(),
})

export const expenseCategorySchema = z.object({
  name: z.string().min(1).max(256),
  sortOrder: z.coerce.number().int().default(0),
})

export const updateExpenseCategorySchema = expenseCategorySchema.extend({
  id: z.string().uuid(),
})

const expenseLineFields = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1).max(256),
  isRecurring: z.boolean().default(false),
  frequency: budgetRecurringFrequencySchema.optional().nullable(),
  recurringAmount: z.coerce.number().optional().nullable(),
  recurringCurrency: supportedCurrencySchema.optional().nullable(),
  recurringAnchorDate: dateStr.optional().nullable(),
})

const expenseLineRefined = expenseLineFields.superRefine((data, ctx) => {
  if (data.isRecurring) {
    if (data.frequency == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a frequency for recurring expense",
        path: ["frequency"],
      })
    }
    const amt = data.recurringAmount
    if (amt == null || Number.isNaN(amt) || amt <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter amount per period",
        path: ["recurringAmount"],
      })
    }
  }
})

export const expenseLineSchema = expenseLineRefined.transform((data) => ({
  categoryId: data.categoryId,
  name: data.name,
  isRecurring: data.isRecurring,
  frequency: data.isRecurring ? data.frequency! : null,
  recurringAmount: data.isRecurring ? data.recurringAmount! : null,
  recurringCurrency: data.isRecurring ? (data.recurringCurrency ?? "USD") : null,
  recurringAnchorDate: data.isRecurring ? (data.recurringAnchorDate ?? null) : null,
}))

const updateExpenseLineInput = z
  .object({ id: z.string().uuid() })
  .merge(expenseLineFields)
  .superRefine((data, ctx) => {
    if (data.isRecurring) {
      if (data.frequency == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Choose a frequency for recurring expense",
          path: ["frequency"],
        })
      }
      const amt = data.recurringAmount
      if (amt == null || Number.isNaN(amt) || amt <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter amount per period",
          path: ["recurringAmount"],
        })
      }
    }
  })

export const updateExpenseLineSchema = updateExpenseLineInput.transform((data) => ({
  id: data.id,
  categoryId: data.categoryId,
  name: data.name,
  isRecurring: data.isRecurring,
  frequency: data.isRecurring ? data.frequency! : null,
  recurringAmount: data.isRecurring ? data.recurringAmount! : null,
  recurringCurrency: data.isRecurring ? (data.recurringCurrency ?? "USD") : null,
  recurringAnchorDate: data.isRecurring ? (data.recurringAnchorDate ?? null) : null,
}))

export const expenseRecordSchema = z.object({
  expenseLineId: z.string().uuid(),
  amount: z.coerce.number(),
  currency: supportedCurrencySchema,
  occurredOn: dateStr,
})

export const updateExpenseRecordSchema = expenseRecordSchema.extend({
  id: z.string().uuid(),
})
