const formatters = new Map<string, Intl.NumberFormat>()

function getFormatter(currencyCode: string, maximumFractionDigits: number): Intl.NumberFormat {
  const key = `${currencyCode}-${maximumFractionDigits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits,
    })
    formatters.set(key, f)
  }
  return f
}

export function formatCurrency(
  value: number | null | undefined,
  currencyCode: string,
  options?: { maximumFractionDigits?: number },
): string {
  if (value == null || Number.isNaN(value)) return "—"
  const digits = options?.maximumFractionDigits ?? 0
  try {
    return getFormatter(currencyCode.toUpperCase(), digits).format(value)
  } catch {
    return `${value.toFixed(digits)} ${currencyCode}`
  }
}

export function formatMonths(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—"
  return `${Math.round(value)}`
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—"
  return `${Math.round(rate * 100)}%`
}

export function formatYearMonthLabel(value: string | null | undefined): string {
  if (!value) return "—"
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return value

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return value

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)))
}
