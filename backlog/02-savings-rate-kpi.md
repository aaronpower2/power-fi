# Backlog: Savings Rate KPI on Summary Dashboard

## Problem
Savings rate is the single most impactful variable in a FIRE plan — it determines both how fast the portfolio grows and how small the required principal is (lower spending = lower withdrawal). It is not currently surfaced anywhere on the Summary dashboard. You have to mentally compute it from the cash-flow page.

---

## Desired Outcome
- Summary dashboard gains a **Savings Rate** KPI card showing:
  - Current month savings rate %
  - 3-month rolling average savings rate %
  - Visual indicator vs a configurable target (e.g., 40%)
- Savings rate = (total income − total expenses) / total income for the period, converted to reporting currency

---

## Technical Spec

### 1. Data: savings rate query (`lib/data/summary.ts`)

Add a helper `getSavingsRateData(reportingCurrency: string)` that:

1. Queries the last 3 closed months from `expense_records` + `income_records` (joined via `income_lines` / `expense_categories`).
2. For each month, computes:
   ```
   income    = SUM(income_records.amount converted to reportingCurrency)
   expenses  = SUM(expense_records.amount converted to reportingCurrency)
   savings   = income - expenses
   rate      = savings / income  (null if income = 0)
   ```
3. Returns:
   ```typescript
   interface SavingsRateData {
     currentMonth: { label: string; rate: number | null; income: number; expenses: number };
     rollingAvg3Month: number | null; // avg of up to 3 most recent months with data
   }
   ```

Use existing FX conversion utilities (`lib/currency/convert.ts`) — the same pattern used in `lib/data/budget.ts`.

Use `occurredOn` date field to bucket by month (`YYYY-MM`). "Current month" = the most recent month that has at least one income or expense record.

---

### 2. Summary page data (`lib/data/summary.ts`)

Call `getSavingsRateData` inside `getSummaryPageData()` and merge into the return object.

---

### 3. UI: Savings Rate card (`components/summary/SavingsRateCard.tsx`)

New component. Props:

```typescript
interface SavingsRateCardProps {
  currentRate: number | null;     // e.g. 0.43 = 43%
  rollingAvg: number | null;
  targetRate?: number;            // default 0.40 — pull from goal or hardcode for now
  currentMonth: string;           // e.g. "Mar 2026"
}
```

Layout:

```
┌──────────────────────────────────┐
│ Savings Rate          Mar 2026   │
│                                  │
│        43%                       │
│  ████████████░░░░  vs 40% target │
│                                  │
│  3-month avg: 38%                │
└──────────────────────────────────┘
```

- Rate displayed in large text, colour-coded: green if >= target, amber if within 5pp below, red if > 5pp below.
- Progress bar uses shadcn `Progress`, capped at 100%.
- If `currentRate` is null (no data), show "No data yet — add income and expenses in Cash Flow."

---

### 4. Goal: optional target savings rate field

To make the target configurable rather than hardcoded at 40%, add an optional field to the `goals` schema:

```sql
-- drizzle migration
ALTER TABLE goals ADD COLUMN target_savings_rate numeric(5,4);
-- e.g. 0.4000 = 40%
```

Update `lib/db/schema.ts` and the goal Zod validation (`lib/validations/goal.ts`) accordingly. Update the Goal form in `components/goals/GoalManager.tsx` to expose a "Target savings rate (%)" input.

If the field is null, the card defaults to displaying 40% as the target with a "(default)" label.

---

### Files to touch
| File | Change |
|------|--------|
| `lib/data/summary.ts` | Add `getSavingsRateData`, merge into `getSummaryPageData` |
| `components/summary/SummaryDashboard.tsx` | Render `SavingsRateCard` |
| `components/summary/SavingsRateCard.tsx` | New component |
| `lib/db/schema.ts` | Add `targetSavingsRate` to goals table |
| `drizzle/` | New migration file for the column |
| `lib/validations/goal.ts` | Add optional `targetSavingsRate` field |
| `components/goals/GoalManager.tsx` | Add savings rate input to goal form |

---

### Edge cases
- Month with zero income: show rate as null / "—" not 0% or Infinity.
- Months with only partial records (e.g., current month mid-way through): label clearly as "month-to-date."
- Multi-currency: all amounts must be converted before summing — use the same FX rates already loaded for the summary page to avoid redundant queries.
