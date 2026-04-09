# Fix: Allocation Records Must Update Asset Balances

## Problem
`allocation_records` are written by the "Allocate Investable" action in Cash Flow, but are **never read by anything**. The FI engine uses `assets.currentBalance` as its starting balance. The Net Worth page shows `assets.currentBalance`. Neither reads `allocation_records`.

Result: the user can allocate their monthly surplus to assets every month, and nothing changes anywhere. They must manually update `assets.currentBalance` as a completely separate action. The two are entirely disconnected — `allocation_records` is a write-only orphan table.

---

## Desired Outcome
1. When the user confirms the "Allocate Investable" action, each asset's `currentBalance` is incremented by its allocation slice.
2. `allocation_records` remain as the audit trail (they're still useful for the trend chart in backlog spec `04-investable-surplus-trend.md`).
3. Net Worth page reflects the updated balances immediately after allocation.
4. Allocation records show in an "Allocation history" panel per asset so the user can see what was contributed and when.

---

## Technical Spec

### 1. Update `allocateInvestablePerStrategy` to also bump `assets.currentBalance`

In `lib/actions/portfolio.ts`, inside the `allocateInvestablePerStrategy` transaction, after inserting `allocationRecords`, also update each asset's balance:

```typescript
await db.transaction(async (tx) => {
  // Existing: insert allocation records
  await tx.insert(allocationRecords).values(rowsToInsert)

  // NEW: bump each asset's currentBalance
  for (const row of rowsToInsert) {
    await tx
      .update(assets)
      .set({
        currentBalance: sql`${assets.currentBalance} + ${row.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, row.assetId))
  }
})
```

This keeps `allocation_records` as the line-item audit trail while making `currentBalance` the live running total.

---

### 2. Handle reversal: deleting an allocation record must reverse the balance

In `deleteAllocationRecord` (`lib/actions/portfolio.ts`), before deleting, read the record's amount and asset, then subtract from `currentBalance`:

```typescript
export async function deleteAllocationRecord(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured.")

  await db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(allocationRecords)
      .where(eq(allocationRecords.id, id))

    if (record) {
      await tx
        .update(assets)
        .set({
          currentBalance: sql`GREATEST(${assets.currentBalance} - ${record.amount}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(assets.id, record.assetId))
    }

    await tx.delete(allocationRecords).where(eq(allocationRecords.id, id))
  })

  rev()
  return ok()
}
```

---

### 3. Guard: prevent double-allocation for the same month

Currently nothing prevents the user from clicking "Allocate Investable" twice for the same month. With balances now updating, this would double-count.

Add a check in `allocateInvestablePerStrategy`: query `allocation_records` for any records with `allocatedOn` in the same month as the requested `yearMonth`. If any exist for the same set of assets, return an error:

```typescript
const existingThisMonth = await db
  .select({ id: allocationRecords.id })
  .from(allocationRecords)
  .where(
    and(
      gte(allocationRecords.allocatedOn, start),
      lte(allocationRecords.allocatedOn, end),
      inArray(allocationRecords.assetId, targetAssetIds),
    )
  )

if (existingThisMonth.length > 0) {
  return err(
    "This month already has allocation records. Delete the existing records first, or use manual balance updates for adjustments."
  )
}
```

---

### 4. UI: Show allocation history per asset

On the Net Worth page, each asset card (or its detail panel) should show its recent allocation records:

```
Vanguard Global ETF                              AED 342,100
  Last updated: via allocation Apr 30 2026

  Allocation history:
  ├ Apr 2026  +AED 8,400   (from budget surplus)
  ├ Mar 2026  +AED 7,200
  └ Feb 2026  +AED 9,100
  [View all]
```

This closes the feedback loop: the user sees that their Cash Flow allocation actually changed the asset balance.

In `lib/data/portfolio.ts`, add a query for the last 3 `allocation_records` per asset, ordered by `allocatedOn DESC`, and include them in the portfolio data response.

---

### 5. Migration note: existing `allocation_records` are stale

Existing `allocation_records` were written before this fix, so `currentBalance` on those assets does NOT include those historical allocations (they were supposedly entered manually). Do NOT retroactively replay historical allocation records into `currentBalance` — that would double-count what the user has already manually entered.

Add a one-time migration guard: on first deploy of this fix, log a warning if `allocation_records` rows exist. The user should review their `currentBalance` values to confirm they're accurate before enabling this feature.

Consider adding a flag `lib/features.ts` (simple boolean constant):

```typescript
export const ALLOCATION_UPDATES_BALANCE = true // set false to disable while migrating
```

---

### Files to touch
| File | Change |
|------|--------|
| `lib/actions/portfolio.ts` | `allocateInvestablePerStrategy` — bump balances; `deleteAllocationRecord` — reverse balance |
| `lib/data/portfolio.ts` | Load recent allocation records per asset |
| `components/portfolio/AssetCard.tsx` | Show allocation history panel |
| `app/(dashboard)/net-worth/page.tsx` | Pass allocation records to component |

---

### Edge cases
- Asset currency ≠ reporting currency: `row.amount` in `allocationRecords` is already stored in the asset's native currency (see `convertAmount(shareReporting, reportingCurrency, assetCcy, fx.rates)` in the action). The `currentBalance` is also in the asset's native currency. So the addition is currency-safe as-is.
- Manual balance edit after allocations: the user can still manually edit `currentBalance` via the asset form. That's fine — `currentBalance` is always the source of truth. Allocation records are additive, and manual edits override.
- Asset deleted: `allocationRecords` rows cascade-delete (FK with `onDelete: "cascade"`). No reversal needed since the asset is gone.
