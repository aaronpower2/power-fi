# Fix: Liability ↔ Budget Category Enforcement

## Problem
Creating a liability in Net Worth has no effect on Cash Flow. The user must manually:
1. Navigate to Cash Flow
2. Create an expense category
3. Set `cashFlowType = "debt_payment"`
4. Select the liability from a dropdown

Nothing enforces this was done, and nothing detects when it breaks. If a liability is deleted, its `linked_liability_id` on any expense category silently becomes `NULL` (`onDelete: "set null"`). The category still exists, still shows as `debt_payment`, but now reduces nothing. No warning is shown.

The conceptual intent — "every liability should have a tracking budget category" — is correct but entirely unenforced.

---

## Desired Outcome
1. When a liability is created, the app offers to auto-create the corresponding `debt_payment` expense category (pre-filled with the liability name and balance).
2. On the Net Worth page, each liability that has NO linked budget category shows a warning badge.
3. On the Cash Flow page, each `debt_payment` category whose `linkedLiabilityId` is `NULL` shows an "unlinked" warning.
4. Deleting a liability with a linked category asks for confirmation and warns that the budget category will become unlinked.

---

## Technical Spec

### 1. Auto-create budget category on liability creation

In `lib/actions/portfolio.ts`, extend `createAsset` and `createLiability` to accept an optional flag:

```typescript
// createLiabilitySchema — add optional field
autoCreateBudgetCategory: z.boolean().optional().default(false)
```

When `autoCreateBudgetCategory: true`, after inserting the liability, insert an `expenseCategories` row:

```typescript
await tx.insert(expenseCategories).values({
  name: v.name,                         // same name as the liability
  cashFlowType: "debt_payment",
  linkedLiabilityId: newLiabilityId,
  isRecurring: false,                   // user sets recurring amount separately
  createdAt: new Date(),
})
```

Also revalidate `/cash-flow` path.

The `createAsset` server action already creates a `securedLiability` inline — extend this to also accept `autoCreateBudgetCategory` at the liability level.

---

### 2. Detect unlinked liabilities on Net Worth page

In `lib/data/portfolio.ts` (wherever asset/liability data is loaded), add a query that finds liabilities with no matching `debt_payment` expense category:

```typescript
const linkedLiabilityIds = await db
  .select({ id: expenseCategories.linkedLiabilityId })
  .from(expenseCategories)
  .where(
    and(
      eq(expenseCategories.cashFlowType, "debt_payment"),
      isNotNull(expenseCategories.linkedLiabilityId),
    )
  )
const linkedSet = new Set(linkedLiabilityIds.map(r => r.id))

// Attach to each liability row:
liabilityRows.map(l => ({
  ...l,
  hasBudgetCategory: linkedSet.has(l.id)
}))
```

Return `hasBudgetCategory: boolean` alongside each liability. Display a yellow badge "No budget tracking" on any liability where this is false, with a CTA "Set up debt payment" that links to `/cash-flow` with a query param to pre-open the create category form.

---

### 3. Detect orphaned `debt_payment` categories in Cash Flow

In `lib/data/budget.ts`, the `cats` query already loads all expense categories. After loading, check each `debt_payment` category:

```typescript
const orphanedDebtCategories = cats.filter(
  c => c.cashFlowType === "debt_payment" && c.linkedLiabilityId === null
)
```

Return this list to the page. Render a warning banner at the top of the debt payments section:

```
⚠️ "Home Loan Repayment" is a debt payment category but is not linked to any liability.
Payments are recorded but no liability balance will be reduced. [Fix →]
```

The "Fix" link opens the edit form for that category pre-focused on the `linkedLiabilityId` field.

---

### 4. Confirm before deleting a liability with a linked category

In `deleteLiability` (`lib/actions/portfolio.ts`), before deleting, check if any expense category references this liability:

```typescript
const linked = await db
  .select({ id: expenseCategories.id, name: expenseCategories.name })
  .from(expenseCategories)
  .where(eq(expenseCategories.linkedLiabilityId, id))
```

If any exist, return an `ActionResult` with a `requiresConfirmation` flag and the names of the affected categories:

```typescript
return {
  ok: false,
  requiresConfirmation: true,
  message: `"Home Loan Repayment" in Cash Flow is linked to this liability. Deleting it will unlink that category.`,
  affectedCategoryNames: linked.map(l => l.name),
}
```

The UI shows a confirmation dialog. On confirm, call `deleteLiability` again with a `force: true` flag to proceed.

Alternatively: on deletion, optionally also delete the linked expense category (give user the choice in the confirmation dialog: "Delete liability only" vs "Delete liability and its budget category").

---

### Files to touch
| File | Change |
|------|--------|
| `lib/validations/portfolio.ts` | Add `autoCreateBudgetCategory` to liability schema |
| `lib/actions/portfolio.ts` | `createLiability`, `createAsset` — auto-create category; `deleteLiability` — confirm if linked |
| `lib/data/portfolio.ts` | Return `hasBudgetCategory` per liability |
| `lib/data/budget.ts` | Return `orphanedDebtCategories` list |
| `components/portfolio/LiabilityForm.tsx` | Add "Set up budget tracking" checkbox |
| `components/portfolio/LiabilityCard.tsx` | Show "No budget tracking" badge |
| `components/budget/BudgetManager.tsx` | Show orphaned category warning banner |
| `components/budget/ExpenseCategoryForm.tsx` | Pre-fill `linkedLiabilityId` from query param |

---

### Edge cases
- A liability may legitimately have no budget category (e.g., a revolving credit card where you don't track individual payments). Make the badge dismissible or suppressible per-liability via a `suppressBudgetWarning` flag in `meta` JSONB.
- A `debt_payment` category may intentionally have no liability (e.g., tracking manual loan payments to a friend). Show the warning but allow the user to dismiss it per-category.
- If the auto-created category name conflicts with an existing one, append "(Debt)" to disambiguate.
