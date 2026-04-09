# Backlog: Investable Surplus Trend Chart

## Problem
The monthly investable surplus (income − expenses) is visible on the cash-flow page for the selected month, but there is no historical view. You can't answer "am I investing more or less than last quarter?" without manually comparing months. This is a critical feedback loop for a FIRE plan — contribution consistency matters as much as growth rate.

---

## Desired Outcome
- Summary dashboard gains a **Investable Surplus Trend** chart showing the last 12 months of:
  - Actual investable surplus (income − expenses, in reporting currency)
  - A reference line at the "required monthly investable" implied by the active FI goal
- Hovering a bar shows: month, income, expenses, surplus, and how much was actually allocated

---

## Technical Spec

### 1. Data query (`lib/data/summary.ts`)

Add `getInvestableTrend(months: number, reportingCurrency: string, fxRates: FxRateMap)`:

```typescript
interface MonthSurplusPoint {
  label: string;          // "Jan 2026"
  periodMonth: string;    // "2026-01"
  income: number;
  expenses: number;
  surplus: number;        // income - expenses (converted to reportingCurrency)
  allocated: number;      // SUM(allocation_records.amount) for that month, converted
}
```

Steps:
1. Get the 12 most recent `YYYY-MM` values that have at least one income or expense record.
2. For each month, SUM `income_records.amount` (with FX conversion) and SUM `expense_records.amount` (with FX conversion).
3. For each month, SUM `allocation_records.amount` WHERE `date_trunc('month', allocated_on) = month` (with FX conversion).
4. Return array sorted ascending by date.

Use existing `lib/currency/convert.ts` utilities.

---

### 2. Required monthly investable (from FI goal)

The active goal already has `monthlyFundingRequirement` (lifestyle lines sum). But "required monthly investable" for the accumulation phase = `(requiredPrincipal - currentNetWorth) / monthsToFiDate`. Add this calculation to `getSummaryPageData()` and expose it alongside the chart data.

This becomes the reference line on the chart: "you need to invest at least X/month to hit your FI date."

---

### 3. UI: Surplus Trend chart (`components/summary/SurplusTrendChart.tsx`)

New component using Recharts `ComposedChart` with:
- `Bar` for surplus (green if positive, red/amber if negative)
- `Line` for allocated amount (dashed, to show "what actually went to work")
- `ReferenceLine` at `y={requiredMonthlyInvestable}` labelled "Required"

Props:
```typescript
interface SurplusTrendChartProps {
  data: MonthSurplusPoint[];
  requiredMonthlyInvestable: number | null;
  currency: string;
}
```

Tooltip content on hover:
```
Mar 2026
Income:    AED 28,500
Expenses:  AED 16,200
Surplus:   AED 12,300
Allocated: AED 10,000
```

Chart height: 220px. Keep it compact — it sits below the KPI cards on the summary page.

---

### 4. Summary page layout

Insert `SurplusTrendChart` below the KPI cards row and above the FI projection chart. The section heading should read "Monthly Surplus — last 12 months."

---

### Files to touch
| File | Change |
|------|--------|
| `lib/data/summary.ts` | Add `getInvestableTrend`, expose `requiredMonthlyInvestable` |
| `components/summary/SummaryDashboard.tsx` | Render `SurplusTrendChart` between KPI cards and projection chart |
| `components/summary/SurplusTrendChart.tsx` | New component |

---

### Edge cases
- Months with no income records: show bar as 0, don't divide by zero.
- Negative surplus months: render bar in a distinct red/amber colour to make them visually obvious.
- Fewer than 12 months of data: render what exists, left-pad with nothing (don't show empty bars).
- `requiredMonthlyInvestable` is null if there's no active goal or FI date is in the past — omit the reference line in that case.
