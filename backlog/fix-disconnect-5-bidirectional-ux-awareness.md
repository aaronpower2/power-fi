# Fix: Bi-directional UX Awareness Between Net Worth and Cash Flow

## Problem
Net Worth and Cash Flow are conceptually linked — liabilities live in Net Worth but are serviced in Cash Flow; the allocation strategy is configured in Net Worth but executed in Cash Flow. Despite this, neither page has any awareness of the other's state.

Specific gaps:
1. **Net Worth → Cash Flow:** No signal that a liability has no budget category. No signal that allocation strategy targets have been configured.
2. **Cash Flow → Net Worth:** No signal showing the current allocation strategy or that it needs to be set up first. The "Allocate Investable" button fails with a confusing error if no strategy or targets are configured.
3. **Allocation workflow is split:** Strategy setup is in Net Worth; execution is in Cash Flow. The user has to know both halves exist and navigate between them manually.
4. **Deletion cascades are silent:** Deleting a liability in Net Worth silently orphans its Cash Flow category (covered in detail in `fix-disconnect-1`). Deleting an asset silently removes it from allocation targets and strategy weights — the strategy now has orphaned weights that no longer sum to 100%.

---

## Desired Outcome
Each page surfaces relevant state from the other, using contextual nudges and cross-links rather than complex cross-page UI. The user never has to guess what they need to do first.

---

## Technical Spec

### 1. Net Worth page: "Allocation setup" status card

On the Net Worth page, add a small status card in the Allocation Strategy section showing the health of the current setup:

```
┌────────────────────────────────────────────┐
│ Active Strategy: Global 60/40              │
│                                            │
│ ✓ 3 assets with targets (weights: 100%)    │
│ ✓ Investable allocation: ready             │
│                                            │
│ Last allocated: Apr 30 2026                │
│ [Allocate in Cash Flow →]                  │
└────────────────────────────────────────────┘
```

And a warning state when not ready:

```
⚠️ Strategy has targets but weights don't sum to 100% (currently 85%).
Allocation will be rescaled but results may surprise you. [Fix weights]
```

Or:

```
⚠️ No active strategy. Set one up here before allocating in Cash Flow.
```

Data needed: already available in the net worth page query — just surface it in a dedicated card component.

---

### 2. Cash Flow page: strategy context banner before "Allocate Investable"

Currently the allocate section shows target assets in a preview but no explanation of where the strategy came from or how to change it. Add a single contextual line:

```
Strategy: "Global 60/40" · 3 assets · [Edit in Net Worth →]
```

If no strategy is configured, replace the button with:

```
No active allocation strategy. [Set up in Net Worth →]
```

This removes the confusing server error the user currently gets if they try to allocate without a strategy.

Implementation: the `allocatePreview` data is already returned by `getBudgetPageData`. Add `strategyName` and a link to `/net-worth` to the preview. If `allocatePreview === null`, render the setup nudge instead of the button.

---

### 3. Asset deletion: warn about allocation target orphaning

When an asset with allocation targets is deleted, the targets cascade-delete (FK `onDelete: "cascade"` on `allocation_targets`). The strategy's remaining weights no longer sum to 100% — but nothing tells the user this.

In `deleteAsset` (`lib/actions/portfolio.ts`), before deleting, check for existing allocation targets:

```typescript
const targets = await db
  .select({ strategyId: allocationTargets.strategyId })
  .from(allocationTargets)
  .where(eq(allocationTargets.assetId, id))

if (targets.length > 0) {
  // return warning — show confirmation dialog in UI
  return {
    ok: false,
    requiresConfirmation: true,
    message: `This asset has allocation targets in ${targets.length} strategy/strategies. Deleting it will remove those targets and your weights will no longer sum to 100%.`,
  }
}
```

On confirmation (`force: true`), proceed with deletion. After deletion, revalidate Net Worth page so the user immediately sees the broken weight sum.

---

### 4. Net Worth page: show liability-to-budget link status

(Overlaps with `fix-disconnect-1` — implement together)

On the Net Worth liability list, each liability row should show one of:
- ✓ "Tracked in Cash Flow" — a linked debt_payment category exists
- ⚠️ "Not tracked in budget" — no linked category; payments don't reduce this balance
- ⚠️ "Tracking category unlinked" — a debt_payment category existed but was orphaned (detectable via checking all `debt_payment` categories for this liability ID)

The last case can't be directly queried without a join, but the first and second are straightforward (same query as in `fix-disconnect-1`).

---

### 5. Unified "setup health" indicator on Summary dashboard

Add a small "Setup health" widget to the FI Summary page that surfaces any outstanding configuration issues across both Net Worth and Cash Flow:

```
┌─────────────────────────────────────────┐
│ ⚠️ Setup issues (2)                      │
│                                          │
│ • "Car Loan" has no budget tracking →    │
│ • Allocation weights sum to 85% →        │
└─────────────────────────────────────────┘
```

This is a read-only diagnostic. Each item links to the relevant page to fix it.

The data for this widget is already computable from existing queries — it just needs to be aggregated and exposed on the summary page:
- Unlinked liabilities: from `fix-disconnect-1`'s `hasBudgetCategory` check
- Weight sum issues: from the allocation strategy targets
- Stale liability balances: from `fix-disconnect-4`'s staleness check

Aggregate into a `setupIssues: Array<{ message: string; href: string }>` field in `FiPlanPageData`.

---

### Files to touch
| File | Change |
|------|--------|
| `lib/data/fi-plan.ts` | Aggregate `setupIssues` from existing health checks |
| `lib/actions/portfolio.ts` | `deleteAsset` — warn on allocation target orphaning |
| `lib/data/portfolio.ts` | Return `allocationHealthSummary` (strategy name, weight sum, last allocated date) |
| `lib/data/budget.ts` | Return `strategyContextForBudget` (strategy name, target count, href) |
| `components/portfolio/AllocationStrategyCard.tsx` | Show setup status + "Allocate in Cash Flow" CTA |
| `components/budget/BudgetManager.tsx` | Show strategy context banner above allocate button |
| `components/summary/SummaryDashboard.tsx` | Render `SetupHealthWidget` |
| `components/summary/SetupHealthWidget.tsx` | New component — setup issues list |

---

### Implementation order
These are mostly additive UI changes that read from already-computed data. Suggested order:

1. Cash Flow strategy context banner (step 2) — 1 hour, highest daily-use value
2. Net Worth allocation status card (step 1) — 1 hour
3. Asset deletion warning (step 3) — 2 hours, prevents data loss
4. Summary setup health widget (step 5) — depends on fixes 1 and 4 being done first
5. Net Worth liability link status (step 4) — duplicate of disconnect-1, implement once

---

### Edge cases
- No goals configured: setup health widget should only show allocation/liability issues, not goal-related ones (keep the "no goal" state to the existing dashboard empty state).
- Strategy weight sum != 100%: the allocation action already normalizes weights, so this is a UX warning only, not a hard block. Make the copy reflect that ("weights will be rescaled" not "allocation blocked").
