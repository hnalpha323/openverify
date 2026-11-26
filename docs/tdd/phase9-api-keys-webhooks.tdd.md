# Phase 9, Workflow 9B, Stage 3: `api-keys-webhooks` (family W)

One-call key rotation, the key `note`, its age warning and its attribute blocklist at every exit;
webhook names, descriptions and failure alerts with their sweep, the attempt headers and the previous
secret's end; notification preferences and the `webhook-failure` kind; the sender name (C169.1-C169.3,
C169.5-C169.8, C169.10; decisions 50 and 52; reviews P22, P29, P33; plan outcomes 20 and 21). Built on
`foundation-9b`'s (W) checkpoint (`b0b5a2a3`, code `9f0d3317`).

Every command ran after `source scripts/env.sh`, from the package directory named (`apps/api` or
`packages/db`). Iterating runs pass `--coverage.enabled=false --maxWorkers=2`. Outputs are abbreviated.

## Slice 1: the sender name (C169.8; review P29)

RED `fababcb1`, GREEN `4fbe8818`.

The test renders each From through nodemailer's own `MailComposer` (what the SMTP transport writes) and
reads the header back: the address must stay the install's, the name must read back exactly, a
non-ASCII name must go out as RFC 2047 encoded words and a name with specials as a quoted string. A
probe first showed that nodemailer re-parses the `from` string and encodes the name itself, quoting an
encoded word written before it (`"=?UTF-8?B?...?=" <...>`, which RFC 2047 section 5 forbids), so
`formatSender` answers `"<name>" <address>` with the raw name and leaves the encoding to nodemailer.

```
$ pnpm exec vitest run src/mail/sender-name.test.ts
 FAIL ... sends look-alike characters encoded, as the name they are, with the install address
AssertionError: expected { name: 'OpenVerify', …(1) } to deeply equal { …(2) }
      Tests  8 failed | 12 passed (20)
```

GREEN: the first run of `src/mail/` failed `sender-name-hook.test.ts` "keeps the install-wide From
while the stub is not built" (received `"Synthetic Bank" <no-reply@example.test>`), the stub test
`foundation-9b` named for replacement; it now reads the built From.

```
$ pnpm exec vitest run src/mail/
 Test Files  5 passed (5)
      Tests  43 passed (43)
```

Spoofing examples kept on the install From: an address of its own, an at sign, a closing quote, CR LF
and LF header injections, a NUL, a lone `>`, an encoded word decoding to an address, a bidi override,
an empty name and 101 characters. Full-width look-alikes are sent, encoded, as the name they are, with
the install address.

## Slice 2: the attempt headers (C169.5; contracts B30)

RED `2d610dcf`, GREEN `4ad1dec2`.

```
$ pnpm exec vitest run src/webhooks/attempt-headers/ src/phase9b-keys-webhooks-plumbing.test.ts -t "attempt header|deliveryAttemptHeaders|attempt headers"
     × names the attempts made with this one, those left, and when the first was made
AssertionError: expected {} to deeply equal { …(3) }
     × sends the headers on each attempt, with the first attempt’s time kept
AssertionError: expected [ { made: undefined, …(2) }, …(1) ] to deeply equal [ Array(2) ]
     × adds the three attempt headers (built by api-keys-webhooks)
      Tests  5 failed | 2 passed | 13 skipped (20)
```

GREEN: two Phase 2 tests of `dispatcher.test.ts` compare the exact header set; the plan adds three
headers, so both gain them (an existing test changed by the plan).

```
$ pnpm exec vitest run src/webhooks/ src/phase9b-keys-webhooks-plumbing.test.ts
 Test Files  8 passed (8)
      Tests  629 passed (629)
```

## Slice 3: the key attribute blocklist (C169.3; review P22)

Stubs `e7add586`, RED `e591edd9`, GREEN `35f9c8cf`.

One test per exit (top-level `data`, `included[]`, an event's `payload`, export columns, bulk-report
results, the `meta` of an asynchronous job, problems), the hook's body handling (a Buffer, non-JSON
bodies, unparseable JSON, no content type), and one test per golden document of
`contracts/fixtures/api/` (178 resource families and variants): every top-level attribute blocked leaves
each resource of `data` and `included` its `type`, `id`, `relationships` and `links`, and no blocked
name at any depth of any resource's attributes.

```
$ pnpm exec vitest run src/services/api-keys/blocklist.test.ts
     × top-level data: removes the names at any depth of the attributes, keeping type, id, relationships and links
     × a JSON body that does not parse is not sent (fail closed)
AssertionError: expected '{"data":{"attributes":{"birthdate":"1…' to be ''
     × account-action.json: every top-level attribute blocked leaves each resource its type, id and relationships only
      Tests  180 failed | 5 passed (185)
```

GREEN: the first run failed the problem case only, on the RED's own expectation: its list names
`status`, which the nested inquiry rightly loses while the problem keeps its own `status`. The
expectation was corrected.

```
$ pnpm exec vitest run src/services/api-keys/blocklist.test.ts src/phase9b-keys-webhooks-plumbing.test.ts
 Test Files  2 passed (2)
      Tests  200 passed (200)
blocklist.ts |   95.58 |    88.75 |     100 |   95.38
```

## Slice 4: rotation, the note, the stored blocklist and the age (C169.1-C169.3; review P33)

RED `37e1e474`, GREEN `3fb7c2ea`.

```
$ pnpm exec vitest run src/routes/server/api-keys-phase9b.test.ts src/phase9b-keys-webhooks-plumbing.test.ts
     × clones the key with its scopes, IPs, version, blocklist and note, ends the old one, and answers the token once
Error: expected HTTP 201, got 501: ..."API key rotation is not built yet (api-keys-webhooks, Workflow 9B)."
     × refuses a caller that does not hold every scope it would copy, and changes nothing (review P33)
AssertionError: ...: expected 501 to be 403
     × marks a key older than api-key-age-warning-days (90 by default) and follows the setting
AssertionError: expected [ undefined, undefined, undefined ] to deeply equal [ false, true, false ]
 Failed Tests 16
```

GREEN. The first run failed four tests; the corrections were to the RED test's own assumptions, each
recorded here: the refusal test compared whole lists, whose `last-used-at` moves with the caller's own
key (it now compares ids and ends); `created-at` is the database's time, not the fixed clock (the age
test sets the clock from it); the harness records events rather than storing them (the event is stored
with `createEvent` from the inquiry's own document); the key list names `scopes` as a value of its own
`attribute-blocklist` (the member is checked instead of the text); the stored-log check names the
blocked key. One existing test changed by the plan: `routes/server/api-keys.test.ts` "creates a key and
returns its token once" gains `note: null`, `attribute-blocklist: []` and `age-warning: false`.

```
$ pnpm exec vitest run src/routes/server/api-keys-phase9b.test.ts src/phase9b-keys-webhooks-plumbing.test.ts src/routes/server/api-keys.test.ts
 Test Files  3 passed (3)
      Tests  78 passed (78)
$ pnpm exec vitest run src/case-plumbing.test.ts src/phase9b-access-plumbing.test.ts src/case-joins.test.ts src/routes/server/report-review.test.ts
 Test Files  4 passed
```

## Slice 5: webhook name, description, failure alert and the previous secret's end (C169.5, C169.6)

RED `e7b9e645`, GREEN `780bb7bf` (the borrowed edit of `services/webhooks.ts`, plan W7).

```
$ pnpm exec vitest run src/routes/server/webhooks-phase9b.test.ts src/phase9b-keys-webhooks-plumbing.test.ts
     × are stored and served on create, and stored as the three alert columns
Error: expected HTTP 201, got 501: ..."A webhook's name, description, failure-alert are not built yet"
     × says until when the previous secret signs, and null once it no longer does
AssertionError: expected undefined to be '2026-10-20T13:00:00.000Z'
      Tests  9 failed | 13 passed (22)
$ pnpm exec vitest run src/routes/server/webhooks-phase9b.test.ts src/phase9b-keys-webhooks-plumbing.test.ts src/routes/server/webhooks.test.ts src/routes/server/webhook-actions.test.ts src/routes/server/webhook-deliveries.test.ts
 Test Files  5 passed (5)
      Tests  126 passed (126)
```

`prettier --ignore-path=.gitignore` also wrapped three long lines of `services/webhooks.ts` outside the
change; they were put back as they were (the format trap of plan outcome 37).

## Slice 6: notification preferences and the `webhook-failure` read rule (C169.7; outcome 20)

RED `a65c1598`, GREEN `8a76dcc8`.

```
$ pnpm exec vitest run src/routes/dashboard/notification-preferences.test.ts src/routes/dashboard/phase9b-notification-routes.test.ts
     × answers every kind with the defaults, the console on and email off, under the user’s id
AssertionError: ..."Notification preferences are not built yet ...": expected 501 to be 200
     × hand the rows about a webhook to readableWebhookNotifications, which keeps them for webhooks:read
AssertionError: expected [ 'unot_…' ] to deeply equal [ …(2) ]
     × serve a webhook failure the rule keeps, naming its webhook, to a reader without cases:read
AssertionError: expected [] to deeply equal [ 'unot_…' ]
      Tests  6 failed | 5 passed (11)
$ pnpm exec vitest run src/routes/dashboard/notification-preferences.test.ts src/routes/dashboard/phase9b-notification-routes.test.ts src/routes/dashboard/notifications.test.ts
 Test Files  3 passed (3)
      Tests  13 passed (13)
```

The read test now holds both halves of outcome 20: a reader with `webhooks:read` and no `cases:read`
sees the alert, and one with `cases:read` alone does not (404 on its read).

## Slice 7: the `webhook-failure-alerts` sweep (C169.6, C169.10; outcome 21)

db stubs `6acfc90e`, db RED `7eb76277`, API RED `41a231be`, db GREEN `b9d311de`, API GREEN `ee26f0d2`.

```
$ (packages/db) pnpm exec vitest run src/repositories/webhook-alerts.test.ts
     × counts deliveries whose first attempt failed inside the window, never a retry
Error: countFailedFirstAttempts is not built yet (api-keys-webhooks, Workflow 9B)
      Tests  8 failed (8)
$ (apps/api) pnpm exec vitest run src/jobs/repeatable/webhook-alerts.test.ts src/worker-webhook-alerts.test.ts
     × alerts the users who hold webhooks:read: the console for each, a link-only email for one who chose it
PermanentJobError: The job cannot succeed (webhook_failure_alerts_not_built)
     × passes over a database with no alert on and reports nothing (built by api-keys-webhooks)
PermanentJobError: The job cannot succeed (webhook_failure_alerts_not_built)
```

db GREEN: the first run failed the count (`expected +0 to be 3`): the scan's `created_at <= to` bound
left out deliveries the database stamped after the pass's time. The bound is not needed (the first
attempt's time bounds the window; `created_at >= from - 1 day` keeps the index) and was removed.

```
$ (packages/db) pnpm exec vitest run src/repositories/webhook-alerts.test.ts
      Tests  8 passed (8)
$ (apps/api) pnpm exec vitest run src/jobs/repeatable/webhook-alerts.test.ts src/worker-webhook-alerts.test.ts src/jobs/repeatable/index.test.ts
 Test Files  3 passed (3)
      Tests  15 passed (15)
```

## Final gates

Each read from its own exit code; heavy calls through `/tmp/openverify-heavy.sh`; the load average
beside each timing.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm exec prettier --check --ignore-path=.gitignore <my 28 files>` | exit 1 on `apps/api/src/services/webhooks.ts` only: three long lines outside my change, never formatted before (the `services/` ignore trap, outcome 37), kept as they were; every line I wrote is formatted. The plain `prettier --check` (the repository's ignore file) passes |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --concurrency=1 --filter=@openverify/api --filter=@openverify/db` | exit 0, 4 of 4 tasks, 728 s (load 24.1 before, 6.1 after) |
| `pnpm --filter @openverify/db test` | first run exit 1 on two `report_origin` tests of `foundation-9b` (X)'s migration, fixed in its `db00d996`; re-run exit 0: 148 files, 2,147 tests, 92.26% statements, 258 s (load 17.2 / 25.3) |
| db `test:integration` | exit 0, 78 tests, 161 s (load 10.0 / 28.4) |
| api `--project graph` | exit 0, 13 tests, template 225,000 rows built in 30.2 s of its 180 s guard, 65 s (load 26.2 / 12.8) |
| api `--project api --shard=1/3`, `2/3`, `3/3` | exit 0 each: 89 tests 164 s (load 12.0 / 29.3), 98 tests 236 s (27.8 / 20.2), 78 tests 96 s (20.1 / 22.5) |
| API unit, 6 blob shards (`--maxWorkers=3`) and the merge, run 1 at `ee26f0d2` | shards 287, 347, 309, 366, 382, 395 s (load 4.0 to 20.3); merge exit 1: 666 files, 9,175 tests, 1 failed, `openapi.test.ts` "matches the committed snapshot", on `foundation-9b` (X)'s routes before its snapshot commit `99f77a83`; the file passes on the tree after it (15 of 15); 94.36% statements, 84.87% branches |
| API unit, run 2 at `db00d996` | shards 262, 277, 293, 290, 279, 278 s (load 3.8 to 20.7); merge exit 1: 81 tests in 3 files failed, all on other agents' in-flight work while it ran: `seed/dev-seed.test.ts` and `workflows/actions/https/handler.test.ts` (failed queries against migration 0031 while `foundation-9b` (C) regenerated it, uncommitted), `phase9b-exports-plumbing.test.ts` (`api-exports`' list filters built in `c7263441`, replacing that stub test); 93.6% statements, 83.92% branches; my files: `services/api-keys.ts` 96.96%, `services/api-keys/` 96.38% |
| The failed files re-run on the settled tree (after `c828a66e`) | `dev-seed`, `https/handler`, `phase9b-exports-plumbing`, `openapi` and all my files: exit 0, 26 files, 1,106 tests, 82 s (load 3.1 / 5.7) |
| API unit, run 3 at `bc3c4014` | shards 298, 321, 308, 297, 343, 292 s (load 5.4 to 20.8); merge exit 1: 672 files, 9,216 tests, 3 failed, all in `routes/dashboard/phase9b-print-audit-routes.test.ts`, `foundation-9b` (C)'s RED `6298fca4`, whose GREEN `fc9ca64e` landed while the shards ran; that file passes after it (3 of 3); 93.3% statements, 83.9% branches; my files 96.96% (`services/api-keys.ts`), 95.58% (`blocklist.ts`), 100% (`rotate.ts`, `webhooks/alerts/notifications.ts`) |

No full-stack e2e (Stage 3 rule). The benchmark checks were not needed: no file rule 16 names changed.
