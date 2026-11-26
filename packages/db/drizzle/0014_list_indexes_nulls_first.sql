-- C38 (Workflow 3A Stage 3, the Workflow 2E follow-up): every list orders `created_at DESC,
-- id DESC`, which Postgres reads as NULLS FIRST, but these 28 older list indexes (53 descending
-- columns, from 0001 and 0003) were created DESC NULLS LAST, so each list sorted every row of its
-- scope instead of stopping at the page size. They are recreated in the lists' own order. Plain
-- CREATE INDEX (not CONCURRENTLY: migrations run in one transaction) holds each table's write
-- lock while it builds.
DROP INDEX "api_keys_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "roles_organization_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "users_organization_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiry_template_versions_env_template_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiry_template_versions_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiry_templates_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "account_types_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "accounts_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "accounts_environment_id_account_type_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "accounts_environment_id_status_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiries_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiries_environment_id_status_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiries_environment_id_account_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiries_environment_id_template_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "inquiry_sessions_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "events_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "events_environment_id_name_created_at_id_idx";--> statement-breakpoint
DROP INDEX "webhook_deliveries_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "webhook_deliveries_environment_id_webhook_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "webhooks_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "audit_logs_environment_id_created_at_idx";--> statement-breakpoint
DROP INDEX "audit_logs_environment_id_created_at_public_id_idx";--> statement-breakpoint
DROP INDEX "audit_logs_environment_id_actor_id_created_at_idx";--> statement-breakpoint
DROP INDEX "audit_logs_environment_id_action_created_at_idx";--> statement-breakpoint
DROP INDEX "api_logs_environment_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "api_logs_environment_id_api_key_id_created_at_id_idx";--> statement-breakpoint
DROP INDEX "api_logs_environment_id_route_created_at_id_idx";--> statement-breakpoint
DROP INDEX "api_logs_environment_id_status_created_at_id_idx";--> statement-breakpoint
CREATE INDEX "api_keys_environment_id_created_at_id_idx" ON "api_keys" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "roles_organization_id_created_at_id_idx" ON "roles" USING btree ("organization_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "users_organization_id_created_at_id_idx" ON "users" USING btree ("organization_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiry_template_versions_env_template_created_at_id_idx" ON "inquiry_template_versions" USING btree ("environment_id","inquiry_template_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiry_template_versions_environment_id_created_at_id_idx" ON "inquiry_template_versions" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiry_templates_environment_id_created_at_id_idx" ON "inquiry_templates" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "account_types_environment_id_created_at_id_idx" ON "account_types" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "accounts_environment_id_created_at_id_idx" ON "accounts" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "accounts_environment_id_account_type_id_created_at_id_idx" ON "accounts" USING btree ("environment_id","account_type_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "accounts_environment_id_status_created_at_id_idx" ON "accounts" USING btree ("environment_id","status","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiries_environment_id_created_at_id_idx" ON "inquiries" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiries_environment_id_status_created_at_id_idx" ON "inquiries" USING btree ("environment_id","status","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiries_environment_id_account_id_created_at_id_idx" ON "inquiries" USING btree ("environment_id","account_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiries_environment_id_template_id_created_at_id_idx" ON "inquiries" USING btree ("environment_id","inquiry_template_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "inquiry_sessions_environment_id_created_at_id_idx" ON "inquiry_sessions" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "events_environment_id_created_at_id_idx" ON "events" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "events_environment_id_name_created_at_id_idx" ON "events" USING btree ("environment_id","name","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_environment_id_created_at_id_idx" ON "webhook_deliveries" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_environment_id_webhook_id_created_at_id_idx" ON "webhook_deliveries" USING btree ("environment_id","webhook_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "webhooks_environment_id_created_at_id_idx" ON "webhooks" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_environment_id_created_at_idx" ON "audit_logs" USING btree ("environment_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_environment_id_created_at_public_id_idx" ON "audit_logs" USING btree ("environment_id","created_at" DESC NULLS FIRST,"public_id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_environment_id_actor_id_created_at_idx" ON "audit_logs" USING btree ("environment_id","actor_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_environment_id_action_created_at_idx" ON "audit_logs" USING btree ("environment_id","action","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "api_logs_environment_id_created_at_id_idx" ON "api_logs" USING btree ("environment_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "api_logs_environment_id_api_key_id_created_at_id_idx" ON "api_logs" USING btree ("environment_id","api_key_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "api_logs_environment_id_route_created_at_id_idx" ON "api_logs" USING btree ("environment_id","route","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "api_logs_environment_id_status_created_at_id_idx" ON "api_logs" USING btree ("environment_id","status","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);