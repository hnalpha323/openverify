CREATE TABLE "government_id_extractions" (
	"environment_id" text NOT NULL,
	"verification_id" text PRIMARY KEY NOT NULL,
	"fields" text,
	"field_sources" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identification_number_index" text,
	"front_phash" text,
	"front_phash_band_0" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 1, 2))::bit(8)::integer)::smallint) STORED,
	"front_phash_band_1" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 3, 2))::bit(8)::integer)::smallint) STORED,
	"front_phash_band_2" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 5, 2))::bit(8)::integer)::smallint) STORED,
	"front_phash_band_3" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 7, 2))::bit(8)::integer)::smallint) STORED,
	"front_phash_band_4" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 9, 2))::bit(8)::integer)::smallint) STORED,
	"front_phash_band_5" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 11, 2))::bit(8)::integer)::smallint) STORED,
	"front_phash_band_6" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 13, 2))::bit(8)::integer)::smallint) STORED,
	"front_phash_band_7" smallint GENERATED ALWAYS AS ((('x' || substr("government_id_extractions"."front_phash", 15, 2))::bit(8)::integer)::smallint) STORED,
	"redacted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "government_id_extractions_identification_number_index_hex" CHECK ("government_id_extractions"."identification_number_index" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "government_id_extractions_front_phash_hex" CHECK ("government_id_extractions"."front_phash" ~ '^[0-9a-f]{16}$')
);
--> statement-breakpoint
ALTER TABLE "government_id_extractions" ADD CONSTRAINT "government_id_extractions_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "government_id_extractions" ADD CONSTRAINT "government_id_extractions_verification_fk" FOREIGN KEY ("environment_id","verification_id") REFERENCES "public"."verifications"("environment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_identification_number_index_idx" ON "government_id_extractions" USING btree ("environment_id","identification_number_index") WHERE "government_id_extractions"."identification_number_index" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_0_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_0") WHERE "government_id_extractions"."front_phash_band_0" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_1_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_1") WHERE "government_id_extractions"."front_phash_band_1" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_2_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_2") WHERE "government_id_extractions"."front_phash_band_2" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_3_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_3") WHERE "government_id_extractions"."front_phash_band_3" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_4_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_4") WHERE "government_id_extractions"."front_phash_band_4" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_5_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_5") WHERE "government_id_extractions"."front_phash_band_5" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_6_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_6") WHERE "government_id_extractions"."front_phash_band_6" is not null;--> statement-breakpoint
CREATE INDEX "government_id_extractions_environment_id_front_phash_band_7_idx" ON "government_id_extractions" USING btree ("environment_id","front_phash_band_7") WHERE "government_id_extractions"."front_phash_band_7" is not null;