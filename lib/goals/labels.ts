/** Safe to import from Client Components — no DB or Node-only deps. */

/** Primary label for tables and headers (no “active” suffix). */
export function formatGoalDisplayName(g: {
  name: string | null | undefined
  fiDate: string
  currency: string | null | undefined
}): string {
  const trimmed = g.name?.trim()
  if (trimmed) return trimmed
  const ccy = g.currency ?? "USD"
  return `${g.fiDate} · ${ccy}`
}

/** FI summary switcher and similar: includes “(active)” when applicable. */
export function formatGoalListLabel(g: {
  name: string | null | undefined
  fiDate: string
  currency: string | null | undefined
  isActive: boolean
}): string {
  const base = formatGoalDisplayName(g)
  return g.isActive ? `${base} (active)` : base
}
