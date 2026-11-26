CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "importers" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"list_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"mode" text DEFAULT 'all-or-nothing' NOT NULL,
	"encoding" text DEFAULT 'utf-8' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"successful_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"already_present_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"file_sha256" text NOT NULL,
	"file_bytes" integer NOT NULL,
	"storage_key" text,
	"wrapped_dek" text,
	"object_deleted_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"enqueued_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "importers_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "importers_id_format" CHECK ("importers"."id" ~ '^mprt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "importers_status_valid" CHECK ("importers"."status" in ('pending', 'ready', 'errored')),
	CONSTRAINT "importers_mode_valid" CHECK ("importers"."mode" in ('all-or-nothing', 'skip-invalid')),
	CONSTRAINT "importers_file_sha256_hex" CHECK ("importers"."file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "importers_counts_non_negative" CHECK ("importers"."row_count" >= 0 and "importers"."successful_count" >= 0 and "importers"."duplicate_count" >= 0
        and "importers"."already_present_count" >= 0 and "importers"."error_count" >= 0
        and "importers"."attempts" >= 0 and "importers"."file_bytes" >= 0),
	CONSTRAINT "importers_object_complete" CHECK (("importers"."storage_key" is null) = ("importers"."wrapped_dek" is null)),
	CONSTRAINT "importers_object_deleted" CHECK ("importers"."object_deleted_at" is null or "importers"."storage_key" is null),
	CONSTRAINT "importers_completed_at_fits_status" CHECK (("importers"."status" = 'pending') = ("importers"."completed_at" is null)),
	CONSTRAINT "importers_last_error_code_format" CHECK ("importers"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "list_import_errors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "list_import_errors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"importer_id" text NOT NULL,
	"row" integer,
	"column" text,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_import_errors_row_positive" CHECK ("list_import_errors"."row" >= 1),
	CONSTRAINT "list_import_errors_code_valid" CHECK ("list_import_errors"."code" in ('invalid_encoding', 'missing_column', 'unknown_column', 'duplicate_column', 'row_limit_exceeded', 'record_too_large', 'field_count_mismatch', 'invalid_value', 'unparseable_phone', 'host_bits_set', 'out_of_range', 'unsupported_class')),
	CONSTRAINT "list_import_errors_column_format" CHECK ("list_import_errors"."column" ~ '^[a-z][a-z_]{0,31}$')
);
--> statement-breakpoint
CREATE TABLE "list_import_rows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "list_import_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"importer_id" text NOT NULL,
	"row" integer NOT NULL,
	"value" text NOT NULL,
	"match_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_import_rows_row_positive" CHECK ("list_import_rows"."row" >= 1),
	CONSTRAINT "list_import_rows_match_key_hex" CHECK ("list_import_rows"."match_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "list_item_backgrounds" (
	"item_id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"layout" vector(144),
	"valid_cells" text,
	"coverage" double precision,
	"masked_file_key" text,
	"masked_file_wrapped_dek" text,
	"source_inquiry_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_item_backgrounds_valid_cells_format" CHECK ("list_item_backgrounds"."valid_cells" ~ '^[01]{48}$'),
	CONSTRAINT "list_item_backgrounds_coverage_unit_interval" CHECK ("list_item_backgrounds"."coverage" >= 0 and "list_item_backgrounds"."coverage" <= 1),
	CONSTRAINT "list_item_backgrounds_layout_complete" CHECK (("list_item_backgrounds"."layout" is null) = ("list_item_backgrounds"."valid_cells" is null)
        and ("list_item_backgrounds"."layout" is null) = ("list_item_backgrounds"."coverage" is null)),
	CONSTRAINT "list_item_backgrounds_mask_complete" CHECK (("list_item_backgrounds"."masked_file_key" is null) = ("list_item_backgrounds"."masked_file_wrapped_dek" is null))
);
--> statement-breakpoint
CREATE TABLE "list_item_faces" (
	"item_id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"template" text,
	"model" text,
	"source_inquiry_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_item_faces_embedded_complete" CHECK (("list_item_faces"."template" is null) = ("list_item_faces"."model" is null))
);
--> statement-breakpoint
CREATE TABLE "list_item_geo" (
	"environment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"bbox" "box" NOT NULL,
	"part" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "list_item_geo_pkey" PRIMARY KEY("item_id","part"),
	CONSTRAINT "list_item_geo_part_valid" CHECK ("list_item_geo"."part" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE "list_item_ip_ranges" (
	"item_id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"range" "cidr" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_item_keys" (
	"environment_id" text NOT NULL,
	"item_id" text NOT NULL,
	"key_kind" text NOT NULL,
	"match_key" text NOT NULL,
	CONSTRAINT "list_item_keys_pkey" PRIMARY KEY("environment_id","item_id","key_kind","match_key"),
	CONSTRAINT "list_item_keys_key_kind_valid" CHECK ("list_item_keys"."key_kind" in ('identifier-string', 'identifier-email', 'identifier-email-domain', 'identifier-phone', 'identifier-government-id-number', 'identifier-name', 'identifier-name-last', 'identifier-ip', 'identifier-ip-range', 'identifier-country', 'identifier-geolocation', 'identifier-browser-fingerprint', 'identifier-device-fingerprint', 'identifier-field')),
	CONSTRAINT "list_item_keys_match_key_hex" CHECK ("list_item_keys"."match_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "list_items" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"list_id" text NOT NULL,
	"value" text,
	"match_key" text,
	"country_code" text,
	"normaliser_version" text NOT NULL,
	"key_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"archive_reason" text,
	"match_count" integer DEFAULT 0 NOT NULL,
	"created_by_type" text,
	"created_by_id" text,
	"archived_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_items_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "list_items_id_format" CHECK ("list_items"."id" ~ '^(libf|lidf|lic|liea|lifc|ligl|ligin|liif|liip|lin|lipn|lisb|lis)_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "list_items_match_key_hex" CHECK ("list_items"."match_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "list_items_country_code_format" CHECK ("list_items"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "list_items_status_valid" CHECK ("list_items"."status" in ('pending', 'active', 'archived')),
	CONSTRAINT "list_items_archive_reason_valid" CHECK ("list_items"."archive_reason" in ('source_unavailable')),
	CONSTRAINT "list_items_key_id_format" CHECK ("list_items"."key_id" ~ '^[A-Za-z0-9_-]{11}$'),
	CONSTRAINT "list_items_match_count_non_negative" CHECK ("list_items"."match_count" >= 0),
	CONSTRAINT "list_items_created_by_type_valid" CHECK ("list_items"."created_by_type" in ('user', 'api-key', 'importer')),
	CONSTRAINT "list_items_created_by_complete" CHECK (("list_items"."created_by_type" is null) = ("list_items"."created_by_id" is null)),
	CONSTRAINT "list_items_archived_at_fits_status" CHECK (("list_items"."status" = 'archived') = ("list_items"."archived_at" is not null)),
	CONSTRAINT "list_items_redacted_is_archived" CHECK ("list_items"."redacted_at" is null or "list_items"."status" = 'archived'),
	CONSTRAINT "list_items_redacted_holds_nothing" CHECK ("list_items"."redacted_at" is null
        or ("list_items"."value" is null and "list_items"."match_key" is null
            and "list_items"."country_code" is null))
);
--> statement-breakpoint
CREATE TABLE "list_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"list_id" text NOT NULL,
	"list_item_id" text,
	"inquiry_id" text NOT NULL,
	"account_id" text,
	"source" text NOT NULL,
	"method" text NOT NULL,
	"tier" text NOT NULL,
	"confidence" double precision,
	"approximate" boolean DEFAULT false NOT NULL,
	"score" double precision,
	"distance_meters" integer,
	"list_version" integer NOT NULL,
	"matched_value" text,
	"status" text DEFAULT 'open' NOT NULL,
	"dismissed_at" timestamp with time zone,
	"reason" text,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_matches_id_format" CHECK ("list_matches"."id" ~ '^lmt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "list_matches_list_id_format" CHECK ("list_matches"."list_id" ~ '^lst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "list_matches_source_valid" CHECK ("list_matches"."source" in ('otp.email-address', 'otp.phone-number', 'inquiry.fields', 'account.fields', 'government-id.identification-number', 'government-id.name', 'government-id.issuing-country', 'database.input', 'session.ip-address', 'session.ip-country', 'session.ip-point', 'session.browser-fingerprint', 'session.device-fingerprint', 'selfie.center', 'report.query', 'request')),
	CONSTRAINT "list_matches_method_valid" CHECK ("list_matches"."method" in ('exact', 'cidr', 'radius', 'fuzzy_name', 'face_cosine', 'background')),
	CONSTRAINT "list_matches_tier_valid" CHECK ("list_matches"."tier" in ('R', 'H')),
	CONSTRAINT "list_matches_status_valid" CHECK ("list_matches"."status" in ('open', 'dismissed')),
	CONSTRAINT "list_matches_confidence_unit_interval" CHECK ("list_matches"."confidence" >= 0 and "list_matches"."confidence" <= 1),
	CONSTRAINT "list_matches_score_unit_interval" CHECK ("list_matches"."score" >= 0 and "list_matches"."score" <= 1),
	CONSTRAINT "list_matches_distance_non_negative" CHECK ("list_matches"."distance_meters" >= 0),
	CONSTRAINT "list_matches_list_version_positive" CHECK ("list_matches"."list_version" >= 1),
	CONSTRAINT "list_matches_dismissed_at_fits_status" CHECK (("list_matches"."status" = 'dismissed') = ("list_matches"."dismissed_at" is not null)),
	CONSTRAINT "list_matches_redacted_holds_nothing" CHECK ("list_matches"."redacted_at" is null
        or ("list_matches"."matched_value" is null and "list_matches"."reason" is null))
);
--> statement-breakpoint
CREATE TABLE "list_screenings" (
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"trigger_status" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"match_count" integer,
	"unscreened" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"not_applicable" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_cause" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"enqueued_at" timestamp with time zone,
	"screened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_screenings_pkey" PRIMARY KEY("environment_id","inquiry_id"),
	CONSTRAINT "list_screenings_trigger_valid" CHECK ("list_screenings"."trigger_status" in ('completed', 'failed', 'expired')),
	CONSTRAINT "list_screenings_status_valid" CHECK ("list_screenings"."status" in ('pending', 'completed', 'partial', 'errored')),
	CONSTRAINT "list_screenings_review_cause_valid" CHECK ("list_screenings"."review_cause" in ('list_match', 'list_unscreened', 'inquiry_already_decided')),
	CONSTRAINT "list_screenings_attempts_non_negative" CHECK ("list_screenings"."attempts" >= 0),
	CONSTRAINT "list_screenings_match_count_non_negative" CHECK ("list_screenings"."match_count" >= 0),
	CONSTRAINT "list_screenings_completed_has_count" CHECK ("list_screenings"."status" <> 'completed' or "list_screenings"."match_count" is not null),
	CONSTRAINT "list_screenings_ended_has_time" CHECK ("list_screenings"."status" = 'pending' or "list_screenings"."screened_at" is not null),
	CONSTRAINT "list_screenings_last_error_code_format" CHECK ("list_screenings"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"item_retention_days" integer,
	"screen_at_completion" boolean DEFAULT true NOT NULL,
	"field_key" text,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"default_region" text,
	"use_for_compromised_ids" boolean DEFAULT false NOT NULL,
	"allow_fuzzy_name_first" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "lists_id_format" CHECK ("lists"."id" ~ '^lst_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "lists_type_valid" CHECK ("lists"."type" in ('browser-fingerprint', 'device-fingerprint', 'country', 'email-address', 'face', 'geolocation', 'government-id-number', 'field', 'ip-address', 'name', 'phone-number', 'selfie-background', 'string')),
	CONSTRAINT "lists_status_valid" CHECK ("lists"."status" in ('active', 'archived')),
	CONSTRAINT "lists_version_positive" CHECK ("lists"."version" >= 1),
	CONSTRAINT "lists_item_count_non_negative" CHECK ("lists"."item_count" >= 0),
	CONSTRAINT "lists_item_retention_days_range" CHECK ("lists"."item_retention_days" between 1 and 3650),
	CONSTRAINT "lists_archived_at_fits_status" CHECK (("lists"."status" = 'archived') = ("lists"."archived_at" is not null)),
	CONSTRAINT "lists_field_key_fits_type" CHECK (("lists"."type" = 'field') = ("lists"."field_key" is not null)),
	CONSTRAINT "lists_default_region_fits_type" CHECK ("lists"."default_region" is null or "lists"."type" = 'phone-number'),
	CONSTRAINT "lists_default_region_format" CHECK ("lists"."default_region" ~ '^[A-Z]{2}$'),
	CONSTRAINT "lists_compromised_fits_type" CHECK (not "lists"."use_for_compromised_ids" or "lists"."type" = 'government-id-number'),
	CONSTRAINT "lists_fuzzy_fits_type" CHECK (not "lists"."allow_fuzzy_name_first" or "lists"."type" = 'name'),
	CONSTRAINT "lists_case_sensitive_fits_type" CHECK (not "lists"."case_sensitive" or "lists"."type" = 'string'),
	CONSTRAINT "lists_biometric_retention" CHECK (not "lists"."type" in ('face', 'selfie-background') or "lists"."item_retention_days" is not null)
);
--> statement-breakpoint
CREATE TABLE "transaction_field_keys" (
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"field_key" text NOT NULL,
	"value_key" text NOT NULL,
	CONSTRAINT "transaction_field_keys_pkey" PRIMARY KEY("environment_id","transaction_id","field_key","value_key"),
	CONSTRAINT "transaction_field_keys_field_key_format" CHECK ("transaction_field_keys"."field_key" ~ '^[a-z0-9][a-z0-9_-]*$'
      and char_length("transaction_field_keys"."field_key") <= 64),
	CONSTRAINT "transaction_field_keys_value_key_hex" CHECK ("transaction_field_keys"."value_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "transaction_files" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"field_key" text NOT NULL,
	"filename" text,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"wrapped_dek" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_files_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "transaction_files_id_format" CHECK ("transaction_files"."id" ~ '^txnf_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "transaction_files_field_key_format" CHECK ("transaction_files"."field_key" ~ '^[a-z0-9][a-z0-9_-]*$'
      and char_length("transaction_files"."field_key") <= 64),
	CONSTRAINT "transaction_files_sha256_hex" CHECK ("transaction_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transaction_files_byte_size_non_negative" CHECK ("transaction_files"."byte_size" >= 0),
	CONSTRAINT "transaction_files_filename_until_redacted" CHECK ("transaction_files"."filename" is not null or "transaction_files"."redacted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "transaction_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"label" text,
	"model_version" text,
	"score" double precision,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_labels_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "transaction_labels_id_format" CHECK ("transaction_labels"."id" ~ '^txnl_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "transaction_labels_label_until_redacted" CHECK ("transaction_labels"."label" is not null or "transaction_labels"."redacted_at" is not null),
	CONSTRAINT "transaction_labels_label_length" CHECK (char_length("transaction_labels"."label") between 1 and 64),
	CONSTRAINT "transaction_labels_model_version_length" CHECK (char_length("transaction_labels"."model_version") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "transaction_objects" (
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text,
	"inquiry_id" text,
	"report_id" text,
	"verification_id" text,
	"object_id" text GENERATED ALWAYS AS (coalesce("account_id", "inquiry_id", "report_id", "verification_id")) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_objects_pkey" PRIMARY KEY("environment_id","transaction_id","object_id"),
	CONSTRAINT "transaction_objects_one_target" CHECK (num_nonnulls("transaction_objects"."account_id", "transaction_objects"."inquiry_id", "transaction_objects"."report_id",
        "transaction_objects"."verification_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "transaction_relations" (
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"relation_schema_key" text NOT NULL,
	"account_id" text,
	"related_transaction_id" text,
	"target_id" text GENERATED ALWAYS AS (coalesce("account_id", "related_transaction_id")) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_relations_pkey" PRIMARY KEY("environment_id","transaction_id","relation_schema_key","target_id"),
	CONSTRAINT "transaction_relations_key_format" CHECK ("transaction_relations"."relation_schema_key" ~ '^[a-z0-9][a-z0-9_-]*$'
      and char_length("transaction_relations"."relation_schema_key") <= 64),
	CONSTRAINT "transaction_relations_one_target" CHECK (num_nonnulls("transaction_relations"."account_id", "transaction_relations"."related_transaction_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "transaction_status_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transaction_status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_status_history_from_status_format" CHECK ("transaction_status_history"."from_status" ~ '^[a-z0-9][a-z0-9 _-]*$'
      and char_length("transaction_status_history"."from_status") <= 64),
	CONSTRAINT "transaction_status_history_to_status_format" CHECK ("transaction_status_history"."to_status" ~ '^[a-z0-9][a-z0-9 _-]*$'
      and char_length("transaction_status_history"."to_status") <= 64),
	CONSTRAINT "transaction_status_history_status_until_redacted" CHECK ("transaction_status_history"."to_status" is not null or "transaction_status_history"."redacted_at" is not null),
	CONSTRAINT "transaction_status_history_actor_valid" CHECK (("transaction_status_history"."actor_type" = 'system' and "transaction_status_history"."actor_id" is null)
        or ("transaction_status_history"."actor_type" = 'user' and "transaction_status_history"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_status_history"."actor_type" = 'api_key' and "transaction_status_history"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$'))
);
--> statement-breakpoint
CREATE TABLE "transaction_type_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"transaction_type_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"field_schemas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"statuses" text[] NOT NULL,
	"relation_schemas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_card_like_strings" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_type_versions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "transaction_type_versions_id_format" CHECK ("transaction_type_versions"."id" ~ '^txntpv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "transaction_type_versions_version_positive" CHECK ("transaction_type_versions"."version" >= 1),
	CONSTRAINT "transaction_type_versions_status_valid" CHECK ("transaction_type_versions"."status" in ('draft', 'published', 'superseded')),
	CONSTRAINT "transaction_type_versions_published_at" CHECK (("transaction_type_versions"."status" = 'draft') = ("transaction_type_versions"."published_at" is null)),
	CONSTRAINT "transaction_type_versions_created_first" CHECK ("transaction_type_versions"."statuses"[1] is not distinct from 'created'),
	CONSTRAINT "transaction_type_versions_statuses_count" CHECK (cardinality("transaction_type_versions"."statuses") <= 50),
	CONSTRAINT "transaction_type_versions_field_schemas_array" CHECK (jsonb_typeof("transaction_type_versions"."field_schemas") = 'array'),
	CONSTRAINT "transaction_type_versions_relation_schemas_array" CHECK (jsonb_typeof("transaction_type_versions"."relation_schemas") = 'array')
);
--> statement-breakpoint
CREATE TABLE "transaction_types" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_types_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "transaction_types_id_format" CHECK ("transaction_types"."id" ~ '^txntp_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "transaction_types_status_valid" CHECK ("transaction_types"."status" in ('active', 'archived')),
	CONSTRAINT "transaction_types_name_length" CHECK (char_length("transaction_types"."name") between 1 and 255)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"transaction_type_id" text NOT NULL,
	"transaction_type_version_id" text NOT NULL,
	"reference_id" text,
	"status" text NOT NULL,
	"fields" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"redacted_at" timestamp with time zone,
	"biometrics_redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "transactions_tags_valid" CHECK (openverify_tags_valid("transactions"."tags")),
	CONSTRAINT "transactions_id_format" CHECK ("transactions"."id" ~ '^txn_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "transactions_transaction_type_id_format" CHECK ("transactions"."transaction_type_id" ~ '^txntp_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "transactions_transaction_type_version_id_format" CHECK ("transactions"."transaction_type_version_id" ~ '^txntpv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "transactions_status_format" CHECK ("transactions"."status" ~ '^[a-z0-9][a-z0-9 _-]*$'
      and char_length("transactions"."status") <= 64),
	CONSTRAINT "transactions_reference_id_length" CHECK (char_length("transactions"."reference_id") between 1 and 255),
	CONSTRAINT "transactions_fields_until_redacted" CHECK ("transactions"."fields" is not null or "transactions"."redacted_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "graph_attributes" (
	"environment_id" text NOT NULL,
	"kind" smallint NOT NULL,
	"value_key" text NOT NULL,
	"key_id" text NOT NULL,
	"account_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"inquiry_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_attributes_pkey" PRIMARY KEY("environment_id","kind","value_key","account_id","source_type","source_id"),
	CONSTRAINT "graph_attributes_kind_valid" CHECK ("graph_attributes"."kind" in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)),
	CONSTRAINT "graph_attributes_value_key_format" CHECK ("graph_attributes"."value_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "graph_attributes_key_id_format" CHECK ("graph_attributes"."key_id" ~ '^[A-Za-z0-9_-]{11}$'),
	CONSTRAINT "graph_attributes_source_type_valid" CHECK ("graph_attributes"."source_type" in ('account', 'inquiry', 'inquiry-session', 'verification')),
	CONSTRAINT "graph_attributes_source_id_format" CHECK (("graph_attributes"."source_type" = 'account' and "graph_attributes"."source_id" ~ '^acc_[0-9A-HJKMNP-TV-Z]{26}$') or ("graph_attributes"."source_type" = 'inquiry' and "graph_attributes"."source_id" ~ '^inq_[0-9A-HJKMNP-TV-Z]{26}$') or ("graph_attributes"."source_type" = 'inquiry-session' and "graph_attributes"."source_id" ~ '^iqse_[0-9A-HJKMNP-TV-Z]{26}$') or ("graph_attributes"."source_type" = 'verification' and "graph_attributes"."source_id" ~ '^ver_[0-9A-HJKMNP-TV-Z]{26}$')),
	CONSTRAINT "graph_attributes_inquiry_of_source" CHECK (("graph_attributes"."source_type" = 'account') = ("graph_attributes"."inquiry_id" is null)),
	CONSTRAINT "graph_attributes_inquiry_source_id" CHECK ("graph_attributes"."source_type" <> 'inquiry' or "graph_attributes"."source_id" = "graph_attributes"."inquiry_id"),
	CONSTRAINT "graph_attributes_seen_order" CHECK ("graph_attributes"."last_seen_at" >= "graph_attributes"."first_seen_at")
);
--> statement-breakpoint
CREATE TABLE "graph_components" (
	"environment_id" text NOT NULL,
	"account_id" text NOT NULL,
	"component_id" text NOT NULL,
	"size" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "graph_components_pkey" PRIMARY KEY("environment_id","account_id"),
	CONSTRAINT "graph_components_component_id_length" CHECK (char_length("graph_components"."component_id") between 1 and 64),
	CONSTRAINT "graph_components_size_positive" CHECK ("graph_components"."size" >= 1)
);
--> statement-breakpoint
CREATE TABLE "graph_index_jobs" (
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"trigger_status" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"enqueued_at" timestamp with time zone,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_index_jobs_pkey" PRIMARY KEY("environment_id","inquiry_id"),
	CONSTRAINT "graph_index_jobs_trigger_valid" CHECK ("graph_index_jobs"."trigger_status" in ('completed', 'failed', 'expired')),
	CONSTRAINT "graph_index_jobs_status_valid" CHECK ("graph_index_jobs"."status" in ('pending', 'completed', 'skipped', 'errored')),
	CONSTRAINT "graph_index_jobs_attempts_non_negative" CHECK ("graph_index_jobs"."attempts" >= 0),
	CONSTRAINT "graph_index_jobs_ended_has_time" CHECK (("graph_index_jobs"."status" = 'pending') = ("graph_index_jobs"."indexed_at" is null)),
	CONSTRAINT "graph_index_jobs_last_error_code_format" CHECK ("graph_index_jobs"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "graph_index_state" (
	"environment_id" text NOT NULL,
	"kind" smallint NOT NULL,
	"indexed_since" timestamp with time zone DEFAULT now() NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"backfill_cursor" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_index_state_pkey" PRIMARY KEY("environment_id","kind"),
	CONSTRAINT "graph_index_state_kind_valid" CHECK ("graph_index_state"."kind" in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)),
	CONSTRAINT "graph_index_state_completed_at" CHECK ("graph_index_state"."complete" = ("graph_index_state"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "graph_queries" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"graph_query_template_id" text NOT NULL,
	"graph_query_template_version_id" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"params" text,
	"timeout_seconds" integer DEFAULT 30 NOT NULL,
	"run_sync" boolean DEFAULT false NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"node_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"account_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"kinds_not_indexed" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"skipped_hub_values" integer DEFAULT 0 NOT NULL,
	"node_limit_reached" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"enqueued_at" timestamp with time zone,
	"errored_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_queries_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "graph_queries_id_format" CHECK ("graph_queries"."id" ~ '^grphq_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "graph_queries_status_valid" CHECK ("graph_queries"."status" in ('submitted', 'completed', 'errored', 'cancelled', 'timed_out')),
	CONSTRAINT "graph_queries_timeout_range" CHECK ("graph_queries"."timeout_seconds" between 1 and 59),
	CONSTRAINT "graph_queries_completed_at" CHECK (("graph_queries"."status" = 'completed') = ("graph_queries"."completed_at" is not null)),
	CONSTRAINT "graph_queries_errored_at" CHECK (("graph_queries"."status" = 'errored') = ("graph_queries"."errored_at" is not null)),
	CONSTRAINT "graph_queries_params_until_redacted" CHECK ("graph_queries"."redacted_at" is not null or "graph_queries"."params" is not null),
	CONSTRAINT "graph_queries_redacted_empty" CHECK ("graph_queries"."redacted_at" is null or ("graph_queries"."params" is null
        and "graph_queries"."nodes" = '[]'::jsonb and "graph_queries"."links" = '[]'::jsonb
        and "graph_queries"."node_map" = '{}'::jsonb and cardinality("graph_queries"."account_ids") = 0)),
	CONSTRAINT "graph_queries_kinds_not_indexed_valid" CHECK ("graph_queries"."kinds_not_indexed" <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]::smallint[]),
	CONSTRAINT "graph_queries_skipped_hub_values_non_negative" CHECK ("graph_queries"."skipped_hub_values" >= 0),
	CONSTRAINT "graph_queries_attempts_non_negative" CHECK ("graph_queries"."attempts" >= 0),
	CONSTRAINT "graph_queries_last_error_code_format" CHECK ("graph_queries"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE TABLE "graph_query_template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"graph_query_template_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_query_template_versions_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "graph_query_template_versions_id_format" CHECK ("graph_query_template_versions"."id" ~ '^grqtv_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "graph_query_template_versions_version_positive" CHECK ("graph_query_template_versions"."version" >= 1),
	CONSTRAINT "graph_query_template_versions_status_valid" CHECK ("graph_query_template_versions"."status" in ('draft', 'published', 'superseded')),
	CONSTRAINT "graph_query_template_versions_published_at" CHECK (("graph_query_template_versions"."status" = 'draft') = ("graph_query_template_versions"."published_at" is null))
);
--> statement-breakpoint
CREATE TABLE "graph_query_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_query_templates_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "graph_query_templates_id_format" CHECK ("graph_query_templates"."id" ~ '^grqt_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "graph_query_templates_status_valid" CHECK ("graph_query_templates"."status" in ('active', 'archived')),
	CONSTRAINT "graph_query_templates_name_length" CHECK (char_length("graph_query_templates"."name") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "report_templates" DROP CONSTRAINT "report_templates_report_type_valid";--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_report_type_valid";--> statement-breakpoint
ALTER TABLE "inquiry_template_versions" ADD COLUMN "list_config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "importers" ADD CONSTRAINT "importers_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importers" ADD CONSTRAINT "importers_list_fk" FOREIGN KEY ("environment_id","list_id") REFERENCES "public"."lists"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_import_errors" ADD CONSTRAINT "list_import_errors_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_import_errors" ADD CONSTRAINT "list_import_errors_importer_fk" FOREIGN KEY ("environment_id","importer_id") REFERENCES "public"."importers"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_import_rows" ADD CONSTRAINT "list_import_rows_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_import_rows" ADD CONSTRAINT "list_import_rows_importer_fk" FOREIGN KEY ("environment_id","importer_id") REFERENCES "public"."importers"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_backgrounds" ADD CONSTRAINT "list_item_backgrounds_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_backgrounds" ADD CONSTRAINT "list_item_backgrounds_item_fk" FOREIGN KEY ("environment_id","item_id") REFERENCES "public"."list_items"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_backgrounds" ADD CONSTRAINT "list_item_backgrounds_source_inquiry_fk" FOREIGN KEY ("environment_id","source_inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_faces" ADD CONSTRAINT "list_item_faces_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_faces" ADD CONSTRAINT "list_item_faces_item_fk" FOREIGN KEY ("environment_id","item_id") REFERENCES "public"."list_items"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_faces" ADD CONSTRAINT "list_item_faces_source_inquiry_fk" FOREIGN KEY ("environment_id","source_inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_geo" ADD CONSTRAINT "list_item_geo_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_geo" ADD CONSTRAINT "list_item_geo_item_fk" FOREIGN KEY ("environment_id","item_id") REFERENCES "public"."list_items"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_ip_ranges" ADD CONSTRAINT "list_item_ip_ranges_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_ip_ranges" ADD CONSTRAINT "list_item_ip_ranges_item_fk" FOREIGN KEY ("environment_id","item_id") REFERENCES "public"."list_items"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_keys" ADD CONSTRAINT "list_item_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item_keys" ADD CONSTRAINT "list_item_keys_item_fk" FOREIGN KEY ("environment_id","item_id") REFERENCES "public"."list_items"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_fk" FOREIGN KEY ("environment_id","list_id") REFERENCES "public"."lists"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_matches" ADD CONSTRAINT "list_matches_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_matches" ADD CONSTRAINT "list_matches_list_fk" FOREIGN KEY ("environment_id","list_id") REFERENCES "public"."lists"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_matches" ADD CONSTRAINT "list_matches_item_fk" FOREIGN KEY ("environment_id","list_item_id") REFERENCES "public"."list_items"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_matches" ADD CONSTRAINT "list_matches_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_matches" ADD CONSTRAINT "list_matches_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_screenings" ADD CONSTRAINT "list_screenings_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_screenings" ADD CONSTRAINT "list_screenings_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_field_keys" ADD CONSTRAINT "transaction_field_keys_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_field_keys" ADD CONSTRAINT "transaction_field_keys_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_files" ADD CONSTRAINT "transaction_files_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_files" ADD CONSTRAINT "transaction_files_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_objects" ADD CONSTRAINT "transaction_objects_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_objects" ADD CONSTRAINT "transaction_objects_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_objects" ADD CONSTRAINT "transaction_objects_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_objects" ADD CONSTRAINT "transaction_objects_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_objects" ADD CONSTRAINT "transaction_objects_report_fk" FOREIGN KEY ("environment_id","report_id") REFERENCES "public"."reports"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_objects" ADD CONSTRAINT "transaction_objects_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_relations" ADD CONSTRAINT "transaction_relations_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_relations" ADD CONSTRAINT "transaction_relations_owner_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_relations" ADD CONSTRAINT "transaction_relations_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_relations" ADD CONSTRAINT "transaction_relations_transaction_fk" FOREIGN KEY ("environment_id","related_transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_status_history" ADD CONSTRAINT "transaction_status_history_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_status_history" ADD CONSTRAINT "transaction_status_history_transaction_fk" FOREIGN KEY ("environment_id","transaction_id") REFERENCES "public"."transactions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_type_versions" ADD CONSTRAINT "transaction_type_versions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_type_versions" ADD CONSTRAINT "transaction_type_versions_type_fk" FOREIGN KEY ("environment_id","transaction_type_id") REFERENCES "public"."transaction_types"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_types" ADD CONSTRAINT "transaction_types_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_fk" FOREIGN KEY ("environment_id","transaction_type_id") REFERENCES "public"."transaction_types"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_version_fk" FOREIGN KEY ("environment_id","transaction_type_version_id") REFERENCES "public"."transaction_type_versions"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_attributes" ADD CONSTRAINT "graph_attributes_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_attributes" ADD CONSTRAINT "graph_attributes_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_attributes" ADD CONSTRAINT "graph_attributes_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_components" ADD CONSTRAINT "graph_components_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_components" ADD CONSTRAINT "graph_components_account_fk" FOREIGN KEY ("environment_id","account_id") REFERENCES "public"."accounts"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_index_jobs" ADD CONSTRAINT "graph_index_jobs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_index_jobs" ADD CONSTRAINT "graph_index_jobs_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_index_state" ADD CONSTRAINT "graph_index_state_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_queries" ADD CONSTRAINT "graph_queries_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_queries" ADD CONSTRAINT "graph_queries_template_fk" FOREIGN KEY ("environment_id","graph_query_template_id") REFERENCES "public"."graph_query_templates"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_queries" ADD CONSTRAINT "graph_queries_template_version_fk" FOREIGN KEY ("environment_id","graph_query_template_version_id") REFERENCES "public"."graph_query_template_versions"("environment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_query_template_versions" ADD CONSTRAINT "graph_query_template_versions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_query_template_versions" ADD CONSTRAINT "graph_query_template_versions_template_fk" FOREIGN KEY ("environment_id","graph_query_template_id") REFERENCES "public"."graph_query_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_query_templates" ADD CONSTRAINT "graph_query_templates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "importers_environment_id_created_at_id_idx" ON "importers" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "importers_environment_id_list_id_created_at_id_idx" ON "importers" USING btree ("environment_id","list_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "importers_file_idempotency_idx" ON "importers" USING btree ("environment_id","list_id","mode","file_sha256","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "importers_pending_idx" ON "importers" USING btree ("created_at") WHERE "importers"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "importers_object_purge_idx" ON "importers" USING btree ("completed_at") WHERE "importers"."storage_key" is not null and "importers"."status" <> 'pending';--> statement-breakpoint
CREATE INDEX "list_import_errors_importer_row_idx" ON "list_import_errors" USING btree ("importer_id","row","id");--> statement-breakpoint
CREATE UNIQUE INDEX "list_import_rows_importer_row_key" ON "list_import_rows" USING btree ("importer_id","row");--> statement-breakpoint
CREATE INDEX "list_import_rows_importer_match_key_idx" ON "list_import_rows" USING btree ("importer_id","match_key");--> statement-breakpoint
CREATE INDEX "list_item_backgrounds_environment_id_source_inquiry_id_idx" ON "list_item_backgrounds" USING btree ("environment_id","source_inquiry_id");--> statement-breakpoint
CREATE INDEX "list_item_faces_environment_id_source_inquiry_id_idx" ON "list_item_faces" USING btree ("environment_id","source_inquiry_id");--> statement-breakpoint
CREATE INDEX "list_item_geo_bbox_idx" ON "list_item_geo" USING gist ("bbox" box_ops);--> statement-breakpoint
CREATE INDEX "list_item_ip_ranges_range_idx" ON "list_item_ip_ranges" USING spgist ("range" inet_ops);--> statement-breakpoint
CREATE INDEX "list_item_keys_environment_id_key_kind_match_key_idx" ON "list_item_keys" USING btree ("environment_id","key_kind","match_key");--> statement-breakpoint
CREATE UNIQUE INDEX "list_items_active_match_key_key" ON "list_items" USING btree ("environment_id","list_id","match_key") WHERE "list_items"."archived_at" is null and "list_items"."redacted_at" is null;--> statement-breakpoint
CREATE INDEX "list_items_environment_id_country_code_idx" ON "list_items" USING btree ("environment_id","country_code") WHERE "list_items"."country_code" is not null and "list_items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "list_items_environment_id_list_id_created_at_id_idx" ON "list_items" USING btree ("environment_id","list_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "list_matches_inquiry_item_source_key" ON "list_matches" USING btree ("environment_id","inquiry_id","list_item_id","source") WHERE "list_matches"."list_item_id" is not null;--> statement-breakpoint
CREATE INDEX "list_matches_environment_id_created_at_id_idx" ON "list_matches" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "list_matches_environment_id_inquiry_id_created_at_id_idx" ON "list_matches" USING btree ("environment_id","inquiry_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "list_matches_environment_id_account_id_created_at_id_idx" ON "list_matches" USING btree ("environment_id","account_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "list_matches_environment_id_list_id_created_at_id_idx" ON "list_matches" USING btree ("environment_id","list_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "list_screenings_pending_idx" ON "list_screenings" USING btree ("created_at") WHERE "list_screenings"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "lists_environment_id_created_at_id_idx" ON "lists" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "lists_environment_id_type_active_idx" ON "lists" USING btree ("environment_id","type") WHERE "lists"."status" = 'active';--> statement-breakpoint
CREATE INDEX "transaction_field_keys_lookup_idx" ON "transaction_field_keys" USING btree ("environment_id","field_key","value_key","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_files_storage_key_key" ON "transaction_files" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_files_one_live_per_field_key" ON "transaction_files" USING btree ("environment_id","transaction_id","field_key") WHERE "transaction_files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "transaction_files_undeleted_redacted_idx" ON "transaction_files" USING btree ("redacted_at") WHERE "transaction_files"."redacted_at" is not null and "transaction_files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "transaction_labels_transaction_created_at_id_idx" ON "transaction_labels" USING btree ("environment_id","transaction_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "transaction_objects_environment_id_object_id_idx" ON "transaction_objects" USING btree ("environment_id","object_id","created_at" DESC NULLS FIRST,"transaction_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "transaction_relations_environment_id_target_id_idx" ON "transaction_relations" USING btree ("environment_id","target_id");--> statement-breakpoint
CREATE INDEX "transaction_status_history_transaction_created_at_id_idx" ON "transaction_status_history" USING btree ("environment_id","transaction_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_type_versions_transaction_type_id_version_key" ON "transaction_type_versions" USING btree ("transaction_type_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_type_versions_one_published_key" ON "transaction_type_versions" USING btree ("transaction_type_id") WHERE "transaction_type_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "transaction_type_versions_env_type_created_at_id_idx" ON "transaction_type_versions" USING btree ("environment_id","transaction_type_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "transaction_types_environment_id_created_at_id_idx" ON "transaction_types" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "transactions_environment_id_created_at_id_idx" ON "transactions" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "transactions_environment_id_type_status_created_at_id_idx" ON "transactions" USING btree ("environment_id","transaction_type_id","status","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "transactions_environment_id_reference_id_idx" ON "transactions" USING btree ("environment_id","reference_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "transactions"."reference_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_unredacted_created_at_idx" ON "transactions" USING btree ("created_at") WHERE "transactions"."redacted_at" is null;--> statement-breakpoint
CREATE INDEX "transactions_lower_tags_idx" ON "transactions" USING gin (openverify_lower_tags("tags"));--> statement-breakpoint
CREATE INDEX "graph_attributes_environment_id_account_id_kind_idx" ON "graph_attributes" USING btree ("environment_id","account_id","kind","value_key");--> statement-breakpoint
CREATE INDEX "graph_attributes_environment_id_inquiry_id_idx" ON "graph_attributes" USING btree ("environment_id","inquiry_id") WHERE "graph_attributes"."inquiry_id" is not null;--> statement-breakpoint
CREATE INDEX "graph_components_environment_id_component_id_idx" ON "graph_components" USING btree ("environment_id","component_id");--> statement-breakpoint
CREATE INDEX "graph_index_jobs_pending_idx" ON "graph_index_jobs" USING btree ("created_at") WHERE "graph_index_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "graph_index_state_incomplete_idx" ON "graph_index_state" USING btree ("environment_id") WHERE not "graph_index_state"."complete";--> statement-breakpoint
CREATE INDEX "graph_queries_environment_id_created_at_id_idx" ON "graph_queries" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "graph_queries_environment_id_template_created_at_id_idx" ON "graph_queries" USING btree ("environment_id","graph_query_template_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "graph_queries_submitted_idx" ON "graph_queries" USING btree ("created_at") WHERE "graph_queries"."status" = 'submitted';--> statement-breakpoint
CREATE INDEX "graph_queries_unredacted_created_at_idx" ON "graph_queries" USING btree ("created_at") WHERE "graph_queries"."redacted_at" is null;--> statement-breakpoint
CREATE INDEX "graph_queries_account_ids_idx" ON "graph_queries" USING gin ("account_ids");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_query_template_versions_template_id_version_key" ON "graph_query_template_versions" USING btree ("graph_query_template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_query_template_versions_one_published_key" ON "graph_query_template_versions" USING btree ("graph_query_template_id") WHERE "graph_query_template_versions"."status" = 'published';--> statement-breakpoint
CREATE INDEX "graph_query_template_versions_env_template_created_at_id_idx" ON "graph_query_template_versions" USING btree ("environment_id","graph_query_template_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "graph_query_templates_environment_id_created_at_id_idx" ON "graph_query_templates" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_report_type_valid" CHECK ("report_templates"."report_type" in ('watchlist', 'business-watchlist', 'crypto-address-watchlist', 'politically-exposed-person', 'adverse-media', 'business-adverse-media', 'email-address', 'phone-number', 'address-lookup', 'ip-address', 'custom-list'));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_report_type_valid" CHECK ("reports"."report_type" in ('watchlist', 'business-watchlist', 'crypto-address-watchlist', 'politically-exposed-person', 'adverse-media', 'business-adverse-media', 'email-address', 'phone-number', 'address-lookup', 'ip-address', 'custom-list'));--> statement-breakpoint
CREATE TRIGGER "lists_set_updated_at" BEFORE UPDATE ON "lists" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "list_items_set_updated_at" BEFORE UPDATE ON "list_items" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "list_matches_set_updated_at" BEFORE UPDATE ON "list_matches" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "list_screenings_set_updated_at" BEFORE UPDATE ON "list_screenings" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "importers_set_updated_at" BEFORE UPDATE ON "importers" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "transaction_types_set_updated_at" BEFORE UPDATE ON "transaction_types" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "transaction_type_versions_set_updated_at" BEFORE UPDATE ON "transaction_type_versions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "transactions_set_updated_at" BEFORE UPDATE ON "transactions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "transaction_labels_set_updated_at" BEFORE UPDATE ON "transaction_labels" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "transaction_files_set_updated_at" BEFORE UPDATE ON "transaction_files" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "graph_index_jobs_set_updated_at" BEFORE UPDATE ON "graph_index_jobs" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "graph_index_state_set_updated_at" BEFORE UPDATE ON "graph_index_state" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "graph_query_templates_set_updated_at" BEFORE UPDATE ON "graph_query_templates" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "graph_query_template_versions_set_updated_at" BEFORE UPDATE ON "graph_query_template_versions" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "graph_queries_set_updated_at" BEFORE UPDATE ON "graph_queries" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
-- Hand edit (C105.4, C105.5; the C73.2 pattern): a transaction's status history and labels are
-- append-only. The one UPDATE allowed is a transaction redaction
-- (`openverify.transaction_redaction = 'on'`, transaction-local, set only by the redaction
-- repository) that nulls the trigger's free-text columns and stamps `redacted_at`, with every other
-- column unchanged. A DELETE is refused unless the transaction deletes an environment
-- (`openverify.environment_deletion = 'on'`): transactions are redacted, never deleted (C105.5).
-- Neither table holds a sealed value, so a KEK rewrap has no case here.
CREATE OR REPLACE FUNCTION "openverify_transaction_history_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  free_text text[] := TG_ARGV[0:];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('openverify.environment_deletion', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END IF;
  IF coalesce(current_setting('openverify.transaction_redaction', true), '') = 'on'
     AND NEW."redacted_at" IS NOT NULL
     AND (to_jsonb(NEW) - free_text - 'redacted_at' - 'updated_at')
       = (to_jsonb(OLD) - free_text - 'redacted_at' - 'updated_at')
     AND NOT EXISTS (
       SELECT 1 FROM unnest(free_text) AS member(name) WHERE to_jsonb(NEW) ->> member.name IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "transaction_status_history_append_only" BEFORE UPDATE OR DELETE ON "transaction_status_history" FOR EACH ROW EXECUTE FUNCTION "openverify_transaction_history_append_only"('from_status', 'to_status');--> statement-breakpoint
CREATE TRIGGER "transaction_labels_append_only" BEFORE UPDATE OR DELETE ON "transaction_labels" FOR EACH ROW EXECUTE FUNCTION "openverify_transaction_history_append_only"('label', 'model_version');--> statement-breakpoint
-- Hand edit (C101.5, H10, V11): every environment that exists before this migration starts each
-- graph kind (the codes of GRAPH_KIND_REGISTRY, 1-18) incomplete, so `graph-backfill` indexes what
-- it already holds. An environment created later has no row, which reads complete.
INSERT INTO "graph_index_state" ("environment_id", "kind", "complete")
SELECT "environments"."id", "kinds"."code", false
  FROM "environments" CROSS JOIN generate_series(1, 18) AS "kinds"("code");