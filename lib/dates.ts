/** UTC calendar date as `YYYY-MM-DD`. */
export function utcIsoDateString(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** UTC calendar month bounds as `YYYY-MM-DD` for Postgres `date` filters. */
export function utcMonthRangeStrings(d: Date): { start: string; end: string } {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  return utcMonthBoundsForCalendarMonth(y, m)
}

/** Inclusive ISO date bounds for a UTC calendar month (`monthIndex0` = 0 → January). */
export function utcMonthBoundsForCalendarMonth(
  year: number,
  monthIndex0: number,
): { start: string; end: string } {
  const start = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-01`
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
  const end = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  return { start, end }
}

/** Parse `YYYY-MM` for UTC budget navigation. Returns null if invalid. */
export function parseYearMonthYm(ym: string | undefined | null): {
  year: number
  monthIndex0: number
} | null {
  if (ym == null) return null
  const s = ym.trim()
  const m = /^(\d{4})-(\d{2})$/.exec(s)
  if (!m) return null
  const year = Number(m[1])
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  return { year, monthIndex0: mo - 1 }
}

/** `YYYY-MM` from UTC calendar parts. */
export function formatYearMonthYm(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`
}

/** Add calendar months to a `YYYY-MM` string (UTC). */
export function addMonthsToYm(ym: string, deltaMonths: number): string {
  const p = parseYearMonthYm(ym)
  if (!p) {
    const d = new Date()
    return formatYearMonthYm(d.getUTCFullYear(), d.getUTCMonth())
  }
  let year = p.year
  let m = p.monthIndex0 + deltaMonths
  while (m < 0) {
    m += 12
    year -= 1
  }
  while (m > 11) {
    m -= 12
    year += 1
  }
  return formatYearMonthYm(year, m)
}
