CREATE TABLE "document_extractions" (
	"environment_id" text NOT NULL,
	"verification_id" text PRIMARY KEY NOT NULL,
	"inquiry_id" text NOT NULL,
	"document_type" text NOT NULL,
	"type_confidence" double precision,
	"fields" text,
	"page_count" smallint NOT NULL,
	"mime_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "document_extractions_environment_id_verification_id_key" UNIQUE("environment_id","verification_id"),
	CONSTRAINT "document_extractions_document_type_valid" CHECK ("document_extractions"."document_type" in ('utility_bill', 'bank_statement', 'lease', 'pay_stub', 'tax_document', 'other', 'unknown')),
	CONSTRAINT "document_extractions_type_confidence_unit_interval" CHECK ("document_extractions"."type_confidence" between 0 and 1),
	CONSTRAINT "document_extractions_page_count_range" CHECK ("document_extractions"."page_count" between 1 and 50),
	CONSTRAINT "document_extractions_mime_type_valid" CHECK ("document_extractions"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'))
);
--> statement-breakpoint
CREATE TABLE "chip_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"nonce_sha256" text NOT NULL,
	"status" text NOT NULL,
	"aa_response" text,
	"device_report" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "chip_challenges_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "chip_challenges_status_valid" CHECK ("chip_challenges"."status" in ('initiated', 'submitted', 'processed', 'expired', 'superseded')),
	CONSTRAINT "chip_challenges_nonce_sha256_hex" CHECK ("chip_challenges"."nonce_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chip_challenges_id_format" CHECK ("chip_challenges"."id" ~ '^chc_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "chip_reads" (
	"environment_id" text NOT NULL,
	"verification_id" text PRIMARY KEY NOT NULL,
	"inquiry_id" text NOT NULL,
	"fields" text,
	"sod_signature" text,
	"sod_signature_index" text,
	"document_number_index" text,
	"integrity" text NOT NULL,
	"selfie_bound" boolean DEFAULT false NOT NULL,
	"issuing_country" text,
	"pa_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "chip_reads_environment_id_verification_id_key" UNIQUE("environment_id","verification_id"),
	CONSTRAINT "chip_reads_integrity_valid" CHECK ("chip_reads"."integrity" in ('established', 'broken', 'not_established')),
	CONSTRAINT "chip_reads_issuing_country_format" CHECK ("chip_reads"."issuing_country" ~ '^[A-Z<]{3}$'),
	CONSTRAINT "chip_reads_sod_signature_index_hex" CHECK ("chip_reads"."sod_signature_index" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chip_reads_document_number_index_hex" CHECK ("chip_reads"."document_number_index" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "business_registry_records" (
	"environment_id" text NOT NULL,
	"verification_id" text PRIMARY KEY NOT NULL,
	"inquiry_id" text NOT NULL,
	"source" text NOT NULL,
	"record" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "business_registry_records_environment_id_verification_id_key" UNIQUE("environment_id","verification_id"),
	CONSTRAINT "business_registry_records_source_valid" CHECK ("business_registry_records"."source" in ('gleif', 'companies-house', 'sec-edgar', 'sandbox'))
);
--> statement-breakpoint
CREATE TABLE "trust_anchor_memberships" (
	"source_id" text NOT NULL,
	"anchor_id" text NOT NULL,
	"list_signing_time" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "trust_anchor_memberships_pkey" PRIMARY KEY("source_id","anchor_id")
);
--> statement-breakpoint
CREATE TABLE "trust_anchor_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_signing_time" timestamp with time zone,
	"last_list_sha256" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_anchor_sources_id_format" CHECK ("trust_anchor_sources"."id" ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
	CONSTRAINT "trust_anchor_sources_last_list_sha256_hex" CHECK ("trust_anchor_sources"."last_list_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "trust_anchor_syncs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trust_anchor_syncs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_id" text,
	"outcome" text NOT NULL,
	"reason" text,
	"list_sha256" text,
	"list_signing_time" timestamp with time zone,
	"anchors_seen" integer DEFAULT 0 NOT NULL,
	"anchors_withdrawn" integer DEFAULT 0 NOT NULL,
	"crls_updated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_anchor_syncs_outcome_valid" CHECK ("trust_anchor_syncs"."outcome" in ('accepted', 'refused', 'failed')),
	CONSTRAINT "trust_anchor_syncs_reason_format" CHECK ("trust_anchor_syncs"."reason" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "trust_anchor_syncs_list_sha256_hex" CHECK ("trust_anchor_syncs"."list_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "trust_anchors" (
	"sha256" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"subject_dn" text NOT NULL,
	"ski" text,
	"aki" text,
	"certificate" "bytea" NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"is_link" boolean DEFAULT false NOT NULL,
	"sandbox_only" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_anchors_sha256_hex" CHECK ("trust_anchors"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "trust_anchors_country_format" CHECK ("trust_anchors"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "trust_anchors_ski_hex" CHECK ("trust_anchors"."ski" ~ '^[0-9a-f]{2,128}$'),
	CONSTRAINT "trust_anchors_aki_hex" CHECK ("trust_anchors"."aki" ~ '^[0-9a-f]{2,128}$')
);
--> statement-breakpoint
CREATE TABLE "trust_crls" (
	"sha256" text PRIMARY KEY NOT NULL,
	"issuer_country" text NOT NULL,
	"issuer_key_id" text,
	"der" "bytea" NOT NULL,
	"this_update" timestamp with time zone NOT NULL,
	"next_update" timestamp with time zone,
	"crl_number" text,
	"url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_crls_sha256_hex" CHECK ("trust_crls"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "trust_crls_issuer_country_format" CHECK ("trust_crls"."issuer_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "trust_crls_issuer_key_id_hex" CHECK ("trust_crls"."issuer_key_id" ~ '^[0-9a-f]{2,128}$'),
	CONSTRAINT "trust_crls_crl_number_decimal" CHECK ("trust_crls"."crl_number" ~ '^[0-9]{1,48}$')
);
--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chip_challenges" ADD CONSTRAINT "chip_challenges_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chip_challenges" ADD CONSTRAINT "chip_challenges_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chip_challenges" ADD CONSTRAINT "chip_challenges_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chip_reads" ADD CONSTRAINT "chip_reads_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chip_reads" ADD CONSTRAINT "chip_reads_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chip_reads" ADD CONSTRAINT "chip_reads_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_registry_records" ADD CONSTRAINT "business_registry_records_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_registry_records" ADD CONSTRAINT "business_registry_records_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_registry_records" ADD CONSTRAINT "business_registry_records_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_anchor_memberships" ADD CONSTRAINT "trust_anchor_memberships_source_fk" FOREIGN KEY ("source_id") REFERENCES "public"."trust_anchor_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_anchor_memberships" ADD CONSTRAINT "trust_anchor_memberships_anchor_fk" FOREIGN KEY ("anchor_id") REFERENCES "public"."trust_anchors"("sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_extractions_environment_id_inquiry_id_idx" ON "document_extractions" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "chip_challenges_environment_id_verification_id_created_at_idx" ON "chip_challenges" USING btree ("environment_id","verification_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "chip_challenges_environment_id_inquiry_id_idx" ON "chip_challenges" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chip_challenges_one_initiated_per_verification_key" ON "chip_challenges" USING btree ("environment_id","verification_id") WHERE "chip_challenges"."status" = 'initiated';--> statement-breakpoint
CREATE INDEX "chip_reads_environment_id_inquiry_id_idx" ON "chip_reads" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "chip_reads_environment_id_sod_signature_index_idx" ON "chip_reads" USING btree ("environment_id","sod_signature_index") WHERE "chip_reads"."sod_signature_index" is not null;--> statement-breakpoint
CREATE INDEX "chip_reads_environment_id_document_number_index_idx" ON "chip_reads" USING btree ("environment_id","document_number_index") WHERE "chip_reads"."document_number_index" is not null;--> statement-breakpoint
CREATE INDEX "business_registry_records_environment_id_inquiry_id_idx" ON "business_registry_records" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "trust_anchor_memberships_anchor_id_idx" ON "trust_anchor_memberships" USING btree ("anchor_id");--> statement-breakpoint
CREATE INDEX "trust_anchor_syncs_source_id_created_at_idx" ON "trust_anchor_syncs" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE INDEX "trust_anchors_country_idx" ON "trust_anchors" USING btree ("country");--> statement-breakpoint
CREATE INDEX "trust_anchors_ski_idx" ON "trust_anchors" USING btree ("ski") WHERE "trust_anchors"."ski" is not null;--> statement-breakpoint
CREATE INDEX "trust_crls_issuer_country_issuer_key_id_idx" ON "trust_crls" USING btree ("issuer_country","issuer_key_id");