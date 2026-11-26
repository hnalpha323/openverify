-- C25.9 (Workflow 2E): GET /api-logs?filter[user-id]= lists the requests a user's dashboard
-- sessions made, newest first. The order is the list's own (DESC means NULLS FIRST), so a page is
-- read in index order and the scan stops after it.
CREATE INDEX "api_logs_environment_id_user_id_created_at_id_idx" ON "api_logs" USING btree ("environment_id","user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);