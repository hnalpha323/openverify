-- C16 retention (Workflow 2B F022): dashboard user sessions and one-time links are deleted 30
-- days past their expiry, oldest first.
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "one_time_links_expires_at_idx" ON "one_time_links" USING btree ("expires_at");