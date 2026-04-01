import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core"

export const growthTypeEnum = pgEnum("growth_type", ["compound", "capital"])

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  assetType: varchar("asset_type", { length: 128 }).notNull(),
  growthType: growthTypeEnum("growth_type").notNull(),
  assumedAnnualReturn: numeric("assumed_annual_return", { precision: 10, scale: 6 }),
  assumedTerminalValue: numeric("assumed_terminal_value", { precision: 16, scale: 2 }),
  maturationDate: date("maturation_date"),
  currentBalance: numeric("current_balance", { precision: 16, scale: 2 })
    .notNull()
    .default("0"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
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

export const incomeRecords = pgTable("income_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  incomeLineId: uuid("income_line_id")
    .notNull()
    .references(() => incomeLines.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  occurredOn: date("occurred_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 256 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const expenseLines = pgTable("expense_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => expenseCategories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 256 }).notNull(),
  isRecurring: boolean("is_recurring").notNull().default(false),
  frequency: varchar("frequency", { length: 32 }),
  recurringAmount: numeric("recurring_amount", { precision: 16, scale: 2 }),
  recurringCurrency: varchar("recurring_currency", { length: 3 }).notNull().default("USD"),
  recurringAnchorDate: date("recurring_anchor_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

/** Frozen planned monthly totals per line for closed months (finalize action). */
export const budgetMonthPlanLines = pgTable(
  "budget_month_plan_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodMonth: date("period_month").notNull(),
    lineKind: varchar("line_kind", { length: 16 }).notNull(),
    incomeLineId: uuid("income_line_id").references(() => incomeLines.id, {
      onDelete: "cascade",
    }),
    expenseLineId: uuid("expense_line_id").references(() => expenseLines.id, {
      onDelete: "cascade",
    }),
    currency: varchar("currency", { length: 3 }).notNull(),
    plannedAmount: numeric("planned_amount", { precision: 16, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      "budget_month_plan_lines_one_line",
      sql`(
        (${t.incomeLineId} IS NOT NULL AND ${t.expenseLineId} IS NULL AND ${t.lineKind} = 'income')
        OR (${t.expenseLineId} IS NOT NULL AND ${t.incomeLineId} IS NULL AND ${t.lineKind} = 'expense')
      )`,
    ),
    uniqueIndex("budget_month_plan_income_uidx")
      .on(t.periodMonth, t.incomeLineId)
      .where(sql`${t.incomeLineId} IS NOT NULL`),
    uniqueIndex("budget_month_plan_expense_uidx")
      .on(t.periodMonth, t.expenseLineId)
      .where(sql`${t.expenseLineId} IS NOT NULL`),
  ],
)

export const expenseRecords = pgTable("expense_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  expenseLineId: uuid("expense_line_id")
    .notNull()
    .references(() => expenseLines.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  occurredOn: date("occurred_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})

export const allocationRecords = pgTable("allocation_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  allocatedOn: date("allocated_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
})
