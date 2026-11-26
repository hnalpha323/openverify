ALTER TABLE "verification_checks" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "verification_checks" ADD COLUMN "confidence" double precision;--> statement-breakpoint
ALTER TABLE "verification_checks" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_stage_valid" CHECK ("verification_checks"."stage" is null or "verification_checks"."stage" in ('ga', 'beta', 'sunset'));--> statement-breakpoint
ALTER TABLE "verification_checks" ADD CONSTRAINT "verification_checks_confidence_unit_interval" CHECK ("verification_checks"."confidence" is null or ("verification_checks"."confidence" >= 0 and "verification_checks"."confidence" <= 1));