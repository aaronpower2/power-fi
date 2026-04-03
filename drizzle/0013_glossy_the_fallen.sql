ALTER TABLE "expense_records" DROP CONSTRAINT "expense_records_expense_line_id_expense_lines_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_records" ADD COLUMN "expense_category_id" uuid;
--> statement-breakpoint
UPDATE "expense_records" er
SET "expense_category_id" = el."category_id"
FROM "expense_lines" el
WHERE er."expense_line_id" = el."id"
  AND er."expense_category_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "expense_records" ALTER COLUMN "expense_category_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_records" ALTER COLUMN "expense_line_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_expense_category_id_expense_categories_id_fk" FOREIGN KEY ("expense_category_id") REFERENCES "public"."expense_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_expense_line_id_expense_lines_id_fk" FOREIGN KEY ("expense_line_id") REFERENCES "public"."expense_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD COLUMN "suggested_expense_category_id" uuid;
--> statement-breakpoint
UPDATE "imported_transactions"
SET "suggested_expense_category_id" = "suggested_use_existing_category_id"
WHERE "suggested_expense_category_id" IS NULL
  AND "suggested_use_existing_category_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "imported_transactions" it
SET "suggested_expense_category_id" = el."category_id"
FROM "expense_lines" el
WHERE it."suggested_expense_category_id" IS NULL
  AND it."suggested_expense_line_id" = el."id";
--> statement-breakpoint
UPDATE "imported_transactions" it
SET "suggested_expense_category_id" = er."expense_category_id"
FROM "expense_records" er
WHERE it."suggested_expense_category_id" IS NULL
  AND it."posted_record_kind" = 'expense'
  AND it."posted_record_id" = er."id";
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_suggested_expense_category_id_expense_categories_id_fk" FOREIGN KEY ("suggested_expense_category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "budget_month_transactions" ADD COLUMN "suggested_expense_category_id" uuid;
--> statement-breakpoint
UPDATE "budget_month_transactions" bmt
SET "suggested_expense_category_id" = it."suggested_expense_category_id"
FROM "imported_transactions" it
WHERE bmt."suggested_expense_category_id" IS NULL
  AND bmt."imported_transaction_id" = it."id";
--> statement-breakpoint
UPDATE "budget_month_transactions" bmt
SET "suggested_expense_category_id" = el."category_id"
FROM "expense_lines" el
WHERE bmt."suggested_expense_category_id" IS NULL
  AND bmt."suggested_expense_line_id" = el."id";
--> statement-breakpoint
ALTER TABLE "budget_month_transactions" ADD CONSTRAINT "budget_month_transactions_suggested_expense_category_id_expense_categories_id_fk" FOREIGN KEY ("suggested_expense_category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;
