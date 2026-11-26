-- Workflow 10B (foundation-10b): one migration for the Workflow, extended per Stage 1b checkpoint.
-- Checkpoint 2, (C): files.capture_trigger (C206.2). Checkpoint 3, (I): the integrity challenges and
-- verdicts (C211.3, C211.4, C221.3).
-- Hand edit: the verdicts' updated_at trigger (openverify_set_updated_at), as every table with one.
CREATE TABLE "inquiry_integrity_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"inquiry_id" text NOT NULL,
	"session_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "inquiry_integrity_challenges_environment_id_id_key" UNIQUE("environment_id","id"),
	CONSTRAINT "inquiry_integrity_challenges_request_hash_format" CHECK ("inquiry_integrity_challenges"."request_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "inquiry_integrity_challenges_expires_after_created" CHECK ("inquiry_integrity_challenges"."expires_at" > "inquiry_integrity_challenges"."created_at"),
	CONSTRAINT "inquiry_integrity_challenges_token_consumed" CHECK ("inquiry_integrity_challenges"."token" is null or "inquiry_integrity_challenges"."consumed_at" is not null),
	CONSTRAINT "inquiry_integrity_challenges_id_format" CHECK ("inquiry_integrity_challenges"."id" ~ '^ich_[0-9A-HJKMNP-TV-Z]{26}$')
);
--> statement-breakpoint
CREATE TABLE "inquiry_integrity_verdicts" (
	"environment_id" text NOT NULL,
	"inquiry_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"verdict" text NOT NULL,
	"decoded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_integrity_verdicts_provider_valid" CHECK ("inquiry_integrity_verdicts"."provider" in ('play-integrity', 'sandbox'))
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "capture_trigger" text;--> statement-breakpoint
ALTER TABLE "inquiry_integrity_challenges" ADD CONSTRAINT "inquiry_integrity_challenges_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_integrity_challenges" ADD CONSTRAINT "inquiry_integrity_challenges_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_integrity_challenges" ADD CONSTRAINT "inquiry_integrity_challenges_session_fk" FOREIGN KEY ("environment_id","session_id") REFERENCES "public"."inquiry_sessions"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_integrity_verdicts" ADD CONSTRAINT "inquiry_integrity_verdicts_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_integrity_verdicts" ADD CONSTRAINT "inquiry_integrity_verdicts_inquiry_fk" FOREIGN KEY ("environment_id","inquiry_id") REFERENCES "public"."inquiries"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inquiry_integrity_challenges_environment_id_inquiry_id_idx" ON "inquiry_integrity_challenges" USING btree ("environment_id","inquiry_id");--> statement-breakpoint
CREATE INDEX "inquiry_integrity_challenges_expires_at_idx" ON "inquiry_integrity_challenges" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_capture_trigger_valid" CHECK ("files"."capture_trigger" is null or "files"."capture_trigger" in ('auto', 'manual'));--> statement-breakpoint
CREATE TRIGGER "inquiry_integrity_verdicts_set_updated_at" BEFORE UPDATE ON "inquiry_integrity_verdicts" FOR EACH ROW EXECUTE FUNCTION "openverify_set_updated_at"();
