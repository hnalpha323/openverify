CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"source_deployment_id" text,
	"creator_type" text NOT NULL,
	"creator_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_inquiry_template_version_id_key" UNIQUE("inquiry_template_version_id"),
	CONSTRAINT "deployments_creator_valid" CHECK ("deployments"."creator_type" in ('user', 'api-key')),
	CONSTRAINT "deployments_creator_id_format" CHECK (("deployments"."creator_type" <> 'user' or "deployments"."creator_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        and ("deployments"."creator_type" <> 'api-key' or "deployments"."creator_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "deployments_source_deployment_id_format" CHECK ("deployments"."source_deployment_id" is null or "deployments"."source_deployment_id" ~ '^dply_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "deployments_id_format" CHECK ("deployments"."id" ~ '^dply_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "inquiry_template_promotions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "inquiry_template_promotions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"source_environment_id" text NOT NULL,
	"source_template_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"promoted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_template_promotions_ids_format" CHECK ("inquiry_template_promotions"."source_environment_id" ~ '^env_[0-9A-HJKMNP-TV-Z]{26}$'
        and "inquiry_template_promotions"."source_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'
        and "inquiry_template_promotions"."source_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "inquiry_template_promotions_promoted_by_format" CHECK ("inquiry_template_promotions"."promoted_by" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "simulation_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulation_presets_name_length" CHECK (char_length("simulation_presets"."name") between 1 and 100),
	CONSTRAINT "simulation_presets_id_format" CHECK ("simulation_presets"."id" ~ '^ssp_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "theme_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"kind" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"licence_attested_by" text,
	"licence_attested_at" timestamp with time zone,
	"unicode_range" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_assets_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "theme_assets_kind_valid" CHECK ("theme_assets"."kind" in ('logo', 'font')),
	CONSTRAINT "theme_assets_media_type_valid" CHECK ("theme_assets"."media_type" in ('image/png', 'image/jpeg', 'font/woff2')),
	CONSTRAINT "theme_assets_kind_coherent" CHECK (("theme_assets"."kind" = 'logo' and "theme_assets"."media_type" in ('image/png', 'image/jpeg')
            and "theme_assets"."width" between 1 and 2048 and "theme_assets"."height" between 1 and 2048
            and "theme_assets"."licence_attested_by" is null and "theme_assets"."licence_attested_at" is null
            and "theme_assets"."unicode_range" is null and "theme_assets"."byte_size" between 1 and 262144)
        or ("theme_assets"."kind" = 'font' and "theme_assets"."media_type" = 'font/woff2'
            and "theme_assets"."width" is null and "theme_assets"."height" is null
            and "theme_assets"."licence_attested_by" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'
            and "theme_assets"."licence_attested_at" is not null and "theme_assets"."byte_size" between 1 and 524288)),
	CONSTRAINT "theme_assets_unicode_range_length" CHECK ("theme_assets"."unicode_range" is null or char_length("theme_assets"."unicode_range") <= 1000),
	CONSTRAINT "theme_assets_sha256_hex" CHECK ("theme_assets"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "theme_assets_wrapped_dek_format" CHECK ("theme_assets"."wrapped_dek" ~ '^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}$'),
	CONSTRAINT "theme_assets_id_format" CHECK ("theme_assets"."id" ~ '^tsa_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "theme_set_revisions" (
	"environment_id" text NOT NULL,
	"theme_set_id" text NOT NULL,
	"revision" integer NOT NULL,
	"name" text NOT NULL,
	"styles" jsonb NOT NULL,
	"creator_type" text NOT NULL,
	"creator_id" text NOT NULL,
	"restored_from" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_set_revisions_environment_id_theme_set_id_revision_pk" PRIMARY KEY("environment_id","theme_set_id","revision"),
	CONSTRAINT "theme_set_revisions_revision_positive" CHECK ("theme_set_revisions"."revision" >= 1),
	CONSTRAINT "theme_set_revisions_restored_from_earlier" CHECK ("theme_set_revisions"."restored_from" is null or ("theme_set_revisions"."restored_from" >= 1 and "theme_set_revisions"."restored_from" < "theme_set_revisions"."revision")),
	CONSTRAINT "theme_set_revisions_creator_valid" CHECK ("theme_set_revisions"."creator_type" in ('user', 'api-key')),
	CONSTRAINT "theme_set_revisions_creator_id_format" CHECK (("theme_set_revisions"."creator_type" = 'user' and "theme_set_revisions"."creator_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("theme_set_revisions"."creator_type" = 'api-key' and "theme_set_revisions"."creator_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$'))
);
--> statement-breakpoint
CREATE TABLE "theme_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"styles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "theme_sets_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "theme_sets_name_length" CHECK (char_length("theme_sets"."name") between 1 and 100),
	CONSTRAINT "theme_sets_status_valid" CHECK ("theme_sets"."status" in ('active', 'archived')),
	CONSTRAINT "theme_sets_revision_positive" CHECK ("theme_sets"."revision" >= 1),
	CONSTRAINT "theme_sets_archived_coherent" CHECK (("theme_sets"."status" = 'archived') = ("theme_sets"."archived_at" is not null)),
	CONSTRAINT "theme_sets_id_format" CHECK ("theme_sets"."id" ~ '^theset_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "inquiry_flow_actions" (
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"step_id" text NOT NULL,
	"entry" integer NOT NULL,
	"workflow_run_id" text,
	"status" text NOT NULL,
	"error_type" text,
	"target_account_id" text,
	"copied_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "inquiry_flow_actions_pkey" PRIMARY KEY("environment_id","inquiry_id","step_id","entry"),
	CONSTRAINT "inquiry_flow_actions_entry_positive" CHECK ("inquiry_flow_actions"."entry" > 0),
	CONSTRAINT "inquiry_flow_actions_step_id_format" CHECK ("inquiry_flow_actions"."step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "inquiry_flow_actions_status_valid" CHECK ("inquiry_flow_actions"."status" in ('running', 'completed', 'errored')),
	CONSTRAINT "inquiry_flow_actions_error_coherent" CHECK (("inquiry_flow_actions"."status" = 'errored') = ("inquiry_flow_actions"."error_type" is not null)
        and ("inquiry_flow_actions"."error_type" is null or "inquiry_flow_actions"."error_type" ~ '^[a-z][a-z0-9_:-]{0,127}$')),
	CONSTRAINT "inquiry_flow_actions_finished_coherent" CHECK (("inquiry_flow_actions"."status" = 'running') = ("inquiry_flow_actions"."finished_at" is null)),
	CONSTRAINT "inquiry_flow_actions_ids_format" CHECK (("inquiry_flow_actions"."workflow_run_id" is null or "inquiry_flow_actions"."workflow_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')
        and ("inquiry_flow_actions"."target_account_id" is null or "inquiry_flow_actions"."target_account_id" ~ '^acc_[0-9A-HJKMNP-TV-Z]{26}$'))
);
--> statement-breakpoint
CREATE TABLE "inquiry_flow_signal_snapshots" (
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"step_record_seq" integer NOT NULL,
	"name" text NOT NULL,
	"value" jsonb,
	"tier" text NOT NULL,
	"stage" text NOT NULL,
	"null_reason" text,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inquiry_flow_signal_snapshots_pkey" PRIMARY KEY("environment_id","inquiry_id","step_record_seq","name"),
	CONSTRAINT "inquiry_flow_signal_snapshots_null_coherent" CHECK (("inquiry_flow_signal_snapshots"."value" is null) = ("inquiry_flow_signal_snapshots"."null_reason" is not null)
        and ("inquiry_flow_signal_snapshots"."null_reason" is null or "inquiry_flow_signal_snapshots"."null_reason" ~ '^[a-z][a-z0-9_:-]{0,127}$'))
);
--> statement-breakpoint
CREATE TABLE "inquiry_flow_steps" (
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"seq" integer NOT NULL,
	"step_id" text NOT NULL,
	"step_type" text NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"exited_at" timestamp with time zone,
	"exit_port" text,
	"outcome" text,
	"waited_ms" bigint,
	"sensitive" boolean DEFAULT false NOT NULL,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "inquiry_flow_steps_pkey" PRIMARY KEY("environment_id","inquiry_id","seq"),
	CONSTRAINT "inquiry_flow_steps_seq_positive" CHECK ("inquiry_flow_steps"."seq" > 0),
	CONSTRAINT "inquiry_flow_steps_step_id_format" CHECK ("inquiry_flow_steps"."step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "inquiry_flow_steps_step_type_format" CHECK ("inquiry_flow_steps"."step_type" ~ '^[a-z][a-z0-9_:-]{0,127}$'),
	CONSTRAINT "inquiry_flow_steps_codes_format" CHECK (("inquiry_flow_steps"."exit_port" is null or "inquiry_flow_steps"."exit_port" ~ '^[a-z][a-z0-9_:-]{0,127}$')
        and ("inquiry_flow_steps"."outcome" is null or "inquiry_flow_steps"."outcome" ~ '^[a-z][a-z0-9_:-]{0,127}$')),
	CONSTRAINT "inquiry_flow_steps_exit_coherent" CHECK (("inquiry_flow_steps"."exited_at" is null) = ("inquiry_flow_steps"."exit_port" is null)),
	CONSTRAINT "inquiry_flow_steps_waited_ms_valid" CHECK ("inquiry_flow_steps"."waited_ms" is null or "inquiry_flow_steps"."waited_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_trigger_type_valid";--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_creator_valid";--> statement-breakpoint
ALTER TABLE "workflow_triggers" DROP CONSTRAINT "workflow_triggers_kind_valid";--> statement-breakpoint
ALTER TABLE "workflow_versions" DROP CONSTRAINT "workflow_versions_trigger_type_valid";--> statement-breakpoint
ALTER TABLE "inquiry_decisions" DROP CONSTRAINT "inquiry_decisions_kind_valid";--> statement-breakpoint
ALTER TABLE "inquiry_decisions" DROP CONSTRAINT "inquiry_decisions_actor_type_valid";--> statement-breakpoint
ALTER TABLE "inquiry_decisions" DROP CONSTRAINT "inquiry_decisions_actor_id_format";--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "publish_note" text;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "last_updater" jsonb;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "field_schemas" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "copy" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "enabled_locales" text[] DEFAULT '{en}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "default_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "theme_set_id" text;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "embed_origins" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "redirect_uri" text;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "redirect_uri_schemes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "redirect_include_status" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "help_url" text;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "privacy_url" text;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "validation" jsonb;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "flow_sha256" text;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "acknowledgements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "flow_step_id" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "flow_state" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "flow_previous_step_id" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "flow_spec_version" smallint;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "first_device_kind" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "first_platform" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "flow_outcome" jsonb;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "initial_fields" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "redirect_uri" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "theme_set_id" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "capture_method" text;--> statement-breakpoint
ALTER TABLE "inquiry_decisions" ADD COLUMN "flow" jsonb;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_version_fk" FOREIGN KEY ("environment_id","inquiry_template_id","inquiry_template_version_id") REFERENCES "public"."inquiry_template_versions"("environment_id","inquiry_template_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_template_promotions" ADD CONSTRAINT "inquiry_template_promotions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_template_promotions" ADD CONSTRAINT "inquiry_template_promotions_version_fk" FOREIGN KEY ("environment_id","inquiry_template_id","inquiry_template_version_id") REFERENCES "public"."inquiry_template_versions"("environment_id","inquiry_template_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_template_promotions" ADD CONSTRAINT "inquiry_template_promotions_template_fk" FOREIGN KEY ("environment_id","inquiry_template_id") REFERENCES "public"."inquiry_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_presets" ADD CONSTRAINT "simulation_presets_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_presets" ADD CONSTRAINT "simulation_presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_assets" ADD CONSTRAINT "theme_assets_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_set_revisions" ADD CONSTRAINT "theme_set_revisions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_set_revisions" ADD CONSTRAINT "theme_set_revisions_theme_set_fk" FOREIGN KEY ("environment_id","theme_set_id") REFERENCES "public"."theme_sets"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theme_sets" ADD CONSTRAINT "theme_sets_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_flow_actions" ADD CONSTRAINT "inquiry_flow_actions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_flow_actions" ADD CONSTRAINT "inquiry_flow_actions_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_flow_signal_snapshots" ADD CONSTRAINT "inquiry_flow_signal_snapshots_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_flow_signal_snapshots" ADD CONSTRAINT "inquiry_flow_signal_snapshots_step_fk" FOREIGN KEY ("environment_id","inquiry_id","step_record_seq") REFERENCES "public"."inquiry_flow_steps"("environment_id","inquiry_id","seq") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_flow_steps" ADD CONSTRAINT "inquiry_flow_steps_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_flow_steps" ADD CONSTRAINT "inquiry_flow_steps_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deployments_environment_id_created_at_id_idx" ON "deployments" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "deployments_environment_id_template_created_at_id_idx" ON "deployments" USING btree ("environment_id","inquiry_template_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiry_template_promotions_source_idx" ON "inquiry_template_promotions" USING btree ("environment_id","source_template_id");--> statement-breakpoint
CREATE INDEX "simulation_presets_environment_id_user_id_created_at_id_idx" ON "simulation_presets" USING btree ("environment_id","user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "theme_assets_storage_key_key" ON "theme_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "theme_sets_environment_id_created_at_id_idx" ON "theme_sets" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiry_flow_actions_running_idx" ON "inquiry_flow_actions" USING btree ("entered_at") WHERE "inquiry_flow_actions"."status" = 'running';--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_theme_set_fk" FOREIGN KEY ("environment_id","theme_set_id") REFERENCES "public"."theme_sets"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inquiries_flow_waiting_idx" ON "inquiries" USING btree ("environment_id","id") WHERE "inquiries"."flow_state" = 'waiting';--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD CONSTRAINT "inquiry_template_versions_publish_note_length" CHECK ("inquiry_template_versions"."publish_note" is null or char_length("inquiry_template_versions"."publish_note") <= 255);--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD CONSTRAINT "inquiry_template_versions_description_length" CHECK ("inquiry_template_versions"."description" is null or char_length("inquiry_template_versions"."description") <= 2000);--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD CONSTRAINT "inquiry_template_versions_flow_sha256_format" CHECK ("inquiry_template_versions"."flow_sha256" is null or "inquiry_template_versions"."flow_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD CONSTRAINT "inquiry_template_versions_theme_set_id_format" CHECK ("inquiry_template_versions"."theme_set_id" is null or "inquiry_template_versions"."theme_set_id" ~ '^theset_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD CONSTRAINT "inquiry_template_versions_locales_valid" CHECK (cardinality("inquiry_template_versions"."enabled_locales") between 1 and 5
        and "inquiry_template_versions"."enabled_locales" <@ array['en', 'es', 'fr', 'de', 'ar']::text[]
        and "inquiry_template_versions"."default_locale" = any("inquiry_template_versions"."enabled_locales"));--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD CONSTRAINT "inquiry_template_versions_json_shapes" CHECK (jsonb_typeof("inquiry_template_versions"."field_schemas") = 'array' and jsonb_typeof("inquiry_template_versions"."copy") = 'object'
        and jsonb_typeof("inquiry_template_versions"."acknowledgements") = 'array'
        and ("inquiry_template_versions"."last_updater" is null or jsonb_typeof("inquiry_template_versions"."last_updater") = 'object')
        and ("inquiry_template_versions"."validation" is null or jsonb_typeof("inquiry_template_versions"."validation") = 'object'));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_flow_state_valid" CHECK ("inquiries"."flow_state" is null or "inquiries"."flow_state" in ('active', 'waiting', 'halted', 'ended'));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_flow_spec_version_valid" CHECK ("inquiries"."flow_spec_version" is null or "inquiries"."flow_spec_version" in (1, 2));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_flow_step_id_format" CHECK (("inquiries"."flow_step_id" is null or "inquiries"."flow_step_id" ~ '^[a-z][a-z0-9_-]{0,63}$')
        and ("inquiries"."flow_previous_step_id" is null or "inquiries"."flow_previous_step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_first_device_kind_valid" CHECK ("inquiries"."first_device_kind" is null or "inquiries"."first_device_kind" in ('desktop-web', 'mobile-web', 'native'));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_first_platform_valid" CHECK ("inquiries"."first_platform" is null or "inquiries"."first_platform" in ('web', 'android'));--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_redirect_uri_length" CHECK ("inquiries"."redirect_uri" is null or char_length("inquiries"."redirect_uri") <= 2048);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_capture_method_valid" CHECK ("files"."capture_method" is null or "files"."capture_method" in ('upload', 'camera'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_trigger_type_valid" CHECK ("workflow_runs"."trigger_type" in ('trigger-event', 'trigger-api', 'trigger-schedule', 'trigger-recurring', 'trigger-direct', 'trigger-account', 'trigger-case', 'trigger-verification', 'trigger-flow'));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_creator_valid" CHECK (("workflow_runs"."creator_type" is null and "workflow_runs"."creator_id" is null)
        or ("workflow_runs"."creator_id" is not null and "workflow_runs"."creator_type" in ('user', 'api-key', 'event', 'scheduled-run', 'workflow-run', 'account-action', 'case-action', 'inquiry-flow')));--> statement-breakpoint
ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_kind_valid" CHECK ("workflow_triggers"."kind" in ('trigger-event', 'trigger-api', 'trigger-schedule', 'trigger-recurring', 'trigger-direct', 'trigger-account', 'trigger-case', 'trigger-verification', 'trigger-flow'));--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_trigger_type_valid" CHECK ("workflow_versions"."trigger_type" is null or "workflow_versions"."trigger_type" in ('trigger-event', 'trigger-api', 'trigger-schedule', 'trigger-recurring', 'trigger-direct', 'trigger-account', 'trigger-case', 'trigger-verification', 'trigger-flow'));--> statement-breakpoint
ALTER TABLE "inquiry_decisions" ADD CONSTRAINT "inquiry_decisions_flow_coherent" CHECK (("inquiry_decisions"."kind" = 'flow-failure') = ("inquiry_decisions"."flow" is not null and jsonb_typeof("inquiry_decisions"."flow") = 'object'));--> statement-breakpoint
ALTER TABLE "inquiry_decisions" ADD CONSTRAINT "inquiry_decisions_kind_valid" CHECK ("inquiry_decisions"."kind" in ('approve', 'decline', 'review', 'reopen', 'adverse', 'flow-failure'));--> statement-breakpoint
ALTER TABLE "inquiry_decisions" ADD CONSTRAINT "inquiry_decisions_actor_type_valid" CHECK ("inquiry_decisions"."actor_type" in ('user', 'api-key', 'workflow-run', 'inquiry-flow'));--> statement-breakpoint
ALTER TABLE "inquiry_decisions" ADD CONSTRAINT "inquiry_decisions_actor_id_format" CHECK (("inquiry_decisions"."actor_type" is distinct from 'user' or "inquiry_decisions"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("inquiry_decisions"."actor_type" is distinct from 'api-key' or "inquiry_decisions"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("inquiry_decisions"."actor_type" is distinct from 'workflow-run' or "inquiry_decisions"."actor_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("inquiry_decisions"."actor_type" is distinct from 'inquiry-flow' or "inquiry_decisions"."actor_id" ~ '^inq_[0-9A-HJKMNP-TV-Z]{26}$'));