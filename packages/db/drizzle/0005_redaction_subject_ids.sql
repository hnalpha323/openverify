-- C16 redaction of stored copies (Workflow 2B F005, F017): API logs and idempotent responses
-- record every inquiry, verification, session and account id their stored text mentions, so
-- redaction also clears list answers and embeddings. Rows written earlier keep '{}' and are
-- still matched by resource_id; they expire with the API log and idempotency retention.
ALTER TABLE "api_logs" ADD COLUMN "subject_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "subject_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "api_logs_subject_ids_idx" ON "api_logs" USING gin ("subject_ids");--> statement-breakpoint
CREATE INDEX "idempotency_keys_subject_ids_idx" ON "idempotency_keys" USING gin ("subject_ids");