# Analytics

OpenVerify counts what happens to inquiries, verifications, checks, cases and signals in daily
rollups, and serves them through a read-only aggregates API and, from Workflow 9C, the console's
Analytics section. Every figure is a count of whole things (inquiries, attempts, cases), never of
sessions, and every answer is suppressed before anyone sees it: small counts are hidden, rates are
shown as bounds when they would reveal a small count, and complementary cells are hidden so that no
hidden cell follows by subtraction.

This page covers C163 and C164 of [the Phase 9 plan](../plans/phase-9.plan.md) as built in
Workflow 9B (`analytics-logic` in `@openverify/core`, `api-analytics` in the API). The definitions
are ours: they are written as constants in
[`packages/core/src/analytics/definitions.ts`](../../packages/core/src/analytics/definitions.ts),
and this page and the console repeat them word for word.

- [The API](#the-api)
- [Definitions](#definitions)
- [How the counting works](#how-the-counting-works)
- [Suppression](#suppression)
- [What suppression does not cover](#what-suppression-does-not-cover)
- [Freshness, the settle window and the live day](#freshness-the-settle-window-and-the-live-day)
- [The reporting time zone](#the-reporting-time-zone)
- [Redaction and retention](#redaction-and-retention)
- [Employee notice: the per-reviewer case figures](#employee-notice-the-per-reviewer-case-figures)
- [Settings](#settings)
- [No SQL explorer: a read-only database role instead](#no-sql-explorer-a-read-only-database-role-instead)
- [Performance](#performance)
- [Not built](#not-built)

Exports of the lists and saved views are on [their own page](exports.md).

## The API

Six reads, each `GET`, scope `analytics:read`, always the caller's one environment (a sandbox key
never sees production counts, and no answer mixes the two):

| Path                              | What it answers                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/api/v1/analytics/inquiries`     | created, started, finished, outcomes, expirations, time to finish, how inquiries were decided      |
| `/api/v1/analytics/funnel`        | per template version and step: entered, exited, revisited; transitions; the 20 most frequent paths |
| `/api/v1/analytics/verifications` | attempts by type, capture method and country; each verification step's per-person outcome          |
| `/api/v1/analytics/checks`        | per check: every status as its own column, reasons, share of failed verifications, tier and stage  |
| `/api/v1/analytics/cases`         | created, resolved, SLA met and missed, resolution time; per reviewer only for `users:write`        |
| `/api/v1/analytics/signals`       | per signal, the values in fixed bins, with "not evaluated"                                         |

Each read is counted first by the `analytics` rate-limit policy (60 a minute per user or key) and
answers 429 over it. `@openverify/node` has one method per read (`analytics.inquiries(query)` and so
on).

**The query.** `filter[from]` and `filter[to]` are local dates (`YYYY-MM-DD`, both included, in the
reporting time zone; an instant is refused), at most 400 days apart (`ANALYTICS_MAX_RANGE_DAYS`,
ours, provisional). `bucket` is `day` (the default), `week` (starting on Monday) or `month`. The
inquiry-based reads take `filter[inquiry-template-id]`, `filter[inquiry-template-version-id]`,
`filter[platform]` and `filter[device-kind]` (the platform and device kind of the session that served
the inquiry's first step); the inquiries read also takes `filter[tag]` (a tag's name); the cases read
takes `filter[case-template-id]` and no inquiry filter. Two filters are refused rather than ignored:

- `filter[platform]` and `filter[device-kind]` on the funnel, verifications and checks answer 400,
  because the step, verification and check rollups have no device dimension. An unfiltered answer
  under a filter would be a wrong answer.
- With `filter[tag]`, the inquiries read serves only the four counts the tag rollup holds
  (`created`, `finished`, `completed`, `failed`): no rate and no time to finish, because none was
  counted per tag.

**The answer.** `{ data: { type: "analytics-<read>", id, attributes } }`, where `id` is the SHA-256
of the read and its canonical query, and the attributes always name:

- `time-zone` (the setting the window was read in) and `time-zones` (every zone a bucket of the
  window was computed in; more than one marks a mixed range, see
  [the reporting time zone](#the-reporting-time-zone));
- `from`, `to`, `bucket` and the `buckets[]`, each with its first and last local day, its zone and
  `live`;
- `threshold` (the suppression threshold in force), `suppressed-cells` (how many served cells are
  hidden) and `settle-days`;
- `freshness { rolled-up-through, outcomes-as-of }` (see
  [freshness](#freshness-the-settle-window-and-the-live-day)); both are `null` before the first
  rollup pass.

A count is an integer or `{ suppressed: "small-count" | "complementary" }`; a rate is `{ value }` (a
fraction from 0 to 1), `{ below }` or `{ above }` (a whole percent) or `{ suppressed: true }`; a
duration is `{ lower, upper }` in seconds, `{ suppressed: true }` or `null`. The answer's own schema
([`packages/contracts/src/analytics.ts`](../../packages/contracts/src/analytics.ts)) refuses any
visible count from 1 to `threshold - 1` and any outcome in a live bucket, so no code path can serve
one.

Problems: 400 (the query, or a refused filter), 401, 403 (no `analytics:read`), 429, and 500 only
when the counting code refuses its own input (an `AnalyticsInputError`, whose message names the
input, never a value).

## Definitions

The tables below are generated from `ANALYTICS_METRICS` and `SIGNAL_BINS` in
[`@openverify/core`](../../packages/core/src/analytics/), so their words are the code's. "Counts"
is the unit of one counted thing; "Live" marks the counts served for the current day (every other
count is an outcome, never served live; see
[the live day](#freshness-the-settle-window-and-the-live-day)).

### The inquiries answer

| Key                            | Kind                                             | Counts    | Live | Definition                                                                                                                                         |
| ------------------------------ | ------------------------------------------------ | --------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `created`                      | count                                            | inquiries | yes  | Inquiries created.                                                                                                                                 |
| `started`                      | count                                            | inquiries | yes  | Inquiries whose first step the server served (pending).                                                                                            |
| `interacted`                   | count                                            | inquiries | no   | Started inquiries whose first step was exited.                                                                                                     |
| `finished`                     | count                                            | inquiries | no   | Inquiries whose flow reached completed or failed; an expired inquiry is not finished.                                                              |
| `completed`                    | count                                            | inquiries | no   | Finished inquiries now completed.                                                                                                                  |
| `completed-verified`           | count                                            | inquiries | no   | Completed inquiries whose every verification on the path passed.                                                                                   |
| `completed-with-fallback`      | count                                            | inquiries | no   | Completed inquiries whose path took an exhausted fallback.                                                                                         |
| `completed-unverified`         | count                                            | inquiries | no   | Completed inquiries whose path held no verification.                                                                                               |
| `failed`                       | count                                            | inquiries | no   | Finished inquiries now failed.                                                                                                                     |
| `expired-before-start`         | count                                            | inquiries | no   | Inquiries that expired before their first step was served.                                                                                         |
| `expired-after-start`          | count                                            | inquiries | no   | Started inquiries that expired before finishing.                                                                                                   |
| `approved`                     | count                                            | inquiries | no   | Finished inquiries now approved.                                                                                                                   |
| `declined`                     | count                                            | inquiries | no   | Finished inquiries now declined.                                                                                                                   |
| `needs-review`                 | count                                            | inquiries | no   | Finished inquiries now in needs review.                                                                                                            |
| `marked-for-review`            | count                                            | inquiries | no   | Finished inquiries that a flow or a check sent to review at least once.                                                                            |
| `decided-automatic`            | count                                            | inquiries | no   | Decided inquiries whose decision record says solely automated.                                                                                     |
| `decided-manual`               | count                                            | inquiries | no   | Decided inquiries decided by a person.                                                                                                             |
| `decided-not-declared`         | count                                            | inquiries | no   | Decided inquiries whose decision did not declare whether it was automated (an API decision without solely-automated).                              |
| `success-rate`                 | rate: (`completed` + `approved`) / (`finished`)  | inquiries | no   | Finished inquiries now completed or approved, over finished inquiries.                                                                             |
| `completed-verified-rate`      | rate: (`completed-verified`) / (`finished`)      | inquiries | no   | Completed with every verification on the path passed, over finished inquiries.                                                                     |
| `completed-with-fallback-rate` | rate: (`completed-with-fallback`) / (`finished`) | inquiries | no   | Completed through a fallback, over finished inquiries.                                                                                             |
| `completed-unverified-rate`    | rate: (`completed-unverified`) / (`finished`)    | inquiries | no   | Completed with no verification, over finished inquiries.                                                                                           |
| `rejected-rate`                | rate: (`failed` + `declined`) / (`finished`)     | inquiries | no   | Finished inquiries now failed or declined, over finished inquiries.                                                                                |
| `needs-review-rate`            | rate: (`needs-review`) / (`finished`)            | inquiries | no   | Finished inquiries now in needs review, over finished inquiries.                                                                                   |
| `expiration-rate`              | rate: (`expired-after-start`) / (`started`)      | inquiries | no   | Started inquiries that expired, over started inquiries; inquiries that expired before starting are their own count, so the rate never passes 100%. |
| `time-to-finish`               | duration                                         | inquiries | no   | From creation to the flow reaching completed or failed, as the bucket that holds the median (approximate).                                         |

### The funnel answer

| Key             | Kind                                | Counts      | Live | Definition                                                                                                       |
| --------------- | ----------------------------------- | ----------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| `started`       | count                               | inquiries   | no   | Inquiries of the version that started (the overall share's denominator).                                         |
| `entered`       | count                               | inquiries   | no   | Inquiries that entered the step (their first entry).                                                             |
| `exited`        | count                               | inquiries   | no   | Inquiries that left the step.                                                                                    |
| `revisits`      | count                               | inquiries   | no   | Inquiries that entered the step more than once.                                                                  |
| `transitions`   | count                               | transitions | no   | Moves from one person-visible step to the next; branch and action steps are edges, not steps.                    |
| `paths`         | count                               | paths       | no   | Inquiries that took the same sequence of person-visible steps (the 20 most frequent).                            |
| `overall-share` | rate: (`entered`) / (`started`)     | inquiries   | no   | Inquiries that entered the step, over started inquiries.                                                         |
| `step-share`    | rate: (`entered`) / (`transitions`) | inquiries   | no   | Inquiries that entered the step, over the sum of the transitions into it (a step can have several predecessors). |

### The verifications answer

| Key                          | Kind                                                        | Counts           | Live | Definition                                                                             |
| ---------------------------- | ----------------------------------------------------------- | ---------------- | ---- | -------------------------------------------------------------------------------------- |
| `created`                    | count                                                       | attempts         | no   | Verification attempts created.                                                         |
| `submitted`                  | count                                                       | attempts         | no   | Attempts submitted.                                                                    |
| `passed`                     | count                                                       | attempts         | no   | Attempts that passed.                                                                  |
| `failed`                     | count                                                       | attempts         | no   | Attempts that failed.                                                                  |
| `requires-retry`             | count                                                       | attempts         | no   | Attempts that asked the person to retry.                                               |
| `skipped`                    | count                                                       | attempts         | no   | Attempts that were skipped.                                                            |
| `needs-review`               | count                                                       | attempts         | no   | Attempts sent to review.                                                               |
| `canceled`                   | count                                                       | attempts         | no   | Attempts canceled.                                                                     |
| `pass-rate-per-attempt`      | rate: (`passed`) / (`passed` + `failed` + `requires-retry`) | attempts         | no   | Attempts that passed, over attempts that passed, failed or asked for a retry.          |
| `step-entered`               | count                                                       | people-and-steps | no   | Inquiries that entered the verification step.                                          |
| `step-passed`                | count                                                       | people-and-steps | no   | Inquiries whose last attempt at the step passed.                                       |
| `step-failed-after-attempts` | count                                                       | people-and-steps | no   | Inquiries whose step ended without passing, its attempts used up or not retriable.     |
| `step-needs-review`          | count                                                       | people-and-steps | no   | Inquiries whose last attempt at the step went to review.                               |
| `step-skipped`               | count                                                       | people-and-steps | no   | Inquiries whose step was skipped.                                                      |
| `pass-rate-per-person`       | rate: (`step-passed`) / (`step-entered`)                    | people-and-steps | no   | Inquiries whose last attempt at the step passed, over inquiries that entered the step. |

Each inquiry's first person-visible step is entered from the reserved start `$start` (Workflow 9D,
K9-24), stored in `analytics_transition_daily` like any move, so the entry step has transitions into
it and a `step-share`. The start is never served as a transition: the funnel's `transitions` list
only the moves between two steps. Days rolled up and closed before migration 0032 hold no start: on a
window that reaches one of them the entry step's entries usually exceed the transitions into it,
which leaves its `step-share` out, and where moves back into the entry step make up the difference
the share also counts those moves, as `step-share`'s definition says.

### The checks answer

| Key                    | Kind                                        | Counts        | Live | Definition                                                                                         |
| ---------------------- | ------------------------------------------- | ------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `runs`                 | count                                       | checks        | no   | Results written for the check, every status included.                                              |
| `passed`               | count                                       | checks        | no   | Results that passed.                                                                               |
| `failed`               | count                                       | checks        | no   | Results that failed.                                                                               |
| `not-applicable`       | count                                       | checks        | no   | Results not applicable for a reason about the input (never an outage).                             |
| `errored`              | count                                       | checks        | no   | Results that could not be computed: an execution error, a missing input or an unavailable service. |
| `not-configured`       | count                                       | checks        | no   | Results not computed because no provider is configured.                                            |
| `pending`              | count                                       | checks        | no   | Results not finished yet.                                                                          |
| `failed-verifications` | count                                       | verifications | no   | Failed verifications of the check's verification type.                                             |
| `failure-share`        | rate: (`failed`) / (`failed-verifications`) | verifications | no   | Failed results of the check, over the failed verifications of its type.                            |

A check's reason counts (`reason:<code>`) are those of the same check, verification type and
requirement (Workflow 9D, K9-24), so a check used as required in one place and as not required in
another keeps its reasons apart. Migration 0032 gave each earlier reason row the type and
requirement of its check's results of the same day and version when they named exactly one; a row
it could not attribute (the check ran both ways that day) was removed, never guessed, so a closed
day of that kind serves no reasons for that check.

### The cases answer

| Key               | Kind     | Counts | Live | Definition                                                                                              |
| ----------------- | -------- | ------ | ---- | ------------------------------------------------------------------------------------------------------- |
| `created`         | count    | cases  | yes  | Cases created.                                                                                          |
| `resolved`        | count    | cases  | no   | Cases resolved.                                                                                         |
| `sla-met`         | count    | cases  | no   | Resolved cases resolved within their SLA.                                                               |
| `sla-missed`      | count    | cases  | no   | Cases whose SLA was breached.                                                                           |
| `resolution-time` | duration | cases  | no   | From creation to resolution, as the buckets that hold the median and the 90th percentile (approximate). |
| `assigned`        | count    | cases  | no   | Cases assigned to the reviewer (shown only to holders of users:write, never exported by name).          |

### The signals answer

| Key      | Kind  | Counts        | Live | Definition                                                                            |
| -------- | ----- | ------------- | ---- | ------------------------------------------------------------------------------------- |
| `values` | count | signal-values | no   | Inquiries whose signal value fell in the bin; a null value counts as "not evaluated". |

### What the words leave open, as built

The rollup SQL
([`apps/api/src/services/analytics/rollup-sql.ts`](../../apps/api/src/services/analytics/rollup-sql.ts))
decides these, and they are ours:

- **Inquiries.**
  - _Finished_ means the inquiry has a completion or failure time; an expired inquiry never has
    one. _Completed_, _failed_, _approved_, _declined_ and _needs review_ are finished inquiries by
    their status now.
  - The three completed splits come from the inquiry's recorded flow outcome (the verification
    types on its path and the fallbacks it took). A completed inquiry with no recorded flow outcome
    is in none of the three, so the splits can sum to less than `completed`.
  - _Interacted_ means the inquiry's first step record was exited.
  - _Marked for review_ is a finished inquiry that is now in needs review, has a flag on its flow
    outcome, has a review decision record, or has a verification attempt in needs review.
  - _Decided_ reads the inquiry's latest approve, decline or flow-failure decision record. A record
    that says solely automated counts as automatic, one that says it was not counts as manual; when
    the record says neither, a person's decision counts as manual, an API key's as not declared, and
    a workflow run's or the flow's own as automatic. An inquiry with no such record is in none of
    the three.
  - _Time to finish_ runs from creation to the completion or failure time.
- **The funnel.** Its nodes are person-visible steps; branch and action steps are edges. It is
  computed from the server's step record, never from screen views a client reports. The step share
  is absent for a step with no recorded transition into it, or whose entries exceed the transitions
  into it: the entry step is entered from the start, which the transition rollup does not record, so
  its overall share is its figure. The funnel is per template version; compare versions side by side
  rather than summing them.
- **Verifications.** Every attempt is its own verification, so the per-attempt counts and rate are
  of attempts. A step's per-person outcome is that of the inquiry's latest attempt of the step's
  verification type that was sent (not still initiated or confirmed) and not created by a workflow;
  a last attempt that asked for a retry counts as failed after attempts. So two steps of the same
  type in one flow share their attempts, and an entered step with no sent attempt, or whose last one
  was canceled, is in `step-entered` and in none of its four outcomes. The capture method is the one
  the client reported on the attempt's earliest file that carries one (`null` when none does), and
  the country is the government ID's.
- **Checks.** `errored` and `not-configured` are their own statuses, so an outage never counts as
  "not applicable". `pending` is a result that has not finished. A check of a verification type that
  was attempted in the window but that wrote no result there is listed as `ran: false` with no
  counts: it shows "not run", never zero failures. Its requirement is then the registry's default,
  not a template's. The failure share is absent when there are no failed verifications of the type,
  or when the check's failures exceed them (an advisory check can fail without failing its
  verification). The reasons rollup has no verification type or requirement, so a check used both as
  required and as advisory has its reasons combined.
- **Cases.** A case counts on its own creation day. _Resolved_ means it has a resolution time;
  _SLA met_ means it was resolved and its SLA was met; _SLA missed_ means its SLA expired. Resolution
  time is shown as the buckets that hold the median and the 90th percentile. The per-reviewer
  figures count each case under its current assignee.
- **Signals.** Each signal's values fall in fixed bins (below), and `null` is "not evaluated". A
  value outside every bin is left out of that signal and logged by signal name and count, never
  counted in another bin. `inquiry/list_match_count` is read from the list screening: a completed
  screening's match count, and "not evaluated" for any other screening status or none, never 0.
  Distances are stored in metres and binned in whole kilometres.

Durations (time to finish, resolution time) are counted in 40 log-spaced buckets from 1 second to
30 days; each bucket is about 1.45 times as wide as the one before, the first also holds anything
under a second and the last anything over 30 days. A median or percentile is served as its bucket's
bounds ("between 4 and 6 minutes"), so it is approximate, and it is hidden when fewer than the
threshold of durations were counted.

### The signal bins

The bins are ours and provisional, chosen from each signal's value type and range and tuned on no
data.

| Signal                              | Bins                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `inquiry/bot_score`                 | `0-9`, `10-19`, `20-29`, `30-39`, `40-49`, `50-59`, `60-69`, `70-79`, `80-89`, `90-100` |
| `inquiry/behavior_threat_level`     | `low`, `medium`, `high`                                                                 |
| `inquiry/automation_artefact_count` | `0`, `1`, `2-4`, `5+`                                                                   |
| `inquiry/session_count`             | `0`, `1`, `2`, `3-5`, `6+`                                                              |
| `inquiry/network_threat_level`      | `low`, `medium`, `high`                                                                 |
| `inquiry/tor_detected`              | `true`, `false`                                                                         |
| `inquiry/datacenter_detected`       | `true`                                                                                  |
| `inquiry/vpn_detected`              | `true`                                                                                  |
| `inquiry/proxy_detected`            | `true`, `false`                                                                         |
| `inquiry/country_from_session`      | one bin per ISO 3166-1 alpha-2 code present                                             |
| `inquiry/country_comparison`        | `same`, `different`                                                                     |
| `inquiry/max_session_distance`      | `0-49`, `50-499`, `500-1999`, `2000+`                                                   |
| `inquiry/handoff_count`             | `0`, `1`, `2`, `3+`                                                                     |
| `inquiry/list_match_count`          | `0`, `1`, `2-4`, `5+`                                                                   |

## How the counting works

**Cohorts.** An inquiry counts on its creation day in the reporting time zone, and everything about
it counts on that same day: its step record, its verification attempts, their checks and its
signals. An attempt made two days after the inquiry was created still counts on the creation day. A
case counts on its own creation day. A day is computed with the zone's own calendar, so a 23- or
25-hour day is right.

**Rollups.** Twelve daily tables hold counts only, one environment each (`analytics_inquiry_daily`,
`_inquiry_tag_daily`, `_step_daily`, `_transition_daily`, `_path_daily`, `_verification_daily`,
`_verification_step_daily`, `_check_daily`, `_check_reason_daily`, `_case_daily`,
`_case_assignee_daily` and `_signal_daily`; the columns are in
[`packages/db/src/tables/analytics.ts`](../../packages/db/src/tables/analytics.ts)). They name
templates, versions, step ids, check names, reason codes, signal bins and tag names, never an end
user's id or a value. The one exception is `analytics_case_assignee_daily`, keyed by an operator's
user id (see the [employee notice](#employee-notice-the-per-reviewer-case-figures)). Each row says
which zone it was computed in and its `source`: `facts` rows are recomputed from unredacted
inquiries, `redacted` rows hold the contribution of inquiries redacted while their day was open.
Every reader adds both.

**Relations.** Some counts add up once a window has settled (`ANALYTICS_RELATIONS` in
[`metrics.ts`](../../packages/core/src/analytics/metrics.ts)):

- inquiries: created = started + expired before start; started = finished + expired after start;
  finished = completed + failed + approved + declined + needs review; completed = the three
  completed splits;
- verifications: created = submitted + canceled + skipped; submitted = passed + failed + requires
  retry + needs review; step entered = the four step outcomes;
- checks: runs = the six statuses.

They hold only once every inquiry of the window has settled: a pending inquiry is started but
neither finished nor expired. The statement "started equals finished plus expired" is therefore
true of a settled window and not of an open one. Some remainders can also last: an attempt that was
created and never sent (still initiated or confirmed) is in `created` and in none of its parts, and a
verification step whose inquiry never sent an attempt, or whose last attempt was canceled, is in
`step entered` and in none of the four outcomes. Suppression treats each relation's remainder (the
total less its parts, never served) as known to a reader, which is the cautious side: a reader who
assumes a settled window takes it to be 0.

## Suppression

Suppression is applied by one function, `suppressAnalyticsTable` in
[`packages/core/src/analytics/suppression.ts`](../../packages/core/src/analytics/suppression.ts),
after every filter, and the API serves cells only through it. The threshold `t` is the
environment's `analytics-suppression-threshold`: 11 by default, from 11 to 100, never below 11.

**Small counts.** A count from 1 to `t − 1` is served as `{ suppressed: "small-count" }`, shown as
"fewer than `t`". Zero is shown.

**Rates.** A rate over a denominator `D` with numerator `N` and complement `C = D − N` is:

- shown exactly when `N`, `C` and `D` each reach `t` and every cell it sums is shown;
- otherwise, when `N` is below `t`, the bound "under X%" with `X = ⌊100·(t − 1)/D⌋ + 1`;
- when `C` is below `t`, the bound "over Y%" with `Y = ⌈100·(D − t + 1)/D⌉ − 1`;
- not shown at all when `D` is below `t`, or when `N` and `C` are both below `t` (a denominator from
  `t` to `2t − 2`), because no one-sided bound describes it.

Both bounds are **strict** and hold for every numerator the hidden cell allows: with `t = 11`,
`N = 10` and `D = 40` the rate is 25% and the bound reads "under 26%", never "under 25%", which
would not be true. A property test checks every bound against the true value. A bound is shown only
when the denominator's cells are shown, an "under" bound only when no numerator cell is hidden as
complementary, and an "over" bound only when no numerator cell is hidden at all; otherwise the rate
is `{ suppressed: true }`.

**Durations.** A median or percentile is hidden when fewer than `t` durations were counted, and
`null` when none were.

**Complementary suppression.** When a total and all but one of its parts would be visible, the
smallest other visible non-zero part is hidden too, as `{ suppressed: "complementary" }`, shown as
"hidden" (never "fewer than", because its value may be large). Zeros are never hidden. The rule
runs group by group, and then an exact check in integer arithmetic finds any hidden cell that the
visible ones still determine through several groups together (three groups, or a bridge across a
two-way table, can reveal a cell no single group does) and hides one more cell for each, until no
hidden cell can be derived. Cells are read in a fixed order, so which cells are hidden depends only
on the values.

**One table per answer, over the whole time lattice.** Each answer builds one table over every day,
week (from Monday, cut to the window), month (cut to the window) and the window's total, whatever
`bucket` was asked, so a week's total and its visible days never reveal a hidden day, and a `day`
answer and a `week` answer of the same window hide the same cells. A cell that two answers serve
comes from one table: the funnel's `started` is the inquiries answer's, the verifications and checks
answers share one table (a type's failed verifications are in both), and every signal's bins sum to
one shared population.

**Where it applies.** Every answer of the API is built only from suppressed cells, and its schema
refuses an unsuppressed small count. The console's Analytics section (Workflow 9C) draws its charts,
tables and captions from these answers only, and its CSV download of a view (Workflow 9D, K9-18) is
written in the browser from the view's own suppressed tables, a hidden cell as its mark. A database role reads the raw rollups without suppression (see
[below](#no-sql-explorer-a-read-only-database-role-instead)).

## What suppression does not cover

Cell suppression hides cells in one answer. It does not stop a reader who combines answers or
knows more:

- **Differencing windows or filters.** Two overlapping windows (the 1st to the 30th, and the 1st to
  the 29th), or a filtered answer against an unfiltered one, can differ by a single inquiry. Blocking
  that would hide totals for every filter combination; noise-based protection (differential
  privacy) is not built.
- **Snapshot differencing.** An open day's outcomes, read on two consecutive days, differ by the
  outcomes decided in between. The outcomes of open days are refreshed once a local day, over the
  day's whole population, which limits this to once a day; a redaction can refresh one open day's
  outcomes earlier (see [redaction](#redaction-and-retention)).
- **Bounds the labels imply.** A small-count cell is 1 to `t − 1`, and a complementary one is at
  least `t` (zeros are never hidden, and a visible non-zero count is at least `t`), so a total
  close to the least sum of its hidden parts narrows them (protection-interval inference, which
  cell suppression does not address).
- **Readers who can also list inquiries.** An operator who holds `inquiries:read` can count the
  inquiries of a day directly; suppression protects the people behind a count from readers of the
  aggregates, not from readers of the records.
- **Outside knowledge.** A total combined with what a reader already knows about someone (that they
  verified on a given day) can tell that reader more than the total alone.
- **The unsettled remainder lives in the API, not in the function** (S4B-14 (AA2), K9-27, recorded
  in Workflow 9D rather than built). The relations of [How the counting
  works](#how-the-counting-works) hold only once a window has settled: in an open window a pending
  inquiry is started but neither finished nor expired. `suppressAnalyticsTable` checks each relation
  it is given as exact, so the API gives it each relation with one more part, the total less its
  parts on each day, as `<total>.unsettled`. That part is never served and is counted as known to a
  reader, the cautious side: a reader who assumes a settled window takes it to be 0, and where it is
  0 that is right. Two limits follow. Another caller of `suppressAnalyticsTable` must add the
  remainder itself, or the function would treat an open window's relation as exact and could hide
  too little. And a relation that the rows break the other way on a day (its parts over its total,
  which an inquiry redacted between the two counts can cause) is not declared at all, so the exact
  check does not use that equation; a reader who knows it holds can use it where the function did
  not. It was not moved into the function because that changes the function's input and the
  complementary-cell tests along the time axis for every answer at the end of Phase 9, for a
  composition the API's tests already hold. Suppression is never weakened for it.

## Freshness, the settle window and the live day

**The pass.** The worker's repeatable `analytics-rollup` job runs every 5 minutes over every
environment. Its watermark is the clock less 2 minutes, because database timestamps are not
commit-ordered; `freshness.rolled-up-through` is the last pass's watermark.

**Stored days and live days.** Every local day before the watermark's day is stored in the rollups.
The current day, and any later day the last pass has not stored, is **live**: it is computed on
every read with the same SQL, from the unredacted inquiries and cases plus that day's redacted
contributions, and never stored. A live day serves only its live counts (`created` and `started` of
inquiries, `created` of tags and cases) and no outcome at all: no passed, failed, declined, approved,
needs-review or check figure is ever served live, so two reads minutes apart can never be
differenced into one person's outcome. Between the zone's midnight and the first pass after it,
yesterday is still live; before the environment's first pass, every day is live. A week, month or
total that holds a live day is not itself marked live: its `created` and `started` include the live
day, and its outcomes are summed over its stored days only.

**Open and closed days.** A stored day stays **open** for `analytics-settle-days` after it (30 by
default, 1 to 90), then it is **closed** and frozen. While a day is open:

- each 5-minute pass refreshes its `created` and `started` when one of its inquiries,
  verifications, checks or cases changed since the last watermark;
- its outcome columns are recomputed once a local day, by the first pass after the zone's
  midnight, across the day's whole population; `freshness.outcomes-as-of` is that pass's watermark.

So an outcome of an open day is at most a day old, and a change decided after a day closed (a
review decided weeks later) is never reflected in that day. Answers carry `settle-days` so that a
reader can see the window. A figure for a recent window is therefore provisional until its days
close, and the relations of [How the counting works](#how-the-counting-works) hold only once they
have settled.

**The first pass** builds every day from the environment's first inquiry or case (or the retention
window's start, whichever is later) up to yesterday. Days that were already past the settle window
at that build count only the inquiries that were still unredacted then: no redacted contribution was
recorded before analytics existed.

**A closed day stays closed.** The state remembers the last day the rollup closed
(`analytics_rollup_state.closed_through`, Workflow 9D, K9-24), and no later pass or rebuild
recomputes it or an earlier day, so raising `analytics-settle-days` never reopens a closed day: the
larger window applies to the days still open and to the days after them. (Before this, a reopened
day lost at its next recompute an inquiry redacted while it was closed, which had recorded no
contribution.) Lowering the window closes more days at the next pass. Migration 0032 also had every
environment's next pass recompute its open days, so they gained the entry step's start transitions
and the reasons by type and requirement at once.

**No step data.** Step-derived figures start at the environment's first step record. A funnel bucket
before that day says `step-data: false` ("no step data"), never 0, and the funnel's totals name
`step-data-from`, which does not move once set.

## The reporting time zone

`analytics-time-zone` (default `UTC`) is the environment's reporting zone: days are local days in it,
and every answer names it. It must be an IANA zone name that the runtime knows (at most 64
characters) and that the database knows; otherwise the change is refused with 422 at
`/analytics-time-zone` and nothing is written. A UTC offset (`+05:30`), a lower-case `utc` and
`GMT+5` are refused: PostgreSQL reads a bare offset with the opposite sign to ISO 8601.

Changing the zone does not relabel history. The next rollup pass sees that the stored days were
built in another zone and queues an `analytics-rebuild` job, which recomputes the **open** days in
the new zone in one transaction. Closed days and every redacted contribution keep the zone they were
computed in, because their base facts may have been partly redacted. Each bucket names the zone it
was computed in (the setting's, unless all its stored rows are of another), and the answer's
`time-zones` lists every zone in the window, so a range that mixes zones is marked as such.

## Redaction and retention

**Redaction does not change a count.** When an inquiry is redacted (on demand, through an account,
or by retention), its contribution is computed with the same SQL, restricted to that inquiry, inside
the redaction's transaction and before anything is cleared:

- if its cohort day is open, the contribution is added to the day's `redacted` rows (counts only, no
  inquiry id), and, when the day is already stored, taken back out of its `facts` rows, so that the
  sum every reader sees is unchanged;
- if the `facts` rows cannot give it back (the inquiry's outcome changed since the day's last full
  recompute), that day alone is recomputed at once without the inquiry: an extra, early refresh of
  that one day's outcomes;
- if the day is closed, nothing is recorded and the day's counts stay as they are;
- an inquiry already redacted adds nothing, so no contribution is counted twice. If recording the
  contribution fails, the redaction is rolled back.

The rollups hold no end user's data, so they outlive the inquiries they count. The step records
behind the funnel are pseudonymous and are deleted with the inquiry's redaction and by its
retention.

**Retention.** The C16 retention pass (the worker's, or `pnpm --filter @openverify/api
retention:run`) deletes, per environment and in batches, the rollup rows whose local day is more
than `analytics-retention-months` back (13 by default, 13 to 60), and the per-reviewer rows past
`analytics-assignee-retention-months` (13 by default, 1 to 60). Its report counts both
(`deletedAnalyticsRollupRows`, `deletedAnalyticsAssigneeRows`). Every rollup row is deleted with its
environment.

## Employee notice: the per-reviewer case figures

The cases answer can show, per reviewer, how many cases created on a day were assigned to them and
how many of those were resolved. These figures are about named employees, so they are personal data
about them, and an organisation that uses OpenVerify should tell its reviewers about them. The
following paragraph is a starting point to adapt; it is not legal advice, and what an employer must
say, and on what basis it may keep such figures, depends on its jurisdiction and its agreements with
its staff.

> OpenVerify keeps, for each case template and each day, the number of cases created that day that
> are assigned to you and how many of them are resolved. It counts the case's current assignee,
> recomputed while the day is within the settle window. These figures are shown only to colleagues
> who can manage users (the `users:write` permission), in the console's Analytics section and
> through the analytics API to signed-in users; API keys cannot read them, and they are never
> exported with your name. They are kept for `analytics-assignee-retention-months` (13 months unless
> your organisation sets a shorter or longer time, from 1 to 60), and deleted if your user account is
> deleted. Deactivating your account does not delete them; they then expire with that retention
> window. OpenVerify records no availability or working-time figure about you.

As built:

- The rows are `analytics_case_assignee_daily` (environment, day, zone, source, case template, user
  id, `assigned`, `resolved`). They are served only to a principal holding `users:write` (an
  organisation-wide permission; no API key scope grants it); every other reader gets `assignees:
null`.
- When a user is deleted, the foreign key deletes their rows. A function that instead re-keys them to
  "former user" (`forgetAnalyticsAssigneeInTx`) exists for a deletion path to call, but no code path
  deletes a user today (users are deactivated), so it has no caller yet.
- There are no availability metrics: no online time, no idle time, no response time per person.

## Settings

Each is an environment setting changed through `PATCH /api/v1/dashboard/settings` with
`settings:write`, audited like every settings change, and served with its default. See
[the settings pages](../settings/README.md) for how settings are changed and who may change them.

| Setting                               | Default | Bounds                                              | What it does                                  |
| ------------------------------------- | ------- | --------------------------------------------------- | --------------------------------------------- |
| `analytics-time-zone`                 | `UTC`   | an IANA name both the runtime and the database know | the zone days are counted in                  |
| `analytics-suppression-threshold`     | 11      | 11 to 100                                           | the threshold `t` of every suppression rule   |
| `analytics-settle-days`               | 30      | 1 to 90                                             | how long a day stays open before it is frozen |
| `analytics-retention-months`          | 13      | 13 to 60                                            | how long rollup rows are kept                 |
| `analytics-assignee-retention-months` | 13      | 1 to 60                                             | how long the per-reviewer rows are kept       |

Each default and bound is ours and provisional
([`packages/contracts/src/dashboard-api.ts`](../../packages/contracts/src/dashboard-api.ts)).

## No SQL explorer: a read-only database role instead

OpenVerify has no SQL explorer: self-hosters own their database. Analysts who need queries the API
does not answer can read the rollups through a read-only PostgreSQL role, best on a streaming
replica so their queries never load the primary. The compose file ships no replica; setting one up
is PostgreSQL's hot-standby configuration and is the operator's.

Roles and grants are replicated from the primary, so create the role there:

```sql
CREATE ROLE openverify_analytics_reader LOGIN PASSWORD 'change-me-analytics-reader';
ALTER ROLE openverify_analytics_reader SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE openverify TO openverify_analytics_reader;
GRANT USAGE ON SCHEMA public TO openverify_analytics_reader;
GRANT SELECT ON
  analytics_inquiry_daily, analytics_inquiry_tag_daily, analytics_step_daily,
  analytics_transition_daily, analytics_path_daily, analytics_verification_daily,
  analytics_verification_step_daily, analytics_check_daily, analytics_check_reason_daily,
  analytics_case_daily, analytics_signal_daily, analytics_rollup_state
  TO openverify_analytics_reader;
```

Then let it connect only to the replica (`pg_hba.conf`), with its own password from your secret
store. Know what such a role bypasses:

- **No suppression.** It reads the raw counts, small ones included. Grant it only to people who may
  already see those counts, such as people who can list inquiries.
- **No environment boundary.** Every environment's rows are in the same tables; sandbox and
  production are told apart only by `environment_id`.
- **Add both sources.** A day's figure is the sum of its `facts` and `redacted` rows; reading only
  `facts` undercounts every day that had a redaction while it was open. The live day is not stored.
- **No audit entry.** Its reads are not in OpenVerify's audit log; use PostgreSQL's own logging if
  you need a record.
- **Leave out the per-reviewer table.** `analytics_case_assignee_daily` is personal data about
  employees (above), which the grant deliberately omits.
- **Grant no other table.** The other tables hold personal data, secrets and wrapped keys; many
  values are encrypted at rest, but ids, times, statuses and tag names are not.
- **Later tables need their own grant.** A table added by a later migration is not covered.

## Performance

`pnpm --filter @openverify/api analytics:benchmark` measures the rollups on its own container of the
pinned `pgvector/pgvector:pg17` image, one phase per call: `--seed` (resumable, run it until it
prints that the seed is complete), `--measure`, then `--teardown`. On a development machine with
other work running (load about 3), at 1 million inquiries, 2 million attempts, 12 million checks and
3 million step records, the first build of 365 days took 411 s, a 5-minute refresh of 2 dirty days
63 ms, the first pass after midnight over 30 open days 31 s, and the six reads of a 400-day window at
most 392 ms each ([the measurements](../tdd/phase9-api-analytics.tdd.md)). Answers are not cached.

## Not built

- **Forwarding flow events to a third party.** The embed client's `onEvent` lets a host page forward
  events itself; their metadata can carry ids, so a host that forwards them sends those ids too.
- **A SQL explorer** (see the [read-only role](#no-sql-explorer-a-read-only-database-role-instead)),
  **the session map**, and **availability metrics** for reviewers.
- **Noise-based protection** (differential privacy) against window and filter differencing.
- **Device filters on the funnel, verifications and checks**, whose rollups have no device
  dimension (refused with 400).
