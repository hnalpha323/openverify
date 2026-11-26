CREATE TABLE "verification_inputs" (
	"environment_id" text NOT NULL,
	"verification_id" text PRIMARY KEY NOT NULL,
	"inquiry_id" text NOT NULL,
	"values" text,
	"field_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text NOT NULL,
	"source_verification_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "verification_inputs_environment_id_verification_id_key" UNIQUE("environment_id","verification_id"),
	CONSTRAINT "verification_inputs_source_valid" CHECK ("verification_inputs"."source" in ('flow', 'government_id')),
	CONSTRAINT "verification_inputs_source_verification_iff_copied" CHECK (("verification_inputs"."source" = 'government_id') = ("verification_inputs"."source_verification_id" is not null)),
	CONSTRAINT "verification_inputs_source_verification_id_format" CHECK ("verification_inputs"."source_verification_id" ~ '^ver_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"channel" text NOT NULL,
	"destination" text,
	"destination_index" text,
	"code_hmac" "bytea",
	"code_key_id" text,
	"status" text NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"error_code" text,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "otp_challenges_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "otp_challenges_channel_valid" CHECK ("otp_challenges"."channel" in ('sms', 'email')),
	CONSTRAINT "otp_challenges_status_valid" CHECK ("otp_challenges"."status" in ('sent', 'confirmed', 'superseded', 'expired', 'exhausted', 'errored')),
	CONSTRAINT "otp_challenges_failed_attempts_range" CHECK ("otp_challenges"."failed_attempts" between 0 and 5),
	CONSTRAINT "otp_challenges_code_hmac_length" CHECK ("otp_challenges"."code_hmac" is null or octet_length("otp_challenges"."code_hmac") = 32),
	CONSTRAINT "otp_challenges_code_hmac_only_while_sent" CHECK ("otp_challenges"."status" = 'sent' or "otp_challenges"."code_hmac" is null),
	CONSTRAINT "otp_challenges_error_code_format" CHECK ("otp_challenges"."error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "otp_challenges_destination_index_hex" CHECK ("otp_challenges"."destination_index" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "otp_challenges_id_format" CHECK ("otp_challenges"."id" ~ '^otpc_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "otp_verification_states" (
	"environment_id" text NOT NULL,
	"verification_id" text PRIMARY KEY NOT NULL,
	"inquiry_id" text NOT NULL,
	"sends" integer DEFAULT 0 NOT NULL,
	"wrong_entries" integer DEFAULT 0 NOT NULL,
	"limited_at" timestamp with time zone,
	"limited_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_verification_states_environment_id_verification_id_key" UNIQUE("environment_id","verification_id"),
	CONSTRAINT "otp_verification_states_sends_range" CHECK ("otp_verification_states"."sends" between 0 and 5),
	CONSTRAINT "otp_verification_states_wrong_entries_range" CHECK ("otp_verification_states"."wrong_entries" between 0 and 10),
	CONSTRAINT "otp_verification_states_limited_reason_valid" CHECK ("otp_verification_states"."limited_reason" is null or "otp_verification_states"."limited_reason" in ('destination', 'inquiry', 'guess', 'environment', 'store_unavailable')),
	CONSTRAINT "otp_verification_states_limited_reason_iff_limited" CHECK (("otp_verification_states"."limited_at" is null) = ("otp_verification_states"."limited_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "crypto_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"verification_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"chain_id" text NOT NULL,
	"wallet_address" text,
	"address_index" text,
	"message" text,
	"status" text NOT NULL,
	"signature" text,
	"signed_message" text,
	"scheme" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"redacted_at" timestamp with time zone,
	CONSTRAINT "crypto_challenges_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "crypto_challenges_status_valid" CHECK ("crypto_challenges"."status" in ('initiated', 'submitted', 'processed', 'expired', 'superseded')),
	CONSTRAINT "crypto_challenges_chain_id_format" CHECK ("crypto_challenges"."chain_id" ~ '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$'),
	CONSTRAINT "crypto_challenges_scheme_format" CHECK ("crypto_challenges"."scheme" ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
	CONSTRAINT "crypto_challenges_address_index_hex" CHECK ("crypto_challenges"."address_index" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "crypto_challenges_id_format" CHECK ("crypto_challenges"."id" ~ '^cwc_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
ALTER TABLE "verification_inputs" ADD CONSTRAINT "verification_inputs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_inputs" ADD CONSTRAINT "verification_inputs_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_inputs" ADD CONSTRAINT "verification_inputs_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_inputs" ADD CONSTRAINT "verification_inputs_source_verification_fk" FOREIGN KEY ("environment_id","source_verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_verification_states" ADD CONSTRAINT "otp_verification_states_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_verification_states" ADD CONSTRAINT "otp_verification_states_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_verification_states" ADD CONSTRAINT "otp_verification_states_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_challenges" ADD CONSTRAINT "crypto_challenges_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_challenges" ADD CONSTRAINT "crypto_challenges_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_challenges" ADD CONSTRAINT "crypto_challenges_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_inputs_environment_id_inquiry_id_idx" ON "verification_inputs" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "otp_challenges_environment_id_verification_id_sent_at_idx" ON "otp_challenges" USING btree ("environment_id","verification_id","sent_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "otp_challenges_environment_id_inquiry_id_idx" ON "otp_challenges" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "otp_challenges_environment_id_destination_index_sent_at_idx" ON "otp_challenges" USING btree ("environment_id","destination_index","sent_at") WHERE "otp_challenges"."destination_index" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "otp_challenges_one_sent_per_verification_key" ON "otp_challenges" USING btree ("environment_id","verification_id") WHERE "otp_challenges"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "otp_verification_states_environment_id_inquiry_id_idx" ON "otp_verification_states" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "crypto_challenges_environment_id_verification_id_created_at_idx" ON "crypto_challenges" USING btree ("environment_id","verification_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "crypto_challenges_environment_id_inquiry_id_idx" ON "crypto_challenges" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "crypto_challenges_environment_id_address_index_idx" ON "crypto_challenges" USING btree ("environment_id","address_index") WHERE "crypto_challenges"."address_index" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_challenges_one_initiated_per_verification_key" ON "crypto_challenges" USING btree ("environment_id","verification_id") WHERE "crypto_challenges"."status" = 'initiated';--> statement-breakpoint
-- Hand edit: updated_at is maintained by the openverify_set_updated_at trigger (0001, 0003), as on
-- every other table that has it; a KEK rewrap leaves it alone.
CREATE TRIGGER "verification_inputs_set_updated_at" BEFORE UPDATE ON "verification_inputs" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "otp_verification_states_set_updated_at" BEFORE UPDATE ON "otp_verification_states" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();
