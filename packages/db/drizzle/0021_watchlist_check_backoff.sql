ALTER TABLE "watchlist_sources" ADD COLUMN "check_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist_sources" ADD COLUMN "last_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watchlist_sources" ADD CONSTRAINT "watchlist_sources_check_failures_non_negative" CHECK ("watchlist_sources"."check_failures" >= 0);