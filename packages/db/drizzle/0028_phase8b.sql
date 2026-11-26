CREATE TABLE "case_accounts" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"attached_by_type" text NOT NULL,
	"attached_by_id" text NOT NULL,
	"attached_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" text NOT NULL,
	CONSTRAINT "case_accounts_pkey" PRIMARY KEY("environment_id","case_id","account_id"),
	CONSTRAINT "case_accounts_object_id_format" CHECK ("case_accounts"."account_id" ~ '^acc_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_accounts_attached_by_type_valid" CHECK ("case_accounts"."attached_by_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_accounts_attached_by_id_format" CHECK (("case_accounts"."attached_by_type" is distinct from 'user'
            or "case_accounts"."attached_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_accounts"."attached_by_type" is distinct from 'api-key'
            or "case_accounts"."attached_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_accounts"."attached_by_type" is distinct from 'workflow-run'
            or "case_accounts"."attached_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_accounts_attached_state_object" CHECK (jsonb_typeof("case_accounts"."attached_state") = 'object')
);
--> statement-breakpoint
CREATE TABLE "case_action_templates" (
	"environment_id" text NOT NULL,
	"case_action_id" text NOT NULL,
	"case_template_id" text NOT NULL,
	CONSTRAINT "case_action_templates_pkey" PRIMARY KEY("environment_id","case_action_id","case_template_id")
);
--> statement-breakpoint
CREATE TABLE "case_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"placement" text DEFAULT 'header' NOT NULL,
	"prefill" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_actions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_actions_id_format" CHECK ("case_actions"."id" ~ '^cact_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_actions_status_valid" CHECK ("case_actions"."status" in ('active', 'archived')),
	CONSTRAINT "case_actions_placement_valid" CHECK ("case_actions"."placement" in ('header')),
	CONSTRAINT "case_actions_label_length" CHECK (char_length("case_actions"."label") between 1 and 80),
	CONSTRAINT "case_actions_prefill_object" CHECK (jsonb_typeof("case_actions"."prefill") = 'object')
);
--> statement-breakpoint
CREATE TABLE "case_assignment_policy_sources" (
	"environment_id" text NOT NULL,
	"case_assignment_policy_id" text NOT NULL,
	"position" integer NOT NULL,
	"case_template_id" text,
	"case_queue_id" text,
	CONSTRAINT "case_assignment_policy_sources_pkey" PRIMARY KEY("environment_id","case_assignment_policy_id","position"),
	CONSTRAINT "case_assignment_policy_sources_template_key" UNIQUE("environment_id","case_assignment_policy_id","case_template_id"),
	CONSTRAINT "case_assignment_policy_sources_queue_key" UNIQUE("environment_id","case_assignment_policy_id","case_queue_id"),
	CONSTRAINT "case_assignment_policy_sources_one_source" CHECK (num_nonnulls("case_assignment_policy_sources"."case_template_id", "case_assignment_policy_sources"."case_queue_id") = 1),
	CONSTRAINT "case_assignment_policy_sources_position_range" CHECK ("case_assignment_policy_sources"."position" >= 0 and "case_assignment_policy_sources"."position" < 50),
	CONSTRAINT "case_assignment_policy_sources_case_template_id_format" CHECK ("case_assignment_policy_sources"."case_template_id" ~ '^ctmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_assignment_policy_sources_case_queue_id_format" CHECK ("case_assignment_policy_sources"."case_queue_id" ~ '^cqueue_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "case_bulk_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"creator_type" text NOT NULL,
	"creator_id" text NOT NULL,
	"request" text,
	"requested_count" integer DEFAULT 0 NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"no_change_count" integer DEFAULT 0 NOT NULL,
	"refused_count" integer DEFAULT 0 NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_bulk_actions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_bulk_actions_id_format" CHECK ("case_bulk_actions"."id" ~ '^cblk_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_bulk_actions_action_valid" CHECK ("case_bulk_actions"."action" in ('assign', 'set-status', 'set-queue', 'add-tags', 'remove-tags')),
	CONSTRAINT "case_bulk_actions_status_valid" CHECK ("case_bulk_actions"."status" in ('pending', 'running', 'completed')),
	CONSTRAINT "case_bulk_actions_creator_type_valid" CHECK ("case_bulk_actions"."creator_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_bulk_actions_creator_id_format" CHECK (("case_bulk_actions"."creator_type" is distinct from 'user'
            or "case_bulk_actions"."creator_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_bulk_actions"."creator_type" is distinct from 'api-key'
            or "case_bulk_actions"."creator_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_bulk_actions"."creator_type" is distinct from 'workflow-run'
            or "case_bulk_actions"."creator_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_bulk_actions_counts" CHECK ("case_bulk_actions"."requested_count" between 0 and 500
        and "case_bulk_actions"."applied_count" >= 0 and "case_bulk_actions"."no_change_count" >= 0 and "case_bulk_actions"."refused_count" >= 0
        and "case_bulk_actions"."applied_count" + "case_bulk_actions"."no_change_count" + "case_bulk_actions"."refused_count" <= "case_bulk_actions"."requested_count"),
	CONSTRAINT "case_bulk_actions_completed_with_status" CHECK (("case_bulk_actions"."status" = 'completed') = ("case_bulk_actions"."completed_at" is not null)),
	CONSTRAINT "case_bulk_actions_outcomes_array" CHECK (jsonb_typeof("case_bulk_actions"."outcomes") = 'array'),
	CONSTRAINT "case_bulk_actions_request_until_completed" CHECK ("case_bulk_actions"."request" is not null or "case_bulk_actions"."status" = 'completed')
);
--> statement-breakpoint
CREATE TABLE "case_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"message" text,
	"commenter_type" text NOT NULL,
	"commenter_id" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"redacted_at" timestamp with time zone,
	"workflow_run_step_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_comments_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_comments_workflow_run_step_id_format" CHECK ("case_comments"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_comments_id_format" CHECK ("case_comments"."id" ~ '^cscm_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_comments_commenter_type_valid" CHECK ("case_comments"."commenter_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_comments_commenter_id_format" CHECK (("case_comments"."commenter_type" is distinct from 'user'
            or "case_comments"."commenter_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_comments"."commenter_type" is distinct from 'api-key'
            or "case_comments"."commenter_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_comments"."commenter_type" is distinct from 'workflow-run'
            or "case_comments"."commenter_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_comments_mentions_count" CHECK (cardinality("case_comments"."mentions") <= 50),
	CONSTRAINT "case_comments_message_until_redacted" CHECK ("case_comments"."message" is not null or "case_comments"."redacted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "case_field_keys" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"field_key" text NOT NULL,
	"value_key" text NOT NULL,
	CONSTRAINT "case_field_keys_pkey" PRIMARY KEY("environment_id","case_id","field_key","value_key"),
	CONSTRAINT "case_field_keys_field_key_format" CHECK ("case_field_keys"."field_key" ~ '^[a-z0-9][a-z0-9_-]*$'
        and char_length("case_field_keys"."field_key") <= 64),
	CONSTRAINT "case_field_keys_value_key_hex" CHECK ("case_field_keys"."value_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "case_graph_queries" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"attached_by_type" text NOT NULL,
	"attached_by_id" text NOT NULL,
	"attached_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"graph_query_id" text NOT NULL,
	CONSTRAINT "case_graph_queries_pkey" PRIMARY KEY("environment_id","case_id","graph_query_id"),
	CONSTRAINT "case_graph_queries_object_id_format" CHECK ("case_graph_queries"."graph_query_id" ~ '^grphq_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_graph_queries_attached_by_type_valid" CHECK ("case_graph_queries"."attached_by_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_graph_queries_attached_by_id_format" CHECK (("case_graph_queries"."attached_by_type" is distinct from 'user'
            or "case_graph_queries"."attached_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_graph_queries"."attached_by_type" is distinct from 'api-key'
            or "case_graph_queries"."attached_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_graph_queries"."attached_by_type" is distinct from 'workflow-run'
            or "case_graph_queries"."attached_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_graph_queries_attached_state_object" CHECK (jsonb_typeof("case_graph_queries"."attached_state") = 'object')
);
--> statement-breakpoint
CREATE TABLE "case_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"from" jsonb,
	"to" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_history_kind_valid" CHECK ("case_history"."kind" in ('created', 'status-changed', 'resolved', 'reopened', 'assigned', 'unassigned', 'queue-changed', 'fields-changed', 'tags-changed', 'comment-added', 'comment-redacted', 'object-attached', 'object-removed', 'attachment-added', 'attachment-scanned', 'sla-started', 'sla-paused', 'sla-resumed', 'sla-recomputed', 'sla-met', 'sla-expired', 'sla-cleared', 'exported', 'print-initiated', 'redacted')),
	CONSTRAINT "case_history_actor_valid" CHECK (("case_history"."actor_type" = 'system' and "case_history"."actor_id" is null)
        or ("case_history"."actor_type" <> 'system' and "case_history"."actor_id" is not null)),
	CONSTRAINT "case_history_actor_type_valid" CHECK ("case_history"."actor_type" in ('user', 'api-key', 'workflow-run', 'case-assignment-policy', 'system')),
	CONSTRAINT "case_history_actor_id_format" CHECK (("case_history"."actor_type" is distinct from 'user'
            or "case_history"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_history"."actor_type" is distinct from 'api-key'
            or "case_history"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_history"."actor_type" is distinct from 'workflow-run'
            or "case_history"."actor_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_history"."actor_type" is distinct from 'case-assignment-policy'
            or "case_history"."actor_id" ~ '^cap_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_history_from_object" CHECK ("case_history"."from" is null or jsonb_typeof("case_history"."from") = 'object'),
	CONSTRAINT "case_history_to_object" CHECK ("case_history"."to" is null or jsonb_typeof("case_history"."to") = 'object'),
	CONSTRAINT "case_history_request_id_length" CHECK (char_length("case_history"."request_id") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "case_inquiries" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"attached_by_type" text NOT NULL,
	"attached_by_id" text NOT NULL,
	"attached_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inquiry_id" text NOT NULL,
	CONSTRAINT "case_inquiries_pkey" PRIMARY KEY("environment_id","case_id","inquiry_id"),
	CONSTRAINT "case_inquiries_object_id_format" CHECK ("case_inquiries"."inquiry_id" ~ '^inq_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_inquiries_attached_by_type_valid" CHECK ("case_inquiries"."attached_by_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_inquiries_attached_by_id_format" CHECK (("case_inquiries"."attached_by_type" is distinct from 'user'
            or "case_inquiries"."attached_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_inquiries"."attached_by_type" is distinct from 'api-key'
            or "case_inquiries"."attached_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_inquiries"."attached_by_type" is distinct from 'workflow-run'
            or "case_inquiries"."attached_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_inquiries_attached_state_object" CHECK (jsonb_typeof("case_inquiries"."attached_state") = 'object')
);
--> statement-breakpoint
CREATE TABLE "case_name_counters" (
	"environment_id" text NOT NULL,
	"case_template_id" text NOT NULL,
	"last_value" bigint NOT NULL,
	CONSTRAINT "case_name_counters_pkey" PRIMARY KEY("environment_id","case_template_id"),
	CONSTRAINT "case_name_counters_last_value_positive" CHECK ("case_name_counters"."last_value" >= 1)
);
--> statement-breakpoint
CREATE TABLE "case_report_runs" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"attached_by_type" text NOT NULL,
	"attached_by_id" text NOT NULL,
	"attached_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_run_id" text NOT NULL,
	CONSTRAINT "case_report_runs_pkey" PRIMARY KEY("environment_id","case_id","report_run_id"),
	CONSTRAINT "case_report_runs_object_id_format" CHECK ("case_report_runs"."report_run_id" ~ '^rpr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_report_runs_attached_by_type_valid" CHECK ("case_report_runs"."attached_by_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_report_runs_attached_by_id_format" CHECK (("case_report_runs"."attached_by_type" is distinct from 'user'
            or "case_report_runs"."attached_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_report_runs"."attached_by_type" is distinct from 'api-key'
            or "case_report_runs"."attached_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_report_runs"."attached_by_type" is distinct from 'workflow-run'
            or "case_report_runs"."attached_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_report_runs_attached_state_object" CHECK (jsonb_typeof("case_report_runs"."attached_state") = 'object')
);
--> statement-breakpoint
CREATE TABLE "case_reports" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"attached_by_type" text NOT NULL,
	"attached_by_id" text NOT NULL,
	"attached_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_id" text NOT NULL,
	CONSTRAINT "case_reports_pkey" PRIMARY KEY("environment_id","case_id","report_id"),
	CONSTRAINT "case_reports_object_id_format" CHECK ("case_reports"."report_id" ~ '^rep_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_reports_attached_by_type_valid" CHECK ("case_reports"."attached_by_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_reports_attached_by_id_format" CHECK (("case_reports"."attached_by_type" is distinct from 'user'
            or "case_reports"."attached_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_reports"."attached_by_type" is distinct from 'api-key'
            or "case_reports"."attached_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_reports"."attached_by_type" is distinct from 'workflow-run'
            or "case_reports"."attached_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_reports_attached_state_object" CHECK (jsonb_typeof("case_reports"."attached_state") = 'object')
);
--> statement-breakpoint
CREATE TABLE "case_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"case_template_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"field_schemas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"statuses" jsonb NOT NULL,
	"resolutions" text[] DEFAULT '{Approved,Declined}'::text[] NOT NULL,
	"transitions" jsonb,
	"default_queue_id" text,
	"assignment_policy_id" text,
	"sla_policy_id" text,
	"sla_starts_on" text DEFAULT 'created' NOT NULL,
	"held_object_types" text[] DEFAULT '{account,inquiry,report,report-run,transaction,verification,graph-query,document}'::text[] NOT NULL,
	"attachment_policy" jsonb,
	"notify_on_create" text[] DEFAULT '{}'::text[] NOT NULL,
	"layout_modules" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_template_versions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_template_versions_id_format" CHECK ("case_template_versions"."id" ~ '^ctmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_template_versions_case_template_id_format" CHECK ("case_template_versions"."case_template_id" ~ '^ctmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_template_versions_version_positive" CHECK ("case_template_versions"."version" >= 1),
	CONSTRAINT "case_template_versions_status_valid" CHECK ("case_template_versions"."status" in ('draft', 'published', 'superseded')),
	CONSTRAINT "case_template_versions_published_at" CHECK (("case_template_versions"."status" = 'draft') = ("case_template_versions"."published_at" is null)),
	CONSTRAINT "case_template_versions_sla_starts_on_valid" CHECK ("case_template_versions"."sla_starts_on" in ('created', 'entered-queue', 'assigned')),
	CONSTRAINT "case_template_versions_statuses_array" CHECK (jsonb_typeof("case_template_versions"."statuses") = 'array'
        and jsonb_array_length("case_template_versions"."statuses") <= 50),
	CONSTRAINT "case_template_versions_field_schemas_array" CHECK (jsonb_typeof("case_template_versions"."field_schemas") = 'array'),
	CONSTRAINT "case_template_versions_transitions_object" CHECK ("case_template_versions"."transitions" is null or jsonb_typeof("case_template_versions"."transitions") = 'object'),
	CONSTRAINT "case_template_versions_attachment_policy_object" CHECK ("case_template_versions"."attachment_policy" is null or jsonb_typeof("case_template_versions"."attachment_policy") = 'object'),
	CONSTRAINT "case_template_versions_layout_modules_array" CHECK ("case_template_versions"."layout_modules" is null or jsonb_typeof("case_template_versions"."layout_modules") = 'array'),
	CONSTRAINT "case_template_versions_resolutions_count" CHECK (cardinality("case_template_versions"."resolutions") <= 50),
	CONSTRAINT "case_template_versions_notify_on_create_count" CHECK (cardinality("case_template_versions"."notify_on_create") <= 50),
	CONSTRAINT "case_template_versions_default_queue_id_format" CHECK ("case_template_versions"."default_queue_id" ~ '^cqueue_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_template_versions_assignment_policy_id_format" CHECK ("case_template_versions"."assignment_policy_id" ~ '^cap_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_template_versions_sla_policy_id_format" CHECK ("case_template_versions"."sla_policy_id" ~ '^cslap_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "case_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visible_to_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_templates_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_templates_environment_id_key_key" UNIQUE("environment_id","key"),
	CONSTRAINT "case_templates_id_format" CHECK ("case_templates"."id" ~ '^ctmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_templates_key_format" CHECK ("case_templates"."key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
	CONSTRAINT "case_templates_status_valid" CHECK ("case_templates"."status" in ('active', 'archived')),
	CONSTRAINT "case_templates_name_length" CHECK (char_length("case_templates"."name") between 1 and 80),
	CONSTRAINT "case_templates_archived_with_status" CHECK (("case_templates"."status" = 'archived') = ("case_templates"."archived_at" is not null)),
	CONSTRAINT "case_templates_visible_to_roles_count" CHECK (cardinality("case_templates"."visible_to_roles") <= 50)
);
--> statement-breakpoint
CREATE TABLE "case_transactions" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"attached_by_type" text NOT NULL,
	"attached_by_id" text NOT NULL,
	"attached_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" text NOT NULL,
	CONSTRAINT "case_transactions_pkey" PRIMARY KEY("environment_id","case_id","transaction_id"),
	CONSTRAINT "case_transactions_object_id_format" CHECK ("case_transactions"."transaction_id" ~ '^txn_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_transactions_attached_by_type_valid" CHECK ("case_transactions"."attached_by_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_transactions_attached_by_id_format" CHECK (("case_transactions"."attached_by_type" is distinct from 'user'
            or "case_transactions"."attached_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_transactions"."attached_by_type" is distinct from 'api-key'
            or "case_transactions"."attached_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_transactions"."attached_by_type" is distinct from 'workflow-run'
            or "case_transactions"."attached_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_transactions_attached_state_object" CHECK (jsonb_typeof("case_transactions"."attached_state") = 'object')
);
--> statement-breakpoint
CREATE TABLE "case_verifications" (
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"attached_by_type" text NOT NULL,
	"attached_by_id" text NOT NULL,
	"attached_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verification_id" text NOT NULL,
	"held_as" text DEFAULT 'verification' NOT NULL,
	CONSTRAINT "case_verifications_pkey" PRIMARY KEY("environment_id","case_id","verification_id"),
	CONSTRAINT "case_verifications_object_id_format" CHECK ("case_verifications"."verification_id" ~ '^ver_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_verifications_attached_by_type_valid" CHECK ("case_verifications"."attached_by_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_verifications_attached_by_id_format" CHECK (("case_verifications"."attached_by_type" is distinct from 'user'
            or "case_verifications"."attached_by_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_verifications"."attached_by_type" is distinct from 'api-key'
            or "case_verifications"."attached_by_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_verifications"."attached_by_type" is distinct from 'workflow-run'
            or "case_verifications"."attached_by_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_verifications_attached_state_object" CHECK (jsonb_typeof("case_verifications"."attached_state") = 'object'),
	CONSTRAINT "case_verifications_held_as_valid" CHECK ("case_verifications"."held_as" in ('verification', 'document'))
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"case_template_id" text NOT NULL,
	"case_template_version_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"status_category" text NOT NULL,
	"resolution" text,
	"case_queue_id" text,
	"creator_type" text NOT NULL,
	"creator_id" text NOT NULL,
	"assignee_id" text,
	"assigner_type" text,
	"assigner_id" text,
	"assigned_at" timestamp with time zone,
	"resolver_type" text,
	"resolver_id" text,
	"resolved_at" timestamp with time zone,
	"updater_type" text,
	"updater_id" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"fields" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"redacted_at" timestamp with time zone,
	"workflow_run_step_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sla_state" text DEFAULT 'none' NOT NULL,
	"sla_epoch" integer DEFAULT 0 NOT NULL,
	"sla_consumed_ms" bigint DEFAULT 0 NOT NULL,
	"sla_segment_started_at" timestamp with time zone,
	"sla_expires_at" timestamp with time zone,
	"sla_expired_at" timestamp with time zone,
	"sla_met_at" timestamp with time zone,
	"sla_target_ms" bigint,
	"sla_policy_id" text,
	"sla_policy_revision" integer,
	"sla_case_calendar_id" text,
	"sla_on_reopen" text DEFAULT 'continue' NOT NULL,
	CONSTRAINT "cases_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "cases_environment_id_name_key" UNIQUE("environment_id","name"),
	CONSTRAINT "cases_workflow_run_step_id_format" CHECK ("cases"."workflow_run_step_id" ~ '^wfst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "cases_tags_valid" CHECK (openverify_tags_valid("cases"."tags")),
	CONSTRAINT "cases_id_format" CHECK ("cases"."id" ~ '^case_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "cases_case_template_id_format" CHECK ("cases"."case_template_id" ~ '^ctmpl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "cases_case_template_version_id_format" CHECK ("cases"."case_template_version_id" ~ '^ctmplv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "cases_case_queue_id_format" CHECK ("cases"."case_queue_id" ~ '^cqueue_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "cases_assignee_id_format" CHECK ("cases"."assignee_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "cases_name_format" CHECK ("cases"."name" ~ '^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,17}$'),
	CONSTRAINT "cases_status_format" CHECK ("cases"."status" ~ '^[a-z0-9][a-z0-9_-]*$'
      and char_length("cases"."status") <= 64),
	CONSTRAINT "cases_status_category_valid" CHECK ("cases"."status_category" in ('initial', 'intermediate', 'end')),
	CONSTRAINT "cases_resolution_length" CHECK (char_length("cases"."resolution") between 1 and 80),
	CONSTRAINT "cases_resolved_in_end" CHECK (("cases"."status_category" = 'end') = ("cases"."resolved_at" is not null)),
	CONSTRAINT "cases_creator_type_valid" CHECK ("cases"."creator_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "cases_creator_id_format" CHECK (("cases"."creator_type" is distinct from 'user'
            or "cases"."creator_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."creator_type" is distinct from 'api-key'
            or "cases"."creator_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."creator_type" is distinct from 'workflow-run'
            or "cases"."creator_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "cases_assigner_is_whole" CHECK (("cases"."assigner_type" is null) = ("cases"."assigner_id" is null)),
	CONSTRAINT "cases_assigner_type_valid" CHECK ("cases"."assigner_type" in ('case-assignment-policy', 'user', 'api-key', 'workflow-run')),
	CONSTRAINT "cases_assigner_id_format" CHECK (("cases"."assigner_type" is distinct from 'case-assignment-policy'
            or "cases"."assigner_id" ~ '^cap_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."assigner_type" is distinct from 'user'
            or "cases"."assigner_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."assigner_type" is distinct from 'api-key'
            or "cases"."assigner_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."assigner_type" is distinct from 'workflow-run'
            or "cases"."assigner_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "cases_resolver_is_whole" CHECK (("cases"."resolver_type" is null) = ("cases"."resolver_id" is null)),
	CONSTRAINT "cases_resolver_type_valid" CHECK ("cases"."resolver_type" in ('api-key', 'user', 'workflow-run')),
	CONSTRAINT "cases_resolver_id_format" CHECK (("cases"."resolver_type" is distinct from 'api-key'
            or "cases"."resolver_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."resolver_type" is distinct from 'user'
            or "cases"."resolver_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."resolver_type" is distinct from 'workflow-run'
            or "cases"."resolver_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "cases_updater_is_whole" CHECK (("cases"."updater_type" is null) = ("cases"."updater_id" is null)),
	CONSTRAINT "cases_updater_type_valid" CHECK ("cases"."updater_type" in ('api-key', 'case-assignment-policy', 'user', 'workflow-run')),
	CONSTRAINT "cases_updater_id_format" CHECK (("cases"."updater_type" is distinct from 'api-key'
            or "cases"."updater_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."updater_type" is distinct from 'case-assignment-policy'
            or "cases"."updater_id" ~ '^cap_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."updater_type" is distinct from 'user'
            or "cases"."updater_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("cases"."updater_type" is distinct from 'workflow-run'
            or "cases"."updater_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "cases_lock_version_non_negative" CHECK ("cases"."lock_version" >= 0),
	CONSTRAINT "cases_fields_until_redacted" CHECK ("cases"."fields" is not null or "cases"."redacted_at" is not null),
	CONSTRAINT "cases_sla_state_valid" CHECK ("cases"."sla_state" in ('none', 'running', 'paused', 'met', 'expired')),
	CONSTRAINT "cases_sla_expires_at_with_state" CHECK (("cases"."sla_expires_at" is null) = ("cases"."sla_state" in ('none', 'paused'))),
	CONSTRAINT "cases_sla_target_with_state" CHECK (("cases"."sla_target_ms" is null) = ("cases"."sla_state" = 'none')),
	CONSTRAINT "cases_sla_met_at_with_state" CHECK ("cases"."sla_state" <> 'met' or "cases"."sla_met_at" is not null),
	CONSTRAINT "cases_sla_expired_at_with_state" CHECK ("cases"."sla_state" <> 'expired' or "cases"."sla_expired_at" is not null),
	CONSTRAINT "cases_sla_policy_is_whole" CHECK (("cases"."sla_policy_id" is null) = ("cases"."sla_policy_revision" is null)),
	CONSTRAINT "cases_sla_calendar_with_policy" CHECK ("cases"."sla_case_calendar_id" is null or "cases"."sla_policy_id" is not null),
	CONSTRAINT "cases_sla_counts" CHECK ("cases"."sla_epoch" >= 0 and "cases"."sla_consumed_ms" >= 0
        and ("cases"."sla_target_ms" is null or "cases"."sla_target_ms" > 0)
        and ("cases"."sla_policy_revision" is null or "cases"."sla_policy_revision" >= 1)),
	CONSTRAINT "cases_sla_on_reopen_valid" CHECK ("cases"."sla_on_reopen" in ('continue', 'restart')),
	CONSTRAINT "cases_sla_policy_id_format" CHECK ("cases"."sla_policy_id" ~ '^cslap_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "cases_sla_case_calendar_id_format" CHECK ("cases"."sla_case_calendar_id" ~ '^ccal_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"case_id" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notifications_id_format" CHECK ("user_notifications"."id" ~ '^unot_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "user_notifications_kind_valid" CHECK ("user_notifications"."kind" in ('assigned', 'sla-breached', 'mentioned'))
);
--> statement-breakpoint
CREATE TABLE "case_assignment_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"distribution" text NOT NULL,
	"sort" text DEFAULT 'created-at' NOT NULL,
	"agent_ids" text[],
	"max_capacity" integer,
	"round_robin_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_assignment_policies_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_assignment_policies_id_format" CHECK ("case_assignment_policies"."id" ~ '^cap_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_assignment_policies_name_length" CHECK (char_length("case_assignment_policies"."name") between 1 and 80),
	CONSTRAINT "case_assignment_policies_distribution_valid" CHECK ("case_assignment_policies"."distribution" in ('round-robin', 'fewest-open', 'case-creator', 'inquiry-creator')),
	CONSTRAINT "case_assignment_policies_sort_valid" CHECK ("case_assignment_policies"."sort" in ('created-at', 'sla-expires-at')),
	CONSTRAINT "case_assignment_policies_agent_ids_count" CHECK ("case_assignment_policies"."agent_ids" is null
        or cardinality("case_assignment_policies"."agent_ids") between 1 and 200),
	CONSTRAINT "case_assignment_policies_max_capacity_range" CHECK ("case_assignment_policies"."max_capacity" is null
        or "case_assignment_policies"."max_capacity" between 1 and 500),
	CONSTRAINT "case_assignment_policies_round_robin_cursor_format" CHECK ("case_assignment_policies"."round_robin_cursor" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "case_calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"week" jsonb NOT NULL,
	"holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_calendars_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_calendars_id_format" CHECK ("case_calendars"."id" ~ '^ccal_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_calendars_name_length" CHECK (char_length("case_calendars"."name") between 1 and 80),
	CONSTRAINT "case_calendars_time_zone_length" CHECK (char_length("case_calendars"."time_zone") between 1 and 64),
	CONSTRAINT "case_calendars_week_object" CHECK (jsonb_typeof("case_calendars"."week") = 'object'),
	CONSTRAINT "case_calendars_holidays_array" CHECK (jsonb_typeof("case_calendars"."holidays") = 'array'
        and jsonb_array_length("case_calendars"."holidays") <= 500),
	CONSTRAINT "case_calendars_closures_array" CHECK (jsonb_typeof("case_calendars"."closures") = 'array'
        and jsonb_array_length("case_calendars"."closures") <= 200)
);
--> statement-breakpoint
CREATE TABLE "case_queue_members" (
	"environment_id" text NOT NULL,
	"case_queue_id" text NOT NULL,
	"user_id" text NOT NULL,
	"max_open" integer DEFAULT 50 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_queue_members_pkey" PRIMARY KEY("environment_id","case_queue_id","user_id"),
	CONSTRAINT "case_queue_members_user_id_format" CHECK ("case_queue_members"."user_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_queue_members_max_open_range" CHECK ("case_queue_members"."max_open" between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "case_queues" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"case_assignment_policy_id" text,
	"round_robin_cursor" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_queues_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_queues_id_format" CHECK ("case_queues"."id" ~ '^cqueue_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_queues_name_length" CHECK (char_length("case_queues"."name") between 1 and 80),
	CONSTRAINT "case_queues_status_valid" CHECK ("case_queues"."status" in ('active', 'archived')),
	CONSTRAINT "case_queues_archived_with_status" CHECK (("case_queues"."status" = 'archived') = ("case_queues"."archived_at" is not null)),
	CONSTRAINT "case_queues_case_assignment_policy_id_format" CHECK ("case_queues"."case_assignment_policy_id" ~ '^cap_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_queues_round_robin_cursor_format" CHECK ("case_queues"."round_robin_cursor" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "case_sla_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"case_calendar_id" text,
	"on_reopen" text DEFAULT 'continue' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_sla_policies_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_sla_policies_id_format" CHECK ("case_sla_policies"."id" ~ '^cslap_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_sla_policies_name_length" CHECK (char_length("case_sla_policies"."name") between 1 and 80),
	CONSTRAINT "case_sla_policies_target_minutes_range" CHECK ("case_sla_policies"."target_minutes" between 1 and 525600),
	CONSTRAINT "case_sla_policies_on_reopen_valid" CHECK ("case_sla_policies"."on_reopen" in ('continue', 'restart')),
	CONSTRAINT "case_sla_policies_revision_positive" CHECK ("case_sla_policies"."revision" >= 1),
	CONSTRAINT "case_sla_policies_case_calendar_id_format" CHECK ("case_sla_policies"."case_calendar_id" ~ '^ccal_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "case_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"case_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"original_filename" text,
	"sha256" text,
	"storage_key" text,
	"wrapped_dek" text,
	"uploader_type" text NOT NULL,
	"uploader_id" text NOT NULL,
	"scan_status" text NOT NULL,
	"scan_provider" text,
	"scanned_at" timestamp with time zone,
	"scan_attempts" integer DEFAULT 0 NOT NULL,
	"rendition_status" text DEFAULT 'pending' NOT NULL,
	"rendition_page_count" integer,
	"rendition_truncated" boolean DEFAULT false NOT NULL,
	"rendition_error_code" text,
	"rendition_attempts" integer DEFAULT 0 NOT NULL,
	"rendered_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_attachments_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_attachments_id_format" CHECK ("case_attachments"."id" ~ '^catt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_attachments_mime_type_valid" CHECK ("case_attachments"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
	CONSTRAINT "case_attachments_byte_size_range" CHECK ("case_attachments"."byte_size" between 1 and 10485760),
	CONSTRAINT "case_attachments_sha256_hex" CHECK ("case_attachments"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "case_attachments_filename_until_redacted" CHECK ("case_attachments"."original_filename" is not null or "case_attachments"."redacted_at" is not null),
	CONSTRAINT "case_attachments_sha256_until_redacted" CHECK ("case_attachments"."sha256" is not null or "case_attachments"."redacted_at" is not null),
	CONSTRAINT "case_attachments_object_until_deleted" CHECK (("case_attachments"."storage_key" is null) = ("case_attachments"."deleted_at" is not null)
        and ("case_attachments"."wrapped_dek" is null) = ("case_attachments"."deleted_at" is not null)),
	CONSTRAINT "case_attachments_deleted_after_redaction" CHECK ("case_attachments"."deleted_at" is null or "case_attachments"."redacted_at" is not null),
	CONSTRAINT "case_attachments_wrapped_dek_format" CHECK ("case_attachments"."wrapped_dek" is null or "case_attachments"."wrapped_dek" ~ '^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}$'),
	CONSTRAINT "case_attachments_uploader_type_valid" CHECK ("case_attachments"."uploader_type" in ('user', 'api-key', 'workflow-run')),
	CONSTRAINT "case_attachments_uploader_id_format" CHECK (("case_attachments"."uploader_type" is distinct from 'user'
              or "case_attachments"."uploader_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_attachments"."uploader_type" is distinct from 'api-key'
              or "case_attachments"."uploader_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_attachments"."uploader_type" is distinct from 'workflow-run'
              or "case_attachments"."uploader_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_attachments_scan_status_valid" CHECK ("case_attachments"."scan_status" in ('not_scanned', 'pending', 'clean', 'infected', 'error')),
	CONSTRAINT "case_attachments_scan_provider_valid" CHECK ("case_attachments"."scan_provider" is null or "case_attachments"."scan_provider" in ('sandbox', 'clamd')),
	CONSTRAINT "case_attachments_scan_provider_with_status" CHECK (("case_attachments"."scan_status" = 'not_scanned') = ("case_attachments"."scan_provider" is null)),
	CONSTRAINT "case_attachments_scanned_at_with_verdict" CHECK ("case_attachments"."scan_status" = 'error'
        or ("case_attachments"."scan_status" in ('clean', 'infected')) = ("case_attachments"."scanned_at" is not null)),
	CONSTRAINT "case_attachments_scan_attempts_range" CHECK ("case_attachments"."scan_attempts" between 0 and 3),
	CONSTRAINT "case_attachments_rendition_status_valid" CHECK ("case_attachments"."rendition_status" in ('pending', 'ready', 'failed', 'deleted')),
	CONSTRAINT "case_attachments_rendition_pages_when_ready" CHECK (("case_attachments"."rendition_status" = 'ready') = ("case_attachments"."rendition_page_count" is not null)),
	CONSTRAINT "case_attachments_rendition_page_count_range" CHECK ("case_attachments"."rendition_page_count" is null
        or "case_attachments"."rendition_page_count" between 1 and 20),
	CONSTRAINT "case_attachments_rendition_attempts_non_negative" CHECK ("case_attachments"."rendition_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "case_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"creator_type" text NOT NULL,
	"creator_id" text NOT NULL,
	"format" text NOT NULL,
	"include_personal_data" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request" text,
	"case_count" integer,
	"byte_size" integer,
	"error_code" text,
	"storage_key" text,
	"wrapped_dek" text,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_exports_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "case_exports_id_format" CHECK ("case_exports"."id" ~ '^cexp_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "case_exports_creator_type_valid" CHECK ("case_exports"."creator_type" in ('user', 'api-key')),
	CONSTRAINT "case_exports_creator_id_format" CHECK (("case_exports"."creator_type" is distinct from 'user'
              or "case_exports"."creator_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
      and ("case_exports"."creator_type" is distinct from 'api-key'
              or "case_exports"."creator_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "case_exports_format_valid" CHECK ("case_exports"."format" in ('csv', 'json')),
	CONSTRAINT "case_exports_status_valid" CHECK ("case_exports"."status" in ('pending', 'running', 'completed', 'failed', 'expired')),
	CONSTRAINT "case_exports_request_until_finished" CHECK ("case_exports"."request" is not null or "case_exports"."status" in ('completed', 'failed', 'expired')),
	CONSTRAINT "case_exports_finished_with_times" CHECK (("case_exports"."status" in ('completed', 'expired')) = ("case_exports"."completed_at" is not null
        and "case_exports"."expires_at" is not null and "case_exports"."case_count" is not null)),
	CONSTRAINT "case_exports_file_while_completed" CHECK (("case_exports"."status" = 'completed') = ("case_exports"."storage_key" is not null)
        and ("case_exports"."storage_key" is null) = ("case_exports"."wrapped_dek" is null)
        and ("case_exports"."status" <> 'completed' or "case_exports"."byte_size" is not null)),
	CONSTRAINT "case_exports_error_when_failed" CHECK (("case_exports"."status" = 'failed') = ("case_exports"."error_code" is not null)),
	CONSTRAINT "case_exports_counts" CHECK (("case_exports"."case_count" is null or "case_exports"."case_count" between 0 and 10000)
        and ("case_exports"."byte_size" is null or "case_exports"."byte_size" >= 0)),
	CONSTRAINT "case_exports_wrapped_dek_format" CHECK ("case_exports"."wrapped_dek" is null or "case_exports"."wrapped_dek" ~ '^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}$')
);
--> statement-breakpoint
CREATE TABLE "file_renditions" (
	"file_id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"page_count" integer,
	"truncated" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"rendered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_renditions_id_format" CHECK ("file_renditions"."file_id" ~ '^file_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "file_renditions_status_valid" CHECK ("file_renditions"."status" in ('pending', 'ready', 'failed', 'deleted')),
	CONSTRAINT "file_renditions_pages_when_ready" CHECK (("file_renditions"."status" = 'ready') = ("file_renditions"."page_count" is not null)
        and ("file_renditions"."status" = 'ready') = ("file_renditions"."rendered_at" is not null)),
	CONSTRAINT "file_renditions_page_count_range" CHECK ("file_renditions"."page_count" is null or "file_renditions"."page_count" between 1 and 20),
	CONSTRAINT "file_renditions_error_when_failed" CHECK (("file_renditions"."status" = 'failed') = ("file_renditions"."error_code" is not null)),
	CONSTRAINT "file_renditions_attempts_non_negative" CHECK ("file_renditions"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rendition_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"source_id" text NOT NULL,
	"page" integer NOT NULL,
	"media_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rendition_pages_source_id_format" CHECK ("rendition_pages"."source_id" ~ '^file_[0-9A-HJKMNP-TV-Z]{26}$'
        or "rendition_pages"."source_id" ~ '^catt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "rendition_pages_id_format" CHECK ("rendition_pages"."id" = "rendition_pages"."source_id" || '/' || "rendition_pages"."page"),
	CONSTRAINT "rendition_pages_page_range" CHECK ("rendition_pages"."page" between 1 and 20),
	CONSTRAINT "rendition_pages_media_type_valid" CHECK ("rendition_pages"."media_type" in ('image/jpeg', 'image/png')),
	CONSTRAINT "rendition_pages_size_range" CHECK ("rendition_pages"."width" between 1 and 4096
        and "rendition_pages"."height" between 1 and 4096
        and "rendition_pages"."byte_size" between 1 and 16777216),
	CONSTRAINT "rendition_pages_wrapped_dek_format" CHECK ("rendition_pages"."wrapped_dek" is null or "rendition_pages"."wrapped_dek" ~ '^ov1\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{80}$')
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_creator_valid";--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "case_template_ids" text[];--> statement-breakpoint
ALTER TABLE "case_accounts" ADD CONSTRAINT "case_accounts_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_accounts" ADD CONSTRAINT "case_accounts_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_accounts" ADD CONSTRAINT "case_accounts_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_action_templates" ADD CONSTRAINT "case_action_templates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_action_templates" ADD CONSTRAINT "case_action_templates_action_fk" FOREIGN KEY ("environment_id","case_action_id") REFERENCES "public"."case_actions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_action_templates" ADD CONSTRAINT "case_action_templates_template_fk" FOREIGN KEY ("environment_id","case_template_id") REFERENCES "public"."case_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_actions" ADD CONSTRAINT "case_actions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_actions" ADD CONSTRAINT "case_actions_workflow_fk" FOREIGN KEY ("environment_id","workflow_id") REFERENCES "public"."workflows"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment_policy_sources" ADD CONSTRAINT "case_assignment_policy_sources_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment_policy_sources" ADD CONSTRAINT "case_assignment_policy_sources_policy_fk" FOREIGN KEY ("environment_id","case_assignment_policy_id") REFERENCES "public"."case_assignment_policies"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment_policy_sources" ADD CONSTRAINT "case_assignment_policy_sources_template_fk" FOREIGN KEY ("environment_id","case_template_id") REFERENCES "public"."case_templates"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment_policy_sources" ADD CONSTRAINT "case_assignment_policy_sources_queue_fk" FOREIGN KEY ("environment_id","case_queue_id") REFERENCES "public"."case_queues"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_bulk_actions" ADD CONSTRAINT "case_bulk_actions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_comments" ADD CONSTRAINT "case_comments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_comments" ADD CONSTRAINT "case_comments_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_field_keys" ADD CONSTRAINT "case_field_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_field_keys" ADD CONSTRAINT "case_field_keys_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_graph_queries" ADD CONSTRAINT "case_graph_queries_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_graph_queries" ADD CONSTRAINT "case_graph_queries_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_graph_queries" ADD CONSTRAINT "case_graph_queries_graph_query_fk" FOREIGN KEY ("environment_id","graph_query_id") REFERENCES "public"."graph_queries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_inquiries" ADD CONSTRAINT "case_inquiries_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_inquiries" ADD CONSTRAINT "case_inquiries_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_inquiries" ADD CONSTRAINT "case_inquiries_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_name_counters" ADD CONSTRAINT "case_name_counters_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_name_counters" ADD CONSTRAINT "case_name_counters_template_fk" FOREIGN KEY ("environment_id","case_template_id") REFERENCES "public"."case_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_report_runs" ADD CONSTRAINT "case_report_runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_report_runs" ADD CONSTRAINT "case_report_runs_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_report_runs" ADD CONSTRAINT "case_report_runs_report_run_fk" FOREIGN KEY ("environment_id","report_run_id") REFERENCES "public"."report_runs"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_reports" ADD CONSTRAINT "case_reports_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_reports" ADD CONSTRAINT "case_reports_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_reports" ADD CONSTRAINT "case_reports_report_fk" FOREIGN KEY ("environment_id","report_id") REFERENCES "public"."reports"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_template_fk" FOREIGN KEY ("environment_id","case_template_id") REFERENCES "public"."case_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_default_queue_fk" FOREIGN KEY ("environment_id","default_queue_id") REFERENCES "public"."case_queues"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_assignment_policy_fk" FOREIGN KEY ("environment_id","assignment_policy_id") REFERENCES "public"."case_assignment_policies"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_template_versions" ADD CONSTRAINT "case_template_versions_sla_policy_fk" FOREIGN KEY ("environment_id","sla_policy_id") REFERENCES "public"."case_sla_policies"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_templates" ADD CONSTRAINT "case_templates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_transactions" ADD CONSTRAINT "case_transactions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_transactions" ADD CONSTRAINT "case_transactions_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_transactions" ADD CONSTRAINT "case_transactions_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_verifications" ADD CONSTRAINT "case_verifications_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_verifications" ADD CONSTRAINT "case_verifications_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_verifications" ADD CONSTRAINT "case_verifications_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_queue_fk" FOREIGN KEY ("environment_id","case_queue_id") REFERENCES "public"."case_queues"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_sla_policy_fk" FOREIGN KEY ("environment_id","sla_policy_id") REFERENCES "public"."case_sla_policies"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_sla_calendar_fk" FOREIGN KEY ("environment_id","sla_case_calendar_id") REFERENCES "public"."case_calendars"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_template_fk" FOREIGN KEY ("environment_id","case_template_id") REFERENCES "public"."case_templates"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_version_fk" FOREIGN KEY ("environment_id","case_template_version_id") REFERENCES "public"."case_template_versions"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignment_policies" ADD CONSTRAINT "case_assignment_policies_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_calendars" ADD CONSTRAINT "case_calendars_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_queue_members" ADD CONSTRAINT "case_queue_members_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_queue_members" ADD CONSTRAINT "case_queue_members_queue_fk" FOREIGN KEY ("environment_id","case_queue_id") REFERENCES "public"."case_queues"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_queue_members" ADD CONSTRAINT "case_queue_members_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_queues" ADD CONSTRAINT "case_queues_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_queues" ADD CONSTRAINT "case_queues_policy_fk" FOREIGN KEY ("environment_id","case_assignment_policy_id") REFERENCES "public"."case_assignment_policies"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sla_policies" ADD CONSTRAINT "case_sla_policies_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_sla_policies" ADD CONSTRAINT "case_sla_policies_calendar_fk" FOREIGN KEY ("environment_id","case_calendar_id") REFERENCES "public"."case_calendars"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_exports" ADD CONSTRAINT "case_exports_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_renditions" ADD CONSTRAINT "file_renditions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_renditions" ADD CONSTRAINT "file_renditions_file_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rendition_pages" ADD CONSTRAINT "rendition_pages_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_accounts_object_idx" ON "case_accounts" USING btree ("environment_id","account_id");--> statement-breakpoint
CREATE INDEX "case_accounts_case_created_at_idx" ON "case_accounts" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"account_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_action_templates_template_idx" ON "case_action_templates" USING btree ("environment_id","case_template_id");--> statement-breakpoint
CREATE INDEX "case_actions_environment_created_at_id_idx" ON "case_actions" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_assignment_policy_sources_template_idx" ON "case_assignment_policy_sources" USING btree ("environment_id","case_template_id") WHERE "case_assignment_policy_sources"."case_template_id" is not null;--> statement-breakpoint
CREATE INDEX "case_assignment_policy_sources_queue_idx" ON "case_assignment_policy_sources" USING btree ("environment_id","case_queue_id") WHERE "case_assignment_policy_sources"."case_queue_id" is not null;--> statement-breakpoint
CREATE INDEX "case_bulk_actions_unfinished_idx" ON "case_bulk_actions" USING btree ("created_at") WHERE "case_bulk_actions"."status" <> 'completed';--> statement-breakpoint
CREATE UNIQUE INDEX "case_comments_workflow_run_step_key" ON "case_comments" USING btree ("environment_id","workflow_run_step_id") WHERE "case_comments"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE INDEX "case_comments_case_created_at_id_idx" ON "case_comments" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_field_keys_lookup_idx" ON "case_field_keys" USING btree ("environment_id","field_key","value_key","case_id");--> statement-breakpoint
CREATE INDEX "case_graph_queries_object_idx" ON "case_graph_queries" USING btree ("environment_id","graph_query_id");--> statement-breakpoint
CREATE INDEX "case_graph_queries_case_created_at_idx" ON "case_graph_queries" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"graph_query_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_history_case_id_idx" ON "case_history" USING btree ("environment_id","case_id","id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_inquiries_object_idx" ON "case_inquiries" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "case_inquiries_case_created_at_idx" ON "case_inquiries" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"inquiry_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_report_runs_object_idx" ON "case_report_runs" USING btree ("environment_id","report_run_id");--> statement-breakpoint
CREATE INDEX "case_report_runs_case_created_at_idx" ON "case_report_runs" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"report_run_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_reports_object_idx" ON "case_reports" USING btree ("environment_id","report_id");--> statement-breakpoint
CREATE INDEX "case_reports_case_created_at_idx" ON "case_reports" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"report_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "case_template_versions_case_template_id_version_key" ON "case_template_versions" USING btree ("case_template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "case_template_versions_one_published_key" ON "case_template_versions" USING btree ("case_template_id") WHERE "case_template_versions"."status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "case_template_versions_one_draft_key" ON "case_template_versions" USING btree ("case_template_id") WHERE "case_template_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "case_template_versions_env_template_created_at_id_idx" ON "case_template_versions" USING btree ("environment_id","case_template_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_templates_environment_id_created_at_id_idx" ON "case_templates" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_transactions_object_idx" ON "case_transactions" USING btree ("environment_id","transaction_id");--> statement-breakpoint
CREATE INDEX "case_transactions_case_created_at_idx" ON "case_transactions" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"transaction_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_verifications_object_idx" ON "case_verifications" USING btree ("environment_id","verification_id");--> statement-breakpoint
CREATE INDEX "case_verifications_case_created_at_idx" ON "case_verifications" USING btree ("environment_id","case_id","created_at" DESC NULLS FIRST,"verification_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "cases_workflow_run_step_key" ON "cases" USING btree ("environment_id","workflow_run_step_id") WHERE "cases"."workflow_run_step_id" is not null;--> statement-breakpoint
CREATE INDEX "cases_environment_id_created_at_id_idx" ON "cases" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "cases_environment_id_template_status_created_at_id_idx" ON "cases" USING btree ("environment_id","case_template_id","status","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "cases_environment_id_assignee_created_at_id_idx" ON "cases" USING btree ("environment_id","assignee_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "cases"."assignee_id" is not null;--> statement-breakpoint
CREATE INDEX "cases_pull_idx" ON "cases" USING btree ("environment_id","case_queue_id","sla_expires_at","created_at","id") WHERE "cases"."assignee_id" is null and "cases"."status_category" <> 'end'
          and "cases"."redacted_at" is null;--> statement-breakpoint
CREATE INDEX "cases_open_assignee_idx" ON "cases" USING btree ("environment_id","assignee_id","case_queue_id") WHERE "cases"."assignee_id" is not null and "cases"."status_category" <> 'end'
          and "cases"."redacted_at" is null;--> statement-breakpoint
CREATE INDEX "cases_sla_due_idx" ON "cases" USING btree ("sla_expires_at") WHERE "cases"."sla_state" = 'running';--> statement-breakpoint
CREATE INDEX "cases_sla_calendar_idx" ON "cases" USING btree ("environment_id","sla_case_calendar_id") WHERE "cases"."sla_case_calendar_id" is not null and "cases"."sla_state" in ('running', 'paused');--> statement-breakpoint
CREATE INDEX "cases_unredacted_resolved_at_idx" ON "cases" USING btree ("resolved_at") WHERE "cases"."redacted_at" is null and "cases"."resolved_at" is not null;--> statement-breakpoint
CREATE INDEX "cases_lower_tags_idx" ON "cases" USING gin (openverify_lower_tags("tags"));--> statement-breakpoint
CREATE INDEX "user_notifications_user_created_at_id_idx" ON "user_notifications" USING btree ("environment_id","user_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "user_notifications_created_at_idx" ON "user_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "case_assignment_policies_environment_created_at_id_idx" ON "case_assignment_policies" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_calendars_environment_created_at_id_idx" ON "case_calendars" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_queue_members_user_idx" ON "case_queue_members" USING btree ("environment_id","user_id");--> statement-breakpoint
CREATE INDEX "case_queues_environment_created_at_id_idx" ON "case_queues" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_sla_policies_environment_created_at_id_idx" ON "case_sla_policies" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "case_sla_policies_calendar_idx" ON "case_sla_policies" USING btree ("environment_id","case_calendar_id") WHERE "case_sla_policies"."case_calendar_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_attachments_storage_key_key" ON "case_attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "case_attachments_case_created_at_idx" ON "case_attachments" USING btree ("environment_id","case_id","created_at","id");--> statement-breakpoint
CREATE INDEX "case_attachments_scan_pending_idx" ON "case_attachments" USING btree ("created_at") WHERE "case_attachments"."scan_status" = 'pending';--> statement-breakpoint
CREATE INDEX "case_attachments_undeleted_redacted_idx" ON "case_attachments" USING btree ("redacted_at") WHERE "case_attachments"."redacted_at" is not null and "case_attachments"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_exports_storage_key_key" ON "case_exports" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "case_exports_creator_created_at_idx" ON "case_exports" USING btree ("environment_id","creator_type","creator_id","created_at","id");--> statement-breakpoint
CREATE INDEX "case_exports_expiry_idx" ON "case_exports" USING btree ("expires_at") WHERE "case_exports"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "case_exports_unfinished_idx" ON "case_exports" USING btree ("created_at") WHERE "case_exports"."status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "file_renditions_environment_id_idx" ON "file_renditions" USING btree ("environment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rendition_pages_storage_key_key" ON "rendition_pages" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "rendition_pages_source_idx" ON "rendition_pages" USING btree ("environment_id","source_id");--> statement-breakpoint
CREATE INDEX "rendition_pages_discarded_idx" ON "rendition_pages" USING btree ("discarded_at") WHERE "rendition_pages"."discarded_at" is not null;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_case_template_ids_count" CHECK ("api_keys"."case_template_ids" is null or cardinality("api_keys"."case_template_ids") <= 100);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_creator_valid" CHECK (("workflow_runs"."creator_type" is null and "workflow_runs"."creator_id" is null)
        or ("workflow_runs"."creator_id" is not null and "workflow_runs"."creator_type" in ('user', 'api-key', 'event', 'scheduled-run', 'workflow-run', 'account-action', 'case-action')));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_caused_by_bulk_id_format" CHECK ("events"."caused_by_bulk_id" is null
        or "events"."caused_by_bulk_id" ~ '^cblk_[0-9A-HJKMNP-TV-Z]{26}$');--> statement-breakpoint
CREATE TRIGGER "case_templates_set_updated_at" BEFORE UPDATE ON "case_templates" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_template_versions_set_updated_at" BEFORE UPDATE ON "case_template_versions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "cases_set_updated_at" BEFORE UPDATE ON "cases" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_comments_set_updated_at" BEFORE UPDATE ON "case_comments" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_actions_set_updated_at" BEFORE UPDATE ON "case_actions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_bulk_actions_set_updated_at" BEFORE UPDATE ON "case_bulk_actions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_queues_set_updated_at" BEFORE UPDATE ON "case_queues" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_queue_members_set_updated_at" BEFORE UPDATE ON "case_queue_members" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_assignment_policies_set_updated_at" BEFORE UPDATE ON "case_assignment_policies" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_sla_policies_set_updated_at" BEFORE UPDATE ON "case_sla_policies" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_calendars_set_updated_at" BEFORE UPDATE ON "case_calendars" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_attachments_set_updated_at" BEFORE UPDATE ON "case_attachments" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "file_renditions_set_updated_at" BEFORE UPDATE ON "file_renditions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "case_exports_set_updated_at" BEFORE UPDATE ON "case_exports" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
-- Hand edit (C131.4, F12): a case's history is append-only. An UPDATE is always refused: it holds
-- no value, so a redaction leaves it as it is (C139.1). A DELETE is refused unless the transaction
-- deletes an environment (`openverify.environment_deletion = 'on'`) or is the C16 pass
-- (`openverify.retention = 'on'`, transaction-local, set only by that pass). The history holds no
-- sealed value, so a KEK rewrap has no case here.
CREATE OR REPLACE FUNCTION "openverify_case_history_append_only"() RETURNS trigger
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
CREATE TRIGGER "case_history_append_only" BEFORE UPDATE OR DELETE ON "case_history" FOR EACH ROW EXECUTE FUNCTION "openverify_case_history_append_only"();
