ALTER TABLE "expense_lines" ADD COLUMN "is_recurring" boolean DEFAULT false NOT NULL;
ALTER TABLE "expense_lines" ADD COLUMN "frequency" varchar(32);
ALTER TABLE "expense_lines" ADD COLUMN "recurring_amount" numeric(16, 2);
ALTER TABLE "expense_lines" ADD COLUMN "recurring_currency" varchar(3) DEFAULT 'USD' NOT NULL;
ALTER TABLE "expense_lines" ADD COLUMN "recurring_anchor_date" date;

CREATE TABLE "budget_month_plan_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_month" date NOT NULL,
	"line_kind" varchar(16) NOT NULL,
	"income_line_id" uuid,
	"expense_line_id" uuid,
	"currency" varchar(3) NOT NULL,
	"planned_amount" numeric(16, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_month_plan_lines_one_line" CHECK (
		(income_line_id IS NOT NULL AND expense_line_id IS NULL AND line_kind = 'income')
		OR (expense_line_id IS NOT NULL AND income_line_id IS NULL AND line_kind = 'expense')
	)
);

ALTER TABLE "budget_month_plan_lines" ADD CONSTRAINT "budget_month_plan_lines_income_line_id_income_lines_id_fk" FOREIGN KEY ("income_line_id") REFERENCES "public"."income_lines"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "budget_month_plan_lines" ADD CONSTRAINT "budget_month_plan_lines_expense_line_id_expense_lines_id_fk" FOREIGN KEY ("expense_line_id") REFERENCES "public"."expense_lines"("id") ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "budget_month_plan_income_uidx" ON "budget_month_plan_lines" USING btree ("period_month","income_line_id") WHERE "income_line_id" IS NOT NULL;
CREATE UNIQUE INDEX "budget_month_plan_expense_uidx" ON "budget_month_plan_lines" USING btree ("period_month","expense_line_id") WHERE "expense_line_id" IS NOT NULL;
