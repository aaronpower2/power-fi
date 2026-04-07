ALTER TABLE "expense_lines"
ADD COLUMN "linked_liability_id" uuid;
--> statement-breakpoint
ALTER TABLE "expense_lines"
ADD COLUMN "is_recurring" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_lines"
ADD COLUMN "frequency" varchar(32);
--> statement-breakpoint
ALTER TABLE "expense_lines"
ADD COLUMN "recurring_amount" numeric(16, 2);
--> statement-breakpoint
ALTER TABLE "expense_lines"
ADD COLUMN "recurring_currency" varchar(3) DEFAULT 'USD' NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_lines"
ADD COLUMN "recurring_anchor_date" date;
--> statement-breakpoint
ALTER TABLE "expense_lines"
ADD CONSTRAINT "expense_lines_linked_liability_id_liabilities_id_fk"
FOREIGN KEY ("linked_liability_id") REFERENCES "public"."liabilities"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expense_lines_linked_liability_idx" ON "expense_lines" USING btree ("linked_liability_id");
--> statement-breakpoint
INSERT INTO "expense_categories" (
  "name",
  "sort_order",
  "cash_flow_type",
  "linked_liability_id",
  "is_recurring",
  "frequency",
  "recurring_amount",
  "recurring_currency"
)
SELECT '__DEBT_SERVICE_INTERNAL__', 999999, 'expense', null, false, null, null, 'USD'
WHERE NOT EXISTS (
  SELECT 1 FROM "expense_categories" WHERE "name" = '__DEBT_SERVICE_INTERNAL__'
);
--> statement-breakpoint
UPDATE "expense_lines" AS "el"
SET
  "linked_liability_id" = "ec"."linked_liability_id",
  "is_recurring" = "ec"."is_recurring",
  "frequency" = "ec"."frequency",
  "recurring_amount" = "ec"."recurring_amount",
  "recurring_currency" = "ec"."recurring_currency"
FROM "expense_categories" AS "ec"
WHERE "el"."category_id" = "ec"."id"
  AND "ec"."cash_flow_type" = 'debt_payment'
  AND "el"."linked_liability_id" IS NULL;
--> statement-breakpoint
WITH "internal_bucket" AS (
  SELECT "id" FROM "expense_categories" WHERE "name" = '__DEBT_SERVICE_INTERNAL__' LIMIT 1
)
INSERT INTO "expense_lines" (
  "category_id",
  "name",
  "linked_liability_id",
  "is_recurring",
  "frequency",
  "recurring_amount",
  "recurring_currency"
)
SELECT
  "internal_bucket"."id",
  "ec"."name",
  "ec"."linked_liability_id",
  "ec"."is_recurring",
  "ec"."frequency",
  "ec"."recurring_amount",
  "ec"."recurring_currency"
FROM "expense_categories" AS "ec"
CROSS JOIN "internal_bucket"
WHERE "ec"."cash_flow_type" = 'debt_payment'
  AND NOT EXISTS (
    SELECT 1
    FROM "expense_lines" AS "el"
    WHERE "el"."category_id" = "ec"."id"
  );
--> statement-breakpoint
UPDATE "expense_records" AS "er"
SET "expense_line_id" = "mapped"."line_id"
FROM (
  SELECT
    "er_inner"."id" AS "record_id",
    (
      SELECT "el"."id"
      FROM "expense_lines" AS "el"
      WHERE "el"."category_id" = "er_inner"."expense_category_id"
      ORDER BY "el"."created_at" ASC
      LIMIT 1
    ) AS "line_id"
  FROM "expense_records" AS "er_inner"
  INNER JOIN "expense_categories" AS "ec"
    ON "ec"."id" = "er_inner"."expense_category_id"
  WHERE "ec"."cash_flow_type" = 'debt_payment'
    AND "er_inner"."expense_line_id" IS NULL
) AS "mapped"
WHERE "er"."id" = "mapped"."record_id"
  AND "mapped"."line_id" IS NOT NULL;
