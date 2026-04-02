/** Per line id → per ISO currency → amount (same shape as budget line native maps). */
export type NativeBucketsByLineId = Record<string, Record<string, number>>

/**
 * All expense lines are shown for every month so imports and the budget grid can target
 * fine-grained lines (e.g. before the first actual posts).
 */
export function expenseLineAppliesToBudgetMonth(
  line: { isRecurring?: boolean },
  lineId: string,
  plannedByLine: NativeBucketsByLineId,
  actualByLine: NativeBucketsByLineId,
): boolean {
  void line
  void lineId
  void plannedByLine
  void actualByLine
  return true
}
