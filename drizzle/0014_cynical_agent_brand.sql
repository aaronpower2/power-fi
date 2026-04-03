ALTER TABLE "expense_categories" ADD COLUMN "cash_flow_type" varchar(32) DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "linked_liability_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_records" ADD COLUMN "applied_liability_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_records" ADD COLUMN "applied_liability_amount" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "liabilities" ADD COLUMN "tracking_mode" varchar(32) DEFAULT 'fixed_installment' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_linked_liability_id_liabilities_id_fk" FOREIGN KEY ("linked_liability_id") REFERENCES "public"."liabilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_records" ADD CONSTRAINT "expense_records_applied_liability_id_liabilities_id_fk" FOREIGN KEY ("applied_liability_id") REFERENCES "public"."liabilities"("id") ON DELETE set null ON UPDATE no action;