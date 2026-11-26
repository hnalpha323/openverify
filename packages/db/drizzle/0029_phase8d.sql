CREATE TABLE "case_notification_emails" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_notification_emails_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"environment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"case_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_notification_emails_kind_valid" CHECK ("case_notification_emails"."kind" in ('created', 'assigned', 'sla-breached', 'mentioned')),
	CONSTRAINT "case_notification_emails_attempts_range" CHECK ("case_notification_emails"."attempts" between 0 and 3 and ("case_notification_emails"."attempts" = 0) = ("case_notification_emails"."claimed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "report_actions" DROP CONSTRAINT "report_actions_actor_valid";--> statement-breakpoint
ALTER TABLE "transaction_status_history" DROP CONSTRAINT "transaction_status_history_actor_valid";--> statement-breakpoint
ALTER TABLE "case_notification_emails" ADD CONSTRAINT "case_notification_emails_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_notification_emails" ADD CONSTRAINT "case_notification_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_notification_emails" ADD CONSTRAINT "case_notification_emails_case_fk" FOREIGN KEY ("environment_id","case_id") REFERENCES "public"."cases"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_environment_id_updated_at_id_idx" ON "cases" USING btree ("environment_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "cases_environment_id_resolved_at_last_asc_idx" ON "cases" USING btree ("environment_id",coalesce("resolved_at", 'infinity'::timestamptz),"id");--> statement-breakpoint
CREATE INDEX "cases_environment_id_resolved_at_last_desc_idx" ON "cases" USING btree ("environment_id",coalesce("resolved_at", '-infinity'::timestamptz),"id");--> statement-breakpoint
CREATE INDEX "cases_environment_id_sla_expires_at_last_asc_idx" ON "cases" USING btree ("environment_id",coalesce("sla_expires_at", 'infinity'::timestamptz),"id");--> statement-breakpoint
CREATE INDEX "cases_environment_id_sla_expires_at_last_desc_idx" ON "cases" USING btree ("environment_id",coalesce("sla_expires_at", '-infinity'::timestamptz),"id");--> statement-breakpoint
CREATE INDEX "case_attachments_rendition_pending_idx" ON "case_attachments" USING btree ("updated_at") WHERE "case_attachments"."rendition_status" = 'pending' and "case_attachments"."redacted_at" is null;--> statement-breakpoint
CREATE INDEX "file_renditions_pending_idx" ON "file_renditions" USING btree ("updated_at") WHERE "file_renditions"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "report_actions" ADD CONSTRAINT "report_actions_actor_valid" CHECK (("report_actions"."actor_type" = 'system' and "report_actions"."actor_id" is null)
        or ("report_actions"."actor_type" = 'user' and "report_actions"."actor_id" is not null
          and "report_actions"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("report_actions"."actor_type" = 'api_key' and "report_actions"."actor_id" is not null
          and "report_actions"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("report_actions"."actor_type"::text = 'workflow_run' and "report_actions"."actor_id" is not null
          and "report_actions"."actor_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'));--> statement-breakpoint
ALTER TABLE "transaction_status_history" ADD CONSTRAINT "transaction_status_history_actor_valid" CHECK (("transaction_status_history"."actor_type" = 'system' and "transaction_status_history"."actor_id" is null)
        or ("transaction_status_history"."actor_type" = 'user' and "transaction_status_history"."actor_id" is not null
          and "transaction_status_history"."actor_id" ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_status_history"."actor_type" = 'api_key' and "transaction_status_history"."actor_id" is not null
          and "transaction_status_history"."actor_id" ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$')
        or ("transaction_status_history"."actor_type"::text = 'workflow_run' and "transaction_status_history"."actor_id" is not null
          and "transaction_status_history"."actor_id" ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'));