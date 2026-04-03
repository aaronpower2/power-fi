"use server"

import { revalidatePath } from "next/cache"
import { asc, eq, max } from "drizzle-orm"

import { matchImportRowsWithAnthropic } from "@/lib/anthropic/import-matcher"
import { loadImportFewShotExamples } from "@/lib/data/import-few-shot"
import { err, ok, type ActionResult } from "@/lib/action-result"
import { importRowDedupeHash } from "@/lib/imports/dedupe-hash"
import { parseCsvText } from "@/lib/imports/parse-spreadsheet"
import { parseSpreadsheetBuffer } from "@/lib/imports/parse-spreadsheet"
import { parsePdfTransactions } from "@/lib/imports/parse-pdf"
import type { ParserKind } from "@/lib/imports/types"
import {
  readImportFile,
  sanitizeOriginalName,
  writeImportFile,
} from "@/lib/imports/storage"
import { getDb } from "@/lib/db"
import {
  expenseCategories,
  expenseLines,
  expenseRecords,
  importedTransactions,
  incomeLines,
  incomeRecords,
  transactionImportBatches,
  transactionImportFiles,
} from "@/lib/db/schema"
import { z } from "zod"

import { getDefaultStatementCurrency } from "@/lib/data/import-currency"
import {
  syncLedgerByImportedTransactionId,
  syncLedgerFromImportedTransaction,
} from "@/lib/data/budget-month-ledger"
import { getImportBatchDetail, listRecentImportBatches } from "@/lib/data/import-transactions"

function rev() {
  revalidatePath("/budget")
  revalidatePath("/summary")
}

/**
 * Parallel Anthropic chunk requests. Default 1 — low org TPM limits (e.g. 8k output/min) are easy to exceed
 * when multiple chunks run at once. Set ANTHROPIC_MATCH_CONCURRENCY=2–4 only if your tier allows it.
 */
function anthropicMatchConcurrency(): number {
  const raw = process.env.ANTHROPIC_MATCH_CONCURRENCY?.trim()
  const parsed = raw ? Number.parseInt(raw, 10) : 1
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, 16)
}

async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function runWorker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  }

  const pool = Math.min(concurrency, Math.max(1, items.length))
  await Promise.all(Array.from({ length: pool }, runWorker))
  return results
}

function extKind(name: string): { parser: ParserKind; mime: string } {
  const lower = name.toLowerCase()
  if (lower.endsWith(".pdf")) return { parser: "pdf_text", mime: "application/pdf" }
  if (lower.endsWith(".csv")) return { parser: "csv", mime: "text/csv" }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls"))
    return {
      parser: "xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
  return { parser: "unknown", mime: "application/octet-stream" }
}

function normalizedPostedRecordAmount(amount: string | number): string {
  return Math.abs(Number(amount)).toFixed(2)
}

export async function createImportBatch(formData: FormData): Promise<
  ActionResult<{ batchId: string }>
> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  const labelRaw = formData.get("label")
  const label =
    typeof labelRaw === "string" && labelRaw.trim().length > 0
      ? labelRaw.trim().slice(0, 256)
      : null

  const files = formData.getAll("files").filter((f): f is File => f instanceof File)
  if (files.length === 0) return err("No files uploaded.")

  const [batch] = await db
    .insert(transactionImportBatches)
    .values({ label, status: "uploaded" })
    .returning({ id: transactionImportBatches.id })

  let fileCount = 0
  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer())
    if (buf.length === 0) continue
    fileCount += 1
    const original = sanitizeOriginalName(file.name || "upload")
    const { parser, mime } = extKind(original)

    const [row] = await db
      .insert(transactionImportFiles)
      .values({
        batchId: batch.id,
        originalName: original,
        mimeType: mime,
        byteSize: buf.length,
        storagePath: "",
        parserKind: parser,
        parseStatus: "pending",
      })
      .returning({ id: transactionImportFiles.id })

    const path = await writeImportFile(batch.id, row.id, original, buf)
    await db
      .update(transactionImportFiles)
      .set({ storagePath: path })
      .where(eq(transactionImportFiles.id, row.id))
  }

  if (fileCount === 0) {
    await db.delete(transactionImportBatches).where(eq(transactionImportBatches.id, batch.id))
    return err("All files were empty.")
  }

  rev()
  return ok({ batchId: batch.id })
}

async function loadBudgetLineCatalog(db: NonNullable<ReturnType<typeof getDb>>) {
  const cats = await db
    .select()
    .from(expenseCategories)
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))
  const expLines = await db
    .select({
      name: expenseLines.name,
      categoryId: expenseLines.categoryId,
    })
    .from(expenseLines)
    .orderBy(asc(expenseLines.name))
  const incLines = await db
    .select()
    .from(incomeLines)
    .orderBy(asc(incomeLines.sortOrder), asc(incomeLines.name))

  const exampleLineNamesByCategory = new Map<string, string[]>()
  for (const line of expLines) {
    const arr = exampleLineNamesByCategory.get(line.categoryId) ?? []
    if (arr.length < 6) arr.push(line.name)
    exampleLineNamesByCategory.set(line.categoryId, arr)
  }

  return {
    expense_categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      example_line_names: exampleLineNamesByCategory.get(c.id) ?? [],
    })),
    income_lines: incLines.map((l) => ({ id: l.id, name: l.name })),
    incomeLineIdSet: new Set(incLines.map((l) => l.id)),
    categoryIdSet: new Set(cats.map((c) => c.id)),
  }
}

export async function parseImportBatch(batchId: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  await db
    .update(transactionImportBatches)
    .set({ status: "parsing" })
    .where(eq(transactionImportBatches.id, batchId))

  const files = await db
    .select()
    .from(transactionImportFiles)
    .where(eq(transactionImportFiles.batchId, batchId))
    .orderBy(asc(transactionImportFiles.createdAt))

  const statementCurrency = await getDefaultStatementCurrency()

  let anyFailed = false
  for (const file of files) {
    if (file.parseStatus === "parsed") continue
    await db
      .update(transactionImportFiles)
      .set({ parseStatus: "pending", parseError: null })
      .where(eq(transactionImportFiles.id, file.id))

    try {
      const buffer = await readImportFile(file.storagePath)
      let rows: import("@/lib/imports/types").NormalizedImportRow[] = []
      const kind = file.parserKind as ParserKind

      if (kind === "pdf_text") {
        rows = await parsePdfTransactions(buffer, { currency: statementCurrency })
      } else if (kind === "xlsx") {
        const { rows: r } = parseSpreadsheetBuffer(buffer, {
          currencyDefault: statementCurrency,
        })
        rows = r
      } else if (kind === "csv") {
        const text = buffer.toString("utf8")
        const { rows: r } = parseCsvText(text, { currencyDefault: statementCurrency })
        rows = r
      } else {
        throw new Error("Unsupported file type. Use PDF, CSV, XLS, or XLSX.")
      }

      for (const row of rows) {
        const dedupeHash = importRowDedupeHash({
          occurredOn: row.occurredOn,
          amount: row.amount,
          description: row.description,
          fileId: file.id,
          parserRowIndex: row.parserRowIndex,
        })
        await db
          .insert(importedTransactions)
          .values({
            batchId,
            fileId: file.id,
            occurredOn: row.occurredOn,
            amount: row.amount.toFixed(2),
            currency: row.currency,
            description: row.description,
            rawPayload: row.rawPayload,
            dedupeHash,
            parserRowIndex: row.parserRowIndex,
            matchStatus: "pending",
          })
          .onConflictDoNothing({
            target: [importedTransactions.batchId, importedTransactions.dedupeHash],
          })
      }

      await db
        .update(transactionImportFiles)
        .set({ parseStatus: "parsed", parseError: null })
        .where(eq(transactionImportFiles.id, file.id))

      const fileTxRows = await db
        .select()
        .from(importedTransactions)
        .where(eq(importedTransactions.fileId, file.id))
      for (const r of fileTxRows) {
        await syncLedgerFromImportedTransaction(db, r)
      }
    } catch (e) {
      anyFailed = true
      const msg = e instanceof Error ? e.message : String(e)
      await db
        .update(transactionImportFiles)
        .set({ parseStatus: "failed", parseError: msg })
        .where(eq(transactionImportFiles.id, file.id))
    }
  }

  await db
    .update(transactionImportBatches)
    .set({ status: anyFailed ? "parsed" : "parsed" })
    .where(eq(transactionImportBatches.id, batchId))

  rev()
  return ok()
}

/** Smaller chunks → less output per request, friendlier to low output-TPM limits. */
const BATCH_SIZE = 24

export async function runAnthropicMatch(batchId: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")

  await db
    .update(transactionImportBatches)
    .set({ status: "matching" })
    .where(eq(transactionImportBatches.id, batchId))

  const catalog = await loadBudgetLineCatalog(db)
  const fewShots = await loadImportFewShotExamples()

  const pending = await db
    .select()
    .from(importedTransactions)
    .where(eq(importedTransactions.batchId, batchId))
    .orderBy(asc(importedTransactions.occurredOn), asc(importedTransactions.id))

  const toMatch = pending.filter((t) => t.matchStatus === "pending" && !t.postedRecordId)
  if (toMatch.length === 0) {
    await db
      .update(transactionImportBatches)
      .set({ status: "ready" })
      .where(eq(transactionImportBatches.id, batchId))
    rev()
    return ok()
  }

  const chunks: (typeof toMatch)[] = []
  for (let i = 0; i < toMatch.length; i += BATCH_SIZE) {
    chunks.push(toMatch.slice(i, i + BATCH_SIZE))
  }

  try {
    const concurrency = anthropicMatchConcurrency()
    const chunkResults = await runWithConcurrencyLimit(chunks, concurrency, async (chunk) => {
      const staging = chunk.map((t) => ({
        staging_id: t.id,
        occurred_on: t.occurredOn,
        amount: Number(t.amount),
        currency: t.currency,
        description: t.description,
      }))
      const matches = await matchImportRowsWithAnthropic(catalog, staging, fewShots)
      return { chunk, matches }
    })

    for (const { chunk, matches } of chunkResults) {
      const byId = new Map(matches.map((m) => [m.staging_id, m]))

      for (const t of chunk) {
        const m = byId.get(t.id)
        if (!m) continue

        const direction = m.kind
        let suggestedExpenseCategoryId: string | null = null
        let suggestedExpenseLineId: string | null = null
        let suggestedIncomeLineId: string | null = null
        let suggestedCategoryName: string | null = null
        let matchStatus: string = "pending"
        const conf = m.confidence
        const notes = m.notes ?? null

        const categoryId = m.existing_category_id?.trim() || null
        const lineId = m.existing_line_id?.trim() || null
        if (m.kind === "expense" && categoryId && catalog.categoryIdSet.has(categoryId)) {
          suggestedExpenseCategoryId = categoryId
          matchStatus = "suggested_line"
        } else if (m.kind === "income" && lineId && catalog.incomeLineIdSet.has(lineId)) {
          suggestedIncomeLineId = lineId
          matchStatus = "suggested_line"
        }

        if (matchStatus !== "suggested_line" && m.kind === "expense") {
          const proposedCategory = m.propose_category_name?.trim() || null
          if (proposedCategory) {
            suggestedCategoryName = proposedCategory
            matchStatus = "needs_new_line"
          }
        }

        await db
          .update(importedTransactions)
          .set({
            direction,
            suggestedExpenseCategoryId,
            suggestedExpenseLineId,
            suggestedIncomeLineId,
            suggestedCategoryName,
            suggestedLineName: null,
            suggestedUseExistingCategoryId: null,
            modelConfidence: conf,
            modelNotes: notes,
            matchStatus,
          })
          .where(eq(importedTransactions.id, t.id))
        await syncLedgerByImportedTransactionId(db, t.id)
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db
      .update(transactionImportBatches)
      .set({ status: "failed" })
      .where(eq(transactionImportBatches.id, batchId))
    rev()
    return err(msg)
  }

  await db
    .update(transactionImportBatches)
    .set({ status: "ready" })
    .where(eq(transactionImportBatches.id, batchId))
  rev()
  return ok()
}

const acceptMatchSchema = z.object({
  importedTransactionId: z.string().uuid(),
  expenseCategoryId: z.string().uuid().optional(),
  incomeLineId: z.string().uuid().optional(),
})

export async function acceptImportMatch(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = acceptMatchSchema.safeParse(input)
  if (!parsed.success) return err(parsed.error.issues.map((i) => i.message).join(" "))
  const { importedTransactionId, expenseCategoryId, incomeLineId } = parsed.data
  if (!expenseCategoryId && !incomeLineId) {
    return err("Provide expenseCategoryId or incomeLineId")
  }
  if (expenseCategoryId && incomeLineId) {
    return err("Provide only one of expenseCategoryId or incomeLineId")
  }

  const [row] = await db
    .select()
    .from(importedTransactions)
    .where(eq(importedTransactions.id, importedTransactionId))
    .limit(1)
  if (!row) return err("Import row not found")
  if (row.postedRecordId) return err("Already posted")
  const postedAmount = normalizedPostedRecordAmount(row.amount)

  const catalog = await loadBudgetLineCatalog(db)

  if (expenseCategoryId) {
    if (!catalog.categoryIdSet.has(expenseCategoryId)) return err("Invalid expense category")
    const [rec] = await db
      .insert(expenseRecords)
      .values({
        expenseCategoryId,
        expenseLineId: null,
        amount: postedAmount,
        currency: row.currency,
        occurredOn: row.occurredOn,
      })
      .returning({ id: expenseRecords.id })
    await db
      .update(importedTransactions)
      .set({
        matchStatus: "posted",
        postedRecordKind: "expense",
        postedRecordId: rec.id,
        suggestedExpenseCategoryId: expenseCategoryId,
        suggestedExpenseLineId: null,
        suggestedIncomeLineId: null,
        suggestedCategoryName: null,
        suggestedLineName: null,
        suggestedUseExistingCategoryId: null,
        direction: "expense",
      })
      .where(eq(importedTransactions.id, importedTransactionId))
    await syncLedgerByImportedTransactionId(db, importedTransactionId)
  } else if (incomeLineId) {
    if (!catalog.incomeLineIdSet.has(incomeLineId)) return err("Invalid income line")
    const [rec] = await db
      .insert(incomeRecords)
      .values({
        incomeLineId,
        amount: postedAmount,
        currency: row.currency,
        occurredOn: row.occurredOn,
      })
      .returning({ id: incomeRecords.id })
    await db
      .update(importedTransactions)
      .set({
        matchStatus: "posted",
        postedRecordKind: "income",
        postedRecordId: rec.id,
        suggestedExpenseCategoryId: null,
        suggestedIncomeLineId: incomeLineId,
        suggestedExpenseLineId: null,
        suggestedCategoryName: null,
        suggestedLineName: null,
        suggestedUseExistingCategoryId: null,
        direction: "income",
      })
      .where(eq(importedTransactions.id, importedTransactionId))
    await syncLedgerByImportedTransactionId(db, importedTransactionId)
  }

  rev()
  return ok()
}

const acceptNewSchema = z.object({
  importedTransactionId: z.string().uuid(),
  categoryName: z.string().min(1).max(256).optional(),
  categoryId: z.string().uuid().optional(),
})

export async function acceptNewCategoryAndPost(input: unknown): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const parsed = acceptNewSchema.safeParse(input)
  if (!parsed.success) return err(parsed.error.issues.map((i) => i.message).join(" "))
  const { importedTransactionId, categoryName, categoryId } = parsed.data

  const [row] = await db
    .select()
    .from(importedTransactions)
    .where(eq(importedTransactions.id, importedTransactionId))
    .limit(1)
  if (!row) return err("Import row not found")
  if (row.postedRecordId) return err("Already posted")
  const postedAmount = normalizedPostedRecordAmount(row.amount)

  const catalog = await loadBudgetLineCatalog(db)

  try {
    await db.transaction(async (tx) => {
      let catId = categoryId ?? null
      if (catId && !catalog.categoryIdSet.has(catId)) {
        throw new Error("Invalid category")
      }
      if (!catId) {
        const name = categoryName?.trim() || "Imported"
        const [maxRow] = await tx
          .select({ m: max(expenseCategories.sortOrder) })
          .from(expenseCategories)
        const nextOrder = Number(maxRow?.m ?? -1) + 1
        const [cat] = await tx
          .insert(expenseCategories)
          .values({ name: name.slice(0, 256), sortOrder: nextOrder })
          .returning({ id: expenseCategories.id })
        catId = cat.id
      }

      const [rec] = await tx
        .insert(expenseRecords)
        .values({
          expenseCategoryId: catId,
          expenseLineId: null,
          amount: postedAmount,
          currency: row.currency,
          occurredOn: row.occurredOn,
        })
        .returning({ id: expenseRecords.id })

      await tx
        .update(importedTransactions)
        .set({
          matchStatus: "posted",
          postedRecordKind: "expense",
          postedRecordId: rec.id,
          suggestedExpenseCategoryId: catId,
          suggestedExpenseLineId: null,
          suggestedCategoryName: null,
          suggestedLineName: null,
          suggestedUseExistingCategoryId: null,
          direction: "expense",
        })
        .where(eq(importedTransactions.id, importedTransactionId))

      await syncLedgerByImportedTransactionId(tx, importedTransactionId)
    })
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }

  rev()
  return ok()
}

export async function dismissImportedTransaction(id: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db
    .update(importedTransactions)
    .set({ matchStatus: "rejected" })
    .where(eq(importedTransactions.id, id))
  rev()
  return ok()
}

export async function deleteImportBatch(batchId: string): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  await db
    .delete(transactionImportBatches)
    .where(eq(transactionImportBatches.id, batchId))
  rev()
  return ok()
}

export async function listImportBatchesAction() {
  const rows = await listRecentImportBatches(25)
  return ok(rows)
}

export async function getImportBatchDetailAction(batchId: string) {
  const d = await getImportBatchDetail(batchId)
  if (!d) {
    return err(
      "Batch not found, or import tables are missing. If you have not run migrations yet: pnpm db:migrate",
    )
  }
  return ok(d)
}

/** One-click: post using AI-suggested category fields on the row. */
export async function acceptSuggestedCategoryFromImport(
  importedTransactionId: string,
): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const [row] = await db
    .select()
    .from(importedTransactions)
    .where(eq(importedTransactions.id, importedTransactionId))
    .limit(1)
  if (!row) return err("Row not found")
  if (!row.suggestedExpenseCategoryId && !row.suggestedCategoryName?.trim()) {
    return err("No suggested category on this row")
  }
  return acceptNewCategoryAndPost({
    importedTransactionId,
    categoryName: row.suggestedCategoryName?.trim() || undefined,
    categoryId: row.suggestedExpenseCategoryId ?? undefined,
  })
}

/** One-click: post using AI-suggested existing category/income IDs on the row. */
export async function acceptSuggestedMatchFromImport(
  importedTransactionId: string,
): Promise<ActionResult> {
  const db = getDb()
  if (!db) return err("Database not configured (set DATABASE_URL).")
  const [row] = await db
    .select()
    .from(importedTransactions)
    .where(eq(importedTransactions.id, importedTransactionId))
    .limit(1)
  if (!row) return err("Row not found")
  if (row.suggestedExpenseCategoryId) {
    return acceptImportMatch({
      importedTransactionId,
      expenseCategoryId: row.suggestedExpenseCategoryId,
    })
  }
  if (row.suggestedIncomeLineId) {
    return acceptImportMatch({
      importedTransactionId,
      incomeLineId: row.suggestedIncomeLineId,
    })
  }
  return err("No suggested match on this row")
}
