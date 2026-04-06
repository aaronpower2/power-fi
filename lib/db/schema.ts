import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core"

export const growthTypeEnum = pgEnum("growth_type", ["compound", "capital"])

export const assetCategoryEnum = pgEnum("asset_category", [
  "investment",
  "cash",
  "real_estate_primary",
  "real_estate_rental",
  "vehicle",
  "depreciating_other",
  "other",
])

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** User-defined label; lists fall back to FI date · currency when unset. */
  name: varchar("name", { length: 256 }),
  fiDate: date("fi_date").notNull(),
  withdrawalRate: numeric("withdrawal_rate", { precision: 10, scale: 6 }).notNull(),
  monthlyFundingRequirement: numeric("monthly_funding_requirement", {
    precision: 16,
    scale: 2,
  }).notNull(),
  /** ISO 4217 — amounts on this goal are in this currency */
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const goalLifestyleLines = pgTable("goal_lifestyle_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 256 }).notNull(),
  monthlyAmount: numeric("monthly_amount", { precision: 16, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
})

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 256 }).notNull(),
  assetCategory: assetCategoryEnum("asset_category").notNull().default("investment"),
  /** When false, asset counts toward net worth but is excluded from FI projection / allocation targets. */
  includeInFiProjection: boolean("include_in_fi_projection").notNull().default(true),
  growthType: growthTypeEnum("growth_type").notNull(),
  assumedAnnualReturn: numeric("assumed_annual_return", { precision: 10, scale: 6 }),
  assumedTerminalValue: numeric("assumed_terminal_value", { precision: 16, scale: 2 }),
  maturationDate: date("maturation_date"),
  currentBalance: numeric("current_balance", { precision: 16, scale: 2 })
    .notNull()
    .default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  /** Optional UI metadata (e.g. linkToManage for external platforms). */
  meta: jsonb("meta")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const fxRates = pgTable(
  "fx_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    asOfDate: date("as_of_date").notNull(),
    baseCurrency: varchar("base_currency", { length: 3 }).notNull(),
    quoteCurrency: varchar("quote_currency", { length: 3 }).notNull(),
    /** Units of quote per 1 unit of base (Frankfurter shape) */
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("fx_rates_date_base_quote_uidx").on(
      t.asOfDate,
      t.baseCurrency,
      t.quoteCurrency,
    ),
  ],
)

export const allocationStrategies = pgTable("allocation_strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 256 }).notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})

export const allocationTargets = pgTable(
  "allocation_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => allocationStrategies.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    weightPercent: numeric("weight_percent", { precision: 8, scale: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex("allocation_targets_strategy_asset_uidx").on(
      t.strategyId,
      t.assetId,
    ),
  ],
)

export const liabilities = pgTable(
  "liabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 256 }).notNull(),
    liabilityType: varchar("liability_type", { length: 128 }),
    /** `fixed_installment` declines as linked debt-service payments are posted; revolving debt stays manual. */
    trackingMode: varchar("tracking_mode", { length: 32 })
      .notNull()
      .default("fixed_installment"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    /** Current remaining owed (positive number). */
    currentBalance: numeric("current_balance", { precision: 16, scale: 2 })
      .notNull()
      .default("0"),
    securedByAssetId: uuid("secured_by_asset_id").references(() => assets.id, {
      onDelete: "set null",
    }),
    meta: jsonb("meta")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("liabilities_secured_asset_uidx")
      .on(t.securedByAssetId)
      .where(sql`${t.securedByAssetId} IS NOT NULL`),
  ],
)

export const incomeLines = pgTable("income_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 256 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isRecurring: boolean("is_recurring").notNull().default(false),
  frequency: varchar("frequency", { length: 32 }),
  recurringAmount: numeric("recurring_amount", { precision: 16, scale: 2 }),
  /** Currency for recurringAmount / monthly equivalent (budget lines show native totals). */
  recurringCurrency: varchar("recurring_currency", { length: 3 }).notNull().default("USD"),
  /**
   * When set with recurring income, budget counts `recurringAmount` only in months that
   * contain a scheduled payment (from this anchor). When null, amount is smoothed across every month.
   */
  recurringAnchorDate: date("recurring_anchor_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const incomeRecords = pgTable(
  "income_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incomeLineId: uuid("income_line_id")
      .notNull()
      .references(() => incomeLines.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    occurredOn: date("occurred_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("income_records_occurred_on_idx").on(t.occurredOn)],
)

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 256 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** `expense` contributes to normal spending; `debt_payment` is a cash outflow that can reduce a linked liability. */
  cashFlowType: varchar("cash_flow_type", { length: 32 }).notNull().default("expense"),
  linkedLiabilityId: uuid("linked_liability_id").references(() => liabilities.id, {
    onDelete: "set null",
  }),
  /** Month-level planned envelope (smoothed monthly equivalent; no per-day anchor). */
  isRecurring: boolean("is_recurring").notNull().default(false),
  frequency: varchar("frequency", { length: 32 }),
  recurringAmount: numeric("recurring_amount", { precision: 16, scale: 2 }),
  recurringCurrency: varchar("recurring_currency", { length: 3 }).notNull().default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const expenseLines = pgTable("expense_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => expenseCategories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 256 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

/** Frozen planned monthly totals for closed months (finalize action). */
export const budgetMonthPlanLines = pgTable(
  "budget_month_plan_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodMonth: date("period_month").notNull(),
    lineKind: varchar("line_kind", { length: 24 }).notNull(),
    incomeLineId: uuid("income_line_id").references(() => incomeLines.id, {
      onDelete: "cascade",
    }),
    expenseLineId: uuid("expense_line_id").references(() => expenseLines.id, {
      onDelete: "cascade",
    }),
    expenseCategoryId: uuid("expense_category_id").references(() => expenseCategories.id, {
      onDelete: "cascade",
    }),
    currency: varchar("currency", { length: 3 }).notNull(),
    plannedAmount: numeric("planned_amount", { precision: 16, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "budget_month_plan_lines_kind_check",
      sql`(
        (${t.incomeLineId} IS NOT NULL AND ${t.expenseLineId} IS NULL AND ${t.expenseCategoryId} IS NULL AND ${t.lineKind} = 'income')
        OR (${t.expenseLineId} IS NOT NULL AND ${t.incomeLineId} IS NULL AND ${t.expenseCategoryId} IS NULL AND ${t.lineKind} = 'expense')
        OR (${t.expenseCategoryId} IS NOT NULL AND ${t.incomeLineId} IS NULL AND ${t.expenseLineId} IS NULL AND ${t.lineKind} = 'expense_category')
      )`,
    ),
    uniqueIndex("budget_month_plan_income_uidx")
      .on(t.periodMonth, t.incomeLineId)
      .where(sql`${t.incomeLineId} IS NOT NULL`),
    uniqueIndex("budget_month_plan_expense_uidx")
      .on(t.periodMonth, t.expenseLineId)
      .where(sql`${t.expenseLineId} IS NOT NULL`),
    uniqueIndex("budget_month_plan_expense_category_uidx")
      .on(t.periodMonth, t.expenseCategoryId)
      .where(sql`${t.expenseCategoryId} IS NOT NULL`),
  ],
)

export const expenseRecords = pgTable(
  "expense_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseCategoryId: uuid("expense_category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "cascade" }),
    expenseLineId: uuid("expense_line_id").references(() => expenseLines.id, { onDelete: "set null" }),
    appliedLiabilityId: uuid("applied_liability_id").references(() => liabilities.id, {
      onDelete: "set null",
    }),
    /** Positive amount deducted from the linked liability when this record posts. */
    appliedLiabilityAmount: numeric("applied_liability_amount", { precision: 16, scale: 2 }),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    occurredOn: date("occurred_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("expense_records_occurred_on_idx").on(t.occurredOn)],
)

/** Bulk bank/card import: one user upload session. */
export const transactionImportBatches = pgTable("transaction_import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: varchar("label", { length: 256 }),
  status: varchar("status", { length: 32 }).notNull().default("uploaded"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

/** One file within a batch; binary stored on disk at `storagePath`. */
export const transactionImportFiles = pgTable(
  "transaction_import_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => transactionImportBatches.id, { onDelete: "cascade" }),
    originalName: varchar("original_name", { length: 512 }).notNull(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    storagePath: varchar("storage_path", { length: 1024 }).notNull(),
    parserKind: varchar("parser_kind", { length: 32 }).notNull().default("unknown"),
    parseStatus: varchar("parse_status", { length: 32 }).notNull().default("pending"),
    parseError: text("parse_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("transaction_import_files_batch_created_idx").on(t.batchId, t.createdAt)],
)

/** Parsed row from a file; match fields filled by AI or user. */
export const importedTransactions = pgTable(
  "imported_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => transactionImportBatches.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => transactionImportFiles.id, { onDelete: "cascade" }),
    occurredOn: date("occurred_on").notNull(),
    /** Signed: negative often means inflow on card statements. */
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    description: text("description").notNull(),
    rawPayload: jsonb("raw_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    dedupeHash: varchar("dedupe_hash", { length: 64 }).notNull(),
    parserRowIndex: integer("parser_row_index").notNull().default(0),
    direction: varchar("direction", { length: 16 }),
    matchStatus: varchar("match_status", { length: 32 }).notNull().default("pending"),
    suggestedExpenseCategoryId: uuid("suggested_expense_category_id").references(
      () => expenseCategories.id,
      { onDelete: "set null" },
    ),
    suggestedExpenseLineId: uuid("suggested_expense_line_id").references(() => expenseLines.id, {
      onDelete: "set null",
    }),
    suggestedIncomeLineId: uuid("suggested_income_line_id").references(() => incomeLines.id, {
      onDelete: "set null",
    }),
    suggestedCategoryName: varchar("suggested_category_name", { length: 256 }),
    suggestedLineName: varchar("suggested_line_name", { length: 256 }),
    suggestedUseExistingCategoryId: uuid("suggested_use_existing_category_id").references(
      () => expenseCategories.id,
      { onDelete: "set null" },
    ),
    modelConfidence: varchar("model_confidence", { length: 32 }),
    modelNotes: text("model_notes"),
    postedRecordKind: varchar("posted_record_kind", { length: 16 }),
    postedRecordId: uuid("posted_record_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("imported_txn_batch_dedupe_uidx").on(t.batchId, t.dedupeHash),
    index("imported_txn_file_idx").on(t.fileId),
    index("imported_txn_batch_status_date_idx").on(t.batchId, t.matchStatus, t.occurredOn),
    index("imported_txn_batch_date_idx").on(t.batchId, t.occurredOn, t.id),
  ],
)

/**
 * Durable month-scoped view of transactions for the budget month (imports + optional manual).
 * Survives import batch deletion via ON DELETE SET NULL on imported_transaction_id.
 */
export const budgetMonthTransactions = pgTable(
  "budget_month_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodMonth: date("period_month").notNull(),
    occurredOn: date("occurred_on").notNull(),
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    description: text("description").notNull(),
    direction: varchar("direction", { length: 16 }),
    source: varchar("source", { length: 32 }).notNull().default("import"),
    importedTransactionId: uuid("imported_transaction_id").references(
      () => importedTransactions.id,
      { onDelete: "set null" },
    ),
    suggestedExpenseCategoryId: uuid("suggested_expense_category_id").references(
      () => expenseCategories.id,
      { onDelete: "set null" },
    ),
    suggestedExpenseLineId: uuid("suggested_expense_line_id").references(() => expenseLines.id, {
      onDelete: "set null",
    }),
    suggestedIncomeLineId: uuid("suggested_income_line_id").references(() => incomeLines.id, {
      onDelete: "set null",
    }),
    postedExpenseRecordId: uuid("posted_expense_record_id").references(() => expenseRecords.id, {
      onDelete: "set null",
    }),
    postedIncomeRecordId: uuid("posted_income_record_id").references(() => incomeRecords.id, {
      onDelete: "set null",
    }),
    matchStatus: varchar("match_status", { length: 32 }).notNull().default("pending"),
    rawPayload: jsonb("raw_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("budget_month_txn_import_uidx").on(t.importedTransactionId),
    index("budget_month_txn_period_month_idx").on(t.periodMonth),
  ],
)

export const allocationRecords = pgTable("allocation_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  allocatedOn: date("allocated_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
