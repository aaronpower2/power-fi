# Backlog: Coast FI / Semi-FIRE Milestone

## Problem
The projection engine models a single target: FI date + required principal.
Semi-FIRE has two stages:
1. **Coast FI** — the portfolio balance at which you can stop contributing and compounding alone will carry you to full FIRE by your FI date.
2. **Full FI** — the required principal under your withdrawal rate.

Right now there is no way to see "when do I reach coast FI?" or "how much longer do I need to keep investing?" Those are the primary planning questions for someone in the accumulation-but-planning-to-semi-retire phase.

---

## Desired Outcome
- Summary dashboard gains a **Coast FI** KPI card showing:
  - Coast FI number (the balance needed today to stop contributing)
  - Current progress toward it (% and absolute gap)
  - Estimated month/year Coast FI is reached at current contribution pace
- FI projection chart gains a second reference line at the Coast FI threshold
- Existing Full FI logic is unchanged

---

## Technical Spec

### 1. Coast FI calculation (`lib/fi/engine.ts`)

Coast FI number is the present value of the required principal, discounted back from the FI date using the blended portfolio growth rate:

```
coastFiNumber = requiredPrincipal / (1 + monthlyRate)^monthsToFiDate
```

Where `monthlyRate` is the weighted average monthly return across all assets included in FI projection (weighted by current balance).

Add a new exported function:

```typescript
// lib/fi/engine.ts
export function calcCoastFiNumber(input: {
  requiredPrincipal: number;
  monthsToFiDate: number;
  blendedAnnualReturn: number; // weighted avg across included assets
}): number {
  const monthlyRate = input.blendedAnnualReturn / 12;
  return input.requiredPrincipal / Math.pow(1 + monthlyRate, input.monthsToFiDate);
}
```

Also export a helper to compute the blended annual return from the assets array:

```typescript
export function calcBlendedReturn(assets: Array<{ currentBalance: number; assumedAnnualReturn: number | null; includeInFiProjection: boolean }>): number {
  const included = assets.filter(a => a.includeInFiProjection && a.assumedAnnualReturn != null);
  const totalBalance = included.reduce((s, a) => s + a.currentBalance, 0);
  if (totalBalance === 0) return 0.07; // fallback 7%
  return included.reduce((s, a) => s + (a.currentBalance / totalBalance) * a.assumedAnnualReturn!, 0);
}
```

---

### 2. Projection engine: track month Coast FI is crossed (`lib/fi/engine.ts`)

In `projectPortfolio`, track the first month where `projectedTotal >= coastFiNumber` and add it to the return type:

```typescript
// lib/fi/types.ts — add to ProjectionResult
export interface ProjectionResult {
  chartPoints: ChartPoint[];
  finalTotal: number;
  coastFiNumber: number;           // NEW
  coastFiReachedMonth: string | null; // NEW — "MMM YYYY" label or null if never reached
}
```

---

### 3. Summary data aggregation (`lib/data/summary.ts`)

In `getSummaryPageData()`, add:
- Call `calcBlendedReturn(assets)`
- Call `calcCoastFiNumber({ requiredPrincipal, monthsToFiDate, blendedAnnualReturn })`
- Return `coastFiNumber`, `coastFiReachedMonth`, and `coastFiProgress` (currentNetWorth / coastFiNumber, capped at 1)

---

### 4. UI: new KPI card (`components/summary/`)

Add a `CoastFiCard` component alongside the existing net worth / months-to-FI cards:

```
┌──────────────────────────────────┐
│ Coast FI                         │
│ AED 1,240,000                    │
│ ████████░░░░  68%                │
│ Reached: ~Aug 2027               │
└──────────────────────────────────┘
```

Props: `coastFiNumber`, `currentNetWorth`, `coastFiReachedMonth`, `currency`.

Use a `Progress` component (shadcn) for the bar. Show "Already reached 🎉" state if `currentNetWorth >= coastFiNumber`.

---

### 5. UI: projection chart reference line (`components/summary/`)

The existing chart uses Recharts. Add a `ReferenceLine` at `y={coastFiNumber}`:

```tsx
<ReferenceLine
  y={coastFiNumber}
  stroke="hsl(var(--chart-3))"
  strokeDasharray="4 4"
  label={{ value: "Coast FI", position: "insideTopRight", fontSize: 11 }}
/>
```

---

### Files to touch
| File | Change |
|------|--------|
| `lib/fi/engine.ts` | Add `calcCoastFiNumber`, `calcBlendedReturn`, update `ProjectionResult` |
| `lib/fi/types.ts` | Extend `ProjectionResult` with coast FI fields |
| `lib/data/summary.ts` | Compute and return coast FI fields |
| `components/summary/SummaryDashboard.tsx` | Render `CoastFiCard`, pass coast FI data to chart |
| `components/summary/CoastFiCard.tsx` | New component |
| `components/summary/ProjectionChart.tsx` | Add `ReferenceLine` for coast FI threshold |

---

### Edge cases
- If FI date is in the past or `monthsToFiDate <= 0`, skip coast FI calculation and hide the card.
- If no assets are included in projection, hide the card with a prompt to include at least one asset.
- Capital (lump-sum) assets: exclude from blended return calc since they don't compound via rate; their terminal value is handled separately by the projection engine.
