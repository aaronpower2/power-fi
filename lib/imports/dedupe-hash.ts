import { createHash } from "node:crypto"

export function importRowDedupeHash(parts: {
  occurredOn: string
  amount: number
  description: string
  fileId: string
  parserRowIndex: number
}): string {
  const normalizedDesc = parts.description.trim().slice(0, 400)
  const payload = [
    parts.occurredOn,
    parts.amount.toFixed(2),
    normalizedDesc,
    parts.fileId,
    String(parts.parserRowIndex),
  ].join("|")
  return createHash("sha256").update(payload, "utf8").digest("hex")
}
