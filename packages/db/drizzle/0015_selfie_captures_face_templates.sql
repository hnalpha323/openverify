-- C42.5: the background layout is a pgvector column; the migration that needs it creates it.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "face_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"source" text DEFAULT 'selfie' NOT NULL,
	"model" text NOT NULL,
	"template" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "face_templates_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "face_templates_source_valid" CHECK ("face_templates"."source" in ('selfie')),
	CONSTRAINT "face_templates_id_format" CHECK ("face_templates"."id" ~ '^ftpl_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "selfie_backgrounds" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"face_template_id" text NOT NULL,
	"layout" vector(144) NOT NULL,
	"valid_cells" text NOT NULL,
	"coverage" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selfie_backgrounds_valid_cells_format" CHECK ("selfie_backgrounds"."valid_cells" ~ '^[01]{48}$'),
	CONSTRAINT "selfie_backgrounds_coverage_unit_interval" CHECK ("selfie_backgrounds"."coverage" >= 0 and "selfie_backgrounds"."coverage" <= 1),
	CONSTRAINT "selfie_backgrounds_id_format" CHECK ("selfie_backgrounds"."id" ~ '^sbg_[0-9A-HJKMNP-TV-Z]{26}$'),
	CONSTRAINT "selfie_backgrounds_face_template_id_format" CHECK ("selfie_backgrounds"."face_template_id" ~ '^ftpl_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "selfie_captures" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"method" text NOT NULL,
	"liveness" text NOT NULL,
	"prompts" jsonb NOT NULL,
	"nonce_sha256" "bytea" NOT NULL,
	"device" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"error_code" text,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "selfie_captures_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "selfie_captures_status_valid" CHECK ("selfie_captures"."status" in ('initiated', 'submitted', 'processed', 'errored')),
	CONSTRAINT "selfie_captures_method_valid" CHECK ("selfie_captures"."method" in ('camera', 'upload')),
	CONSTRAINT "selfie_captures_liveness_valid" CHECK ("selfie_captures"."liveness" in ('passive', 'active')),
	CONSTRAINT "selfie_captures_error_code_valid" CHECK ("selfie_captures"."error_code" is null or "selfie_captures"."error_code" in ('superseded', 'expired', 'canceled', 'processing_failed')),
	CONSTRAINT "selfie_captures_error_code_iff_errored" CHECK (("selfie_captures"."status" = 'errored') = ("selfie_captures"."error_code" is not null)),
	CONSTRAINT "selfie_captures_nonce_sha256_length" CHECK (octet_length("selfie_captures"."nonce_sha256") = 32),
	CONSTRAINT "selfie_captures_prompts_array" CHECK (jsonb_typeof("selfie_captures"."prompts") = 'array'),
	CONSTRAINT "selfie_captures_id_format" CHECK ("selfie_captures"."id" ~ '^self_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "selfie_capture_id" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "client_elapsed_ms" integer;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
-- C40.7: rows created before Phase 4 have no capture; every new selfie verification needs one.
ALTER TABLE "verifications" ADD COLUMN "selfie_capture_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "verifications" ALTER COLUMN "selfie_capture_required" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "face_templates" ADD CONSTRAINT "face_templates_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_templates" ADD CONSTRAINT "face_templates_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_templates" ADD CONSTRAINT "face_templates_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_backgrounds" ADD CONSTRAINT "selfie_backgrounds_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_backgrounds" ADD CONSTRAINT "selfie_backgrounds_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_backgrounds" ADD CONSTRAINT "selfie_backgrounds_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_backgrounds" ADD CONSTRAINT "selfie_backgrounds_face_template_fk" FOREIGN KEY ("environment_id","face_template_id") REFERENCES "public"."face_templates"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_captures" ADD CONSTRAINT "selfie_captures_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_captures" ADD CONSTRAINT "selfie_captures_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selfie_captures" ADD CONSTRAINT "selfie_captures_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "face_templates_verification_id_key" ON "face_templates" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "face_templates_environment_id_created_at_id_idx" ON "face_templates" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "face_templates_environment_id_inquiry_id_idx" ON "face_templates" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "selfie_backgrounds_verification_id_key" ON "selfie_backgrounds" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "selfie_backgrounds_environment_id_created_at_idx" ON "selfie_backgrounds" USING btree ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "selfie_backgrounds_layout_hnsw_idx" ON "selfie_backgrounds" USING hnsw ("layout" vector_l2_ops);--> statement-breakpoint
CREATE INDEX "selfie_captures_environment_id_verification_id_created_at_idx" ON "selfie_captures" USING btree ("environment_id","verification_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "selfie_captures_environment_id_inquiry_id_idx" ON "selfie_captures" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "selfie_captures_one_initiated_per_verification_key" ON "selfie_captures" USING btree ("environment_id","verification_id") WHERE "selfie_captures"."status" = 'initiated';--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_selfie_capture_fk" FOREIGN KEY ("environment_id","selfie_capture_id") REFERENCES "public"."selfie_captures"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_environment_id_sha256_idx" ON "files" USING btree ("environment_id","sha256");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_client_elapsed_ms_range" CHECK ("files"."client_elapsed_ms" is null or ("files"."client_elapsed_ms" >= 0 and "files"."client_elapsed_ms" <= 600000));