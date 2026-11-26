ALTER TYPE "public"."audit_actor_type" ADD VALUE 'workflow_run';--> statement-breakpoint
ALTER TYPE "public"."report_origin" ADD VALUE 'workflow';--> statement-breakpoint
CREATE TABLE "list_rescreen_requests" (
	"environment_id" text NOT NULL,
	"list_id" text NOT NULL,
	"list_version" integer NOT NULL,
	"enqueued_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_rescreen_requests_pkey" PRIMARY KEY("environment_id","list_id","list_version"),
	CONSTRAINT "list_rescreen_requests_version_positive" CHECK ("list_rescreen_requests"."list_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "transaction_children" (
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"child_type" text NOT NULL,
	"child_id" text NOT NULL,
	"workflow_run_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_children_pkey" PRIMARY KEY("environment_id","transaction_id","child_id"),
	CONSTRAINT "transaction_children_child_type_valid" CHECK ("transaction_children"."child_type" in ('inquiry', 'verification', 'report', 'case')),
	CONSTRAINT "transaction_children_child_id_format" CHECK (("transaction_children"."child_type" = 'inquiry' and "transaction_children"."child_id" ~ '^inq_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_children"."child_type" = 'verification' and "transaction_children"."child_id" ~ '^ver_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_children"."child_type" = 'report' and "transaction_children"."child_id" ~ '^rep_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_children"."child_type" = 'case' and "transaction_children"."child_id" ~ '^case_[0-9A-HJKMNP-TV-Z]{26}$')
        or "transaction_children"."child_type" not in ('inquiry', 'verification', 'report', 'case')),
	CONSTRAINT "transaction_children_workflow_run_id_format" CHECK ("transaction_children"."workflow_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "account_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"account_type_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"prefill" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_actions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "account_actions_id_format" CHECK ("account_actions"."id" ~ '^accac_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "account_actions_status_valid" CHECK ("account_actions"."status" in ('active', 'archived')),
	CONSTRAINT "account_actions_label_length" CHECK (char_length("account_actions"."label") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "scheduled_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"target_workflow_id" text NOT NULL,
	"source_run_id" text,
	"subject_id" text,
	"base_at" timestamp with time zone NOT NULL,
	"offset_value" integer NOT NULL,
	"offset_unit" text NOT NULL,
	"offset_direction" text NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"workflow_run_id" text,
	"reason_code" text,
	"inputs" text,
	"workflow_run_step_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_runs_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "scheduled_runs_workflow_run_step_id_format" CHECK ("scheduled_runs"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "scheduled_runs_id_format" CHECK ("scheduled_runs"."id" ~ '^srrun_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "scheduled_runs_status_valid" CHECK ("scheduled_runs"."status" in ('pending', 'run_created', 'canceled')),
	CONSTRAINT "scheduled_runs_offset_unit_valid" CHECK ("scheduled_runs"."offset_unit" in ('minutes', 'hours', 'days')),
	CONSTRAINT "scheduled_runs_offset_direction_valid" CHECK ("scheduled_runs"."offset_direction" in ('before', 'after')),
	CONSTRAINT "scheduled_runs_offset_range" CHECK ("scheduled_runs"."offset_value" >= 0),
	CONSTRAINT "scheduled_runs_run_with_status" CHECK (("scheduled_runs"."status" = 'run_created') = ("scheduled_runs"."workflow_run_id" is not null)),
	CONSTRAINT "scheduled_runs_source_run_id_format" CHECK ("scheduled_runs"."source_run_id" is null or "scheduled_runs"."source_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "scheduled_runs_workflow_run_id_format" CHECK ("scheduled_runs"."workflow_run_id" is null or "scheduled_runs"."workflow_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "scheduled_runs_reason_code_format" CHECK ("scheduled_runs"."reason_code" is null or "scheduled_runs"."reason_code" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"versions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_deployments_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_deployments_id_format" CHECK ("workflow_deployments"."id" ~ '^wfd_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_deployments_status_valid" CHECK ("workflow_deployments"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "workflow_environment_slots" (
	"environment_id" text PRIMARY KEY NOT NULL,
	"in_flight_cap" integer,
	"last_served_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_environment_slots_cap_range" CHECK ("workflow_environment_slots"."in_flight_cap" is null or "workflow_environment_slots"."in_flight_cap" >= 1)
);
--> statement-breakpoint
CREATE TABLE "workflow_run_files" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"run_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"wrapped_dek" text,
	"filename" text,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"redacted_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_files_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_run_files_id_format" CHECK ("workflow_run_files"."id" ~ '^wfrf_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_run_files_sha256_format" CHECK ("workflow_run_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workflow_run_files_byte_size_range" CHECK ("workflow_run_files"."byte_size" >= 0),
	CONSTRAINT "workflow_run_files_held_until_redacted" CHECK ("workflow_run_files"."redacted_at" is not null
        or ("workflow_run_files"."wrapped_dek" is not null and "workflow_run_files"."filename" is not null)),
	CONSTRAINT "workflow_run_files_deleted_after_redacted" CHECK ("workflow_run_files"."deleted_at" is null or "workflow_run_files"."redacted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "workflow_run_journal" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_run_journal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"step_id" text,
	"node_id" text,
	"iteration_path" text,
	"attempt" integer,
	"duration_ms" integer,
	"error_type" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_journal_kind_valid" CHECK ("workflow_run_journal"."kind" in ('run_created', 'run_completed', 'run_errored', 'run_canceled', 'run_resumed', 'run_redacted', 'step_ready', 'step_started', 'step_succeeded', 'step_failed', 'step_skipped', 'step_canceled', 'step_reclaimed', 'retry_scheduled', 'wait_started', 'wait_resolved', 'wait_restored', 'wait_timed_out')),
	CONSTRAINT "workflow_run_journal_step_id_format" CHECK ("workflow_run_journal"."step_id" is null or "workflow_run_journal"."step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_run_journal_error_type_format" CHECK ("workflow_run_journal"."error_type" is null or "workflow_run_journal"."error_type" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "workflow_run_journal_error_code_format" CHECK ("workflow_run_journal"."error_code" is null or "workflow_run_journal"."error_code" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "workflow_run_journal_duration_range" CHECK ("workflow_run_journal"."duration_ms" is null or "workflow_run_journal"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"iteration_path" text DEFAULT '' NOT NULL,
	"node_type" text NOT NULL,
	"action_key" text,
	"action_version" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claims" integer DEFAULT 0 NOT NULL,
	"claimed_by" text,
	"claimed_until" timestamp with time zone,
	"enqueued_at" timestamp with time zone,
	"wait_event_names" text[],
	"wait_correlation_key" text,
	"wait_filter" jsonb,
	"wait_filter_on_null" text,
	"timeout_at" timestamp with time zone,
	"waiting_snapshot" "pg_snapshot",
	"waiting_xact" "xid8",
	"resolved_by_event_id" text,
	"join_remaining" integer,
	"input" text,
	"output" text,
	"console" text,
	"error_type" text,
	"error_code" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_steps_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_run_steps_run_node_iteration_key" UNIQUE("run_id","node_id","iteration_path"),
	CONSTRAINT "workflow_run_steps_id_format" CHECK ("workflow_run_steps"."id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_run_steps_status_valid" CHECK ("workflow_run_steps"."status" in ('pending', 'ready', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'canceled', 'timed_out')),
	CONSTRAINT "workflow_run_steps_node_type_valid" CHECK ("workflow_run_steps"."node_type" in ('action', 'wait', 'parallel', 'join', 'conditional', 'loop', 'module', 'output', 'module-input', 'array-map-output')),
	CONSTRAINT "workflow_run_steps_attempt_range" CHECK ("workflow_run_steps"."attempt" >= 0 and "workflow_run_steps"."claims" >= 0),
	CONSTRAINT "workflow_run_steps_join_remaining_range" CHECK ("workflow_run_steps"."join_remaining" is null or "workflow_run_steps"."join_remaining" >= 0),
	CONSTRAINT "workflow_run_steps_claim_with_running" CHECK ("workflow_run_steps"."status" <> 'running' or ("workflow_run_steps"."claimed_by" is not null and "workflow_run_steps"."claimed_until" is not null)),
	CONSTRAINT "workflow_run_steps_failed_says_why" CHECK ("workflow_run_steps"."status" <> 'failed' or "workflow_run_steps"."error_type" is not null),
	CONSTRAINT "workflow_run_steps_resolved_by_event_id_format" CHECK ("workflow_run_steps"."resolved_by_event_id" is null or "workflow_run_steps"."resolved_by_event_id" ~ '^evt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_run_steps_error_type_format" CHECK ("workflow_run_steps"."error_type" is null or "workflow_run_steps"."error_type" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "workflow_run_steps_error_code_format" CHECK ("workflow_run_steps"."error_code" is null or "workflow_run_steps"."error_code" ~ '^[a-z][a-z0-9_-]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_run_subjects" (
	"environment_id" text NOT NULL,
	"run_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_subjects_pkey" PRIMARY KEY("environment_id","run_id","subject_id"),
	CONSTRAINT "workflow_run_subjects_source_valid" CHECK ("workflow_run_subjects"."source" in ('trigger', 'read', 'written', 'output'))
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"workflow_deployment_id" text,
	"rollout_label" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"waiting_on" text,
	"trigger_type" text NOT NULL,
	"trigger_delivery_id" text,
	"schedule_fire" text,
	"scheduled_run_id" text,
	"idempotency_key" text,
	"creator_type" text,
	"creator_id" text,
	"root_run_id" text,
	"parent_run_id" text,
	"rerun_of_id" text,
	"waiting_on_run_id" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"trigger_depth" integer DEFAULT 0 NOT NULL,
	"step_executions" integer DEFAULT 0 NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"caused_by_principal" text,
	"effective_grant" jsonb NOT NULL,
	"error_type" text,
	"error_code" text,
	"error_node_id" text,
	"step_outcomes" jsonb DEFAULT '{"succeeded":0,"failed-continued":0,"timed-out":0,"unknown-effect":0,"skipped":0}'::jsonb NOT NULL,
	"has_step_errors" boolean DEFAULT false NOT NULL,
	"is_test_run" boolean DEFAULT false NOT NULL,
	"overridden_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	"subjects_overflow" boolean DEFAULT false NOT NULL,
	"trigger_snapshot" text,
	"inputs" text,
	"variables" text,
	"outputs" text,
	"completed_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	"values_purged_at" timestamp with time zone,
	"workflow_run_step_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_runs_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_runs_trigger_delivery_key" UNIQUE("trigger_delivery_id"),
	CONSTRAINT "workflow_runs_schedule_fire_key" UNIQUE("environment_id","schedule_fire"),
	CONSTRAINT "workflow_runs_scheduled_run_key" UNIQUE("scheduled_run_id"),
	CONSTRAINT "workflow_runs_workflow_idempotency_key" UNIQUE("workflow_id","idempotency_key"),
	CONSTRAINT "workflow_runs_workflow_run_step_id_format" CHECK ("workflow_runs"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_id_format" CHECK ("workflow_runs"."id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_status_valid" CHECK ("workflow_runs"."status" in ('in_progress', 'completed', 'errored', 'canceled')),
	CONSTRAINT "workflow_runs_waiting_on_valid" CHECK ("workflow_runs"."waiting_on" is null
        or ("workflow_runs"."status" = 'in_progress' and "workflow_runs"."waiting_on" in ('event', 'time', 'earlier-run', 'child-run', 'admission'))),
	CONSTRAINT "workflow_runs_rollout_label_valid" CHECK ("workflow_runs"."rollout_label" is null or "workflow_runs"."rollout_label" in ('treatment', 'control')),
	CONSTRAINT "workflow_runs_trigger_type_valid" CHECK ("workflow_runs"."trigger_type" in ('trigger-event', 'trigger-api', 'trigger-schedule', 'trigger-recurring', 'trigger-direct', 'trigger-account', 'trigger-case', 'trigger-verification')),
	CONSTRAINT "workflow_runs_creator_valid" CHECK (("workflow_runs"."creator_type" is null and "workflow_runs"."creator_id" is null)
        or ("workflow_runs"."creator_id" is not null and "workflow_runs"."creator_type" in ('user', 'api-key', 'event', 'scheduled-run', 'workflow-run', 'account-action'))),
	CONSTRAINT "workflow_runs_depth_range" CHECK ("workflow_runs"."depth" >= 0 and "workflow_runs"."trigger_depth" >= 0),
	CONSTRAINT "workflow_runs_step_executions_range" CHECK ("workflow_runs"."step_executions" >= 0),
	CONSTRAINT "workflow_runs_finished_says_when" CHECK (("workflow_runs"."status" = 'in_progress') = ("workflow_runs"."completed_at" is null)),
	CONSTRAINT "workflow_runs_errored_says_why" CHECK (("workflow_runs"."status" = 'errored') = ("workflow_runs"."error_type" is not null)),
	CONSTRAINT "workflow_runs_caused_by_principal_format" CHECK ("workflow_runs"."caused_by_principal" is null
        or "workflow_runs"."caused_by_principal" ~ '^(usr|key)_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_error_type_format" CHECK ("workflow_runs"."error_type" is null or "workflow_runs"."error_type" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "workflow_runs_error_code_format" CHECK ("workflow_runs"."error_code" is null or "workflow_runs"."error_code" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "workflow_runs_root_run_id_format" CHECK ("workflow_runs"."root_run_id" is null or "workflow_runs"."root_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_parent_run_id_format" CHECK ("workflow_runs"."parent_run_id" is null or "workflow_runs"."parent_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_rerun_of_id_format" CHECK ("workflow_runs"."rerun_of_id" is null or "workflow_runs"."rerun_of_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_waiting_on_run_id_format" CHECK ("workflow_runs"."waiting_on_run_id" is null or "workflow_runs"."waiting_on_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_trigger_delivery_id_format" CHECK ("workflow_runs"."trigger_delivery_id" is null or "workflow_runs"."trigger_delivery_id" ~ '^wftd_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_scheduled_run_id_format" CHECK ("workflow_runs"."scheduled_run_id" is null or "workflow_runs"."scheduled_run_id" ~ '^srrun_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_runs_deployment_id_format" CHECK ("workflow_runs"."workflow_deployment_id" is null or "workflow_runs"."workflow_deployment_id" ~ '^wfd_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"cron" text,
	"every_minutes" integer,
	"time_zone" text NOT NULL,
	"object_type" text NOT NULL,
	"filter" jsonb,
	"on_null" text,
	"batch_cap" integer DEFAULT 100 NOT NULL,
	"cursor" text,
	"next_fire_at" timestamp with time zone NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_schedules_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_schedules_workflow_key" UNIQUE("workflow_id"),
	CONSTRAINT "workflow_schedules_id_format" CHECK ("workflow_schedules"."id" ~ '^wfsc_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_schedules_object_type_valid" CHECK ("workflow_schedules"."object_type" in ('account', 'case', 'inquiry', 'report', 'transaction')),
	CONSTRAINT "workflow_schedules_cron_or_every" CHECK (("workflow_schedules"."cron" is null) <> ("workflow_schedules"."every_minutes" is null)),
	CONSTRAINT "workflow_schedules_every_range" CHECK ("workflow_schedules"."every_minutes" is null or "workflow_schedules"."every_minutes" >= 1),
	CONSTRAINT "workflow_schedules_batch_cap_range" CHECK ("workflow_schedules"."batch_cap" between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "workflow_step_effects" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"effect_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"result" text,
	"copy_target_id" text,
	"copy_source_subject_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_step_effects_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_step_effects_effect_key" UNIQUE("environment_id","effect_key"),
	CONSTRAINT "workflow_step_effects_id_format" CHECK ("workflow_step_effects"."id" ~ '^wfef_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_step_effects_step_id_format" CHECK ("workflow_step_effects"."step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_step_effects_status_valid" CHECK ("workflow_step_effects"."status" in ('claimed', 'done', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "workflow_trigger_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_name" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_run_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"not_before" timestamp with time zone,
	"enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_trigger_deliveries_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_trigger_deliveries_event_workflow_key" UNIQUE("event_id","workflow_id"),
	CONSTRAINT "workflow_trigger_deliveries_id_format" CHECK ("workflow_trigger_deliveries"."id" ~ '^wftd_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_trigger_deliveries_event_id_format" CHECK ("workflow_trigger_deliveries"."event_id" ~ '^evt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_trigger_deliveries_event_name_format" CHECK ("workflow_trigger_deliveries"."event_name" ~ '^[a-z][a-z_-]*(/[a-z][a-z_-]*)?(\.[a-z][a-z_-]*)+$'),
	CONSTRAINT "workflow_trigger_deliveries_run_id_format" CHECK ("workflow_trigger_deliveries"."workflow_run_id" is null or "workflow_trigger_deliveries"."workflow_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_trigger_deliveries_reason_code_format" CHECK ("workflow_trigger_deliveries"."reason_code" is null or "workflow_trigger_deliveries"."reason_code" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "workflow_trigger_deliveries_status_valid" CHECK ("workflow_trigger_deliveries"."status" in ('pending', 'run_created', 'filtered', 'refused', 'expired')),
	CONSTRAINT "workflow_trigger_deliveries_reason_with_status" CHECK (("workflow_trigger_deliveries"."status" in ('pending', 'run_created')) = ("workflow_trigger_deliveries"."reason_code" is null)),
	CONSTRAINT "workflow_trigger_deliveries_run_with_status" CHECK (("workflow_trigger_deliveries"."status" = 'run_created') = ("workflow_trigger_deliveries"."workflow_run_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_triggers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_triggers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"kind" text NOT NULL,
	"event_name" text,
	"workflow_id" text NOT NULL,
	"workflow_version_id" text,
	"workflow_deployment_id" text,
	"filter" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_triggers_workflow_event_key" UNIQUE NULLS NOT DISTINCT("workflow_id","kind","event_name"),
	CONSTRAINT "workflow_triggers_kind_valid" CHECK ("workflow_triggers"."kind" in ('trigger-event', 'trigger-api', 'trigger-schedule', 'trigger-recurring', 'trigger-direct', 'trigger-account', 'trigger-case', 'trigger-verification')),
	CONSTRAINT "workflow_triggers_version_or_deployment" CHECK (("workflow_triggers"."workflow_version_id" is null) <> ("workflow_triggers"."workflow_deployment_id" is null))
);
--> statement-breakpoint
CREATE TABLE "workflow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"schema_version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_sha256" text,
	"lock_version" integer DEFAULT 1 NOT NULL,
	"trigger_type" text,
	"trigger_config" jsonb,
	"grant" jsonb,
	"egress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acknowledgements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"last_updater" text,
	"published_at" timestamp with time zone,
	"published_by_type" "audit_actor_type",
	"published_by_id" text,
	"promoted_from" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflow_versions_workflow_version_key" UNIQUE("workflow_id","version_number"),
	CONSTRAINT "workflow_versions_id_format" CHECK ("workflow_versions"."id" ~ '^wfv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_versions_workflow_id_format" CHECK ("workflow_versions"."workflow_id" ~ '^wfl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_versions_status_valid" CHECK ("workflow_versions"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "workflow_versions_number_positive" CHECK ("workflow_versions"."version_number" >= 1),
	CONSTRAINT "workflow_versions_schema_version_positive" CHECK ("workflow_versions"."schema_version" >= 1),
	CONSTRAINT "workflow_versions_lock_version_positive" CHECK ("workflow_versions"."lock_version" >= 1),
	CONSTRAINT "workflow_versions_trigger_type_valid" CHECK ("workflow_versions"."trigger_type" is null or "workflow_versions"."trigger_type" in ('trigger-event', 'trigger-api', 'trigger-schedule', 'trigger-recurring', 'trigger-direct', 'trigger-account', 'trigger-case', 'trigger-verification')),
	CONSTRAINT "workflow_versions_sha256_format" CHECK ("workflow_versions"."definition_sha256" is null or "workflow_versions"."definition_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workflow_versions_published_is_complete" CHECK ("workflow_versions"."status" = 'draft' or (
        "workflow_versions"."published_at" is not null
        and "workflow_versions"."definition_sha256" is not null
        and "workflow_versions"."grant" is not null
        and "workflow_versions"."published_by_type" = 'user'
        and "workflow_versions"."published_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "workflow_versions_last_updater_format" CHECK ("workflow_versions"."last_updater" is null
        or "workflow_versions"."last_updater" ~ '^(usr|key)_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_versions_promoted_from_format" CHECK ("workflow_versions"."promoted_from" is null or "workflow_versions"."promoted_from" ~ '^wfv_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_wait_candidates" (
	"event_id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"event_name" text NOT NULL,
	"subject_ids" text[] NOT NULL,
	"xact" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_wait_candidates_event_id_format" CHECK ("workflow_wait_candidates"."event_id" ~ '^evt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_wait_candidates_event_name_format" CHECK ("workflow_wait_candidates"."event_name" ~ '^[a-z][a-z_-]*(/[a-z][a-z_-]*)?(\.[a-z][a-z_-]*)+$')
);
--> statement-breakpoint
CREATE TABLE "workflow_wait_index" (
	"environment_id" text NOT NULL,
	"event_name" text NOT NULL,
	"workflow_version_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_wait_index_pkey" PRIMARY KEY("environment_id","event_name","workflow_version_id"),
	CONSTRAINT "workflow_wait_index_event_name_format" CHECK ("workflow_wait_index"."event_name" ~ '^[a-z][a-z_-]*(/[a-z][a-z_-]*)?(\.[a-z][a-z_-]*)+$')
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'workflow' NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"paused_reason" text,
	"latest_published_version_id" text,
	"draft_version_id" text,
	"active_deployment_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "workflows_id_format" CHECK ("workflows"."id" ~ '^wfl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflows_kind_valid" CHECK ("workflows"."kind" in ('workflow', 'module')),
	CONSTRAINT "workflows_status_valid" CHECK ("workflows"."status" in ('paused', 'running', 'archived')),
	CONSTRAINT "workflows_paused_reason_valid" CHECK (("workflows"."paused_reason" is null or "workflows"."paused_reason" in ('operator', 'publisher_revoked'))
        and ("workflows"."paused_reason" is null or "workflows"."status" = 'paused')),
	CONSTRAINT "workflows_name_length" CHECK (char_length("workflows"."name") between 1 and 80),
	CONSTRAINT "workflows_description_length" CHECK ("workflows"."description" is null or char_length("workflows"."description") <= 500),
	CONSTRAINT "workflows_archived_at_with_status" CHECK (("workflows"."status" = 'archived') = ("workflows"."archived_at" is not null)),
	CONSTRAINT "workflows_latest_published_version_id_format" CHECK ("workflows"."latest_published_version_id" is null or "workflows"."latest_published_version_id" ~ '^wfv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflows_draft_version_id_format" CHECK ("workflows"."draft_version_id" is null or "workflows"."draft_version_id" ~ '^wfv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflows_active_deployment_id_format" CHECK ("workflows"."active_deployment_id" is null or "workflows"."active_deployment_id" ~ '^wfd_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "inquiry_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"run" jsonb,
	"solely_automated" boolean,
	"human_step" jsonb,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_basis" text,
	"contest_route" jsonb,
	"biometric_basis" text,
	"comment" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"human_review_pending" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"test_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_decisions_id_format" CHECK ("inquiry_decisions"."id" ~ '^idec_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "inquiry_decisions_kind_valid" CHECK ("inquiry_decisions"."kind" in ('approve', 'decline', 'review', 'reopen', 'adverse')),
	CONSTRAINT "inquiry_decisions_subject_type_valid" CHECK ("inquiry_decisions"."subject_type" in ('inquiry', 'list-item', 'transaction', 'account')),
	CONSTRAINT "inquiry_decisions_subject_id_format" CHECK (("inquiry_decisions"."subject_type" = 'inquiry' and "inquiry_decisions"."subject_id" ~ '^inq_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("inquiry_decisions"."subject_type" = 'transaction' and "inquiry_decisions"."subject_id" ~ '^txn_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("inquiry_decisions"."subject_type" = 'account' and "inquiry_decisions"."subject_id" ~ '^acc_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("inquiry_decisions"."subject_type" = 'list-item' and "inquiry_decisions"."subject_id" ~ '^(libf|lidf|lic|liea|lifc|ligl|ligin|liif|liip|lin|lipn|lisb|lis)_[0-9A-HJKMNP-TV-Z]{26}$')
        or "inquiry_decisions"."subject_type" not in ('inquiry', 'transaction', 'account', 'list-item')),
	CONSTRAINT "inquiry_decisions_actor_type_valid" CHECK ("inquiry_decisions"."actor_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "inquiry_decisions_actor_id_format" CHECK (("inquiry_decisions"."actor_type" is distinct from 'user' or "inquiry_decisions"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("inquiry_decisions"."actor_type" is distinct from 'api-key' or "inquiry_decisions"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("inquiry_decisions"."actor_type" is distinct from 'workflow-run' or "inquiry_decisions"."actor_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "inquiry_decisions_decision_basis_valid" CHECK ("inquiry_decisions"."decision_basis" in ('contract', 'law', 'explicit-consent')),
	CONSTRAINT "inquiry_decisions_biometric_basis_valid" CHECK ("inquiry_decisions"."biometric_basis" in ('explicit-consent', 'substantial-public-interest')),
	CONSTRAINT "inquiry_decisions_human_step_is_not_automated" CHECK ("inquiry_decisions"."human_step" is null or "inquiry_decisions"."solely_automated" is false),
	CONSTRAINT "inquiry_decisions_pending_is_reopen" CHECK (not "inquiry_decisions"."human_review_pending" or "inquiry_decisions"."kind" = 'reopen'),
	CONSTRAINT "inquiry_decisions_evidence_array" CHECK (jsonb_typeof("inquiry_decisions"."evidence") = 'array'),
	CONSTRAINT "inquiry_decisions_pending_evidence_array" CHECK (jsonb_typeof("inquiry_decisions"."pending_evidence") = 'array'),
	CONSTRAINT "inquiry_decisions_contest_route_object" CHECK ("inquiry_decisions"."contest_route" is null or jsonb_typeof("inquiry_decisions"."contest_route") = 'object'),
	CONSTRAINT "inquiry_decisions_error_code_format" CHECK ("inquiry_decisions"."error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "inquiry_decisions_test_run_id_format" CHECK ("inquiry_decisions"."test_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_secret_values" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"secret_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"value" text NOT NULL,
	"last4" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_value" text,
	"previous_expires_at" timestamp with time zone,
	"rotated_by" text,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_secret_values_secret_id_environment_id_key" UNIQUE("secret_id","environment_id"),
	CONSTRAINT "workflow_secret_values_id_format" CHECK ("workflow_secret_values"."id" ~ '^wsecv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_secret_values_version_positive" CHECK ("workflow_secret_values"."version" >= 1),
	CONSTRAINT "workflow_secret_values_last4_length" CHECK (char_length("workflow_secret_values"."last4") between 1 and 4),
	CONSTRAINT "workflow_secret_values_previous_whole" CHECK (("workflow_secret_values"."previous_value" is null) = ("workflow_secret_values"."previous_expires_at" is null)),
	CONSTRAINT "workflow_secret_values_rotated_whole" CHECK (("workflow_secret_values"."rotated_by" is null) = ("workflow_secret_values"."rotated_at" is null)),
	CONSTRAINT "workflow_secret_values_rotated_by_format" CHECK ("workflow_secret_values"."rotated_by" is null or "workflow_secret_values"."rotated_by" ~ '^(usr_[0-9A-HJKMNP-TV-Z]{26}|key_[0-9A-HJKMNP-TV-Z]{26})$')
);
--> statement-breakpoint
CREATE TABLE "workflow_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"allowed_hosts" text[] NOT NULL,
	"allowed_placements" jsonb DEFAULT '{"headers":["authorization"],"body-pointers":[]}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_secrets_organization_id_key_key" UNIQUE("organization_id","key"),
	CONSTRAINT "workflow_secrets_organization_id_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "workflow_secrets_id_format" CHECK ("workflow_secrets"."id" ~ '^wsec_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "workflow_secrets_key_format" CHECK ("workflow_secrets"."key" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "workflow_secrets_hosts_present" CHECK (cardinality("workflow_secrets"."allowed_hosts") > 0),
	CONSTRAINT "workflow_secrets_created_by_format" CHECK ("workflow_secrets"."created_by" ~ '^(usr_[0-9A-HJKMNP-TV-Z]{26}|key_[0-9A-HJKMNP-TV-Z]{26})$')
);
--> statement-breakpoint
ALTER TABLE "report_actions" DROP CONSTRAINT "report_actions_actor_valid";--> statement-breakpoint
ALTER TABLE "report_runs" DROP CONSTRAINT "report_runs_trigger_sync_with_list_update";--> statement-breakpoint
ALTER TABLE "list_items" DROP CONSTRAINT "list_items_created_by_type_valid";--> statement-breakpoint
ALTER TABLE "transaction_status_history" DROP CONSTRAINT "transaction_status_history_actor_valid";--> statement-breakpoint
ALTER TABLE "account_types" ADD COLUMN "contest_route" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "workflow_run_step_id" text;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "workflow_run_step_id" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "workflow_run_step_id" text;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "trigger_list_id" text;--> statement-breakpoint
ALTER TABLE "report_runs" ADD COLUMN "trigger_list_version" integer;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "workflow_run_step_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "trusted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "trusted_by_type" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "trusted_by_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "trust_reason" text;--> statement-breakpoint
ALTER TABLE "list_items" ADD COLUMN "workflow_run_step_id" text;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "purpose" text DEFAULT 'block' NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_types" ADD COLUMN "adverse_statuses" text[] DEFAULT '{declined}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_types" ADD COLUMN "contest_route" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewer_type" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reviewer_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "workflow_run_step_id" text;--> statement-breakpoint
ALTER TABLE "graph_queries" ADD COLUMN "workflow_run_step_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "caused_by_run_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "caused_by_principal" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "caused_by_test_run_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "caused_by_bulk_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "caused_by_principal_held_inquiries_write" boolean;--> statement-breakpoint
ALTER TABLE "list_rescreen_requests" ADD CONSTRAINT "list_rescreen_requests_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_rescreen_requests" ADD CONSTRAINT "list_rescreen_requests_list_fk" FOREIGN KEY ("environment_id","list_id") REFERENCES "public"."lists"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_children" ADD CONSTRAINT "transaction_children_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_children" ADD CONSTRAINT "transaction_children_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_account_type_fk" FOREIGN KEY ("environment_id","account_type_id") REFERENCES "public"."account_types"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_runs" ADD CONSTRAINT "scheduled_runs_workflow_fk" FOREIGN KEY ("environment_id","target_workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_deployments" ADD CONSTRAINT "workflow_deployments_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_environment_slots" ADD CONSTRAINT "workflow_environment_slots_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_files" ADD CONSTRAINT "workflow_run_files_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_files" ADD CONSTRAINT "workflow_run_files_run_fk" FOREIGN KEY ("environment_id","run_id") REFERENCES "public"."workflow_runs"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_journal" ADD CONSTRAINT "workflow_run_journal_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_journal" ADD CONSTRAINT "workflow_run_journal_run_fk" FOREIGN KEY ("environment_id","run_id") REFERENCES "public"."workflow_runs"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_steps" ADD CONSTRAINT "workflow_run_steps_run_fk" FOREIGN KEY ("environment_id","run_id") REFERENCES "public"."workflow_runs"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_subjects" ADD CONSTRAINT "workflow_run_subjects_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_subjects" ADD CONSTRAINT "workflow_run_subjects_run_fk" FOREIGN KEY ("environment_id","run_id") REFERENCES "public"."workflow_runs"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_version_fk" FOREIGN KEY ("environment_id","workflow_version_id") REFERENCES "public"."workflow_versions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_schedules" ADD CONSTRAINT "workflow_schedules_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_effects" ADD CONSTRAINT "workflow_step_effects_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_effects" ADD CONSTRAINT "workflow_step_effects_run_fk" FOREIGN KEY ("environment_id","run_id") REFERENCES "public"."workflow_runs"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_step_effects" ADD CONSTRAINT "workflow_step_effects_step_fk" FOREIGN KEY ("environment_id","step_id") REFERENCES "public"."workflow_run_steps"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_trigger_deliveries" ADD CONSTRAINT "workflow_trigger_deliveries_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_trigger_deliveries" ADD CONSTRAINT "workflow_trigger_deliveries_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_version_fk" FOREIGN KEY ("environment_id","workflow_version_id") REFERENCES "public"."workflow_versions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_triggers" ADD CONSTRAINT "workflow_triggers_deployment_fk" FOREIGN KEY ("environment_id","workflow_deployment_id") REFERENCES "public"."workflow_deployments"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_wait_candidates" ADD CONSTRAINT "workflow_wait_candidates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_wait_index" ADD CONSTRAINT "workflow_wait_index_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_wait_index" ADD CONSTRAINT "workflow_wait_index_version_fk" FOREIGN KEY ("environment_id","workflow_version_id") REFERENCES "public"."workflow_versions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_decisions" ADD CONSTRAINT "inquiry_decisions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_secret_values" ADD CONSTRAINT "workflow_secret_values_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_secret_values" ADD CONSTRAINT "workflow_secret_values_secret_fk" FOREIGN KEY ("organization_id","secret_id") REFERENCES "public"."workflow_secrets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_secret_values" ADD CONSTRAINT "workflow_secret_values_environment_fk" FOREIGN KEY ("organization_id","environment_id") REFERENCES "public"."environments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_secrets" ADD CONSTRAINT "workflow_secrets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_rescreen_requests_unprocessed_idx" ON "list_rescreen_requests" USING btree ("created_at") WHERE "list_rescreen_requests"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "transaction_children_child_idx" ON "transaction_children" USING btree ("environment_id","child_id");--> statement-breakpoint
CREATE INDEX "account_actions_environment_created_at_id_idx" ON "account_actions" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "account_actions_account_type_idx" ON "account_actions" USING btree ("environment_id","account_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_runs_workflow_run_step_key" ON "scheduled_runs" USING btree ("environment_id","workflow_run_step_id") WHERE "scheduled_runs"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE INDEX "scheduled_runs_due_idx" ON "scheduled_runs" USING btree ("fire_at") WHERE "scheduled_runs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "scheduled_runs_pending_subject_idx" ON "scheduled_runs" USING btree ("environment_id","subject_id") WHERE "scheduled_runs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "scheduled_runs_pending_workflow_idx" ON "scheduled_runs" USING btree ("environment_id","target_workflow_id") WHERE "scheduled_runs"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_deployments_one_active_idx" ON "workflow_deployments" USING btree ("workflow_id") WHERE "workflow_deployments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "workflow_deployments_workflow_created_at_id_idx" ON "workflow_deployments" USING btree ("environment_id","workflow_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_environment_slots_rotation_idx" ON "workflow_environment_slots" USING btree ("last_served_at" NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_run_files_run_idx" ON "workflow_run_files" USING btree ("environment_id","run_id");--> statement-breakpoint
CREATE INDEX "workflow_run_files_undeleted_idx" ON "workflow_run_files" USING btree ("redacted_at") WHERE "workflow_run_files"."redacted_at" is not null and "workflow_run_files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_run_journal_run_idx" ON "workflow_run_journal" USING btree ("environment_id","run_id","id");--> statement-breakpoint
CREATE INDEX "workflow_run_steps_run_created_at_id_idx" ON "workflow_run_steps" USING btree ("environment_id","run_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_run_steps_ready_idx" ON "workflow_run_steps" USING btree ("environment_id","due_at") WHERE "workflow_run_steps"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "workflow_run_steps_running_idx" ON "workflow_run_steps" USING btree ("environment_id","claimed_until") WHERE "workflow_run_steps"."status" = 'running';--> statement-breakpoint
CREATE INDEX "workflow_run_steps_waiting_timeout_idx" ON "workflow_run_steps" USING btree ("timeout_at") WHERE "workflow_run_steps"."status" = 'waiting' and "workflow_run_steps"."timeout_at" is not null;--> statement-breakpoint
CREATE INDEX "workflow_run_steps_waiting_due_idx" ON "workflow_run_steps" USING btree ("due_at") WHERE "workflow_run_steps"."status" = 'waiting' and "workflow_run_steps"."due_at" is not null;--> statement-breakpoint
CREATE INDEX "workflow_run_steps_waiting_key_idx" ON "workflow_run_steps" USING btree ("environment_id","wait_correlation_key") WHERE "workflow_run_steps"."status" = 'waiting' and "workflow_run_steps"."wait_correlation_key" is not null;--> statement-breakpoint
CREATE INDEX "workflow_run_subjects_subject_idx" ON "workflow_run_subjects" USING btree ("environment_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_workflow_run_step_key" ON "workflow_runs" USING btree ("environment_id","workflow_run_step_id") WHERE "workflow_runs"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_runs_environment_created_at_id_idx" ON "workflow_runs" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_created_at_id_idx" ON "workflow_runs" USING btree ("environment_id","workflow_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_runs_version_created_at_id_idx" ON "workflow_runs" USING btree ("environment_id","workflow_version_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_runs_parent_idx" ON "workflow_runs" USING btree ("environment_id","parent_run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_root_idx" ON "workflow_runs" USING btree ("environment_id","root_run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_unfinished_idx" ON "workflow_runs" USING btree ("deadline_at") WHERE "workflow_runs"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "workflow_runs_values_due_idx" ON "workflow_runs" USING btree ("completed_at") WHERE "workflow_runs"."completed_at" is not null and "workflow_runs"."values_purged_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_runs_skeleton_due_idx" ON "workflow_runs" USING btree ("completed_at") WHERE "workflow_runs"."completed_at" is not null;--> statement-breakpoint
CREATE INDEX "workflow_runs_overflow_idx" ON "workflow_runs" USING btree ("environment_id") WHERE "workflow_runs"."subjects_overflow" and "workflow_runs"."values_purged_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_schedules_due_idx" ON "workflow_schedules" USING btree ("next_fire_at");--> statement-breakpoint
CREATE INDEX "workflow_step_effects_run_idx" ON "workflow_step_effects" USING btree ("environment_id","run_id");--> statement-breakpoint
CREATE INDEX "workflow_step_effects_copies_idx" ON "workflow_step_effects" USING gin ("copy_source_subject_ids") WHERE "workflow_step_effects"."copy_target_id" is not null;--> statement-breakpoint
CREATE INDEX "workflow_trigger_deliveries_environment_created_at_id_idx" ON "workflow_trigger_deliveries" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_trigger_deliveries_workflow_created_at_id_idx" ON "workflow_trigger_deliveries" USING btree ("environment_id","workflow_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_trigger_deliveries_pending_idx" ON "workflow_trigger_deliveries" USING btree ("not_before","created_at") WHERE "workflow_trigger_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "workflow_trigger_deliveries_pending_event_idx" ON "workflow_trigger_deliveries" USING btree ("event_id") WHERE "workflow_trigger_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "workflow_trigger_deliveries_run_idx" ON "workflow_trigger_deliveries" USING btree ("environment_id","workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_triggers_lookup_idx" ON "workflow_triggers" USING btree ("environment_id","kind","event_name");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_versions_one_draft_idx" ON "workflow_versions" USING btree ("workflow_id") WHERE "workflow_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "workflow_versions_workflow_number_idx" ON "workflow_versions" USING btree ("environment_id","workflow_id","version_number" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflow_wait_candidates_unprocessed_idx" ON "workflow_wait_candidates" USING btree ("created_at") WHERE "workflow_wait_candidates"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "workflow_wait_candidates_processed_idx" ON "workflow_wait_candidates" USING btree ("processed_at") WHERE "workflow_wait_candidates"."processed_at" is not null;--> statement-breakpoint
CREATE INDEX "workflow_wait_candidates_event_idx" ON "workflow_wait_candidates" USING btree ("environment_id","event_name");--> statement-breakpoint
CREATE INDEX "workflow_wait_candidates_subjects_idx" ON "workflow_wait_candidates" USING gin ("subject_ids");--> statement-breakpoint
CREATE INDEX "workflows_environment_id_created_at_id_idx" ON "workflows" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "workflows_running_idx" ON "workflows" USING btree ("environment_id") WHERE "workflows"."status" = 'running';--> statement-breakpoint
CREATE INDEX "inquiry_decisions_subject_created_at_idx" ON "inquiry_decisions" USING btree ("environment_id","subject_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiry_decisions_needs_review_idx" ON "inquiry_decisions" USING btree ("environment_id","created_at" DESC NULLS FIRST) WHERE "inquiry_decisions"."needs_review";--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_decisions_one_review_pending_idx" ON "inquiry_decisions" USING btree ("environment_id","subject_id") WHERE "inquiry_decisions"."human_review_pending";--> statement-breakpoint
CREATE INDEX "workflow_secret_values_environment_id_idx" ON "workflow_secret_values" USING btree ("environment_id");--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_trigger_list_fk" FOREIGN KEY ("environment_id","trigger_list_id") REFERENCES "public"."lists"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_workflow_run_step_key" ON "accounts" USING btree ("environment_id","workflow_run_step_id") WHERE "accounts"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inquiries_workflow_run_step_key" ON "inquiries" USING btree ("environment_id","workflow_run_step_id") WHERE "inquiries"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_workflow_run_step_key" ON "verifications" USING btree ("environment_id","workflow_run_step_id") WHERE "verifications"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "report_runs_report_id_trigger_list_key" ON "report_runs" USING btree ("report_id","trigger_list_id","trigger_list_version") WHERE "report_runs"."trigger_list_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_workflow_run_step_key" ON "reports" USING btree ("environment_id","workflow_run_step_id") WHERE "reports"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "list_items_workflow_run_step_key" ON "list_items" USING btree ("environment_id","workflow_run_step_id") WHERE "list_items"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_workflow_run_step_key" ON "transactions" USING btree ("environment_id","workflow_run_step_id") WHERE "transactions"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_queries_workflow_run_step_key" ON "graph_queries" USING btree ("environment_id","workflow_run_step_id") WHERE "graph_queries"."workflow_run_step_id" is not null;--> statement-breakpoint
ALTER TABLE "account_types" ADD CONSTRAINT "account_types_contest_route_object" CHECK ("account_types"."contest_route" is null or jsonb_typeof("account_types"."contest_route") = 'object');--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workflow_run_step_id_format" CHECK ("accounts"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_workflow_run_step_id_format" CHECK ("inquiries"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_workflow_run_step_id_format" CHECK ("verifications"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "report_actions" ADD CONSTRAINT "report_actions_actor_valid" CHECK (("report_actions"."actor_type" = 'system' and "report_actions"."actor_id" is null)
        or ("report_actions"."actor_type" = 'user' and "report_actions"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("report_actions"."actor_type" = 'api_key' and "report_actions"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("report_actions"."actor_type"::text = 'workflow_run' and "report_actions"."actor_id" is not null
          and "report_actions"."actor_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'));--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_trigger_sync_with_list_update" CHECK (("report_runs"."run_type" = 'list_update') =
          ("report_runs"."trigger_sync_id" is not null or "report_runs"."trigger_list_id" is not null
           or "report_runs"."trigger_list_version" is not null)
        and ("report_runs"."trigger_sync_id" is null or "report_runs"."trigger_list_id" is null)
        and ("report_runs"."trigger_list_id" is null) = ("report_runs"."trigger_list_version" is null));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_workflow_run_step_id_format" CHECK ("reports"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_trust_is_whole" CHECK (("devices"."trusted_at" is null) = ("devices"."trusted_by_type" is null)
        and ("devices"."trusted_at" is null) = ("devices"."trusted_by_id" is null)
        and ("devices"."trusted_at" is null) = ("devices"."trust_reason" is null));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_trusted_by_type_valid" CHECK ("devices"."trusted_by_type" in ('user', 'api-key', 'workflow-run'));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_trusted_by_id_format" CHECK (("devices"."trusted_by_type" is distinct from 'user' or "devices"."trusted_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("devices"."trusted_by_type" is distinct from 'api-key' or "devices"."trusted_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("devices"."trusted_by_type" is distinct from 'workflow-run' or "devices"."trusted_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'));--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_trust_reason_format" CHECK ("devices"."trust_reason" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_workflow_run_step_id_format" CHECK ("list_items"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_created_by_type_valid" CHECK ("list_items"."created_by_type" in ('user', 'api-key', 'importer', 'workflow-run'));--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_purpose_valid" CHECK ("lists"."purpose" in ('block', 'allow', 'watch'));--> statement-breakpoint
ALTER TABLE "transaction_status_history" ADD CONSTRAINT "transaction_status_history_actor_valid" CHECK (("transaction_status_history"."actor_type" = 'system' and "transaction_status_history"."actor_id" is null)
        or ("transaction_status_history"."actor_type" = 'user' and "transaction_status_history"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_status_history"."actor_type" = 'api_key' and "transaction_status_history"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_status_history"."actor_type"::text = 'workflow_run' and "transaction_status_history"."actor_id" is not null
          and "transaction_status_history"."actor_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'));--> statement-breakpoint
ALTER TABLE "transaction_types" ADD CONSTRAINT "transaction_types_contest_route_object" CHECK ("transaction_types"."contest_route" is null or jsonb_typeof("transaction_types"."contest_route") = 'object');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workflow_run_step_id_format" CHECK ("transactions"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reviewer_is_whole" CHECK (("transactions"."reviewer_type" is null) = ("transactions"."reviewer_id" is null));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reviewer_type_valid" CHECK ("transactions"."reviewer_type" in ('user', 'api-key', 'workflow-run'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reviewer_id_format" CHECK (("transactions"."reviewer_type" is distinct from 'user' or "transactions"."reviewer_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("transactions"."reviewer_type" is distinct from 'api-key' or "transactions"."reviewer_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("transactions"."reviewer_type" is distinct from 'workflow-run' or "transactions"."reviewer_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'));--> statement-breakpoint
ALTER TABLE "graph_queries" ADD CONSTRAINT "graph_queries_workflow_run_step_id_format" CHECK ("graph_queries"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_caused_by_run_id_format" CHECK ("events"."caused_by_run_id" is null
        or "events"."caused_by_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_caused_by_principal_format" CHECK ("events"."caused_by_principal" is null
        or "events"."caused_by_principal" ~ '^(usr|key)_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_caused_by_test_run_id_format" CHECK ("events"."caused_by_test_run_id" is null
        or "events"."caused_by_test_run_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
CREATE TRIGGER "workflows_set_updated_at" BEFORE UPDATE ON "workflows" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_versions_set_updated_at" BEFORE UPDATE ON "workflow_versions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_deployments_set_updated_at" BEFORE UPDATE ON "workflow_deployments" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_trigger_deliveries_set_updated_at" BEFORE UPDATE ON "workflow_trigger_deliveries" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_runs_set_updated_at" BEFORE UPDATE ON "workflow_runs" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_run_steps_set_updated_at" BEFORE UPDATE ON "workflow_run_steps" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_step_effects_set_updated_at" BEFORE UPDATE ON "workflow_step_effects" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_run_files_set_updated_at" BEFORE UPDATE ON "workflow_run_files" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_schedules_set_updated_at" BEFORE UPDATE ON "workflow_schedules" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "scheduled_runs_set_updated_at" BEFORE UPDATE ON "scheduled_runs" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "inquiry_decisions_set_updated_at" BEFORE UPDATE ON "inquiry_decisions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "account_actions_set_updated_at" BEFORE UPDATE ON "account_actions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_environment_slots_set_updated_at" BEFORE UPDATE ON "workflow_environment_slots" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_secrets_set_updated_at" BEFORE UPDATE ON "workflow_secrets" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "workflow_secret_values_set_updated_at" BEFORE UPDATE ON "workflow_secret_values" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
-- Hand edit (C117.2, F12): the run journal is append-only. An UPDATE is always refused. A DELETE is
-- refused unless the transaction deletes an environment (`openverify.environment_deletion = 'on'`)
-- or is the C16 pass deleting a run's skeleton (`openverify.retention = 'on'`, transaction-local,
-- set only by that pass). The journal holds no sealed value, so a KEK rewrap has no case here.
CREATE OR REPLACE FUNCTION "openverify_workflow_run_journal_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (
    coalesce(current_setting('openverify.environment_deletion', true), '') = 'on'
    OR coalesce(current_setting('openverify.retention', true), '') = 'on'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workflow_run_journal_append_only" BEFORE UPDATE OR DELETE ON "workflow_run_journal" FOR EACH ROW EXECUTE FUNCTION "openverify_workflow_run_journal_append_only"();--> statement-breakpoint
-- Hand edit (C117.2; engine note 2.4): the steps table churns, and at the default scale factor
-- 212,000 steps left 365,433 dead tuples after one autovacuum run. Provisional.
ALTER TABLE "workflow_run_steps" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
