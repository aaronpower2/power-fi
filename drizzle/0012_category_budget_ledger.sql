ALTER TABLE "expense_categories" ADD COLUMN "is_recurring" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "frequency" varchar(32);
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "recurring_amount" numeric(16, 2);
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "recurring_currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "budget_month_plan_lines" DROP CONSTRAINT "budget_month_plan_lines_one_line";
--> statement-breakpoint
ALTER TABLE "budget_month_plan_lines" ALTER COLUMN "line_kind" SET DATA TYPE varchar(24);
--> statement-breakpoint
ALTER TABLE "budget_month_plan_lines" ADD COLUMN "expense_category_id" uuid;
--> statement-breakpoint
ALTER TABLE "budget_month_plan_lines" ADD CONSTRAINT "budget_month_plan_lines_expense_category_id_expense_categories_id_fk" FOREIGN KEY ("expense_category_id") REFERENCES "public"."expense_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budget_month_plan_lines" ADD CONSTRAINT "budget_month_plan_lines_kind_check" CHECK (
	(income_line_id IS NOT NULL AND expense_line_id IS NULL AND expense_category_id IS NULL AND line_kind = 'income')
	OR (expense_line_id IS NOT NULL AND income_line_id IS NULL AND expense_category_id IS NULL AND line_kind = 'expense')
	OR (expense_category_id IS NOT NULL AND income_line_id IS NULL AND expense_line_id IS NULL AND line_kind = 'expense_category')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_month_plan_expense_category_uidx" ON "budget_month_plan_lines" USING btree ("period_month","expense_category_id") WHERE "expense_category_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_lines" DROP COLUMN "is_recurring";
--> statement-breakpoint
ALTER TABLE "expense_lines" DROP COLUMN "frequency";
--> statement-breakpoint
ALTER TABLE "expense_lines" DROP COLUMN "recurring_amount";
--> statement-breakpoint
ALTER TABLE "expense_lines" DROP COLUMN "recurring_currency";
--> statement-breakpoint
ALTER TABLE "expense_lines" DROP COLUMN "recurring_anchor_date";
--> statement-breakpoint
CREATE TABLE "budget_month_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_month" date NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"description" text NOT NULL,
	"direction" varchar(16),
	"source" varchar(32) DEFAULT 'import' NOT NULL,
	"imported_transaction_id" uuid,
	"suggested_expense_line_id" uuid,
	"suggested_income_line_id" uuid,
	"posted_expense_record_id" uuid,
	"posted_income_record_id" uuid,
	"match_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_month_transactions" ADD CONSTRAINT "budget_month_transactions_imported_transaction_id_imported_transactions_id_fk" FOREIGN KEY ("imported_transaction_id") REFERENCES "public"."imported_transactions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budget_month_transactions" ADD CONSTRAINT "budget_month_transactions_suggested_expense_line_id_expense_lines_id_fk" FOREIGN KEY ("suggested_expense_line_id") REFERENCES "public"."expense_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budget_month_transactions" ADD CONSTRAINT "budget_month_transactions_suggested_income_line_id_income_lines_id_fk" FOREIGN KEY ("suggested_income_line_id") REFERENCES "public"."income_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budget_month_transactions" ADD CONSTRAINT "budget_month_transactions_posted_expense_record_id_expense_records_id_fk" FOREIGN KEY ("posted_expense_record_id") REFERENCES "public"."expense_records"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budget_month_transactions" ADD CONSTRAINT "budget_month_transactions_posted_income_record_id_income_records_id_fk" FOREIGN KEY ("posted_income_record_id") REFERENCES "public"."income_records"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_month_txn_import_uidx" ON "budget_month_transactions" USING btree ("imported_transaction_id") WHERE "imported_transaction_id" IS NOT NULL;
