CREATE TABLE "transaction_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(256),
	"status" varchar(32) DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"original_name" varchar(512) NOT NULL,
	"mime_type" varchar(128) NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_path" varchar(1024) NOT NULL,
	"parser_kind" varchar(32) DEFAULT 'unknown' NOT NULL,
	"parse_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"description" text NOT NULL,
	"raw_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_hash" varchar(64) NOT NULL,
	"parser_row_index" integer DEFAULT 0 NOT NULL,
	"direction" varchar(16),
	"match_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"suggested_expense_line_id" uuid,
	"suggested_income_line_id" uuid,
	"suggested_category_name" varchar(256),
	"suggested_line_name" varchar(256),
	"suggested_use_existing_category_id" uuid,
	"model_confidence" varchar(32),
	"model_notes" text,
	"posted_record_kind" varchar(16),
	"posted_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_import_files" ADD CONSTRAINT "transaction_import_files_batch_id_transaction_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."transaction_import_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_batch_id_transaction_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."transaction_import_batches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_file_id_transaction_import_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."transaction_import_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_suggested_expense_line_id_expense_lines_id_fk" FOREIGN KEY ("suggested_expense_line_id") REFERENCES "public"."expense_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_suggested_income_line_id_income_lines_id_fk" FOREIGN KEY ("suggested_income_line_id") REFERENCES "public"."income_lines"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imported_transactions" ADD CONSTRAINT "imported_transactions_suggested_use_existing_category_id_expense_categories_id_fk" FOREIGN KEY ("suggested_use_existing_category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "imported_txn_batch_dedupe_uidx" ON "imported_transactions" USING btree ("batch_id","dedupe_hash");
