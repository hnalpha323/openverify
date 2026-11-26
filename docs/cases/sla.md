# SLA and calendars

## Two ways to set a deadline

- **Public:** `meta.sla-expires-in-seconds` on `POST /cases` and `PATCH /cases/:id` (1 to 7,776,000, which is 90 days; `null` clears it), and the Set and Clear Case SLA steps in minutes, hours or days. The deadline is counted on the 24x7 calendar, so it also pauses while the case is in a status that pauses the SLA. A public deadline replaces a policy's SLA; out of range is `sla_out_of_range`.
- **A policy** (`cslap_`): `target-minutes` in business minutes (1 to 525,600), a `case-calendar-id` (or `null` for 24x7) and `on-reopen` (`continue`, the default, or `restart`). The version's `sla-starts-on` (`created`, `entered-queue`, `assigned`) says when it starts, and each status's `pauses-sla` when it pauses. A policy SLA starts only on a case that never had one, so a public deadline or a clear wins. Editing `target-minutes`, the calendar or `on-reopen` moves the policy's `revision`; a case copies the revision it started under (target, calendar, on-reopen), so a later edit moves only cases that start after it.

## State

A case serves `sla-state` (`none`, `running`, `paused`, `met`, `expired`) and `sla-expires-at`, which is null exactly while `none` or `paused`; `met` and `expired` keep the deadline.

- Entering a pausing status pauses it (the business time used is kept); leaving one resumes it with a new deadline.
- Resolving before the deadline marks it `met`; a paused SLA resolved reads `met` with the deadline its remaining time would give. Resolving at or after an unswept deadline reads `expired` without firing, because the event never fires for a resolved case.
- Reopening follows `on-reopen`: `continue` keeps the time used (an expired SLA stays expired), `restart` starts again.
- Every start, pause, resume, recompute and clear moves the SLA's epoch; an expiry does not.

## Firing

The `case-sla` sweep runs every 30 seconds: running SLAs whose deadline has passed, `FOR UPDATE SKIP LOCKED` in batches of 500, each in a savepoint, become `expired` with a history row and `case.sla-expired` staged in the same transaction. It fires once per epoch, however many sweepers run, and never for a resolved case; consumers read `sla-expires-at` from the payload, not the delivery time, because a delivery can come up to a sweep period after the deadline. A pause at or after a deadline the sweep has not reached expires and fires in the status change's transaction. The assignee gets an in-app `sla-breached` notification and its link-only email ([comments and notifications](comments.md#emails)). Escalation (reassigning, notifying others) is a workflow on `case.sla-expired`.

## Calendars

A calendar (`ccal_`) has a `time-zone` (IANA), a `week` (per weekday, up to 8 `[start, end)` local `HH:MM` intervals in order, `24:00` allowed as an end, at least 60 business minutes a week), `holidays[] { date, label }` (at most 500) and `closures[] { start, end, label }` (local `YYYY-MM-DDTHH:MM`, at most 200).

- **Validation:** a zone the runtime does not know, or an interval boundary that falls in a daylight-saving gap or repeat within the next two years, is refused as `calendar_invalid`, naming the dates. Deadlines themselves resolve a skipped local time forward and a repeated one to its first instant.
- **Holidays:** no holiday data ships (the usual data sets are CC BY-SA). `POST /case-calendars/:id/holidays/import` takes a `date,label` CSV in `data.attributes.csv` (at most 65,536 characters) and an optional `replace`; rows merge by date unless `replace` is true. Refused rows are listed by row number and code (`invalid_value`, `date_repeated`, or the CSV reader's codes), never by value.
- **Recompute:** an edit or an import recomputes the running and paused SLAs of the cases on that calendar, each with a history row. An edit that would leave a running SLA unreachable within ten years is refused (`sla_out_of_range`).

Business time is computed in the API on `temporal-polyfill`, never in `packages/core`, so the polyfill stays out of the flow's and the console's bundles.
