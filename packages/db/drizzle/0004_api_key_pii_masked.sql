-- C15 masking for API keys (Workflow 2B F001): a key minted or cloned by a principal that
-- cannot see PII sees it masked too. Existing keys keep seeing PII (false).
ALTER TABLE "api_keys" ADD COLUMN "pii_masked" boolean DEFAULT false NOT NULL;