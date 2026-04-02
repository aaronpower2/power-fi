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
