# Fix: FI Projection Should Use Planned Budget Amounts, Not Current-Month Actuals

## Problem
In `lib/data/fi-plan.ts` (lines 361–428), `monthlyInvestable` — the monthly contribution fed into the FI projection — is computed from:

```typescript
income_records(this month) - expense_records(this month)
```

This is the raw actual for the current calendar month. Problems:

- **On Jan 5th**, salary not yet posted → `monthlyInvestable ≈ 0` → projection shows you never reaching FI.
- **After an unusual month-end expense**, investable tanks → projection artificially worsens.
- **Mid-month**, the investable is partial and meaningless as a forward-looking input.

The projection is a multi-year forward model. The right input is a stable, recurring estimate of "how much do I expect to invest per month going forward" — which is exactly what the budget's planned income and expense recurring rules represent.

---

## Desired Outcome
- The FI projection's `monthlyInvestable` is driven by **planned recurring amounts** (income recurring rules minus expense category recurring rules), giving a stable, forward-looking monthly contribution figure.
- Current-month actuals are still shown on the Summary page as a separate "this month so far" contextual stat — but they don't drive the projection.
- The user can override `monthlyInvestable` manually if they want to model a specific scenario.

---

## Technical Spec

### 1. Compute planned `monthlyInvestable` in `getFiPlanPageData`

Replace the current-month actuals query with planned recurring calculations. The logic already exists in `lib/budget/planned-line.ts` — reuse it:

```typescript
import { monthlyPlannedForLine, monthlyPlannedForExpenseCategory } from "@/lib/budget/planned-line"

// Load all income lines and expense categories
const [allIncomeLines, allExpenseCategories] = await Promise.all([
  db.select().from(incomeLines),
  db.select().from(expenseCategories),
])

// Use a representative "average" month for anchor date logic
// Best choice: same month as today, or next full month
const refStart = startOfCurrentMonth  // already computed above
const refEnd = endOfCurrentMonth

let plannedIncome = 0
for (const line of allIncomeLines) {
  const { currency, amount } = monthlyPlannedForLine(line, refStart, refEnd)
  const conv = convertAmount(amount, currency, goalCurrency, rates)
  if (conv != null) plannedIncome += conv
}

let plannedExpense = 0
for (const cat of allExpenseCategories) {
  const { currency, amount } = monthlyPlannedForExpenseCategory(cat)
  const conv = convertAmount(amount, currency, goalCurrency, rates)
  if (conv != null) plannedExpense += conv
}

const monthlyInvestable = Math.max(0, plannedIncome - plannedExpense)
```

This gives a stable value regardless of where in the month the user is viewing the summary.

---

### 2. Expose both planned and actual investable on the Summary page

Keep the actual current-month calculation as a secondary value — useful context but not the projection driver:

```typescript
// Existing actual calculation — keep, rename
const currentMonthActualInvestable = Math.max(0, incomeConv - expenseConv)

// New planned calculation (above)
const monthlyInvestable = Math.max(0, plannedIncome - plannedExpense)
```

Update the `FiPlanPageData` type to expose both:

```typescript
monthlyInvestable: number | null          // planned — drives projection
currentMonthActualInvestable: number | null  // actual YTD — for display only
```

On the Summary dashboard, show both:

```
Monthly Investable (planned):   AED 12,400   ← drives projection
This month so far (actual):     AED  6,200   ← mid-month, 8 days in
```

---

### 3. Optional: manual override for `monthlyInvestable`

Add an optional URL param `?investable=15000` (in the same currency as the goal) that allows the user to stress-test the projection with a custom monthly contribution:

```typescript
const manualInvestableOverride = opts?.investableOverride
  ? Math.max(0, Number(opts.investableOverride))
  : null

const monthlyInvestable = manualInvestableOverride ?? Math.max(0, plannedIncome - plannedExpense)
```

If an override is active, show a banner on the summary: "Using manual investable of AED 15,000/month. [Reset to planned]"

---

### 4. Update `lib/fi/types.ts`

Extend `FiPlanPageData`:

```typescript
export type FiPlanPageData = {
  // ... existing fields
  monthlyInvestable: number | null          // planned recurring
  currentMonthActualInvestable: number | null  // actual this month
  monthlyInvestableIsOverridden: boolean
}
```

---

### 5. Handle the case where no recurring rules are set

If no income lines have `isRecurring = true` and no expense categories have `isRecurring = true`, `plannedIncome` and `plannedExpense` will both be 0. In this case, fall back to the current-month actuals approach and show a prompt:

```
ⓘ No recurring income or expense rules are set up. The projection is using this
month's actual records. Set up recurring amounts in Cash Flow for a stable projection.
```

This nudges the user toward completing their setup rather than silently showing a misleading value.

---

### Files to touch
| File | Change |
|------|--------|
| `lib/data/fi-plan.ts` | Replace actuals-based investable with planned-based; retain actuals as secondary value |
| `lib/fi/types.ts` | Add `currentMonthActualInvestable` and `monthlyInvestableIsOverridden` to page data type |
| `components/summary/SummaryDashboard.tsx` | Show both planned and actual investable; show override banner if active |
| `app/(dashboard)/summary/page.tsx` | Pass `investableOverride` from search params to data loader |

---

### Edge cases
- If the month used for `monthlyPlannedForLine` has an anchor date effect (e.g., semi-monthly income only counted once in the reference month), results may vary by reference month. Use a 3-month average of planned income/expense to smooth anchor-date effects:
  ```
  plannedMonthlyInvestable = avg of planned investable for (last month, this month, next month)
  ```
- Non-recurring income lines (e.g., bonuses): these correctly contribute 0 to the planned monthly estimate, which is the right behavior for a conservative projection. The actual bonus is captured in `currentMonthActualInvestable`.
- Debt payment categories: their recurring amounts ARE included in `plannedExpense` (they're real cash outflows). The liability paydown simulation in the projection separately handles the balance reduction. This is consistent with the existing logic.
