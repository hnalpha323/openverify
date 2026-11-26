-- Workflow 9D (fix-api, K9-24; S4B-14): the analytics and webhook amendments carried from 9B.
-- Hand edits: the reason backfill, the open-day recompute and the webhooks' trigger.
ALTER TABLE "analytics_check_reason_daily" DROP CONSTRAINT "analytics_check_reason_daily_key";--> statement-breakpoint
ALTER TABLE "analytics_transition_daily" DROP CONSTRAINT "analytics_transition_daily_from_step_id_format";--> statement-breakpoint
-- AL7: a reason keeps its check's verification type and requirement.
ALTER TABLE "analytics_check_reason_daily" ADD COLUMN "verification_type" "verification_type";--> statement-breakpoint
ALTER TABLE "analytics_check_reason_daily" ADD COLUMN "requirement" "check_requirement";--> statement-breakpoint
-- An earlier reason row takes them from its check's results of the same day, zone, source and
-- version when those name exactly one type and requirement.
UPDATE "analytics_check_reason_daily" r
SET "verification_type" = c."verification_type", "requirement" = c."requirement"
FROM (
  SELECT "environment_id", "day", "time_zone", "source", "inquiry_template_id",
    "inquiry_template_version_id", "check_name",
    min("verification_type"::text)::"verification_type" AS "verification_type",
    min("requirement"::text)::"check_requirement" AS "requirement"
  FROM "analytics_check_daily"
  GROUP BY 1, 2, 3, 4, 5, 6, 7
  HAVING count(DISTINCT ("verification_type", "requirement")) = 1
) c
WHERE r."environment_id" = c."environment_id" AND r."day" = c."day"
  AND r."time_zone" = c."time_zone" AND r."source" = c."source"
  AND r."inquiry_template_id" IS NOT DISTINCT FROM c."inquiry_template_id"
  AND r."inquiry_template_version_id" IS NOT DISTINCT FROM c."inquiry_template_version_id"
  AND r."check_name" = c."check_name";--> statement-breakpoint
-- A reason row they cannot attribute (its check ran both ways that day) is removed, never guessed.
DELETE FROM "analytics_check_reason_daily" WHERE "verification_type" IS NULL OR "requirement" IS NULL;--> statement-breakpoint
ALTER TABLE "analytics_check_reason_daily" ALTER COLUMN "verification_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_check_reason_daily" ALTER COLUMN "requirement" SET NOT NULL;--> statement-breakpoint
-- AA6: the last day the rollup closed; the next pass sets it.
ALTER TABLE "analytics_rollup_state" ADD COLUMN "closed_through" date;--> statement-breakpoint
-- The next pass recomputes every column of every open day (P21), so they gain the start
-- transitions and the reasons by type and requirement at once; closed days stay as they are.
UPDATE "analytics_rollup_state" SET "outcomes_as_of" = NULL;--> statement-breakpoint
ALTER TABLE "analytics_check_reason_daily" ADD CONSTRAINT "analytics_check_reason_daily_key" UNIQUE NULLS NOT DISTINCT("environment_id","day","time_zone","source","inquiry_template_id","inquiry_template_version_id","verification_type","check_name","requirement","reason");--> statement-breakpoint
-- AL6: `$start`, the reserved step the entry step is entered from.
ALTER TABLE "analytics_transition_daily" ADD CONSTRAINT "analytics_transition_daily_from_step_id_format" CHECK ("analytics_transition_daily"."from_step_id" = '$start' or "analytics_transition_daily"."from_step_id" ~ '^[a-z][a-z0-9_-]{0,63}$');--> statement-breakpoint
-- KW2 (W3): the failure-alert sweep sets failure_alert_notified_at keeping updated_at, since an
-- alert is not a change of the webhook; any other change still moves it.
CREATE OR REPLACE FUNCTION "openverify_webhooks_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'failure_alert_notified_at' - 'updated_at')
       = (to_jsonb(OLD) - 'failure_alert_notified_at' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  IF NEW."updated_at" IS NOT DISTINCT FROM OLD."updated_at" THEN
    NEW."updated_at" := now();
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER "webhooks_set_updated_at" ON "webhooks";--> statement-breakpoint
CREATE TRIGGER "webhooks_set_updated_at" BEFORE UPDATE ON "webhooks" FOR EACH ROW EXECUTE FUNCTION "openverify_webhooks_set_updated_at"();
