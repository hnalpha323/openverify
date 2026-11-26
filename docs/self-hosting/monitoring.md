# Monitoring

What to watch and alert on (C277.10). **Metrics are log events** (C250.7): there is no metrics port and no `/metrics` endpoint (deferred, C286). Every metric is one pino line at `info` with a stable `metric` field, a numeric `value` and its labels, which are an environment id and a queue name only, never personal data. Ship the API's and the worker's logs to a log store and alert on those lines (for example on `metric` and `value` in your log store's query language). Every metric name this page uses is registered in `apps/api/src/metrics-registry.ts`; `apps/api/src/metrics-documents.test.ts` fails the API's suite when this page names one that is not.

## The registered metrics

Generated from the registry (`pnpm --filter @openverify/docs-tools docs:selfhost` refreshes it):

<!-- openverify:selfhost-metrics:start -->
| Metric | Kind | Unit | Labels | What it means | Contract |
|---|---|---|---|---|---|
| `metric: account_export_refused_pending` | counter | count | environmentId | An account export refused with 409 account_export_pending: the account already had one being prepared. | C253.5 |
| `metric: account_export_refused_rate_limited` | counter | count | environmentId | An account export refused with 429 by the account-export policy (10 an hour per environment). | C253.7 |
| `metric: account_export_refused_too_large` | counter | count | environmentId | An account export refused with 422 account_export_too_large, or failed with that code by its job: more than 5,000 items. | C253.5 |
| `metric: account_export_refused_unavailable` | counter | count | environmentId | An account export refused with 503 account_export_unavailable: the rate-limit store did not answer, so the policy failed closed. | C253.7 |
| `metric: handoff_send_budget_unavailable` | counter | count | environmentId | A handoff link send refused with 503 handoff_send_limited because the store behind the send budget or the SMS guards did not answer (the budget fails closed). | C96.3 |
| `metric: network_sources_stale` | gauge | count | none | Enabled public network sources whose snapshot is stale, never checked or not loaded, at each re-check of a process (every 60 s); their facts read list_stale or list_unavailable. | C92.4 |
| `metric: network_sync_failed` | counter | count | none | A network source sync that ended in an error or a refusal, recorded on the source and counted toward its back-off; the network sync finished line names the source and the code. | C92.2 |
| `metric: queue_admission_wait_ms` | gauge | milliseconds | environmentId, queue | The longest time a job the quota sweep admitted on its visit had been held by its environment cap. | C251.4 |
| `metric: queue_at_cap_ms` | gauge | milliseconds | environmentId, queue | How long an environment with held work has sat at a queue cap, logged once with a warn line past five minutes. | C251.4 |
| `metric: queue_in_flight` | gauge | count | environmentId, queue | Jobs of one environment queued or running on one capped queue, read at the quota sweep visit. | C251.4 |
| `metric: queue_in_flight_cap` | gauge | count | environmentId, queue | The in-flight cap in force for one environment and capped queue, at most the install ceiling. | C251.4 |
| `metric: rate_limiter_store_unavailable` | counter | count | none | A rate-limit store (Valkey) did not answer: the login limiter refused with 503 login_unavailable, or another limit let the request through uncounted. | C246.2 |
| `metric: sso_sign_in_refused` | counter | count | none | An SSO start, callback or step-up refused (C248.7): the browser saw one generic problem, and the log line beside the event names the refusal code and the provider id. | C248.7 |
| `metric: worker_heartbeat_age_ms` | gauge | milliseconds | none | The age of the worker heartbeat each write replaces, normally the 10 s interval; a growing value is a stalling event loop, and the exec probe fails past 30 s. | C250.2 |
<!-- openverify:selfhost-metrics:end -->

## Alerts to set

| Watch | Signal | Alert when |
|---|---|---|
| Rate-limit store (H18) | `metric: rate_limiter_store_unavailable` | any: the login limiter is refusing sign-ins (503 `login_unavailable`) and the other limits are not counting |
| Handoff send budget | `metric: handoff_send_budget_unavailable` | any: handoff links cannot be sent (503 `handoff_send_limited`) |
| Account exports | `metric: account_export_refused_unavailable` | any (the export policy fails closed without its store) |
| Worker liveness | `metric: worker_heartbeat_age_ms` | it grows past the 10 s interval; the exec probe (`node dist/worker-health.js`) fails past 30 s |
| Queue caps | `metric: queue_in_flight` against `metric: queue_in_flight_cap`; `metric: queue_at_cap_ms`; `metric: queue_admission_wait_ms` | an environment sits at its cap (the sweep also logs a warn line past 5 minutes) |
| Network data | `metric: network_sources_stale`, `metric: network_sync_failed` | the stale count is above 0; a sync fails (the sync's finished line names the source and the code; `docs/network/README.md`) |
| SSO | `metric: sso_sign_in_refused` | a rise against your baseline ([sso.md](sso.md)) |
| Readiness | `GET /ready` on the API (Postgres and Valkey, each with its state) | not 200 |

## Queues and caps

The admitted queues (C251) are `process-verification`, `report-run`, `integrity-decode`, `connect-redeem` and `account-export`, plus `workflow-step` under Phase 8's dispatcher: a job waits in its own outbox or pending state while its environment is at its cap (default 50 per queue per environment, never above `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`), and the quota sweep admits it in turn. The console's queue panel shows each cap; it does not show the in-flight count ("Not reported"): read it from `metric: queue_in_flight`.

**Ten queues are classified as capped but have no admission in this release**: `list-screen`, `list-import`, `list-item-embed`, `graph-index`, `graph-query`, `inquiry-signals`, `list-rescreen`, `case-rendition`, `case-attachment-scan` and `case-bulk`. Their environment caps (`queue-in-flight-caps`) are stored and enforced by nothing (KP11-28, Workflow 11F). Caps bound how much of the worker one tenant can hold; they add no capacity, and a cap set too low delays that tenant's own work (C251.6). Even where caps hold, **fairness was missed at the default cap**: another environment's report p95 was 26.6 times its idle p95 behind a flood ([sizing.md](sizing.md#what-one-process-carried)).

No metric reports queue depth or lag. Read them from Valkey (BullMQ's waiting, active, delayed and failed counts per queue) or from the outbox tables, and watch especially the Workflow 7B queues (`list-screen`, `list-import`, `graph-index`, with the rows each leaves errored: `docs/lists/README.md`, `docs/graph/README.md`), the workflow and case queues (`docs/workflows/limits.md`, `docs/cases/README.md`) and the webhook delivery queue.

## Operator checks without a metric

- **Report and sync errors**: report runs that end `errored` (about 0.8% of report runs did on the load stack at every rate, `docs/calibration/load-phase11.md` finding 13); `watchlists:sync`, `pep:sync`, `network:sync` and `trust-anchors:sync` exit 1 on a refused or failed source, so alert on a scheduled run's exit code.
- **Sync freshness**: the console's watchlist sources page marks a source stale, counting from its last successful check (`apps/api/src/watchlists/freshness.ts`); network sources count in `metric: network_sources_stale`.
- **Webhook failures**: each webhook's own failure alert (`failure-alert`, a threshold of failed first attempts within a window) notifies its organisation in the console and by email (`docs/settings/webhooks.md#failure-alerts`). Under overload the webhook delivery lag grew on the load stack (KP11-57, Workflow 11F).
- **Vision's guarded children**: vision logs a warning when a guarded task's child fails, and answers 503 `guarded_worker_failed` to its caller (`services/vision/src/openverify_vision/guarded/runner.py`).
- **Transport and start-up warnings**: `insecure_transport` (a store an interceptor could read, production mode only), `internal_listen_unset`, `secret_file_readable`, the worker's eviction-policy error ([valkey.md](valkey.md)) and a hop-count `OPENVERIFY_TRUST_PROXY` at start.
- **Certificate expiry**: your TLS certificates, the stores' CAs, and the NFC trust store's CSCAs (refreshed by `trust-anchors:sync`); nothing in OpenVerify watches them for you.

## Scaling on queue depth

The chart renders no autoscaler for the worker. An event-driven autoscaler such as KEDA reading the BullMQ lists in Valkey can scale the worker's replicas: that is an example only, untested by this project, and each new worker pod counts 10 database connections ([sizing.md](sizing.md#database-connections)).
