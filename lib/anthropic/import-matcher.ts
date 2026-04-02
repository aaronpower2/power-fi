import Anthropic, { RateLimitError } from "@anthropic-ai/sdk"
import { z } from "zod"

import type { ImportFewShotExample } from "@/lib/data/import-few-shot"

const matchRowSchema = z
  .object({
    staging_id: z.string().uuid(),
    kind: z.enum(["expense", "income"]),
    existing_line_id: z.string().uuid().nullable().optional(),
    propose_category_name: z.string().max(256).nullable().optional(),
    propose_line_name: z.string().max(256).nullable().optional(),
    existing_category_id: z.string().uuid().nullable().optional(),
    confidence: z.enum(["high", "medium", "low"]),
    notes: z.string().max(500).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    const hasLine = d.existing_line_id != null && d.existing_line_id.length > 0
    const hasNew =
      d.propose_line_name != null &&
      String(d.propose_line_name).trim().length > 0
    if (!hasLine && !hasNew) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide existing_line_id or propose_line_name",
      })
    }
  })

export const importMatchResponseSchema = z.array(matchRowSchema)

export type ImportMatchRow = z.infer<typeof matchRowSchema>

export type StagingRowForModel = {
  staging_id: string
  occurred_on: string
  amount: number
  currency: string
  description: string
}

export type BudgetLinesForModel = {
  expense_lines: { id: string; name: string; category_id: string; category_name: string }[]
  income_lines: { id: string; name: string }[]
  expense_categories: { id: string; name: string }[]
}

function extractJsonArray(text: string): unknown {
  const t = text.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/m)
  const body = fence ? fence[1].trim() : t
  const start = body.indexOf("[")
  const end = body.lastIndexOf("]")
  if (start < 0 || end <= start) {
    throw new Error("Model response did not contain a JSON array")
  }
  return JSON.parse(body.slice(start, end + 1))
}

function buildPrompt(
  lines: BudgetLinesForModel,
  staging: StagingRowForModel[],
  fewShots: ImportFewShotExample[],
): string {
  const fewShotBlock =
    fewShots.length > 0
      ? `

## Past mappings (this household)
When a new transaction resembles these past statement descriptions, prefer the same **existing_line_id** UUID (must appear in the lists below). Patterns are from prior accepted posts, not exhaustive.
${JSON.stringify(
          fewShots.map((f) => ({
            description_snippet: f.description_snippet,
            line_id: f.line_id,
            line_kind: f.line_kind,
            line_label: f.line_label,
          })),
        )}
`
      : ""

  return `You are categorizing personal finance transactions for a budget app.

Rules:
- **Budget caps are at the expense category level** (e.g. Education, Food). **Expense lines** are for detailed classification of card/bank transactions — map to the best-fitting line, not a separate budget per merchant.
- **Strongly prefer existing lines.** For almost every transaction you should set existing_line_id to a UUID from the lists below. Merchant/description text is a *hint for theme*, not a requirement that the line name match the merchant (e.g. "NETFLIX", "SPOTIFY", "APPLE.COM/BILL" → an existing line like "Entertainment and Subscriptions" or "Streaming" if one exists — do NOT propose a new "Netflix" line when a broader existing line fits).
- **Map broadly.** If multiple existing lines could work, choose the **most general reasonable** one that still reflects the kind of spend (groceries, transport, utilities, dining, subscriptions, shopping, healthcare, etc.). Only use propose_line_name when **no** existing line is a plausible bucket for this transaction.
- **Rare new lines.** propose_line_name / new categories are for genuinely uncategorized spend that does not fit any existing line even loosely. Do not create merchant-specific lines when a thematic line already exists.
- kind is "expense" for spending, fees, card purchases, and card refunds/credits (map refunds to the same thematic expense line or a generic "Shopping"/returns-style line if you have one — do NOT use income unless it is clearly salary, interest earned, or a labeled income deposit).
- kind is "income" only for salary, freelance payment, interest, dividends, or clear deposits that are income.
- If using an existing line, set existing_line_id to that UUID exactly from the lists below.
- If you truly cannot fit any existing line, set propose_line_name (and optionally propose_category_name or existing_category_id). Prefer existing_category_id + propose_line_name only when the category exists but no line fits.
- confidence: high | medium | low
${fewShotBlock}
Expense lines (id, name, category):
${JSON.stringify(lines.expense_lines)}

Income lines (id, name):
${JSON.stringify(lines.income_lines)}

Expense categories (id, name):
${JSON.stringify(lines.expense_categories)}

Transactions to classify (staging_id is stable — echo each staging_id exactly once in your output):
${JSON.stringify(staging)}

Return ONLY a JSON array (no markdown outside the array). Keep notes null or a very short string. Each element:
{"staging_id":"uuid","kind":"expense"|"income","existing_line_id":null|string,"propose_category_name":null|string,"propose_line_name":null|string,"existing_category_id":null|string,"confidence":"high"|"medium"|"low","notes":null|string}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(headers: Headers | undefined): number | null {
  if (!headers) return null
  const ra = headers.get("retry-after")
  if (!ra) return null
  const sec = Number.parseInt(ra, 10)
  if (!Number.isFinite(sec) || sec < 0) return null
  return Math.min(120_000, sec * 1000)
}

/** Caps output size per request (TPM limits). Override with ANTHROPIC_MATCH_MAX_OUTPUT_TOKENS. */
function matchMaxOutputTokens(): number {
  const raw = process.env.ANTHROPIC_MATCH_MAX_OUTPUT_TOKENS?.trim()
  const n = raw ? Number.parseInt(raw, 10) : 4096
  if (!Number.isFinite(n) || n < 512) return 4096
  return Math.min(n, 8192)
}

export async function matchImportRowsWithAnthropic(
  lines: BudgetLinesForModel,
  staging: StagingRowForModel[],
  fewShots: ImportFewShotExample[] = [],
): Promise<ImportMatchRow[]> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set")
  }
  /** Default: Sonnet 4 snapshot (3.5 Sonnet IDs are retired on the API). Override with ANTHROPIC_MODEL. */
  const model =
    process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514"

  const client = new Anthropic({ apiKey: key })
  const prompt = buildPrompt(lines, staging, fewShots)
  const maxTokens = matchMaxOutputTokens()
  const maxAttempts = 8

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      })

      const block = message.content.find((b) => b.type === "text")
      if (!block || block.type !== "text") {
        throw new Error("No text response from model")
      }

      const raw = extractJsonArray(block.text)
      return importMatchResponseSchema.parse(raw)
    } catch (e) {
      if (e instanceof RateLimitError && attempt < maxAttempts - 1) {
        const fromHeader = parseRetryAfterMs(e.headers)
        const backoff = fromHeader ?? Math.min(90_000, 4000 * 2 ** attempt)
        await sleep(backoff)
        continue
      }
      throw e
    }
  }

  throw new Error("Anthropic match: exhausted rate-limit retries")
}
