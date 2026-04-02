/** Parse a bank/spreadsheet amount string into a number (unsigned magnitude). */
export function parseMoneyString(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "")
  if (!s) return null
  const neg = s.startsWith("(") && s.endsWith(")")
  let t = neg ? s.slice(1, -1) : s
  if (t.startsWith("-")) {
    t = t.slice(1)
  }
  t = t.replace(/[^\d,.\-]/g, "")
  if (!t) return null

  const lastComma = t.lastIndexOf(",")
  const lastDot = t.lastIndexOf(".")
  let normalized = t
  if (lastComma > lastDot) {
    normalized = t.replace(/\./g, "").replace(",", ".")
  } else if (lastComma >= 0 && lastDot >= 0) {
    normalized = t.replace(/,/g, "")
  } else if (lastComma >= 0 && lastDot < 0) {
    const after = t.slice(lastComma + 1)
    if (after.length === 2 && /^\d{2}$/.test(after)) {
      normalized = t.replace(",", ".")
    } else {
      normalized = t.replace(/,/g, "")
    }
  }

  const n = Number.parseFloat(normalized)
  if (Number.isNaN(n)) return null
  const signed = neg || raw.trim().startsWith("-") ? -Math.abs(n) : n
  return signed
}
