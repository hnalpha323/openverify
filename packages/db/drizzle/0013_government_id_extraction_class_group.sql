-- C31.8 (Workflow 3A Stage 3): the class group each blind index was computed with (the ID class
-- the document established, or 'unknown'), so `blind-index:rebuild` can recompute every index
-- under a new key. Rows written before carry 'unknown', which is what the worker wrote then.
ALTER TABLE "government_id_extractions" ADD COLUMN "id_class_group" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "government_id_extractions" ADD CONSTRAINT "government_id_extractions_id_class_group_valid" CHECK ("government_id_extractions"."id_class_group" in ('unknown', 'passport', 'passport_card', 'drivers_license', 'national_id', 'residence_permit', 'visa', 'work_permit', 'military_id', 'voter_id', 'travel_document'));