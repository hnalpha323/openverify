CREATE TABLE "network_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sandbox_only" boolean DEFAULT false NOT NULL,
	"last_sync_id" bigint,
	"last_published_at" timestamp with time zone,
	"last_sha256" text,
	"last_applied_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_origin" text,
	"last_error_code" text,
	"check_failures" integer DEFAULT 0 NOT NULL,
	"last_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_sources_id_format" CHECK ("network_sources"."id" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and char_length("network_sources"."id") <= 64),
	CONSTRAINT "network_sources_last_sha256_hex" CHECK ("network_sources"."last_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "network_sources_last_origin_valid" CHECK ("network_sources"."last_origin" in ('publisher', 'import')),
	CONSTRAINT "network_sources_last_error_code_format" CHECK ("network_sources"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "network_sources_check_failures_non_negative" CHECK ("network_sources"."check_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "network_syncs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "network_syncs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"error_code" text,
	"published_at" timestamp with time zone,
	"sha256" text,
	"snapshot_bytes" bigint,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"covered_ipv4" bigint,
	"covered_ipv6" numeric(39, 0),
	"actor" text NOT NULL,
	"origin" text,
	"overrides" text[] DEFAULT '{}'::text[] NOT NULL,
	"superseded_at" timestamp with time zone,
	"snapshot_deleted_at" timestamp with time zone,
	CONSTRAINT "network_syncs_outcome_valid" CHECK ("network_syncs"."outcome" in ('applied', 'unchanged', 'busy', 'refused_rollback', 'refused_future', 'refused_mass_removal', 'refused_mass_addition', 'refused_schema', 'refused_size', 'refused_digest', 'error')),
	CONSTRAINT "network_syncs_actor_valid" CHECK ("network_syncs"."actor" in ('cli', 'job', 'seed')),
	CONSTRAINT "network_syncs_origin_valid" CHECK ("network_syncs"."origin" in ('publisher', 'import')),
	CONSTRAINT "network_syncs_overrides_valid" CHECK ("network_syncs"."overrides" <@ array['allow-mass-removal', 'allow-mass-addition', 'accept-older-publication']::text[]),
	CONSTRAINT "network_syncs_error_code_format" CHECK ("network_syncs"."error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "network_syncs_sha256_hex" CHECK ("network_syncs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "network_syncs_sizes_non_negative" CHECK ("network_syncs"."entry_count" >= 0 and "network_syncs"."snapshot_bytes" >= 0 and "network_syncs"."covered_ipv6" >= 0
        and "network_syncs"."covered_ipv4" between 0 and 4294967296)
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"inquiry_session_id" text NOT NULL,
	"ip" text,
	"location" text,
	"service_provider" text,
	"service_type" text,
	"proxy_type" text,
	"threat_level" text DEFAULT 'unknown' NOT NULL,
	"country_code" text,
	"country_name" text,
	"asn" bigint,
	"hosting_asn" boolean,
	"hosting_asn_confidence" double precision,
	"privacy_relay" boolean,
	"client_address_source" text NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "networks_id_format" CHECK ("networks"."id" ~ '^net_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "networks_threat_level_valid" CHECK ("networks"."threat_level" in ('unknown', 'low', 'medium', 'high')),
	CONSTRAINT "networks_client_address_source_valid" CHECK ("networks"."client_address_source" in ('socket', 'trusted-list', 'hop-count', 'trust-all')),
	CONSTRAINT "networks_asn_range" CHECK ("networks"."asn" between 0 and 4294967295),
	CONSTRAINT "networks_country_code_format" CHECK ("networks"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "networks_hosting_asn_true_or_null" CHECK ("networks"."hosting_asn" is null or "networks"."hosting_asn"),
	CONSTRAINT "networks_privacy_relay_true_or_null" CHECK ("networks"."privacy_relay" is null or "networks"."privacy_relay"),
	CONSTRAINT "networks_hosting_asn_confidence_range" CHECK ("networks"."hosting_asn_confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"platform" text NOT NULL,
	"collector_version" integer NOT NULL,
	"browser_fingerprint" text,
	"device_fingerprint" text,
	"device_class" text,
	"fingerprint_randomised" boolean DEFAULT false NOT NULL,
	"key_id" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "devices_id_format" CHECK ("devices"."id" ~ '^dev_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "devices_platform_valid" CHECK ("devices"."platform" in ('web', 'android')),
	CONSTRAINT "devices_collector_version_positive" CHECK ("devices"."collector_version" >= 1),
	CONSTRAINT "devices_browser_fingerprint_hex" CHECK ("devices"."browser_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "devices_device_fingerprint_hex" CHECK ("devices"."device_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "devices_device_class_hex" CHECK ("devices"."device_class" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "devices_key_id_format" CHECK ("devices"."key_id" ~ '^[A-Za-z0-9_-]{11}$'),
	CONSTRAINT "devices_identifiers_fit_platform" CHECK (("devices"."platform" <> 'web' or "devices"."device_fingerprint" is null)
        and ("devices"."platform" <> 'android'
             or ("devices"."browser_fingerprint" is null and "devices"."device_class" is null))),
	CONSTRAINT "devices_randomised_drops_strict" CHECK (not "devices"."fingerprint_randomised" or "devices"."browser_fingerprint" is null),
	CONSTRAINT "devices_has_identifier" CHECK (num_nonnulls("devices"."browser_fingerprint", "devices"."device_fingerprint", "devices"."device_class") > 0)
);
--> statement-breakpoint
CREATE TABLE "inquiry_session_signals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inquiry_session_signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"inquiry_session_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"screen" text NOT NULL,
	"platform" text NOT NULL,
	"collector_version" integer NOT NULL,
	"components" text,
	"behaviour" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_session_signals_sequence_non_negative" CHECK ("inquiry_session_signals"."sequence" >= 0),
	CONSTRAINT "inquiry_session_signals_platform_valid" CHECK ("inquiry_session_signals"."platform" in ('web', 'android')),
	CONSTRAINT "inquiry_session_signals_collector_version_positive" CHECK ("inquiry_session_signals"."collector_version" >= 1),
	CONSTRAINT "inquiry_session_signals_screen_format" CHECK ("inquiry_session_signals"."screen" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "inquiry_signal_computations" (
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"trigger_status" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"enqueued_at" timestamp with time zone,
	"computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_signal_computations_pkey" PRIMARY KEY("environment_id","inquiry_id"),
	CONSTRAINT "inquiry_signal_computations_trigger_valid" CHECK ("inquiry_signal_computations"."trigger_status" in ('completed', 'failed', 'expired')),
	CONSTRAINT "inquiry_signal_computations_state_valid" CHECK ("inquiry_signal_computations"."state" in ('pending', 'computed', 'skipped')),
	CONSTRAINT "inquiry_signal_computations_attempts_non_negative" CHECK ("inquiry_signal_computations"."attempts" >= 0),
	CONSTRAINT "inquiry_signal_computations_computed_at" CHECK ("inquiry_signal_computations"."state" <> 'computed' or "inquiry_signal_computations"."computed_at" is not null),
	CONSTRAINT "inquiry_signal_computations_last_error_code_format" CHECK ("inquiry_signal_computations"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "session_devices" (
	"environment_id" text NOT NULL,
	"inquiry_session_id" text NOT NULL,
	"device_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_devices_pkey" PRIMARY KEY("environment_id","inquiry_session_id")
);
--> statement-breakpoint
CREATE TABLE "handoff_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"issuing_session_id" text NOT NULL,
	"step_id" text NOT NULL,
	"method" text NOT NULL,
	"token_hash" text NOT NULL,
	"confirmation_code_hash" text,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"destination_confirmed" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_session_id" text,
	"revoked_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoff_tokens_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "handoff_tokens_id_format" CHECK ("handoff_tokens"."id" ~ '^hnd_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "handoff_tokens_step_id_format" CHECK ("handoff_tokens"."step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "handoff_tokens_method_valid" CHECK ("handoff_tokens"."method" in ('qr', 'email', 'sms')),
	CONSTRAINT "handoff_tokens_token_hash_hex" CHECK ("handoff_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "handoff_tokens_confirmation_code_hash_hex" CHECK ("handoff_tokens"."confirmation_code_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "handoff_tokens_code_attempts_non_negative" CHECK ("handoff_tokens"."code_attempts" >= 0),
	CONSTRAINT "handoff_tokens_redeemed_session" CHECK (("handoff_tokens"."redeemed_at" is null) = ("handoff_tokens"."redeemed_session_id" is null)),
	CONSTRAINT "handoff_tokens_redeemed_or_revoked" CHECK ("handoff_tokens"."redeemed_at" is null or "handoff_tokens"."revoked_at" is null),
	CONSTRAINT "handoff_tokens_declined_revokes" CHECK ("handoff_tokens"."declined_at" is null or "handoff_tokens"."revoked_at" is not null),
	CONSTRAINT "handoff_tokens_unconfirmed_needs_code" CHECK ("handoff_tokens"."destination_confirmed"
        or ("handoff_tokens"."method" <> 'qr' and "handoff_tokens"."confirmation_code_hash" is not null))
);
--> statement-breakpoint
CREATE TABLE "inquiry_handoff_steps" (
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"step_id" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_handoff_steps_pkey" PRIMARY KEY("environment_id","inquiry_id","step_id"),
	CONSTRAINT "inquiry_handoff_steps_state_valid" CHECK ("inquiry_handoff_steps"."state" in ('pending', 'issued', 'redeemed', 'continued_here', 'skipped', 'rejected', 'declined')),
	CONSTRAINT "inquiry_handoff_steps_step_id_format" CHECK ("inquiry_handoff_steps"."step_id" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "report_templates" DROP CONSTRAINT "report_templates_report_type_valid";--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_report_type_valid";--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "signal_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "signals" jsonb;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "signal_details" jsonb;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "network_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "is_tor" boolean;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "is_datacenter" boolean;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "is_vpn" boolean;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "is_proxy" boolean;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "hosting_asn" boolean;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "threat_level" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "country_code" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "country_name" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "ip_connection_type" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "network_organization" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "os_name" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "os_full_version" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "browser_name" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "browser_full_version" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "device_type" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "device_name" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "mobile_sdk_name" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "mobile_sdk_full_version" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "signals_collected" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "signal_bodies_dropped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "device_handoff_method" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "handoff_from_session_id" text;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "handoff_redeemed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "handoff_distance_meters" integer;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "handoff_country_changed" boolean;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "handoff_asn_changed" boolean;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD COLUMN "handoff_rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "created_by_session_id" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "from_rejected_handoff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "selfie_captures" ADD COLUMN "created_by_session_id" text;--> statement-breakpoint
ALTER TABLE "network_syncs" ADD CONSTRAINT "network_syncs_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."network_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_environment_id_id_key" UNIQUE("environment_id","id");--> statement-breakpoint
ALTER TABLE "networks" ADD CONSTRAINT "networks_inquiry_session_fk" FOREIGN KEY ("environment_id","inquiry_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_session_signals" ADD CONSTRAINT "inquiry_session_signals_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_session_signals" ADD CONSTRAINT "inquiry_session_signals_session_fk" FOREIGN KEY ("environment_id","inquiry_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_signal_computations" ADD CONSTRAINT "inquiry_signal_computations_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_signal_computations" ADD CONSTRAINT "inquiry_signal_computations_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_devices" ADD CONSTRAINT "session_devices_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_devices" ADD CONSTRAINT "session_devices_session_fk" FOREIGN KEY ("environment_id","inquiry_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_devices" ADD CONSTRAINT "session_devices_device_fk" FOREIGN KEY ("environment_id","device_id") REFERENCES "public"."devices"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_tokens" ADD CONSTRAINT "handoff_tokens_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_tokens" ADD CONSTRAINT "handoff_tokens_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_tokens" ADD CONSTRAINT "handoff_tokens_issuing_session_fk" FOREIGN KEY ("environment_id","issuing_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_tokens" ADD CONSTRAINT "handoff_tokens_redeemed_session_fk" FOREIGN KEY ("environment_id","redeemed_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_handoff_steps" ADD CONSTRAINT "inquiry_handoff_steps_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_handoff_steps" ADD CONSTRAINT "inquiry_handoff_steps_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "network_syncs_source_id_started_at_idx" ON "network_syncs" USING btree ("source_id","started_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "network_syncs_superseded_snapshot_idx" ON "network_syncs" USING btree ("superseded_at") WHERE "network_syncs"."outcome" = 'applied' and "network_syncs"."snapshot_deleted_at" is null and "network_syncs"."superseded_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "networks_environment_id_inquiry_session_id_key" ON "networks" USING btree ("environment_id","inquiry_session_id");--> statement-breakpoint
CREATE INDEX "networks_environment_id_created_at_id_idx" ON "networks" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "devices_browser_fingerprint_key" ON "devices" USING btree ("environment_id","browser_fingerprint","key_id") WHERE "devices"."browser_fingerprint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_device_fingerprint_key" ON "devices" USING btree ("environment_id","device_fingerprint","key_id") WHERE "devices"."device_fingerprint" is not null;--> statement-breakpoint
CREATE INDEX "devices_environment_id_last_seen_at_idx" ON "devices" USING btree ("environment_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_session_signals_session_sequence_key" ON "inquiry_session_signals" USING btree ("inquiry_session_id","sequence");--> statement-breakpoint
CREATE INDEX "inquiry_session_signals_environment_id_created_at_idx" ON "inquiry_session_signals" USING btree ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "inquiry_signal_computations_pending_idx" ON "inquiry_signal_computations" USING btree ("created_at") WHERE "inquiry_signal_computations"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "session_devices_environment_id_device_id_idx" ON "session_devices" USING btree ("environment_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_tokens_token_hash_key" ON "handoff_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "handoff_tokens_live_per_session_key" ON "handoff_tokens" USING btree ("issuing_session_id") WHERE "handoff_tokens"."redeemed_at" is null and "handoff_tokens"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "handoff_tokens_environment_id_inquiry_id_idx" ON "handoff_tokens" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "handoff_tokens_expires_at_idx" ON "handoff_tokens" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_handoff_from_session_fk" FOREIGN KEY ("environment_id","handoff_from_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_created_by_session_fk" FOREIGN KEY ("environment_id","created_by_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_captures" ADD CONSTRAINT "selfie_captures_created_by_session_fk" FOREIGN KEY ("environment_id","created_by_session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inquiry_sessions_handoff_from_session_id_idx" ON "inquiry_sessions" USING btree ("environment_id","handoff_from_session_id") WHERE "inquiry_sessions"."handoff_from_session_id" is not null;--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_is_datacenter_true_or_null" CHECK ("inquiry_sessions"."is_datacenter" is null or "inquiry_sessions"."is_datacenter");--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_is_vpn_true_or_null" CHECK ("inquiry_sessions"."is_vpn" is null or "inquiry_sessions"."is_vpn");--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_hosting_asn_true_or_null" CHECK ("inquiry_sessions"."hosting_asn" is null or "inquiry_sessions"."hosting_asn");--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_threat_level_valid" CHECK ("inquiry_sessions"."threat_level" in ('low', 'medium', 'high'));--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_country_code_format" CHECK ("inquiry_sessions"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_device_type_valid" CHECK ("inquiry_sessions"."device_type" in ('desktop', 'smartphone', 'tablet', 'tv'));--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_mobile_sdk_name_valid" CHECK ("inquiry_sessions"."mobile_sdk_name" in ('openverify-android', 'openverify-ios'));--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_signals_collected_valid" CHECK ("inquiry_sessions"."signals_collected" <@ array['session-integrity', 'device-recognition']::text[]);--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_signal_bodies_dropped_non_negative" CHECK ("inquiry_sessions"."signal_bodies_dropped" >= 0);--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_device_handoff_method_valid" CHECK ("inquiry_sessions"."device_handoff_method" in ('qr', 'email', 'sms'));--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_handoff_fields_together" CHECK (num_nulls("inquiry_sessions"."device_handoff_method", "inquiry_sessions"."handoff_from_session_id",
        "inquiry_sessions"."handoff_redeemed_at") in (0, 3));--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_handoff_facts_need_handoff" CHECK ("inquiry_sessions"."handoff_from_session_id" is not null
        or num_nonnulls("inquiry_sessions"."handoff_distance_meters", "inquiry_sessions"."handoff_country_changed",
          "inquiry_sessions"."handoff_asn_changed", "inquiry_sessions"."handoff_rejected_at") = 0);--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_handoff_distance_non_negative" CHECK ("inquiry_sessions"."handoff_distance_meters" >= 0);--> statement-breakpoint
ALTER TABLE "inquiry_sessions" ADD CONSTRAINT "inquiry_sessions_device_fields_length" CHECK (greatest(char_length("inquiry_sessions"."os_name"), char_length("inquiry_sessions"."os_full_version"),
        char_length("inquiry_sessions"."browser_name"), char_length("inquiry_sessions"."browser_full_version"),
        char_length("inquiry_sessions"."device_name"), char_length("inquiry_sessions"."mobile_sdk_full_version")) <= 64);--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_report_type_valid" CHECK ("report_templates"."report_type" in ('watchlist', 'business-watchlist', 'crypto-address-watchlist', 'politically-exposed-person', 'adverse-media', 'business-adverse-media', 'email-address', 'phone-number', 'address-lookup', 'ip-address'));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_report_type_valid" CHECK ("reports"."report_type" in ('watchlist', 'business-watchlist', 'crypto-address-watchlist', 'politically-exposed-person', 'adverse-media', 'business-adverse-media', 'email-address', 'phone-number', 'address-lookup', 'ip-address'));--> statement-breakpoint
CREATE TRIGGER "network_sources_set_updated_at" BEFORE UPDATE ON "network_sources" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "networks_set_updated_at" BEFORE UPDATE ON "networks" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "devices_set_updated_at" BEFORE UPDATE ON "devices" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "inquiry_signal_computations_set_updated_at" BEFORE UPDATE ON "inquiry_signal_computations" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "handoff_tokens_set_updated_at" BEFORE UPDATE ON "handoff_tokens" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "inquiry_handoff_steps_set_updated_at" BEFORE UPDATE ON "inquiry_handoff_steps" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();