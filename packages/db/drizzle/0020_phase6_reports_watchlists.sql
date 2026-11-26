CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
-- Hand edit (C73.1): candidate retrieval's trigram path (C78.3) needs pg_trgm; the migration that
-- needs an extension creates it, as the workspace conventions require.
CREATE TYPE "public"."report_action_type" AS ENUM('dismiss', 'review', 'pause', 'resume', 'run', 'redact');--> statement-breakpoint
CREATE TYPE "public"."report_match_status" AS ENUM('open', 'dismissed', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."report_origin" AS ENUM('inquiry_completion', 'api', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."report_review_status" AS ENUM('pending', 'indeterminate', 'true_positive', 'false_positive');--> statement-breakpoint
CREATE TYPE "public"."report_risk_level" AS ENUM('material', 'immaterial');--> statement-breakpoint
CREATE TYPE "public"."report_run_type" AS ENUM('initial', 'scheduled', 'manual', 'list_update');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'submitted', 'ready', 'errored');--> statement-breakpoint
CREATE TABLE "report_accounts" (
	"environment_id" text NOT NULL,
	"report_id" text NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_accounts_pkey" PRIMARY KEY("environment_id","report_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "report_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"report_id" text NOT NULL,
	"action_type" "report_action_type" NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_actions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "report_actions_actor_valid" CHECK (("report_actions"."actor_type" = 'system' and "report_actions"."actor_id" is null)
        or ("report_actions"."actor_type" = 'user' and "report_actions"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("report_actions"."actor_type" = 'api_key' and "report_actions"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "report_actions_id_format" CHECK ("report_actions"."id" ~ '^ract_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "report_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"report_id" text NOT NULL,
	"source_id" text,
	"entry_index" text,
	"evidence_hash" text,
	"score" double precision NOT NULL,
	"snapshot" text,
	"status" "report_match_status" DEFAULT 'open' NOT NULL,
	"review_status" "report_review_status" DEFAULT 'pending' NOT NULL,
	"risk_level" "report_risk_level",
	"notify_on_change" boolean DEFAULT false NOT NULL,
	"present_in_last_run" boolean DEFAULT true NOT NULL,
	"first_run_id" text NOT NULL,
	"last_run_id" text NOT NULL,
	"lapsed_from" text,
	"reviewed_at" timestamp with time zone,
	"delisted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_matches_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "report_matches_score_unit_interval" CHECK ("report_matches"."score" between 0 and 1),
	CONSTRAINT "report_matches_delisted_at" CHECK ("report_matches"."status" <> 'delisted' or "report_matches"."delisted_at" is not null),
	CONSTRAINT "report_matches_entry_index_hex" CHECK ("report_matches"."entry_index" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "report_matches_evidence_hash_hex" CHECK ("report_matches"."evidence_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "report_matches_id_format" CHECK ("report_matches"."id" ~ '^rpm_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"report_id" text NOT NULL,
	"run_type" "report_run_type" NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"not_before" timestamp with time zone,
	"enqueued_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"claimed_until" timestamp with time zone,
	"trigger_sync_id" bigint,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"match_count" integer DEFAULT 0 NOT NULL,
	"new_match_count" integer DEFAULT 0 NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coverage" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_runs_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "report_runs_status_valid" CHECK ("report_runs"."status" in ('pending', 'running', 'ready', 'errored')),
	CONSTRAINT "report_runs_attempt_non_negative" CHECK ("report_runs"."attempt" >= 0),
	CONSTRAINT "report_runs_counts_non_negative" CHECK ("report_runs"."match_count" >= 0 and "report_runs"."new_match_count" >= 0),
	CONSTRAINT "report_runs_notes_valid" CHECK ("report_runs"."notes" <@ array['inquiry_already_decided', 'report_match', 'report_errored', 'recurring_limit', 'evidence_changed', 'risk_data_changed', 'match_not_found_in_run']::text[]),
	CONSTRAINT "report_runs_errors_array" CHECK (jsonb_typeof("report_runs"."errors") = 'array'),
	CONSTRAINT "report_runs_trigger_sync_with_list_update" CHECK (("report_runs"."run_type" = 'list_update') = ("report_runs"."trigger_sync_id" is not null)),
	CONSTRAINT "report_runs_id_format" CHECK ("report_runs"."id" ~ '^rpr_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "report_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"report_template_id" text NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_template_versions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "report_template_versions_version_positive" CHECK ("report_template_versions"."version" >= 1),
	CONSTRAINT "report_template_versions_status_valid" CHECK ("report_template_versions"."status" in ('draft', 'published', 'superseded')),
	CONSTRAINT "report_template_versions_published_at" CHECK (("report_template_versions"."status" = 'draft') = ("report_template_versions"."published_at" IS NULL)),
	CONSTRAINT "report_template_versions_id_format" CHECK ("report_template_versions"."id" ~ '^rptpv_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"report_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_templates_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "report_templates_report_type_valid" CHECK ("report_templates"."report_type" in ('watchlist', 'business-watchlist', 'crypto-address-watchlist', 'politically-exposed-person', 'adverse-media', 'business-adverse-media', 'email-address', 'phone-number', 'address-lookup')),
	CONSTRAINT "report_templates_status_valid" CHECK ("report_templates"."status" in ('active', 'archived')),
	CONSTRAINT "report_templates_name_length" CHECK (char_length("report_templates"."name") between 1 and 200),
	CONSTRAINT "report_templates_id_format" CHECK ("report_templates"."id" ~ '^rptp_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"report_type" text NOT NULL,
	"report_template_id" text NOT NULL,
	"report_template_version_id" text NOT NULL,
	"origin" "report_origin" NOT NULL,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"query" text,
	"query_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"query_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" text,
	"coverage" jsonb,
	"has_match" boolean DEFAULT false NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unavailable_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matcher_version" text,
	"provider" jsonb,
	"thresholds" jsonb,
	"notices" text[] DEFAULT '{}'::text[] NOT NULL,
	"inquiry_id" text,
	"account_id" text,
	"recurrence_interval_days" integer,
	"next_run_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_reason" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"crypto_address_index" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "reports_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "reports_tags_valid" CHECK (openverify_tags_valid("reports"."tags")),
	CONSTRAINT "reports_report_type_valid" CHECK ("reports"."report_type" in ('watchlist', 'business-watchlist', 'crypto-address-watchlist', 'politically-exposed-person', 'adverse-media', 'business-adverse-media', 'email-address', 'phone-number', 'address-lookup')),
	CONSTRAINT "reports_recurrence_interval_days_range" CHECK ("reports"."recurrence_interval_days" between 1 and 365),
	CONSTRAINT "reports_paused_reason_valid" CHECK ("reports"."paused_reason" in ('operator', 'match')),
	CONSTRAINT "reports_paused_reason_with_paused_at" CHECK (("reports"."paused_at" is null) = ("reports"."paused_reason" is null)),
	CONSTRAINT "reports_errors_array" CHECK (jsonb_typeof("reports"."errors") = 'array'),
	CONSTRAINT "reports_unavailable_fields_array" CHECK (jsonb_typeof("reports"."unavailable_fields") = 'array'),
	CONSTRAINT "reports_sources_array" CHECK (jsonb_typeof("reports"."sources") = 'array'),
	CONSTRAINT "reports_crypto_address_index_hex" CHECK ("reports"."crypto_address_index" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reports_report_template_id_format" CHECK ("reports"."report_template_id" ~ '^rptp_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "reports_report_template_version_id_format" CHECK ("reports"."report_template_version_id" ~ '^rptpv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "reports_id_format" CHECK ("reports"."id" ~ '^rep_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "watchlist_crypto_addresses" (
	"source_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"chain" text NOT NULL,
	"canonical" text NOT NULL,
	"raw" text NOT NULL,
	"ticker" text,
	CONSTRAINT "watchlist_crypto_addresses_pkey" PRIMARY KEY("source_id","entry_id","ordinal"),
	CONSTRAINT "watchlist_crypto_addresses_chain_format" CHECK ("watchlist_crypto_addresses"."chain" = 'unknown' or "watchlist_crypto_addresses"."chain" ~ '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$'),
	CONSTRAINT "watchlist_crypto_addresses_length" CHECK (char_length("watchlist_crypto_addresses"."raw") between 1 and 256 and char_length("watchlist_crypto_addresses"."canonical") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "watchlist_entries" (
	"source_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"kind" text NOT NULL,
	"content_hash" text NOT NULL,
	"risk_data_hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"programs" text[] DEFAULT '{}'::text[] NOT NULL,
	"listed_at" text,
	"first_seen_sync_id" bigint NOT NULL,
	"last_seen_sync_id" bigint NOT NULL,
	"changed_sync_id" bigint NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "watchlist_entries_pkey" PRIMARY KEY("source_id","entry_id"),
	CONSTRAINT "watchlist_entries_kind_valid" CHECK ("watchlist_entries"."kind" in ('individual', 'entity', 'vessel', 'aircraft')),
	CONSTRAINT "watchlist_entries_entry_id_length" CHECK (char_length("watchlist_entries"."entry_id") between 1 and 200),
	CONSTRAINT "watchlist_entries_content_hash_hex" CHECK ("watchlist_entries"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "watchlist_entries_risk_data_hash_hex" CHECK ("watchlist_entries"."risk_data_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "watchlist_entries_listed_at_format" CHECK ("watchlist_entries"."listed_at" ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$')
);
--> statement-breakpoint
CREATE TABLE "watchlist_identifiers" (
	"source_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" text NOT NULL,
	"value_normalised" text NOT NULL,
	"country" text,
	CONSTRAINT "watchlist_identifiers_pkey" PRIMARY KEY("source_id","entry_id","ordinal"),
	CONSTRAINT "watchlist_identifiers_kind_valid" CHECK ("watchlist_identifiers"."kind" in ('passport', 'national_id', 'tax_id', 'registration_number', 'lei', 'swift_bic', 'imo', 'mmsi', 'aircraft_serial', 'aircraft_tail', 'website', 'email', 'other')),
	CONSTRAINT "watchlist_identifiers_country_format" CHECK ("watchlist_identifiers"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "watchlist_identifiers_value_length" CHECK (char_length("watchlist_identifiers"."value_normalised") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "watchlist_key_df" (
	"source_id" text NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "watchlist_key_df_pkey" PRIMARY KEY("source_id","key"),
	CONSTRAINT "watchlist_key_df_count_positive" CHECK ("watchlist_key_df"."count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "watchlist_names" (
	"source_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL,
	"normalised" text NOT NULL,
	"script" text NOT NULL,
	"quality" text NOT NULL,
	"primary" boolean DEFAULT false NOT NULL,
	"keys" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "watchlist_names_pkey" PRIMARY KEY("source_id","entry_id","ordinal"),
	CONSTRAINT "watchlist_names_ordinal_non_negative" CHECK ("watchlist_names"."ordinal" >= 0),
	CONSTRAINT "watchlist_names_quality_valid" CHECK ("watchlist_names"."quality" in ('strong', 'weak')),
	CONSTRAINT "watchlist_names_name_length" CHECK (char_length("watchlist_names"."name") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "watchlist_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sandbox_only" boolean DEFAULT false NOT NULL,
	"keys_version" text,
	"last_sync_id" bigint,
	"last_published_at" timestamp with time zone,
	"last_sha256" text,
	"last_applied_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_origin" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_sources_id_format" CHECK ("watchlist_sources"."id" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and char_length("watchlist_sources"."id") <= 64),
	CONSTRAINT "watchlist_sources_last_sha256_hex" CHECK ("watchlist_sources"."last_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "watchlist_sources_last_origin_valid" CHECK ("watchlist_sources"."last_origin" in ('publisher', 'import')),
	CONSTRAINT "watchlist_sources_last_error_code_format" CHECK ("watchlist_sources"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "watchlist_syncs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "watchlist_syncs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"published_at" timestamp with time zone,
	"sha256" text,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"actor" text NOT NULL,
	"origin" text,
	"override" text,
	"keys_version" text,
	"rescreen_state" text DEFAULT 'none' NOT NULL,
	"rescreen_enqueued_at" timestamp with time zone,
	CONSTRAINT "watchlist_syncs_outcome_valid" CHECK ("watchlist_syncs"."outcome" in ('applied', 'unchanged', 'rekeyed', 'busy', 'refused_rollback', 'refused_future', 'refused_mass_removal', 'refused_schema', 'refused_size', 'refused_matcher_data', 'error')),
	CONSTRAINT "watchlist_syncs_actor_valid" CHECK ("watchlist_syncs"."actor" in ('cli', 'job', 'seed')),
	CONSTRAINT "watchlist_syncs_origin_valid" CHECK ("watchlist_syncs"."origin" in ('publisher', 'import')),
	CONSTRAINT "watchlist_syncs_override_valid" CHECK ("watchlist_syncs"."override" in ('allow-mass-removal', 'accept-older-publication', 'allow-normalised')),
	CONSTRAINT "watchlist_syncs_rescreen_state_valid" CHECK ("watchlist_syncs"."rescreen_state" in ('none', 'pending', 'done')),
	CONSTRAINT "watchlist_syncs_counts_non_negative" CHECK ("watchlist_syncs"."entry_count" >= 0 and "watchlist_syncs"."added" >= 0 and "watchlist_syncs"."changed" >= 0 and "watchlist_syncs"."removed" >= 0),
	CONSTRAINT "watchlist_syncs_sha256_hex" CHECK ("watchlist_syncs"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "report_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_accounts" ADD CONSTRAINT "report_accounts_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_accounts" ADD CONSTRAINT "report_accounts_report_fk" FOREIGN KEY ("environment_id","report_id") REFERENCES "public"."reports"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_accounts" ADD CONSTRAINT "report_accounts_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_actions" ADD CONSTRAINT "report_actions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_actions" ADD CONSTRAINT "report_actions_report_fk" FOREIGN KEY ("environment_id","report_id") REFERENCES "public"."reports"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_matches" ADD CONSTRAINT "report_matches_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_matches" ADD CONSTRAINT "report_matches_report_fk" FOREIGN KEY ("environment_id","report_id") REFERENCES "public"."reports"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_matches" ADD CONSTRAINT "report_matches_first_run_fk" FOREIGN KEY ("environment_id","first_run_id") REFERENCES "public"."report_runs"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_matches" ADD CONSTRAINT "report_matches_last_run_fk" FOREIGN KEY ("environment_id","last_run_id") REFERENCES "public"."report_runs"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_matches" ADD CONSTRAINT "report_matches_lapsed_from_fk" FOREIGN KEY ("environment_id","lapsed_from") REFERENCES "public"."report_matches"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_report_fk" FOREIGN KEY ("environment_id","report_id") REFERENCES "public"."reports"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_template_versions" ADD CONSTRAINT "report_template_versions_template_fk" FOREIGN KEY ("environment_id","report_template_id") REFERENCES "public"."report_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_template_fk" FOREIGN KEY ("environment_id","report_template_id") REFERENCES "public"."report_templates"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_template_version_fk" FOREIGN KEY ("environment_id","report_template_version_id") REFERENCES "public"."report_template_versions"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_crypto_addresses" ADD CONSTRAINT "watchlist_crypto_addresses_entry_fk" FOREIGN KEY ("source_id","entry_id") REFERENCES "public"."watchlist_entries"("source_id","entry_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_entries" ADD CONSTRAINT "watchlist_entries_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."watchlist_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_identifiers" ADD CONSTRAINT "watchlist_identifiers_entry_fk" FOREIGN KEY ("source_id","entry_id") REFERENCES "public"."watchlist_entries"("source_id","entry_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_key_df" ADD CONSTRAINT "watchlist_key_df_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."watchlist_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_names" ADD CONSTRAINT "watchlist_names_entry_fk" FOREIGN KEY ("source_id","entry_id") REFERENCES "public"."watchlist_entries"("source_id","entry_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_syncs" ADD CONSTRAINT "watchlist_syncs_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."watchlist_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_accounts_environment_id_account_id_idx" ON "report_accounts" USING btree ("environment_id","account_id");--> statement-breakpoint
CREATE INDEX "report_actions_environment_id_report_id_created_at_idx" ON "report_actions" USING btree ("environment_id","report_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "report_matches_report_id_entry_index_evidence_hash_idx" ON "report_matches" USING btree ("report_id","entry_index","evidence_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "report_matches_one_live_per_entry_key" ON "report_matches" USING btree ("report_id","entry_index") WHERE "report_matches"."status" in ('open', 'delisted');--> statement-breakpoint
CREATE INDEX "report_matches_environment_id_report_id_created_at_idx" ON "report_matches" USING btree ("environment_id","report_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_report_id_trigger_sync_id_key" ON "report_runs" USING btree ("report_id","trigger_sync_id") WHERE "report_runs"."trigger_sync_id" is not null;--> statement-breakpoint
CREATE INDEX "report_runs_claimable_idx" ON "report_runs" USING btree ("scheduled_for") WHERE "report_runs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "report_runs_environment_id_report_id_created_at_idx" ON "report_runs" USING btree ("environment_id","report_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "report_template_versions_report_template_id_version_key" ON "report_template_versions" USING btree ("report_template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "report_template_versions_one_published_key" ON "report_template_versions" USING btree ("report_template_id") WHERE "report_template_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "report_template_versions_env_template_created_at_id_idx" ON "report_template_versions" USING btree ("environment_id","report_template_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "report_templates_environment_id_created_at_id_idx" ON "report_templates" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "reports_environment_id_created_at_id_idx" ON "reports" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "reports_due_idx" ON "reports" USING btree ("next_run_at") WHERE "reports"."next_run_at" is not null and "reports"."paused_at" is null and "reports"."redacted_at" is null;--> statement-breakpoint
CREATE INDEX "reports_recurring_idx" ON "reports" USING btree ("environment_id","report_type") WHERE "reports"."next_run_at" is not null;--> statement-breakpoint
CREATE INDEX "reports_environment_id_inquiry_id_idx" ON "reports" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "reports_environment_id_account_id_idx" ON "reports" USING btree ("environment_id","account_id");--> statement-breakpoint
CREATE INDEX "reports_environment_id_crypto_address_index_idx" ON "reports" USING btree ("environment_id","crypto_address_index") WHERE "reports"."crypto_address_index" is not null;--> statement-breakpoint
CREATE INDEX "reports_lower_tags_idx" ON "reports" USING gin (openverify_lower_tags("tags"));--> statement-breakpoint
CREATE INDEX "watchlist_crypto_addresses_canonical_idx" ON "watchlist_crypto_addresses" USING btree ("canonical");--> statement-breakpoint
CREATE INDEX "watchlist_entries_source_id_changed_sync_id_idx" ON "watchlist_entries" USING btree ("source_id","changed_sync_id");--> statement-breakpoint
CREATE INDEX "watchlist_entries_source_id_removed_at_idx" ON "watchlist_entries" USING btree ("source_id","removed_at");--> statement-breakpoint
CREATE INDEX "watchlist_identifiers_kind_value_normalised_idx" ON "watchlist_identifiers" USING btree ("kind","value_normalised");--> statement-breakpoint
CREATE INDEX "watchlist_names_keys_idx" ON "watchlist_names" USING gin ("keys");--> statement-breakpoint
CREATE INDEX "watchlist_names_normalised_trgm_idx" ON "watchlist_names" USING gin ("normalised" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "watchlist_names_normalised_idx" ON "watchlist_names" USING btree ("normalised");--> statement-breakpoint
CREATE INDEX "watchlist_syncs_source_id_started_at_idx" ON "watchlist_syncs" USING btree ("source_id","started_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "watchlist_syncs_rescreen_pending_idx" ON "watchlist_syncs" USING btree ("rescreen_enqueued_at") WHERE "watchlist_syncs"."rescreen_state" = 'pending';--> statement-breakpoint
-- Hand edit: updated_at triggers for the Phase 6 tables that have the column.
CREATE TRIGGER "report_templates_set_updated_at" BEFORE UPDATE ON "report_templates" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "report_template_versions_set_updated_at" BEFORE UPDATE ON "report_template_versions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "report_matches_set_updated_at" BEFORE UPDATE ON "report_matches" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "watchlist_sources_set_updated_at" BEFORE UPDATE ON "watchlist_sources" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
-- Hand edit (C73.2, P02, F03): a report's history is append-only. An UPDATE is refused except two
-- cases, each with every other column unchanged: a KEK rewrap (`openverify.kek_rewrap = 'on'`) that
-- gives `details` a new ciphertext, and a report redaction (`openverify.report_redaction = 'on'`,
-- transaction-local, set only by the redaction repository) that nulls it. A DELETE is refused
-- unless the transaction deletes an environment (`openverify.environment_deletion = 'on'`):
-- reports are redacted, never deleted (C73.6).
CREATE OR REPLACE FUNCTION "openverify_report_actions_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('openverify.environment_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'report_actions is append-only';
  END IF;
  IF (to_jsonb(NEW) - 'details') = (to_jsonb(OLD) - 'details') THEN
    IF coalesce(current_setting('openverify.kek_rewrap', true), '') = 'on'
       AND OLD."details" IS NOT NULL AND NEW."details" IS NOT NULL THEN
      RETURN NEW;
    END IF;
    IF coalesce(current_setting('openverify.report_redaction', true), '') = 'on'
       AND NEW."details" IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'report_actions is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "report_actions_append_only" BEFORE UPDATE OR DELETE ON "report_actions" FOR EACH ROW EXECUTE FUNCTION "openverify_report_actions_append_only"();
