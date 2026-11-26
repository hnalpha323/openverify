ALTER TYPE "public"."report_origin" ADD VALUE 'bulk';--> statement-breakpoint
CREATE TABLE "transaction_filter_values" (
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"field_key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "transaction_filter_values_pkey" PRIMARY KEY("environment_id","transaction_id","field_key","value"),
	CONSTRAINT "transaction_filter_values_field_key_format" CHECK ("transaction_filter_values"."field_key" ~ '^[a-z0-9][a-z0-9_-]*$'
      and char_length("transaction_filter_values"."field_key") <= 64),
	CONSTRAINT "transaction_filter_values_value_length" CHECK (char_length("transaction_filter_values"."value") between 1 and 1024)
);
--> statement-breakpoint
CREATE TABLE "case_checklist_states" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"checklist_key" text NOT NULL,
	"item_key" text NOT NULL,
	"checked" boolean NOT NULL,
	"checked_by_type" text,
	"checked_by_id" text,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_checklist_states_pkey" PRIMARY KEY("environment_id","case_id","checklist_key","item_key"),
	CONSTRAINT "case_checklist_states_checklist_key_format" CHECK ("case_checklist_states"."checklist_key" ~ '^[a-z][a-z0-9-]{0,39}$'),
	CONSTRAINT "case_checklist_states_item_key_format" CHECK ("case_checklist_states"."item_key" ~ '^[a-z][a-z0-9-]{0,39}$'),
	CONSTRAINT "case_checklist_states_checked_whole" CHECK ("case_checklist_states"."checked" = ("case_checklist_states"."checked_by_type" is not null)
        and "case_checklist_states"."checked" = ("case_checklist_states"."checked_at" is not null)),
	CONSTRAINT "case_checklist_states_checked_by_is_whole" CHECK (("case_checklist_states"."checked_by_type" is null) = ("case_checklist_states"."checked_by_id" is null)),
	CONSTRAINT "case_checklist_states_checked_by_type_valid" CHECK ("case_checklist_states"."checked_by_type" in ('user', 'workflow-run')),
	CONSTRAINT "case_checklist_states_checked_by_id_format" CHECK (("case_checklist_states"."checked_by_type" is distinct from 'user'
            or "case_checklist_states"."checked_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_checklist_states"."checked_by_type" is distinct from 'workflow-run'
            or "case_checklist_states"."checked_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'))
);
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"creator_type" text NOT NULL,
	"creator_id" text NOT NULL,
	"object_type" text NOT NULL,
	"format" text NOT NULL,
	"include_personal_data" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request" text,
	"filter_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"saved_view_id" text,
	"row_count" integer,
	"byte_size" integer,
	"error_code" text,
	"storage_key" text,
	"wrapped_dek" text,
	"cut_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exports_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "exports_id_format" CHECK ("exports"."id" ~ '^exp_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "exports_creator_type_valid" CHECK ("exports"."creator_type" in ('user', 'api-key')),
	CONSTRAINT "exports_creator_id_format" CHECK (("exports"."creator_type" is distinct from 'user' or "exports"."creator_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        and ("exports"."creator_type" is distinct from 'api-key'
          or "exports"."creator_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "exports_object_type_valid" CHECK ("exports"."object_type" in ('inquiries', 'verifications', 'accounts', 'reports', 'lists', 'transactions')),
	CONSTRAINT "exports_format_valid" CHECK ("exports"."format" in ('csv')),
	CONSTRAINT "exports_status_valid" CHECK ("exports"."status" in ('pending', 'running', 'completed', 'failed', 'expired')),
	CONSTRAINT "exports_saved_view_id_format" CHECK ("exports"."saved_view_id" ~ '^svw_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "exports_filter_keys_size" CHECK (coalesce(array_length("exports"."filter_keys", 1), 0) <= 100
        and array_position("exports"."filter_keys", null) is null),
	CONSTRAINT "exports_request_until_finished" CHECK (("exports"."request" is not null) = ("exports"."status" in ('pending', 'running'))),
	CONSTRAINT "exports_finished_with_times" CHECK (("exports"."status" in ('completed', 'expired')) = ("exports"."completed_at" is not null
        and "exports"."expires_at" is not null and "exports"."cut_at" is not null
        and "exports"."row_count" is not null)),
	CONSTRAINT "exports_file_while_completed" CHECK (("exports"."status" = 'completed') = ("exports"."storage_key" is not null)
        and ("exports"."storage_key" is null) = ("exports"."wrapped_dek" is null)),
	CONSTRAINT "exports_size_while_completed" CHECK (("exports"."status" = 'completed') = ("exports"."byte_size" is not null)),
	CONSTRAINT "exports_error_when_failed" CHECK (("exports"."status" = 'failed') = ("exports"."error_code" is not null)
        and ("exports"."error_code" is null or "exports"."error_code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$')),
	CONSTRAINT "exports_counts" CHECK (("exports"."row_count" is null
          or "exports"."row_count" between 0 and 50000)
        and ("exports"."byte_size" is null or "exports"."byte_size" >= 0)),
	CONSTRAINT "exports_wrapped_dek_format" CHECK ("exports"."wrapped_dek" is null or "exports"."wrapped_dek" ~ '^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}$')
);
--> statement-breakpoint
CREATE TABLE "report_bulk_job_rows" (
	"environment_id" text NOT NULL,
	"job_id" text NOT NULL,
	"row_number" integer NOT NULL,
	"outcome" text NOT NULL,
	"report_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_bulk_job_rows_pkey" PRIMARY KEY("environment_id","job_id","row_number"),
	CONSTRAINT "report_bulk_job_rows_row_number_range" CHECK ("report_bulk_job_rows"."row_number" between 1 and 1000),
	CONSTRAINT "report_bulk_job_rows_outcome_valid" CHECK ("report_bulk_job_rows"."outcome" in ('created', 'failed')),
	CONSTRAINT "report_bulk_job_rows_report_id_format" CHECK ("report_bulk_job_rows"."report_id" ~ '^rep_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "report_bulk_job_rows_created_names_report" CHECK (("report_bulk_job_rows"."outcome" = 'created') = ("report_bulk_job_rows"."report_id" is not null)),
	CONSTRAINT "report_bulk_job_rows_failed_has_code" CHECK (("report_bulk_job_rows"."outcome" = 'failed') = ("report_bulk_job_rows"."error_code" is not null)),
	CONSTRAINT "report_bulk_job_rows_error_code_format" CHECK ("report_bulk_job_rows"."error_code" is null or "report_bulk_job_rows"."error_code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "report_bulk_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"creator_type" text NOT NULL,
	"creator_id" text NOT NULL,
	"report_template_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"row_count" integer,
	"error_code" text,
	"storage_key" text,
	"wrapped_dek" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_bulk_jobs_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "report_bulk_jobs_id_format" CHECK ("report_bulk_jobs"."id" ~ '^rbulk_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "report_bulk_jobs_creator_type_valid" CHECK ("report_bulk_jobs"."creator_type" in ('user', 'api-key')),
	CONSTRAINT "report_bulk_jobs_creator_id_format" CHECK (("report_bulk_jobs"."creator_type" is distinct from 'user' or "report_bulk_jobs"."creator_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        and ("report_bulk_jobs"."creator_type" is distinct from 'api-key'
          or "report_bulk_jobs"."creator_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "report_bulk_jobs_report_template_id_format" CHECK ("report_bulk_jobs"."report_template_id" ~ '^rptp_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "report_bulk_jobs_status_valid" CHECK ("report_bulk_jobs"."status" in ('pending', 'running', 'completed', 'failed')),
	CONSTRAINT "report_bulk_jobs_ended_with_time" CHECK (("report_bulk_jobs"."status" in ('completed', 'failed')) = ("report_bulk_jobs"."completed_at" is not null)),
	CONSTRAINT "report_bulk_jobs_error_when_failed" CHECK (("report_bulk_jobs"."error_code" is null or "report_bulk_jobs"."status" = 'failed')
        and ("report_bulk_jobs"."error_code" is null or "report_bulk_jobs"."error_code" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$')),
	CONSTRAINT "report_bulk_jobs_file_whole" CHECK (("report_bulk_jobs"."storage_key" is null) = ("report_bulk_jobs"."wrapped_dek" is null)),
	CONSTRAINT "report_bulk_jobs_row_count_range" CHECK ("report_bulk_jobs"."row_count" is null
        or "report_bulk_jobs"."row_count" between 0 and 1000),
	CONSTRAINT "report_bulk_jobs_wrapped_dek_format" CHECK ("report_bulk_jobs"."wrapped_dek" is null or "report_bulk_jobs"."wrapped_dek" ~ '^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}$')
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"list" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort" text,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "saved_views_id_format" CHECK ("saved_views"."id" ~ '^svw_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "saved_views_list_valid" CHECK ("saved_views"."list" in ('inquiries', 'accounts', 'reports', 'cases', 'transactions', 'api-logs', 'webhook-deliveries', 'events', 'audit-logs')),
	CONSTRAINT "saved_views_name_length" CHECK (char_length("saved_views"."name") between 1 and 100),
	CONSTRAINT "saved_views_filters_object" CHECK (jsonb_typeof("saved_views"."filters") = 'object'),
	CONSTRAINT "saved_views_columns_size" CHECK (coalesce(array_length("saved_views"."columns", 1), 0) <= 50
        and array_position("saved_views"."columns", null) is null),
	CONSTRAINT "saved_views_sort_length" CHECK ("saved_views"."sort" is null or char_length("saved_views"."sort") between 1 and 65)
);
--> statement-breakpoint
CREATE TABLE "webhook_alert_emails" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_alert_emails_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"webhook_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_alert_emails_attempts_range" CHECK ("webhook_alert_emails"."attempts" between 0 and 3 and ("webhook_alert_emails"."attempts" = 0) = ("webhook_alert_emails"."claimed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "audit_log_ip_index" (
	"audit_log_id" bigint PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"ip_hmac" text NOT NULL,
	CONSTRAINT "audit_log_ip_index_ip_hmac_hex" CHECK ("audit_log_ip_index"."ip_hmac" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "analytics_case_assignee_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"case_template_id" text NOT NULL,
	"user_id" text,
	"assigned" integer DEFAULT 0 NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_case_assignee_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","case_template_id","user_id"),
	CONSTRAINT "analytics_case_assignee_daily_source_valid" CHECK ("analytics_case_assignee_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_case_assignee_daily_time_zone_length" CHECK (char_length("analytics_case_assignee_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_case_assignee_daily_case_template_id_format" CHECK ("analytics_case_assignee_daily"."case_template_id" ~ '^ctmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_case_assignee_daily_user_id_format" CHECK ("analytics_case_assignee_daily"."user_id" is null or "analytics_case_assignee_daily"."user_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_case_assignee_daily_counts_nonnegative" CHECK ("analytics_case_assignee_daily"."assigned" >= 0 and "analytics_case_assignee_daily"."resolved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_case_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"case_template_id" text NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"resolved" integer DEFAULT 0 NOT NULL,
	"sla_met" integer DEFAULT 0 NOT NULL,
	"sla_missed" integer DEFAULT 0 NOT NULL,
	"resolution_seconds_histogram" integer[] NOT NULL,
	CONSTRAINT "analytics_case_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","case_template_id"),
	CONSTRAINT "analytics_case_daily_source_valid" CHECK ("analytics_case_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_case_daily_time_zone_length" CHECK (char_length("analytics_case_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_case_daily_case_template_id_format" CHECK ("analytics_case_daily"."case_template_id" ~ '^ctmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_case_daily_counts_nonnegative" CHECK ("analytics_case_daily"."created" >= 0 and "analytics_case_daily"."resolved" >= 0 and "analytics_case_daily"."sla_met" >= 0 and "analytics_case_daily"."sla_missed" >= 0),
	CONSTRAINT "analytics_case_daily_histogram_shape" CHECK (cardinality("analytics_case_daily"."resolution_seconds_histogram") = 40 and 0 <= all("analytics_case_daily"."resolution_seconds_histogram"))
);
--> statement-breakpoint
CREATE TABLE "analytics_check_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"verification_type" "verification_type" NOT NULL,
	"check_name" text NOT NULL,
	"requirement" "check_requirement" NOT NULL,
	"status" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_check_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","verification_type","check_name","requirement","status"),
	CONSTRAINT "analytics_check_daily_source_valid" CHECK ("analytics_check_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_check_daily_time_zone_length" CHECK (char_length("analytics_check_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_check_daily_inquiry_template_id_format" CHECK ("analytics_check_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_check_daily_inquiry_template_version_id_format" CHECK ("analytics_check_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_check_daily_check_name_snake_case" CHECK ("analytics_check_daily"."check_name" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
	CONSTRAINT "analytics_check_daily_status_valid" CHECK ("analytics_check_daily"."status" in ('passed', 'failed', 'not_applicable', 'errored', 'not_configured', 'pending')),
	CONSTRAINT "analytics_check_daily_counts_nonnegative" CHECK ("analytics_check_daily"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_check_reason_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"check_name" text NOT NULL,
	"reason" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_check_reason_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","check_name","reason"),
	CONSTRAINT "analytics_check_reason_daily_source_valid" CHECK ("analytics_check_reason_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_check_reason_daily_time_zone_length" CHECK (char_length("analytics_check_reason_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_check_reason_daily_inquiry_template_id_format" CHECK ("analytics_check_reason_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_check_reason_daily_inquiry_template_version_id_format" CHECK ("analytics_check_reason_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_check_reason_daily_check_name_snake_case" CHECK ("analytics_check_reason_daily"."check_name" ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
	CONSTRAINT "analytics_check_reason_daily_reason_length" CHECK (char_length("analytics_check_reason_daily"."reason") between 1 and 128),
	CONSTRAINT "analytics_check_reason_daily_counts_nonnegative" CHECK ("analytics_check_reason_daily"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_inquiry_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"platform" text,
	"device_kind" text,
	"created" integer DEFAULT 0 NOT NULL,
	"started" integer DEFAULT 0 NOT NULL,
	"interacted" integer DEFAULT 0 NOT NULL,
	"finished" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"completed_verified" integer DEFAULT 0 NOT NULL,
	"completed_with_fallback" integer DEFAULT 0 NOT NULL,
	"completed_unverified" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"expired_before_start" integer DEFAULT 0 NOT NULL,
	"expired_after_start" integer DEFAULT 0 NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"declined" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"marked_for_review" integer DEFAULT 0 NOT NULL,
	"decided_automatic" integer DEFAULT 0 NOT NULL,
	"decided_manual" integer DEFAULT 0 NOT NULL,
	"decided_not_declared" integer DEFAULT 0 NOT NULL,
	"finish_seconds_histogram" integer[] NOT NULL,
	CONSTRAINT "analytics_inquiry_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","platform","device_kind"),
	CONSTRAINT "analytics_inquiry_daily_source_valid" CHECK ("analytics_inquiry_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_inquiry_daily_time_zone_length" CHECK (char_length("analytics_inquiry_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_inquiry_daily_inquiry_template_id_format" CHECK ("analytics_inquiry_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_inquiry_daily_inquiry_template_version_id_format" CHECK ("analytics_inquiry_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_inquiry_daily_platform_valid" CHECK ("analytics_inquiry_daily"."platform" is null or "analytics_inquiry_daily"."platform" in ('web', 'android')),
	CONSTRAINT "analytics_inquiry_daily_device_kind_valid" CHECK ("analytics_inquiry_daily"."device_kind" is null or "analytics_inquiry_daily"."device_kind" in ('desktop-web', 'mobile-web', 'native')),
	CONSTRAINT "analytics_inquiry_daily_counts_nonnegative" CHECK ("analytics_inquiry_daily"."created" >= 0 and "analytics_inquiry_daily"."started" >= 0 and "analytics_inquiry_daily"."interacted" >= 0 and "analytics_inquiry_daily"."finished" >= 0 and "analytics_inquiry_daily"."completed" >= 0 and "analytics_inquiry_daily"."completed_verified" >= 0 and "analytics_inquiry_daily"."completed_with_fallback" >= 0 and "analytics_inquiry_daily"."completed_unverified" >= 0 and "analytics_inquiry_daily"."failed" >= 0 and "analytics_inquiry_daily"."expired_before_start" >= 0 and "analytics_inquiry_daily"."expired_after_start" >= 0 and "analytics_inquiry_daily"."approved" >= 0 and "analytics_inquiry_daily"."declined" >= 0 and "analytics_inquiry_daily"."needs_review" >= 0 and "analytics_inquiry_daily"."marked_for_review" >= 0 and "analytics_inquiry_daily"."decided_automatic" >= 0 and "analytics_inquiry_daily"."decided_manual" >= 0 and "analytics_inquiry_daily"."decided_not_declared" >= 0),
	CONSTRAINT "analytics_inquiry_daily_histogram_shape" CHECK (cardinality("analytics_inquiry_daily"."finish_seconds_histogram") = 40 and 0 <= all("analytics_inquiry_daily"."finish_seconds_histogram"))
);
--> statement-breakpoint
CREATE TABLE "analytics_inquiry_tag_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"platform" text,
	"device_kind" text,
	"tag" text NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"finished" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_inquiry_tag_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","platform","device_kind","tag"),
	CONSTRAINT "analytics_inquiry_tag_daily_source_valid" CHECK ("analytics_inquiry_tag_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_inquiry_tag_daily_time_zone_length" CHECK (char_length("analytics_inquiry_tag_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_inquiry_tag_daily_inquiry_template_id_format" CHECK ("analytics_inquiry_tag_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_inquiry_tag_daily_inquiry_template_version_id_format" CHECK ("analytics_inquiry_tag_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_inquiry_tag_daily_platform_valid" CHECK ("analytics_inquiry_tag_daily"."platform" is null or "analytics_inquiry_tag_daily"."platform" in ('web', 'android')),
	CONSTRAINT "analytics_inquiry_tag_daily_device_kind_valid" CHECK ("analytics_inquiry_tag_daily"."device_kind" is null or "analytics_inquiry_tag_daily"."device_kind" in ('desktop-web', 'mobile-web', 'native')),
	CONSTRAINT "analytics_inquiry_tag_daily_tag_length" CHECK (char_length("analytics_inquiry_tag_daily"."tag") between 1 and 64),
	CONSTRAINT "analytics_inquiry_tag_daily_counts_nonnegative" CHECK ("analytics_inquiry_tag_daily"."created" >= 0 and "analytics_inquiry_tag_daily"."finished" >= 0 and "analytics_inquiry_tag_daily"."completed" >= 0 and "analytics_inquiry_tag_daily"."failed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_path_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"path_sha256" text NOT NULL,
	"step_ids" text[] NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_path_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","path_sha256"),
	CONSTRAINT "analytics_path_daily_source_valid" CHECK ("analytics_path_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_path_daily_time_zone_length" CHECK (char_length("analytics_path_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_path_daily_inquiry_template_id_format" CHECK ("analytics_path_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_path_daily_inquiry_template_version_id_format" CHECK ("analytics_path_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_path_daily_path_sha256_format" CHECK ("analytics_path_daily"."path_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "analytics_path_daily_step_ids_present" CHECK (cardinality("analytics_path_daily"."step_ids") >= 1),
	CONSTRAINT "analytics_path_daily_counts_nonnegative" CHECK ("analytics_path_daily"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_rollup_state" (
	"environment_id" text PRIMARY KEY NOT NULL,
	"rolled_up_through" timestamp with time zone,
	"outcomes_as_of" timestamp with time zone,
	"time_zone" text,
	"step_data_from" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_rollup_state_time_zone_length" CHECK ("analytics_rollup_state"."time_zone" is null or char_length("analytics_rollup_state"."time_zone") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "analytics_signal_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"platform" text,
	"device_kind" text,
	"signal_name" text NOT NULL,
	"bin" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_signal_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","platform","device_kind","signal_name","bin"),
	CONSTRAINT "analytics_signal_daily_source_valid" CHECK ("analytics_signal_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_signal_daily_time_zone_length" CHECK (char_length("analytics_signal_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_signal_daily_inquiry_template_id_format" CHECK ("analytics_signal_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_signal_daily_inquiry_template_version_id_format" CHECK ("analytics_signal_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_signal_daily_platform_valid" CHECK ("analytics_signal_daily"."platform" is null or "analytics_signal_daily"."platform" in ('web', 'android')),
	CONSTRAINT "analytics_signal_daily_device_kind_valid" CHECK ("analytics_signal_daily"."device_kind" is null or "analytics_signal_daily"."device_kind" in ('desktop-web', 'mobile-web', 'native')),
	CONSTRAINT "analytics_signal_daily_signal_name_length" CHECK (char_length("analytics_signal_daily"."signal_name") between 1 and 128),
	CONSTRAINT "analytics_signal_daily_bin_length" CHECK (char_length("analytics_signal_daily"."bin") between 1 and 32),
	CONSTRAINT "analytics_signal_daily_counts_nonnegative" CHECK ("analytics_signal_daily"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_step_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"step_id" text NOT NULL,
	"entered" integer DEFAULT 0 NOT NULL,
	"exited" integer DEFAULT 0 NOT NULL,
	"revisits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_step_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","step_id"),
	CONSTRAINT "analytics_step_daily_source_valid" CHECK ("analytics_step_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_step_daily_time_zone_length" CHECK (char_length("analytics_step_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_step_daily_inquiry_template_id_format" CHECK ("analytics_step_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_step_daily_inquiry_template_version_id_format" CHECK ("analytics_step_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_step_daily_step_id_format" CHECK ("analytics_step_daily"."step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "analytics_step_daily_counts_nonnegative" CHECK ("analytics_step_daily"."entered" >= 0 and "analytics_step_daily"."exited" >= 0 and "analytics_step_daily"."revisits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_transition_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"from_step_id" text NOT NULL,
	"to_step_id" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_transition_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","from_step_id","to_step_id"),
	CONSTRAINT "analytics_transition_daily_source_valid" CHECK ("analytics_transition_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_transition_daily_time_zone_length" CHECK (char_length("analytics_transition_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_transition_daily_inquiry_template_id_format" CHECK ("analytics_transition_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_transition_daily_inquiry_template_version_id_format" CHECK ("analytics_transition_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_transition_daily_from_step_id_format" CHECK ("analytics_transition_daily"."from_step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "analytics_transition_daily_to_step_id_format" CHECK ("analytics_transition_daily"."to_step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "analytics_transition_daily_counts_nonnegative" CHECK ("analytics_transition_daily"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_verification_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"verification_type" "verification_type" NOT NULL,
	"capture_method" text,
	"country" text,
	"created" integer DEFAULT 0 NOT NULL,
	"submitted" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"requires_retry" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"canceled" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_verification_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","verification_type","capture_method","country"),
	CONSTRAINT "analytics_verification_daily_source_valid" CHECK ("analytics_verification_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_verification_daily_time_zone_length" CHECK (char_length("analytics_verification_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_verification_daily_inquiry_template_id_format" CHECK ("analytics_verification_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_verification_daily_inquiry_template_version_id_format" CHECK ("analytics_verification_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_verification_daily_capture_method_valid" CHECK ("analytics_verification_daily"."capture_method" is null or "analytics_verification_daily"."capture_method" in ('upload', 'camera')),
	CONSTRAINT "analytics_verification_daily_country_iso2" CHECK ("analytics_verification_daily"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "analytics_verification_daily_counts_nonnegative" CHECK ("analytics_verification_daily"."created" >= 0 and "analytics_verification_daily"."submitted" >= 0 and "analytics_verification_daily"."passed" >= 0 and "analytics_verification_daily"."failed" >= 0 and "analytics_verification_daily"."requires_retry" >= 0 and "analytics_verification_daily"."skipped" >= 0 and "analytics_verification_daily"."needs_review" >= 0 and "analytics_verification_daily"."canceled" >= 0)
);
--> statement-breakpoint
CREATE TABLE "analytics_verification_step_daily" (
	"environment_id" text NOT NULL,
	"day" date NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"inquiry_template_id" text NOT NULL,
	"inquiry_template_version_id" text NOT NULL,
	"step_id" text NOT NULL,
	"verification_type" "verification_type" NOT NULL,
	"entered" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"failed_after_attempts" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_verification_step_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","step_id","verification_type"),
	CONSTRAINT "analytics_verification_step_daily_source_valid" CHECK ("analytics_verification_step_daily"."source" in ('facts', 'redacted')),
	CONSTRAINT "analytics_verification_step_daily_time_zone_length" CHECK (char_length("analytics_verification_step_daily"."time_zone") between 1 and 64),
	CONSTRAINT "analytics_verification_step_daily_inquiry_template_id_format" CHECK ("analytics_verification_step_daily"."inquiry_template_id" ~ '^itmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_verification_step_daily_inquiry_template_version_id_format" CHECK ("analytics_verification_step_daily"."inquiry_template_version_id" ~ '^itmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "analytics_verification_step_daily_step_id_format" CHECK ("analytics_verification_step_daily"."step_id" ~ '^[a-z][a-z0-9_-]{0,63}$'),
	CONSTRAINT "analytics_verification_step_daily_counts_nonnegative" CHECK ("analytics_verification_step_daily"."entered" >= 0 and "analytics_verification_step_daily"."passed" >= 0 and "analytics_verification_step_daily"."failed_after_attempts" >= 0 and "analytics_verification_step_daily"."needs_review" >= 0 and "analytics_verification_step_daily"."skipped" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"console" boolean NOT NULL,
	"email" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_pkey" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "notification_preferences_kind_valid" CHECK ("notification_preferences"."kind" in ('assigned', 'sla-breached', 'mentioned', 'webhook-failure'))
);
--> statement-breakpoint
ALTER TABLE "case_actions" DROP CONSTRAINT "case_actions_placement_valid";--> statement-breakpoint
ALTER TABLE "case_history" DROP CONSTRAINT "case_history_kind_valid";--> statement-breakpoint
ALTER TABLE "user_notifications" DROP CONSTRAINT "user_notifications_kind_valid";--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "require_mfa" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_notifications" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "attribute_blocklist" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "environment_ids" text[];--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "flow_run_grants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "expiration_after_start_seconds" integer;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "expiration_after_resume_seconds" integer;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "one_time_link_expiration_seconds" integer;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "visible_when" jsonb;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD COLUMN "layout" jsonb;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD COLUMN "checklists" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD COLUMN "preset_comments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD COLUMN "webhook_id" text;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD COLUMN "subject_type" text GENERATED ALWAYS AS (case when webhook_id is null then 'case' else 'webhook' end) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD COLUMN "subject_id" text GENERATED ALWAYS AS (coalesce(case_id, webhook_id)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "failure_alert_enabled" boolean;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "failure_alert_threshold" integer;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "failure_alert_window_minutes" integer;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "failure_alert_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_filter_values" ADD CONSTRAINT "transaction_filter_values_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_filter_values" ADD CONSTRAINT "transaction_filter_values_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_checklist_states" ADD CONSTRAINT "case_checklist_states_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_checklist_states" ADD CONSTRAINT "case_checklist_states_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_bulk_job_rows" ADD CONSTRAINT "report_bulk_job_rows_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_bulk_job_rows" ADD CONSTRAINT "report_bulk_job_rows_job_fk" FOREIGN KEY ("environment_id","job_id") REFERENCES "public"."report_bulk_jobs"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_bulk_jobs" ADD CONSTRAINT "report_bulk_jobs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_bulk_jobs" ADD CONSTRAINT "report_bulk_jobs_report_template_fk" FOREIGN KEY ("environment_id","report_template_id") REFERENCES "public"."report_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_alert_emails" ADD CONSTRAINT "webhook_alert_emails_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_alert_emails" ADD CONSTRAINT "webhook_alert_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_alert_emails" ADD CONSTRAINT "webhook_alert_emails_webhook_fk" FOREIGN KEY ("environment_id","webhook_id") REFERENCES "public"."webhooks"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_ip_index" ADD CONSTRAINT "audit_log_ip_index_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_ip_index" ADD CONSTRAINT "audit_log_ip_index_audit_log_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_case_assignee_daily" ADD CONSTRAINT "analytics_case_assignee_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_case_assignee_daily" ADD CONSTRAINT "analytics_case_assignee_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_case_daily" ADD CONSTRAINT "analytics_case_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_check_daily" ADD CONSTRAINT "analytics_check_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_check_reason_daily" ADD CONSTRAINT "analytics_check_reason_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_inquiry_daily" ADD CONSTRAINT "analytics_inquiry_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_inquiry_tag_daily" ADD CONSTRAINT "analytics_inquiry_tag_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_path_daily" ADD CONSTRAINT "analytics_path_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_rollup_state" ADD CONSTRAINT "analytics_rollup_state_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_signal_daily" ADD CONSTRAINT "analytics_signal_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_step_daily" ADD CONSTRAINT "analytics_step_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_transition_daily" ADD CONSTRAINT "analytics_transition_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_verification_daily" ADD CONSTRAINT "analytics_verification_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_verification_step_daily" ADD CONSTRAINT "analytics_verification_step_daily_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_filter_values_lookup_idx" ON "transaction_filter_values" USING btree ("environment_id","field_key","value","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exports_storage_key_key" ON "exports" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "exports_creator_created_at_idx" ON "exports" USING btree ("environment_id","creator_type","creator_id","created_at","id");--> statement-breakpoint
CREATE INDEX "exports_expiry_idx" ON "exports" USING btree ("expires_at") WHERE "exports"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "exports_unfinished_idx" ON "exports" USING btree ("created_at") WHERE "exports"."status" in ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "report_bulk_jobs_storage_key_key" ON "report_bulk_jobs" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "report_bulk_jobs_file_idx" ON "report_bulk_jobs" USING btree ("created_at") WHERE "report_bulk_jobs"."storage_key" is not null;--> statement-breakpoint
CREATE INDEX "report_bulk_jobs_unfinished_idx" ON "report_bulk_jobs" USING btree ("created_at") WHERE "report_bulk_jobs"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "saved_views_owner_list_idx" ON "saved_views" USING btree ("environment_id","owner_id","list","created_at","id");--> statement-breakpoint
CREATE INDEX "saved_views_shared_list_idx" ON "saved_views" USING btree ("environment_id","list","created_at","id") WHERE "saved_views"."shared";--> statement-breakpoint
CREATE INDEX "saved_views_owner_id_idx" ON "saved_views" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "audit_log_ip_index_lookup_idx" ON "audit_log_ip_index" USING btree ("environment_id","ip_hmac","audit_log_id");--> statement-breakpoint
CREATE INDEX "analytics_case_assignee_daily_user_id_idx" ON "analytics_case_assignee_daily" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_webhook_fk" FOREIGN KEY ("environment_id","webhook_id") REFERENCES "public"."webhooks"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inquiries_environment_id_updated_at_idx" ON "inquiries" USING btree ("environment_id","updated_at");--> statement-breakpoint
CREATE INDEX "verification_checks_environment_id_updated_at_idx" ON "verification_checks" USING btree ("environment_id","updated_at");--> statement-breakpoint
CREATE INDEX "verifications_environment_id_updated_at_idx" ON "verifications" USING btree ("environment_id","updated_at");--> statement-breakpoint
CREATE INDEX "user_notifications_webhook_idx" ON "user_notifications" USING btree ("environment_id","webhook_id") WHERE "user_notifications"."webhook_id" is not null;--> statement-breakpoint
CREATE INDEX "webhooks_failure_alert_enabled_idx" ON "webhooks" USING btree ("environment_id","id") WHERE "webhooks"."failure_alert_enabled";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_note_length" CHECK (char_length("api_keys"."note") <= 255);--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_attribute_blocklist_size" CHECK (cardinality("api_keys"."attribute_blocklist") <= 100);--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_environment_ids_valid" CHECK ("user_roles"."environment_ids" is null or (cardinality("user_roles"."environment_ids") between 1 and 20
        and array_position("user_roles"."environment_ids", null) is null
        and array_to_string("user_roles"."environment_ids", ',') ~ '^env_[0-9A-HJKMNP-TV-Z]{26}(,env_[0-9A-HJKMNP-TV-Z]{26})*$'));--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD CONSTRAINT "inquiry_template_versions_flow_run_grants_array" CHECK (jsonb_typeof("inquiry_template_versions"."flow_run_grants") = 'array');--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_expiry_overrides_range" CHECK (("inquiries"."expiration_after_start_seconds" is null or "inquiries"."expiration_after_start_seconds" between 300 and 2592000) and ("inquiries"."expiration_after_resume_seconds" is null or "inquiries"."expiration_after_resume_seconds" between 300 and 2592000) and ("inquiries"."one_time_link_expiration_seconds" is null or "inquiries"."one_time_link_expiration_seconds" between 300 and 2592000));--> statement-breakpoint
ALTER TABLE "case_actions" ADD CONSTRAINT "case_actions_visible_when_object" CHECK ("case_actions"."visible_when" is null or jsonb_typeof("case_actions"."visible_when") = 'object');--> statement-breakpoint
ALTER TABLE "case_actions" ADD CONSTRAINT "case_actions_placement_valid" CHECK ("case_actions"."placement" in ('header', 'status-switcher')
        or "case_actions"."placement" ~ '^module:[a-z][a-z0-9-]{0,62}$');--> statement-breakpoint
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_kind_valid" CHECK ("case_history"."kind" in ('created', 'status-changed', 'resolved', 'reopened', 'assigned', 'unassigned', 'queue-changed', 'fields-changed', 'tags-changed', 'comment-added', 'comment-redacted', 'object-attached', 'object-removed', 'attachment-added', 'attachment-scanned', 'sla-started', 'sla-paused', 'sla-resumed', 'sla-recomputed', 'sla-met', 'sla-expired', 'sla-cleared', 'exported', 'print-initiated', 'redacted', 'checklist-item-checked', 'checklist-item-unchecked'));--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_layout_object" CHECK ("case_template_versions"."layout" is null or jsonb_typeof("case_template_versions"."layout") = 'object');--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_checklists_array" CHECK (jsonb_typeof("case_template_versions"."checklists") = 'array'
        and jsonb_array_length("case_template_versions"."checklists") <= 10);--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_preset_comments_array" CHECK (jsonb_typeof("case_template_versions"."preset_comments") = 'array'
        and jsonb_array_length("case_template_versions"."preset_comments") <= 50);--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_assigned_subject" CHECK ("user_notifications"."kind" <> 'assigned' or ("user_notifications"."case_id" is not null and "user_notifications"."webhook_id" is null));--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_sla_breached_subject" CHECK ("user_notifications"."kind" <> 'sla-breached' or ("user_notifications"."case_id" is not null and "user_notifications"."webhook_id" is null));--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_mentioned_subject" CHECK ("user_notifications"."kind" <> 'mentioned' or ("user_notifications"."case_id" is not null and "user_notifications"."webhook_id" is null));--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_webhook_failure_subject" CHECK ("user_notifications"."kind" <> 'webhook-failure' or ("user_notifications"."webhook_id" is not null and "user_notifications"."case_id" is null));--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_kind_valid" CHECK ("user_notifications"."kind" in ('assigned', 'sla-breached', 'mentioned', 'webhook-failure'));--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_name_length" CHECK (char_length("webhooks"."name") between 1 and 200);--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_description_length" CHECK (char_length("webhooks"."description") <= 1000);--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_failure_alert_whole" CHECK (("webhooks"."failure_alert_enabled" is null) = ("webhooks"."failure_alert_threshold" is null)
        and ("webhooks"."failure_alert_enabled" is null) = ("webhooks"."failure_alert_window_minutes" is null));--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_failure_alert_threshold_range" CHECK ("webhooks"."failure_alert_threshold" between 1 and 10000);--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_failure_alert_window_range" CHECK ("webhooks"."failure_alert_window_minutes" between 5 and 1440);