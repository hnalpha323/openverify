# Webhooks and notifications

A webhook sends signed event deliveries to a customer's endpoint, retrying failures. This page covers
C169.5 to C169.7 of [the Phase 9 plan](../plans/phase-9.plan.md) as built in Workflow 9B
(`api-keys-webhooks`): names and descriptions, the attempt headers, the previous secret's end,
failure alerts, and notification preferences; and C165.4's delivery search (`api-exports`). Routes
are under `/api/v1` (`webhooks:write` to change a webhook, `webhooks:read` to read one) unless they
say `/dashboard`.

## Name and description

`name` (1 to 200 characters, trimmed, no control characters) and `description` (at most 1,000) are
optional and nullable on create and update (`null` clears them), served on the webhook and copied by
clone. The API keeps them optional for existing clients; the console (Workflow 9C) requires a name
when it creates a webhook, and an existing webhook without one keeps its URL as its title there.

## Deliveries, retries and headers

Each delivery is attempted up to 8 times: at once, then 1 minute, 5 minutes, 30 minutes, 2 hours, 6
hours, 12 hours and 24 hours after the first attempt, each with ±10% jitter
(`WEBHOOK_RETRY_OFFSETS_SECONDS`). Every attempt carries, beside the event id and the signature:

| Header                                  | Value                                                |
| --------------------------------------- | ---------------------------------------------------- |
| `openverify-webhook-attempts-made`      | the attempts made, this one included                 |
| `openverify-webhook-attempts-left`      | the attempts left after this one (never below 0)     |
| `openverify-webhook-first-attempted-at` | when the first attempt was made, an ISO 8601 instant |

## Secret rotation

`POST /api/v1/webhooks/:id/rotate-secret` answers the new secret once; the previous secret keeps
signing for `meta.previous-secret-expires-in-seconds` (24 hours by default, at most 7 days, 0 ends it
at once). Meanwhile each delivery's `openverify-signature` header carries two `v1=` signatures, the
new one first, so **a receiver must accept either until the previous secret ends**. Every webhook the
API serves says when that is, as `previous-secret-expires-at` (`null` once only one secret signs).

## Failure alerts

```json
{ "failure-alert": { "enabled": true, "threshold": 5, "window-minutes": 15 } }
```

`failure-alert` (`threshold` 1 to 10,000, `window-minutes` 5 to 1,440; `null` for none) is set on a
webhook's create or update. The repeatable `webhook-failure-alerts` job runs every 60 seconds in the
worker. For each enabled webhook whose alert is on, it counts the deliveries whose **first** attempt
failed within the last `window-minutes`; when that reaches `threshold`, and the last alert for that
webhook is older than the window, it alerts once:

- a console notification of kind `webhook-failure` to every active user of the organisation who holds
  `webhooks:read` in that environment and has not turned that kind's console channel off;
- an email to those of them who turned its email channel on, when SMTP is configured.

So an alert counts failed first attempts, not retries: a delivery counts once whatever its retries
did, and the alert says so. At most one alert is sent per webhook per window. Simulated and replayed
deliveries count as first attempts too. Deliveries written more than a day before the window are not
scanned.

The email is sent after the alert is committed, from an outbox, at most three tries each, and only to
a user still active, still holding `webhooks:read` there and still choosing email. Its subject is
"A webhook is failing in OpenVerify", and its body is a fixed sentence and a link to the webhook's
console page (`OPENVERIFY_DASHBOARD_PUBLIC_URL`; without it, a sentence asking the reader to sign
in). It never holds the webhook's URL, name or a count. It goes out under the environment's
[sender name](sender-name.md). Without SMTP nothing is queued, and what was queued is dropped and
counted in the log.

**A known gap:** recording an alert updates the webhook row, and a database trigger then moves the
webhook's `updated-at`, so a webhook's `updated-at` changes when an alert fires, though nobody changed
its configuration.

## Searching deliveries

`POST /api/v1/webhook-deliveries/search` (`webhooks:read`) finds the environment's deliveries with
a small query language: clauses over four attributes, combined with `and`, `or` and `not`.

```json
{
  "query": {
    "and": [
      { "attribute": "status", "operator": "eq", "value": "failed" },
      { "attribute": "updated_at", "operator": "gte", "value": "2026-11-01T00:00:00Z" },
      {
        "not": { "attribute": "event_name", "operator": "in", "value": ["inquiry.created"] }
      }
    ]
  },
  "page": { "size": 25 }
}
```

| Attribute    | Operators                | Value                                |
| ------------ | ------------------------ | ------------------------------------ |
| `updated_at` | `gt`, `gte`, `lt`, `lte` | an ISO 8601 date-time with an offset |
| `status`     | `eq`, `in`               | `pending`, `succeeded` or `failed`   |
| `webhook_id` | `eq`, `in`               | a `wbh_` id                          |
| `event_name` | `eq`, `in`               | an event name (`EVENT_NAMES`)        |

- **Limits.** At most two levels of operators and 20 clauses in all; an `and` or `or` holds 1 to
  20 members (`WEBHOOK_DELIVERY_SEARCH_LIMITS`, `packages/contracts/src/webhook-delivery-search.ts`).
  `eq` and `in` each take one value or a list of up to 20, and match any of them. Anything else
  is 400.
- **No personal data.** No clause reads a delivery's body, headers or URL, so a search holds no
  personal data.
- **The answer** is the delivery list document, newest first (`created-at` descending, then id
  descending), 10 a page by default and at most 100 (`page.size`).
- **Paging.** The route is a `POST`, so there is no next URL to follow: **`links.next` is a
  delivery id (`whd_...`), or `null` on the last page.** Send the same `query` again with
  `page.after` set to that id to read the next page. An id that is not a delivery of the
  environment answers 400.

The console's delivery search is at `/webhooks/deliveries`, linked from the webhooks list. It
builds the query from rows of conditions joined by "all of" (`and`) or "any of" (`or`), each row
"is" or "is not" (`not`), at most 20 rows; a date and time is read as UTC; and it posts
`page.after` from the answer's `links.next` for the next page.

## Notifications

A `webhook-failure` notification names its webhook (`subject-type: webhook` and a `webhook`
relationship) where a case notification names its case. `GET /api/v1/dashboard/notifications` and
`POST /api/v1/dashboard/notifications/:id/read` treat each row under its kind's rule: a case notification to a
reader of that case, a webhook-failure notification to a holder of `webhooks:read` in its
environment. An operator with `cases:read` alone does not see webhook alerts, and an operator with
neither permission is refused with 403. A webhook-failure notification stays readable after its
webhook is archived, and goes after 90 days with the other notifications.

## Notification preferences

`GET` and `PUT /api/v1/dashboard/notification-preferences` (any signed-in user, for themselves) hold,
for every notification kind, `{ console, email }`. The defaults are console on and email off. A
`PUT` sets the kinds it names and keeps the others. Preferences belong to the user and are the same
in every environment. Changing them is not audited.

The webhook failure alerts and, since Workflow 9D (K9-26), the case notifications of Phase 8
(assigned, SLA breached, mentioned) read these preferences per kind, through the same reader: a user
gets the console notification only with `console` on, and the link-only email only with `email` on.
So, with the defaults, a case notification is shown in the console and no longer emailed until the
user turns email on for its kind; this changes Phase 8's behaviour, which emailed every case
notification. A case template version's `notify-on-create` list is the template's own choice of
people to email, has no preference kind, and is emailed as before.

## Not built

OAuth client credentials on deliveries and payload filters are not built. Payloads carry related
objects as ids only, and files are served only through authenticated routes, with no file-access
tokens.
