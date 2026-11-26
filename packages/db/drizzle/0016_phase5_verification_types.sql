ALTER TYPE "public"."verification_type" RENAME VALUE 'business' TO 'database_business';--> statement-breakpoint
ALTER TYPE "public"."verification_type" ADD VALUE 'aamva' AFTER 'database';--> statement-breakpoint
ALTER TYPE "public"."verification_type" ADD VALUE 'business_website';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'document';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-sod';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-dg1';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-dg2';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-dg14';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-dg15';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-card-security';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-card-access';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-com';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'document-preview';--> statement-breakpoint
ALTER TYPE "public"."file_kind" ADD VALUE 'chip-portrait';