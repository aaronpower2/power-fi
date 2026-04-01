ALTER TABLE "income_lines" ADD COLUMN "is_recurring" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "income_lines" ADD COLUMN "frequency" varchar(32);--> statement-breakpoint
ALTER TABLE "income_lines" ADD COLUMN "recurring_amount" numeric(16, 2);
