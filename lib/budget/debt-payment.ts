export const INTERNAL_DEBT_CATEGORY_NAME = "__DEBT_SERVICE_INTERNAL__"

export function isInternalDebtCategoryName(name: string | null | undefined): boolean {
  return (name ?? "").trim() === INTERNAL_DEBT_CATEGORY_NAME
}

export function isDebtExpenseLine(line: {
  linkedLiabilityId?: string | null
}): boolean {
  return !!line.linkedLiabilityId
}
