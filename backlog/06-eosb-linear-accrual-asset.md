# Backlog: EOSB / Linear Accrual Asset Growth Type

## Problem
UAE employees accrue End of Service Benefit (EOSB) — a statutory lump sum paid on leaving employment, calculated as a multiple of monthly salary × years of service. It accrues linearly, not via compound interest, and is paid out on a specific event (resignation, termination, retirement). There is currently no asset growth type that models this. As a result, EOSB cannot be factored into FI projections, which understates net worth for UAE-based users.

EOSB formula (UAE Labour Law):
- First 5 years: 21 days' basic salary per year
- After 5 years: 30 days' basic salary per year
- Capped at 2 years' total salary

This is a meaningful number — e.g., 10 years at AED 25,000/month basic = ~AED 300,000+.

---

## Desired Outcome
- New asset growth type: `linear_accrual`
- Asset form gains fields for: monthly accrual rate, accrual start date, payout date (or "FI date")
- Projection engine models balance growing by `monthlyAccrualRate` each month until `payoutDate`
- Net worth page shows current accrued EOSB value
- FI projection includes the lump sum at the payout date

---

## Technical Spec

### 1. Schema (`lib/db/schema.ts`)

Add `linear_accrual` to the `growthType` enum:

```typescript
growthType: text('growth_type')
  .$type<'compound' | 'capital' | 'linear_accrual'>()
  .notNull()
  .default('compound'),
```

Add JSONB metadata fields (stored in existing `meta` JSONB column on `assets`):

```typescript
// For linear_accrual assets, meta contains:
interface LinearAccrualMeta {
  monthlyAccrualAmount: number;   // e.g. 2083 (AED) — computed outside, stored here
  accrualStartDate: string;       // ISO date — when accrual started (employment start)
  payoutDate: string | null;      // ISO date — when lump sum is received; null = use FI date
}
```

No migration required for the meta structure (it's already JSONB). A migration is required only to extend the `growthType` check constraint if one exists — check `drizzle/` migration history.

---

### 2. FI projection engine (`lib/fi/engine.ts`)

In `projectPortfolio`, handle `linear_accrual` assets:

```typescript
// Each month in the simulation loop:
if (asset.growthType === 'linear_accrual') {
  const meta = asset.meta as LinearAccrualMeta;
  const payoutMonth = meta.payoutDate
    ? toYearMonth(meta.payoutDate)
    : input.fiDateYearMonth;

  if (currentYearMonth < payoutMonth) {
    // Still accruing: grow by monthly accrual amount (no compound, no allocation)
    assetBalance += convertToReportingCurrency(meta.monthlyAccrualAmount, asset.currency);
  } else if (currentYearMonth === payoutMonth) {
    // Payout month: full balance realised (already accrued above, no change needed)
    // Mark as terminal — stop accruing after this month
  } else {
    // Post-payout: balance = 0 (paid out and re-invested elsewhere, or just remove from projection)
    assetBalance = 0;
  }
}
```

Linear accrual assets should NOT receive investable allocations — skip them in the allocation distribution loop.

---

### 3. Current balance calculation

For the net worth page, the asset's `currentBalance` should reflect the accrued EOSB to date. The user can either:
a. Manually set it and update periodically, or
b. Have it auto-computed: `monthlyAccrualAmount × monthsSinceAccrualStart`

Implement option (b) as a derived display value in `lib/data/portfolio.ts`:

```typescript
function deriveLinearAccrualBalance(asset: Asset): number {
  const meta = asset.meta as LinearAccrualMeta;
  const start = new Date(meta.accrualStartDate);
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  return Math.max(0, months) * meta.monthlyAccrualAmount;
}
```

Use this derived value for display and projection when `currentBalance` is 0 or stale (i.e., last updated > 30 days ago — add a staleness check).

---

### 4. Asset form UI (`components/portfolio/`)

When `growthType === 'linear_accrual'` is selected, show additional fields:

| Field | Type | Description |
|-------|------|-------------|
| Monthly accrual amount | Number | Net AED/month added to EOSB |
| Accrual start date | Date | Employment start date |
| Payout date | Date (optional) | Leave blank to use FI date |

Hide the `assumedAnnualReturn` field (not applicable). Hide `assumedTerminalValue` (computed from accrual). Keep `currency` visible.

Add helper text: "For UAE EOSB: calculate your monthly accrual as (basic salary × 21/365) for the first 5 years, or (basic salary × 30/365) after 5 years."

---

### 5. Zod validation (`lib/validations/portfolio.ts`)

Add `linear_accrual` to the `growthType` union. Add conditional validation: if `growthType === 'linear_accrual'`, require `meta.monthlyAccrualAmount` and `meta.accrualStartDate` to be present.

---

### Files to touch
| File | Change |
|------|--------|
| `lib/db/schema.ts` | Add `linear_accrual` to growthType enum |
| `drizzle/` | Migration to update check constraint on growthType (if exists) |
| `lib/fi/engine.ts` | Handle `linear_accrual` in projection loop |
| `lib/fi/types.ts` | Update type for growthType union |
| `lib/data/portfolio.ts` | Add `deriveLinearAccrualBalance` |
| `lib/validations/portfolio.ts` | Add `linear_accrual` + conditional meta validation |
| `components/portfolio/AssetForm.tsx` | Conditional fields for linear accrual |

---

### Edge cases
- Accrual start date in the future: balance = 0.
- Payout date before current date: treat as already paid out — exclude from projection, show balance as 0 with a warning "EOSB payout date has passed — update or archive this asset."
- UAE EOSB cap (2 years' salary): add an optional `maxBalance` field to meta; projection engine caps balance at this value.
