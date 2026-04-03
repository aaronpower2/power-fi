DROP INDEX "budget_month_txn_import_uidx";--> statement-breakpoint
CREATE INDEX "budget_month_txn_period_month_idx" ON "budget_month_transactions" USING btree ("period_month");--> statement-breakpoint
CREATE INDEX "expense_records_occurred_on_idx" ON "expense_records" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX "imported_txn_file_idx" ON "imported_transactions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "imported_txn_batch_status_date_idx" ON "imported_transactions" USING btree ("batch_id","match_status","occurred_on");--> statement-breakpoint
CREATE INDEX "imported_txn_batch_date_idx" ON "imported_transactions" USING btree ("batch_id","occurred_on","id");--> statement-breakpoint
CREATE INDEX "income_records_occurred_on_idx" ON "income_records" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX "transaction_import_files_batch_created_idx" ON "transaction_import_files" USING btree ("batch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_month_txn_import_uidx" ON "budget_month_transactions" USING btree ("imported_transaction_id");