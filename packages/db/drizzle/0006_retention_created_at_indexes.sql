-- C16 retention (Workflow 2B F019): the daily sweeps take the oldest rows across environments
-- in batches of 500 (ORDER BY created_at LIMIT 500). Without an index leading with created_at
-- every batch read the whole table.
CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_finished_created_at_idx" ON "webhook_deliveries" USING btree ("created_at") WHERE "webhook_deliveries"."status" <> 'pending';--> statement-breakpoint
CREATE INDEX "api_logs_created_at_idx" ON "api_logs" USING btree ("created_at");