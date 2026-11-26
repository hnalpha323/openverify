-- C13 consolidation and C16 redaction (Workflow 2B F023): finding the accounts consolidated into
-- an account, and checking the self-referencing key, no longer scan the environment's accounts.
CREATE INDEX "accounts_environment_id_consolidated_into_idx" ON "accounts" USING btree ("environment_id","consolidated_into") WHERE "accounts"."consolidated_into" IS NOT NULL;