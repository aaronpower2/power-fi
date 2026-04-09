# Fix: Liability Paydown Simulation Must Use Consistent Data Basis

## Problem
The FI projection calculates net worth as `projected_gross_assets - projected_liability_balance`. These two halves use inconsistent data sources:

**Gross asset projection** uses `monthlyInvestable = income_actual(current month) - expense_actual(current month)`. Debt payments are included in `expense_actual`, so they correctly reduce the investable amount flowing into assets.

**Liability paydown projection** uses `monthlyPlannedForExpenseCategory(cat)` — the planned recurring amount from the budget category — applied linearly, month by month, starting from `liabilities.currentBalance`.

```typescript
// lib/data/fi-plan.ts lines 504–516
const liabilityOffsets = points.map((_, monthIndex) => {
  const monthlyPaydown = debtPaymentByLiabilityGoal.get(row.id) ?? 0
  total += Math.max(0, startBal - monthlyPaydown * (monthIndex + 1))
})
```

**The inconsistency:**
1. If you make an extra loan payment this month (actual > planned), the investable correctly drops (less cash for assets), but the liability balance in the projection still declines at the planned rate — it doesn't model the debt going down faster.
2. Conversely: if no payment was made this month (actual = 0), the investable doesn't drop (good for assets), but the liability paydown simulation still ticks down by the planned amount — modelling the debt shrinking even though it didn't.

After this fix (per `fix-disconnect-3`), `monthlyInvestable` will be based on planned amounts. This resolves the timing mismatch, but a second issue remains: the liability starting balance (`liabilities.currentBalance`) may be stale or inaccurate relative to what the model expects if the user hasn't kept it current.

---

## Desired Outcome
1. When `fix-disconnect-2` is implemented (allocation records update `currentBalance`), the asset side stays current automatically. The liability side needs the same — `currentBalance` should always reflect actual remaining balance, fed by actual debt payment records.
2. The projection clearly shows the assumed monthly paydown rate and flags if there is no budget category tracking a liability (so the paydown rate is 0, meaning the liability never goes down in the projection).
3. Liability `currentBalance` is kept up-to-date by actual `expense_records` (already implemented via `applyExpenseRecordLiability`) — this is working correctly. The issue is the projection uses planned going forward, which is consistent enough if the starting balance is accurate.

---

## Technical Spec

### 1. Validate that `liabilities.currentBalance` is reasonably fresh

In `getFiPlanPageData`, for each `fixed_installment` liability, check `liabilities.updatedAt`. If it hasn't been updated in >60 days and there are no recent expense records reducing it, show a staleness warning:

```typescript
const sixtyDaysAgo = new Date(today)
sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

const staleLibabilities = liabilityRows.filter(
  l => l.trackingMode === "fixed_installment" && new Date(l.updatedAt) < sixtyDaysAgo
)
```

Return `staleliabilityNames` to the summary page. Display:

```
⚠️ "Car Loan" balance hasn't been updated in 60+ days. If you're making payments,
update the balance in Net Worth or post debt payment records in Cash Flow.
```

---

### 2. For liabilities with no linked `debt_payment` category, use 0 paydown rate and warn

Currently, `debtPaymentByLiabilityGoal` only contains amounts from expense categories where `cashFlowType === "debt_payment"` AND `linkedLiabilityId = this liability`. If a liability has no linked category, its `monthlyPaydown = 0`, meaning the projection shows it never declining.

This is actually correct behaviour (the model doesn't know about payments that aren't tracked), but the user won't realise this is why their net worth projection looks flat or wrong.

Add a flag to the summary ViewModel:

```typescript
liabilitiesWithNoPaydownTracking: Array<{ id: string; name: string; balance: number }>
```

Populated by:

```typescript
const trackedLiabilityIds = new Set(debtPaymentByLiabilityGoal.keys())
const untracked = liabilityRows.filter(
  l => l.trackingMode === "fixed_installment" && !trackedLiabilityIds.has(l.id)
)
```

On the Summary dashboard, show a warning below the projection chart:

```
ⓘ The following liabilities have no payment tracking and are shown as fixed in the
projection: Car Loan (AED 52,000), Personal Loan (AED 18,000).
Set up debt payment categories in Cash Flow to model their paydown.
```

---

### 3. Use actual recent paydown rate as a reality-check alongside the planned rate

For liabilities with a linked category, compute both:
- `plannedMonthlyPaydown` — from `monthlyPlannedForExpenseCategory(cat)` (what projection uses)
- `actualAvgMonthlyPaydown` — average of the last 3 months of `expense_records` for that category

If they diverge by more than 20%, surface a note:

```
ⓘ "Home Loan Repayment" is projected at AED 8,500/month but your actual average
over 3 months was AED 8,100/month. The projection may be slightly optimistic.
```

This gives the user visibility into projection assumptions without changing the model.

Add a helper in `lib/data/fi-plan.ts`:

```typescript
async function getActualAvgPaydown(
  db: AppDb,
  categoryId: string,
  monthsBack: number,
  goalCurrency: string,
  rates: Map<string, number>,
): Promise<number> {
  const cutoff = threeMonthsAgo(today)
  const rows = await db
    .select()
    .from(expenseRecords)
    .where(
      and(
        eq(expenseRecords.expenseCategoryId, categoryId),
        gte(expenseRecords.occurredOn, cutoff),
      )
    )
  const total = rows.reduce((s, r) => {
    const v = convertAmount(Number(r.amount), r.currency ?? "USD", goalCurrency, rates)
    return s + (v ?? 0)
  }, 0)
  return total / monthsBack
}
```

---

### 4. In the projection, use planned paydown consistently with fix-disconnect-3

After fix-disconnect-3 is applied, `monthlyInvestable` is planned-based. The liability paydown already uses planned amounts — so after that fix the two halves ARE on a consistent planned basis. The remaining work here is:
- Staleness warnings (step 1 above)
- Untracked liability warnings (step 2 above)
- Divergence notes (step 3 above)

These are diagnostic/informational, not model changes.

---

### Files to touch
| File | Change |
|------|--------|
| `lib/data/fi-plan.ts` | Add staleness check, untracked liability detection, actual vs planned divergence |
| `lib/fi/types.ts` | Add `staleLibabilities`, `liabilitiesWithNoPaydownTracking`, `paydownDivergenceNotes` to `SummaryViewModel` |
| `components/summary/SummaryDashboard.tsx` | Render warning banners below the projection chart |

---

### Edge cases
- `revolving` liabilities (credit cards): these should NOT participate in the paydown simulation at all — their balance is manual. Already handled since `debtPaymentByLiabilityGoal` only applies to `fixed_installment` (`applyExpenseRecordLiability` checks `trackingMode`). Ensure the staleness warning also skips `revolving` liabilities.
- Liability fully paid off (balance reaches 0): `Math.max(0, startBal - monthlyPaydown * (monthIndex + 1))` already handles this correctly.
- Multiple expense categories linked to the same liability: `debtPaymentByLiabilityGoal` sums them (uses `+=`), so the total paydown per liability is correct.
