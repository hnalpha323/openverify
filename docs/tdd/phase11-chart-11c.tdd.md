# Workflow 11C, chart-11c (family K: C263)

Owner of `deploy/helm/openverify/` except `templates/networkpolicies.yaml`, `templates/_security.tpl`, `tests/` and `ci/` (chart-policy-11c's), with the carve-out for this area's own helm-unittest files `deploy/helm/openverify/tests/c263-*_test.yaml` (a Stage 2 amendment for integration-11c to record). `Chart.yaml` and `values.schema.json` are frozen (contracts-11c's). Stage 2, beside the other 11C builders (rule 25: parallel gates). Every timing below carries `cat /proc/loadavg`.

Wait (rule 17): scanners-11c's checkpoint `chart-tools` (`e80e395a2`, "CHECKPOINT chart-tools DONE at 29343142f"). Its installers put Helm 4.3.1 (`helm`), Helm 3.22.1 (`helm3`), helm-unittest 1.2.1 (`~/.local/share/helm/plugins/unittest`, shared by both Helms) and kubeconform 0.8.0 in `~/.local/bin`; this area ran nothing before it landed and committed nothing before it.

Tools as run: `helm` = v4.3.1+gc0d08d0, `helm3` = v3.22.1+gd6c1a0e, `helm plugin list` = unittest 1.2.1.

## 1. Checkpoint components (C263.1-C263.3)

### RED

`deploy/helm/openverify/tests/c263-components_test.yaml` (the components, their labels and selectors, the restricted pod fields every pod shares, the image references with the digest appended, the Services, each process's ConfigMap placed by the registry's `processes` field, the migrate Job with its hook, its two steps and its GitOps switch, NOTES.txt) and `c263-checks_test.yaml` (the refusals: a heartbeat outside `/tmp`, a loopback console URL in production, `OPENVERIFY_DASHBOARD_INSECURE_COOKIES=true`, Play Integrity's key in the API's Secret, `OPENVERIFY_SANDBOX_CHIP_FACES`, a deadline at or below the lock's wait). The checks are their own suites, each rendering one template, because helm-unittest reports a failed render against the first template of the suite that fails.

```
$ cat /proc/loadavg
4.88 3.74 2.84 12/932 1804667
$ helm unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify          (rc 1)
template "openverify/templates/api/deployment.yaml" not exists or not selected in test suite   (x7)
template "openverify/templates/NOTES.txt" not exists or not selected in test suite             (x7)
template "openverify/templates/configmap.yaml" not exists ...; Error: rendered manifest is empty (x8)
Test Suites: 3 failed, 0 passed, 3 total
Tests:       49 failed, 0 passed, 49 total
$ helm3 unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify         (rc 1)
Tests:       49 failed, 0 passed, 49 total
```

Every case fails because the templates it renders do not exist yet (the chart holds only `_security.tpl`).

### GREEN

Continuation after the orchestrator's clean stop at 98% weekly usage (2026-11-14 15:17 EST): the GREEN templates were in the tree, uncommitted, when the Workflow stopped; they were compared byte for byte with the orchestrator's saved copy (`resume/phase11-prep/11c-stop/untracked.tar`, all 17 identical) and committed as they stood, nothing redone.

The templates: `templates/_helpers.tpl` (names, labels, `openverify.image`, `openverify.publicUrl`, `openverify.serviceUrl`, `openverify.checks`, `openverify.podSpecCommon`, `openverify.containerEnv`, `openverify.volumes`, `openverify.volumeMounts`), `templates/_config.tpl` (`openverify.configData` per process, placed by the registry's `processes`; `openverify.configChecksum`; `openverify.envList`), `templates/_deployment.tpl` (`openverify.deployment`, `openverify.service`), `templates/configmap.yaml` (one ConfigMap per long-running process), the six components' `deployment.yaml` and `service.yaml` (the worker has no Service), `templates/migrate-job.yaml` and `templates/NOTES.txt`.

```
$ cat /proc/loadavg
3.51 0.91 0.30 2/731 1874115
$ helm unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify            (rc 0)
 PASS  c263 checks (configmap) / c263 checks (migrate job) / c263 components
Test Suites: 3 passed, 3 total
Tests:       49 passed, 49 total
$ helm3 unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify           (rc 0)
Tests:       49 passed, 49 total
$ helm lint deploy/helm/openverify      (rc 0)   [INFO] Chart.yaml: icon is recommended; 1 chart(s) linted, 0 chart(s) failed
$ helm3 lint deploy/helm/openverify     (rc 0)   same
$ helm template ov deploy/helm/openverify --namespace verify | kubeconform -strict -summary -kubernetes-version <v> -schema-location "$(python3 -I scripts/fetch_k8s_schemas.py --print-location <m>)"
1.35.9: Summary: 19 resources found in 1 file - Valid: 19, Invalid: 0, Errors: 0, Skipped: 0   (rc 0)
1.36.5: Summary: 19 resources found in 1 file - Valid: 19, Invalid: 0, Errors: 0, Skipped: 0   (rc 0)
1.37.1: Summary: 19 resources found in 1 file - Valid: 19, Invalid: 0, Errors: 0, Skipped: 0   (rc 0)
$ pnpm exec prettier --check deploy/helm/openverify     (rc 0) All matched files use Prettier code style!
$ HELM4=~/.local/bin/helm HELM3=~/.local/bin/helm3 bash infra/tests/chart-skeleton.test.sh   (rc 0) 51 passed, 0 failed, 0 skipped
```

The 19 resources: six ConfigMaps (api, worker, dashboard, flow, vision, code-runner), six Deployments, six Services (api, api-internal, vision, flow, dashboard, code-runner) and the migrate Job.

### Gate (rule 25, parallel gates: this area's own checks)

The chart's own checks above (both Helms' unittest and lint, kubeconform on 1.35.9, 1.36.5 and 1.37.1, the chart-local Prettier check, contracts-11c's `chart-skeleton.test.sh`), then `pnpm format:check`: rc 1 (135 s, load 9.67 3.95 1.46 at its start), on one file only, `apps/demo-web/e2e/tsconfig.json`, sdk-web-11c's uncommitted work in progress (not this area's; every chart file passes). No package, Android or e2e path changed, so nothing else applies.

CHECKPOINT components DONE at f3af88a82046985c99465a85bfd878b78ff2f9dd

Handoff for chart-policy-11c (and integration-11c):
- Template files: `templates/_helpers.tpl`, `_config.tpl`, `_deployment.tpl`, `configmap.yaml`, `migrate-job.yaml`, `NOTES.txt`, `api/{deployment,service}.yaml`, `worker/deployment.yaml` (no Service), `vision/{deployment,service}.yaml`, `flow/{deployment,service}.yaml`, `dashboard/{deployment,service}.yaml`, `code-runner/{deployment,service}.yaml` (both only while `codeRunner.enabled`). Later checkpoints add `ingress.yaml`, `httproute.yaml`, `hpa.yaml`, `pdb.yaml` (operations), `models-*.yaml` (models).
- Names: `openverify.fullname` is `<release>-openverify` (or the release name when it already holds `openverify`, or `fullnameOverride`); every component object is `openverify.componentName (dict "root" $ "component" <c>)` = `<fullname>-<c>`. Services: `<fullname>-api` (port `api.port` 3000, port name `http`), `<fullname>-api-internal` (port `api.internalListen.port` 3101, name `internal`, selecting the API's pods), `<fullname>-vision` (8000, `http`), `<fullname>-flow` (4173, `http`), `<fullname>-dashboard` (3001, `http`), `<fullname>-code-runner` (7700, name `runner`). The worker opens no port.
- Labels every pod carries (`openverify.labels`): `app.kubernetes.io/name: openverify` (or nameOverride), `app.kubernetes.io/instance: <release>`, `app.kubernetes.io/component: <c>`, `app.kubernetes.io/part-of: openverify`, `app.kubernetes.io/version`, `app.kubernetes.io/managed-by`, `helm.sh/chart`. Selectors (`openverify.selectorLabels (dict "root" $ "component" <c>)`) are the first three only; select a component's pods with it. Component values: `api`, `worker`, `vision`, `flow`, `dashboard`, `code-runner`, `migrate` (the migrate Job's pod), `models-fetch` (the models Job's pod, checkpoint models).
- Helper calls into `_security.tpl` (each with `"root" $`): every pod `openverify.podSecurityContext (dict "root" $ "uid" 10001 "gid" 10001)` under `securityContext:` at indent 2 of the pod spec; every container `openverify.containerSecurityContext (dict "root" $)`; `openverify.tmpVolume`/`openverify.tmpVolumeMount` first in each list; `openverify.secretVolume`, `openverify.secretVolumeMounts`, `openverify.secretFileEnv`, `openverify.caVolumes`, `openverify.caVolumeMounts`, `openverify.caFileEnv`, each with `"process"` one of `api`, `worker`, `vision`, `flow`, `dashboard`, `codeRunner`, `migrate` (`modelsFetch` in the models checkpoint, which mounts no Secret). The volume and mount helpers must render YAML list items (`- name: ...`) at column 0, or nothing; the env helpers list items `- name: <NAME>_FILE` / `value:` at column 0, or nothing. The Deployment trims each helper's output and indents it, so a helper may render several items. A container's `env` is: the Secret files, then the CA files, then `<c>.extraEnv`; the non-secret configuration comes from the ConfigMap by `envFrom` (long-running processes) or inline env (the migrate Job).
- Pod fields set by `openverify.podSpecCommon`: `automountServiceAccountToken: false`, `enableServiceLinks: false`, `imagePullSecrets`, `securityContext`, `priorityClassName`, `nodeSelector`, `tolerations`, `affinity`, `topologySpreadConstraints`, `terminationGracePeriodSeconds`.
- ConfigMaps (`templates/configmap.yaml`, one per long-running process, named like the component): API and worker (`OPENVERIFY_MODE`, `OPENVERIFY_LOG_LEVEL`, `OPENVERIFY_CONNECT_ENABLED` false, `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` false, `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX` 50, `OPENVERIFY_HANDOFF_SENDS_PER_HOUR`, `OPENVERIFY_VISION_URL` = `http://<fullname>-vision:8000`, `S3_*` from `external.s3`, `OPENVERIFY_MAIL_FROM`, `OPENVERIFY_FLOW_PUBLIC_URL`, `OPENVERIFY_DASHBOARD_PUBLIC_URL` (`publicUrls.<host>` or `https://<ingress.hosts.<host>>`), `OPENVERIFY_TRUST_PROXY` only from `api.trustProxy`, the network source lists, `providers`, `config.extra`); the API alone `OPENVERIFY_API_HOST` 0.0.0.0, `OPENVERIFY_API_PORT`, `OPENVERIFY_INTERNAL_LISTEN` = `0.0.0.0:<api.internalListen.port>`, the console limits, `OPENVERIFY_SSO_PRIVATE_ISSUERS`, `OPENVERIFY_HSTS_MAX_AGE` 0; the worker alone `OPENVERIFY_WORKER_CONCURRENCY`, `OPENVERIFY_WORKER_HEARTBEAT_FILE` (must be under `/tmp/`), `OPENVERIFY_NETWORK_REFRESH` false, Play Integrity's package name and digests; the console `OPENVERIFY_MODE`, `OPENVERIFY_API_URL` = `http://<fullname>-api:3000`, `OPENVERIFY_DASHBOARD_TRUSTED_PROXY_HOPS`, `OPENVERIFY_DASHBOARD_CSP_MODE` enforce, `OPENVERIFY_FLOW_PUBLIC_URL`, `OPENVERIFY_HSTS_MAX_AGE` 0; the flow `OPENVERIFY_MODE`, `OPENVERIFY_FLOW_API_URL` (the API's public URL), `OPENVERIFY_FLOW_SERVER_API_URL` = `http://<fullname>-api-internal:3101`, `OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS`, `OPENVERIFY_DASHBOARD_PUBLIC_URL`, `OPENVERIFY_HSTS_MAX_AGE` 0. Vision and the runner: none yet (their variables come in the models and runner checkpoints). Never rendered: `OPENVERIFY_SANDBOX_CHIP_FACES`, a deviceIntegrity binding unless `providers` binds one, `OPENVERIFY_DASHBOARD_INSECURE_COOKIES`, any frame-ancestors variable, any secret.
- The migrate Job (`<fullname>-migrate`, or `<fullname>-migrate-<first 8 hex of sha256 of the image reference>` with `migrate.gitOps`): hook `pre-install,pre-upgrade`, `helm.sh/hook-weight: "0"`, `hook-delete-policy: before-hook-creation,hook-succeeded`, `backoffLimit` 1, `activeDeadlineSeconds` 900 (must exceed `migrate.lockTimeoutSeconds`, 600), `restartPolicy: Never`; init container `db-migrate` (`node dist/commands/db-migrate.js`), container `db-grant-runtime` (`node dist/commands/db-grant-runtime.js <external.postgres.runtimeRole>`); `migrate.grantRuntime: false` leaves only the container `db-migrate`. Its pods are labelled component `migrate` and need egress to Postgres only (the KEK backfill reads no other store).
- Refusals (`openverify.checks`, included by every component template): deadline at or below the lock's wait; heartbeat outside `/tmp/`; a loopback console URL in production; `OPENVERIFY_DASHBOARD_INSECURE_COOKIES=true` in any `extraEnv`; `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` in `secrets.api.keys`; `OPENVERIFY_SANDBOX_CHIP_FACES` in `config.extra` or any `extraEnv`.
- Tests: `tests/c263-components_test.yaml`, `tests/c263-checks_test.yaml` (49 cases); run `helm unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify` (and `helm3 unittest ...`).

## 2. Checkpoint operations (C263.4, with Workflow 7A's IP-reputation claim, 7B's grace and memory, Phase 8's clamd, OD-11C-5)

What the code says, read before the tests:
- Probes: `/ready` and `/health` are plugin-registered in `apps/api/src/routes/system.ts` (`:20`, `:37`); the worker's probe is `node dist/worker-health.js` (`apps/api/src/worker-health.ts`, 30 s); vision's image health check called `GET /health` on 8000 (`services/vision/Dockerfile:45-46`, `services/vision/src/openverify_vision/app.py:131`); compose probes the flow with `GET /` and the console with `GET /login` (`infra/docker-compose.yml:599-604`, `:646-650`); the runner's health mode is `node bin/code-runner-server.mjs --health` (`packages/workflow-engine/bin/code-runner-server.mjs:49`, compose `:414`).
- The longest job lease: 15 minutes, `REPORT_BULK_CLAIM_LEASE_MS` (`packages/db/src/repositories/report-bulk-jobs.ts:98`), `EXPORT_CLAIM_LEASE_MS` (`packages/db/src/repositories/exports.ts:167`) and `CASE_EXPORT_CLAIM_LEASE_MS` (`packages/db/src/repositories/case-exports.ts:149`); then `REPORT_RUN_CLAIM_MS` 10 minutes (`apps/api/src/jobs/reports/run.ts:76`), the e-mail leases 5 minutes (`apps/api/src/jobs/cases/notification-emails.ts:55`, `apps/api/src/jobs/repeatable/webhook-alerts.ts:81`), `IDEMPOTENCY_LEASE_MS` 120 s, the workflow step lease 60 s by default (`apps/api/src/workflows/engine/executor.ts:92`) or an action's timeout plus 30 s; Workflow 7B's list import (up to 100,000 rows in one transaction, 1.5 to 3 minutes measured under load) and a graph query (at most 59 s) end well inside it. On SIGTERM the worker drains (`apps/api/src/worker-health/drain.ts`: BullMQ's close waits for the running jobs). So the worker's grace is 960 s (900 + 60); a drained worker exits at once, so the grace is only a bound.
- The pools: the API (`apps/api/src/container.ts:280`) and the worker (`apps/api/src/worker.ts:1835`) each open one node-postgres pool with no `max`, so pg-pool's default of 10 (`pg-pool` 3.14.0 `index.js:89`); `db:migrate` opens a pool and its lock client (`apps/api/src/migrate.ts:152-153`), 11. The pool check counts each Deployment at its maximum (`replicaCount`, or the HPA's `maxReplicas` for the API) plus the rolling update's default surge (25%, rounded up), so during an upgrade: `10 x (api + ceil(api/4)) + 10 x (worker + ceil(worker/4)) + 11 <= external.postgres.maxConnections` (defaults: 30 + 20 + 11 = 61 of 100).
- The worker's clamd (`OPENVERIFY_CLAMD_SOCKET`, required while the attachment scanner is bound to clamd, `apps/api/src/config.ts:1367`): ClamAV is GPL-2.0, so the chart ships none; `worker.extraContainers` and `worker.extraVolumes` add the operator's, each extra container under the restricted container context, with a shared `clamd-socket` emptyDir at `/run/clamd` and `OPENVERIFY_CLAMD_SOCKET=/run/clamd/clamd.sock`; nothing of it renders without them.
- The ingress paths with their own body limits: the list importer `POST /api/v1/importer/list-item/<plural>` (Prefix `/api/v1/importer`, which does not match `/api/v1/importers`) and a transaction file `PUT /api/v1/transactions/{id}/files/{fieldKey}` (Prefix `/api/v1/transactions`, since a Prefix cannot match inside a path: every transaction route gets that outer bound; the API's own per-route body limits still apply), from `docs/api/openapi.json`.

### RED

`deploy/helm/openverify/tests/c263-operations_test.yaml`: six suites, 44 cases (probes and pods; HPAs and disruption budgets; the ingress; the Gateway API route; the pool check; the IP-reputation refusals).

```
$ cat /proc/loadavg
3.50 3.73 2.28 3/921 1930138
$ helm unittest -f 'tests/c263-operations_test.yaml' deploy/helm/openverify          (rc 1)
 FAIL  c263 operations (probes and pods): no readinessProbe/livenessProbe/startupProbe; grace 120; no ip-reputation volume or MMDB path; no clamd container or socket; replicas kept under an HPA
 FAIL  c263 operations (autoscaling and disruption budgets): template "openverify/templates/hpa.yaml" not exists or not selected in test suite (and pdb.yaml)
 FAIL  c263 operations (ingress): template ingress.yaml not exists
 FAIL  c263 operations (gateway route): template httproute.yaml not exists
 FAIL  c263 operations (pool check): failedTemplate: Invalid rendering: %!s(<nil>)   (no check yet)
 FAIL  c263 operations (IP-reputation checks): failedTemplate: Invalid rendering: %!s(<nil>)
Test Suites: 6 failed, 0 passed, 6 total
Tests:       34 failed, 10 passed, 44 total
$ helm3 unittest -f 'tests/c263-operations_test.yaml' deploy/helm/openverify         (rc 1)
Tests:       34 failed, 10 passed, 44 total
```

The ten that pass already hold today's defaults (the memory limits, no IP-reputation claim, no clamd, the priority class and spread constraints, the worker's replica count, the default pools passing).

### GREEN

- `templates/_helpers.tpl`: `openverify.poolCheck` (with `openverify.pooledPods`) joins `openverify.checks`, with the two IP-reputation refusals; `openverify.httpProbes`, `openverify.execProbes`, `openverify.restrictedContainers`, `openverify.ipReputationVolume`, `openverify.ipReputationMount`.
- `templates/_config.tpl`: `OPENVERIFY_IP_REPUTATION_MMDB_PATH` on the API and the worker from `ipReputation.path`; `OPENVERIFY_CLAMD_SOCKET=/run/clamd/clamd.sock` on the worker only while `worker.extraContainers` is given.
- The Deployments: the probes; the API, the console and the flow server leave their replica count to an HPA when theirs is enabled; the worker gets the claim, the clamd containers (under `_security.tpl`'s container context, merged over the container's own), `worker.extraVolumes` and the `clamd-socket` emptyDir; `_deployment.tpl` trims the probes block.
- New: `templates/hpa.yaml` (autoscaling/v2, CPU utilisation, API, console and flow only), `templates/pdb.yaml` (policy/v1, each enabled component), `templates/ingress.yaml` (per host; three Ingresses on the API host for the body-limit classes `default`, `import` and `transactionFile`), `templates/httproute.yaml` (gateway.networking.k8s.io/v1, an example per host, HSTS by `ResponseHeaderModifier`, the public ports only).
- `values.yaml`: the worker's grace 960 s with the leases it is read from; the API's HPA maximum 4 instead of 6, because 6 (8 pods with the surge) fails the pool check against the default 100 connections, so the RED case "targets the API's Deployment with its bounds" now expects 4 (the one changed expectation, recorded here); comments for the API's and the worker's memory limits (the Node process, the network sources and their swap, the importer and transaction bodies, the template cache, and what dbip-city-lite adds), for the IP-reputation path, for clamd's socket, and that no HPA owns the worker, vision or the runner.

```
$ cat /proc/loadavg
4.55 4.08 2.69 3/795 1950544
$ helm unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify     (rc 0)  Test Suites: 9 passed; Tests: 93 passed, 93 total
$ helm3 unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify    (rc 0)  Tests: 93 passed, 93 total
$ helm lint / helm3 lint deploy/helm/openverify (default values, and a full set: hosts, TLS, three HPAs, the claim, clamd, a worker PDB)   (rc 0 each)
$ helm template ... | kubeconform -strict -summary (1.35.9, 1.36.5, 1.37.1)
default values:  Summary: 22 resources found in 1 file - Valid: 22, Invalid: 0, Errors: 0, Skipped: 0   (each version, rc 0)
full values:     Summary: 31 resources found in 1 file - Valid: 31, Invalid: 0, Errors: 0, Skipped: 0   (each version, rc 0)
$ pnpm exec prettier --check deploy/helm/openverify      (rc 0)
$ HELM4=... HELM3=... bash infra/tests/chart-skeleton.test.sh     (rc 0) 51 passed, 0 failed, 0 skipped
```

The HTTPRoute is not in kubeconform's bundle (a CRD the Kubernetes documents do not hold), so the full set leaves `gateway.httpRoute` off; helm-unittest holds its shape.

### Gate (rule 25: this area's own checks)

As above; no package, Android, e2e or infra path changed.

CHECKPOINT operations DONE at 265623f42faa63f909a658bc377173234c6b2c3c

Handoff (chart-policy-11c, integration-11c):
- Probes: API readiness `GET /ready`, liveness and startup `GET /health` (port name `http`; startup every 5 s, 60 failures); worker liveness and startup `exec [node, dist/worker-health.js]` (every 15 s and 10 s, 30 startup failures), no readiness (no Service); flow `GET /` readiness and liveness; console `GET /login` readiness, liveness and startup (24); vision `GET /health` readiness, liveness and startup (36); runner readiness and liveness `exec [node, bin/code-runner-server.mjs, --health]`. images-11c's `--health` must check the `tcp:` listener when `OPENVERIFY_CODE_RUNNER_LISTEN` is set (today it connects to the socket only).
- Grace: worker 960 s (the 15-minute leases plus 60 s); the others 30 s.
- Pool check (`openverify.poolCheck`, in `openverify.checks`): `10 x (A + ceil(A/4)) + 10 x (W + ceil(W/4)) + 11 <= external.postgres.maxConnections`, A = `api.replicaCount` or `api.autoscaling.maxReplicas` when the API's HPA is on, W = `worker.replicaCount`; message "the database pools could open <N> connections (api <a> pods x 10, worker <w> pods x 10, migrate 11), above external.postgres.maxConnections (<M>)". Defaults 61 of 100.
- HPAs (`templates/hpa.yaml`): `<fullname>-api`, `-dashboard`, `-flow`, autoscaling/v2 on CPU; none for the worker, vision or the runner. PDBs (`templates/pdb.yaml`): `<fullname>-<component>` per enabled `podDisruptionBudget` (API, console and flow by default).
- Ingress (`templates/ingress.yaml`): only for the hosts set in `ingress.hosts`; `<fullname>-api` (paths: `openverify.internalPathDeny (dict "root" $)` items first, then `/` Prefix to `<fullname>-api` port name `http`), `<fullname>-api-import` (`/api/v1/importer` Prefix), `<fullname>-api-transaction-files` (`/api/v1/transactions` Prefix), `<fullname>-flow`, `<fullname>-dashboard` (each `/`). Annotations: `openverify.ingressAnnotations (dict "root" $ "host" <api|flow|dashboard> "path" <default|import|transactionFile>)`, which must render a YAML map at column 0 (or nothing); `internalPathDeny` must render HTTPIngressPath list items at column 0 (or nothing). `ingressClassName` from `ingress.className`; `tls` the entries of `ingress.tls` naming the host. No backend names the internal port.
- HTTPRoute (`templates/httproute.yaml`, `gateway.httpRoute.enabled`): per host, `parentRefs: [{name: <fullname>}]` (no values key for it: a contractDeviation for integration-11c), one PathPrefix `/` rule to the component's public port with `Strict-Transport-Security` set from `ingress.hsts`.
- IP reputation: `ipReputation.existingClaim` and `ipReputation.path` (under `/var/lib/openverify/ip-reputation/`) together or not at all; volume `ip-reputation` (PVC, readOnly) mounted read-only at `/var/lib/openverify/ip-reputation` in the API and worker pods; `OPENVERIFY_IP_REPUTATION_MMDB_PATH` in their ConfigMaps.
- clamd (OD-11C-5): with `worker.extraContainers`, the worker's pod gains them (restricted container context merged over theirs), `worker.extraVolumes` and `clamd-socket` (emptyDir at `/run/clamd` in the worker); `OPENVERIFY_CLAMD_SOCKET=/run/clamd/clamd.sock` in the worker's ConfigMap. The clamd container shares the worker pod's network policy (its freshclam needs the public-internet rule the worker already has).
- Tests: `tests/c263-operations_test.yaml` (44 cases, 6 suites); with the components checkpoint's files, 93.

## 3. Checkpoint models (C263.5; decision 5, reviews P05 and F05, verification V03)

What it rests on: the vision image (images-11c, `f17c80341`) carries `/app/models/manifest.json` and `/app/scripts/fetch_models.py` (WORKDIR `/app`, `OPENVERIFY_VISION_MODELS_MANIFEST=/app/models/manifest.json`, uid 10001) and refuses to start when a model in `OPENVERIFY_VISION_MODELS_DIR` differs from the manifest (`services/vision/src/openverify_vision/startup.py`); `scripts/fetch_models.py` takes `--manifest` and `--dest`, skips a file already present with its digest, and neither checks a whole directory nor removes one. A chart renders only from its own files, so the chart carries a byte copy of `models/manifest.json` as `files/models-manifest.json` (SHA-256 `09989269558f7aa87f481b37f537422e3967b7475f4adf0c23fda30354c1bcca`) and renders the digest from it; the Job's program (`files/models-fetch.py`, standard library) refuses a manifest in the image whose SHA-256 is not the chart's, so a chart and an image of different releases fail loudly instead of filling a misnamed directory. The completeness marker, the "exit at once" and the pruning are the program's, run as `python3 -I -c <program> <digest> /app/models/manifest.json /app/scripts/fetch_models.py` (no shell).

Stub first (`chore(chart)`, the names only, ruff check, ruff format and mypy --strict clean), then the RED:

### RED

`deploy/helm/openverify/files/test_models_fetch.py` (15 unittest cases, standard library, no network: an injected fetch writes a file; temporary directories) and `deploy/helm/openverify/tests/c263-models_test.yaml` (three suites, 20 cases: job mode, pvc mode, the refusals).

```
$ uv run --project security/python --frozen ruff check deploy/helm/openverify/files/   -> All checks passed!
$ uv run --project security/python --frozen mypy --strict deploy/helm/openverify/files/test_models_fetch.py   -> Success: no issues found in 1 source file
$ python3 -I -m unittest discover -s deploy/helm/openverify/files -p 'test_*.py'      (rc 1)
ERROR (x14): NotImplementedError: models-fetch is not built yet (chart-11c)
FAIL: test_runs_as_python3_isolated_with_the_program_as_c   AssertionError: 0 != 2   (the stub defines main but never calls it)
Ran 15 tests in 0.072s
FAILED (failures=1, errors=14)
$ cat /proc/loadavg
4.80 4.91 3.37 3/847 1976519
$ helm unittest -f 'tests/c263-models_test.yaml' deploy/helm/openverify       (rc 1)
template "openverify/templates/models-pvc.yaml" / "models-fetch-job.yaml" not exists; no models volume in vision; no OPENVERIFY_VISION_MODELS_DIR; no refusal
Test Suites: 3 failed, 0 passed, 3 total
Tests:       19 failed, 1 passed, 20 total
$ helm3 unittest -f 'tests/c263-models_test.yaml' deploy/helm/openverify      (rc 1)
Tests:       19 failed, 1 passed, 20 total
```

The one that passes already: vision runs no init container and no command of its own.

### GREEN

- `files/models-fetch.py` built: checks its three arguments and the digest's form (exit 2), refuses a manifest whose SHA-256 is not the chart's (exit 2, nothing written), exits 0 at once when `/models/<digest>/.openverify-complete` exists, otherwise runs `<python> -I <fetch_models.py> --manifest <manifest> --dest /models/<digest>` and answers its status on failure, writes the marker, then removes every 64-hex directory but the current one and the newest other complete one (by its marker's time); other entries (`lost+found`, an operator's file) stay.
- `files/models-manifest.json`: a byte copy of `models/manifest.json` (`cmp` equal; SHA-256 `09989269...1bcca`).
- `templates/_helpers.tpl`: `openverify.modelsDigest` (from the copy; fails when missing), `openverify.modelsClaim` (`models.existingClaim` or `<fullname>-models`), and two refusals in `openverify.checks`: pvc mode without `existingClaim`, and `ReadOnlyMany` in job mode (the Job writes the claim).
- `templates/models-pvc.yaml` (job mode without `existingClaim`: `pre-install`, weight `-10`, `helm.sh/resource-policy: keep`, no delete policy), `templates/models-fetch-job.yaml` (job mode: `pre-install,pre-upgrade`, weight `-5`, `before-hook-creation,hook-succeeded`, component `models-fetch`, the vision image from `modelsFetch.image`, no Secret, no env, `/tmp` and the claim at `/models`, the required pod affinity to the vision pods' node on upgrade with a `ReadWriteOnce` claim, `backoffLimit` 1, `activeDeadlineSeconds` 1800), vision's read-only claim at `/models` and `OPENVERIFY_VISION_MODELS_DIR=/models/<digest>` in its ConfigMap, NOTES.txt's models and clamd lines.
- A borrowed edit (committed alone, before this): contracts-11c's `infra/tests/chart-skeleton.test.sh` positive control "the schema accepts vision.replicaCount=2" now uses `ReadWriteMany`, since the default job mode refuses `ReadOnlyMany`; the schema rule it checks is unchanged.
- A test change in this area's own file (committed alone): the four operations cases that set an ingress host now also give it a TLS entry, because chart-policy-11c's ingress helpers refuse a host without one (C264.5).

```
$ python3 -I -m unittest discover -s deploy/helm/openverify/files -p 'test_*.py'    (rc 0)  Ran 15 tests ... OK
$ uv run --project security/python --frozen python -m coverage run --include=deploy/helm/openverify/files/models-fetch.py -m unittest discover -s deploy/helm/openverify/files -p 'test_*.py'; ... coverage report --fail-under=80
deploy/helm/openverify/files/models-fetch.py      57      2    96%   36, 126      (rc 0; 36 is the real subprocess, 126 the __main__ line, run by the -c case in a subprocess)
$ uv run --project security/python --frozen ruff check / ruff format --check deploy/helm/openverify/files/   -> All checks passed! / 2 files already formatted
$ uv run --project security/python --frozen mypy --strict deploy/helm/openverify/files/models-fetch.py deploy/helm/openverify/files/test_models_fetch.py   -> Success
$ cat /proc/loadavg
6.31 5.61 3.92 3/802 2000119
$ helm unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify     (rc 0)  Tests: 113 passed, 113 total
$ helm3 unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify    (rc 0)  Tests: 113 passed, 113 total
$ helm lint / helm3 lint deploy/helm/openverify      (rc 0 each)
$ kubeconform -strict over helm template (default values; the full set; pvc mode with a claim) on 1.35.9, 1.36.5 and 1.37.1   (rc 0, every resource valid; 33 / 42 / 30 resources with chart-policy-11c's policies in the tree)
$ the rendered Job's command[3] equals files/models-fetch.py byte for byte (PyYAML check)
$ HELM4=... HELM3=... bash infra/tests/chart-skeleton.test.sh    (rc 0) 51 passed, 0 failed, 0 skipped
$ pnpm exec prettier --check deploy/helm/openverify     (rc 0)
```

### Gate (rule 25: this area's own checks)

As above; no package, Android, e2e or infra path changed beyond the one-line borrowed edit of `infra/tests/chart-skeleton.test.sh` (51 passed).

CHECKPOINT models DONE at 7b1cf636e74beb393537765d4a59745153d248c8

Handoff (chart-policy-11c's egress policy and kind.sh `models`, images-11c, integration-11c):
- Pods and labels: the Job's pod is component `models-fetch` (`openverify.selectorLabels (dict "root" $ "component" "models-fetch")`); it reaches the model hosts only (the egress rule `0.0.0.0/0` minus `publicInternetExcept`, or `networkPolicy.egress.modelHosts`), DNS, and nothing else: no data store, no Secret. Vision has no egress in either mode.
- Hooks: claim `<fullname>-models` (job mode without `models.existingClaim`): `helm.sh/hook: pre-install`, `helm.sh/hook-weight: "-10"`, `helm.sh/resource-policy: keep`, no delete policy. Job `<fullname>-models-fetch` (job mode): `pre-install,pre-upgrade`, weight `"-5"`, `before-hook-creation,hook-succeeded` (the migrate Job is weight `"0"`).
- Paths: the claim at `/models` (writable in the Job, read-only in vision); vision reads `OPENVERIFY_VISION_MODELS_DIR=/models/<SHA-256 of models/manifest.json>` (today `/models/09989269558f7aa87f481b37f537422e3967b7475f4adf0c23fda30354c1bcca`) in both modes. In pvc mode (kind.sh `models`): put the weights in `<claim root>/<digest>/` (e.g. `python3 -I scripts/fetch_models.py --dest <pv path>/<digest>`, or a copy of `models/` without `manifest.json`), owned or readable by gid 10001; `models.existingClaim` is required.
- The Job's command: `[python3, -I, -c, <files/models-fetch.py>, <digest>, /app/models/manifest.json, /app/scripts/fetch_models.py]` in `modelsFetch.image` (openverify/vision); it needs the vision image's `/app/models/manifest.json` byte-equal to `models/manifest.json` (it exits 2 otherwise) and writes `/models/<digest>/.openverify-complete`.
- Upgrade affinity: on `.Release.IsUpgrade` with `models.accessMode: ReadWriteOnce`, a required pod affinity to the vision pods (selector labels, `topologyKey: kubernetes.io/hostname`).
- Refusals: pvc mode without `models.existingClaim`; `ReadOnlyMany` in job mode.
- `files/models-manifest.json` must stay a byte copy of `models/manifest.json`: whoever changes the manifest copies it (a check for chart-checks.sh or release:check: `cmp models/manifest.json deploy/helm/openverify/files/models-manifest.json`).
- Tests: `tests/c263-models_test.yaml` (20 cases); `files/test_models_fetch.py` (15, `python3 -I -m unittest discover -s deploy/helm/openverify/files -p 'test_*.py'`).

## 4. Checkpoint runner (C263.6; decision 51, hardening H8)

What it rests on: contracts-11c's `tcp:` form (`OPENVERIFY_WORKFLOW_CODE_RUNNER=tcp:<host>:<port>`, `parseCodeRunnerTcpTarget`, `packages/workflow-engine/src/code-runner/transport.ts`), the token `OPENVERIFY_CODE_RUNNER_TOKEN` (32 bytes, required in the worker while the form is `tcp:`, optional and unused in the API: `apps/api/src/config.ts` `withCodeRunnerToken`; "the API never builds a runner", `apps/api/src/workflows/actions/https/egress-config.ts`), the runner's `OPENVERIFY_CODE_RUNNER_LISTEN` and `OPENVERIFY_CODE_RUNNER_POOL_SIZE` (registry: `code-runner`), and images-11c's listener. The components checkpoint already rendered the runner's Deployment and Service (`templates/code-runner/`), so six cases pass from the start.

### RED

`deploy/helm/openverify/tests/c263-runner_test.yaml` (two suites, 13 cases).

```
$ cat /proc/loadavg
4.69 5.31 3.95 5/971 2012755
$ helm unittest -f 'tests/c263-runner_test.yaml' deploy/helm/openverify      (rc 1)
FAIL points the worker at the runner's Service over the tcp transport (no OPENVERIFY_WORKFLOW_CODE_RUNNER)
FAIL gives the API the same setting ...; makes the runner listen on its port ... (data is {}); passes the pool size ...; follows a changed port on both ends
FAIL refuses a runner whose token is not in the worker's Secret / in its own Secret: Invalid rendering: %!s(<nil>)
Tests:       7 failed, 6 passed, 13 total
$ helm3 unittest -f 'tests/c263-runner_test.yaml' deploy/helm/openverify     (rc 1)
Tests:       7 failed, 6 passed, 13 total
```

(Two case titles first ended in `tcp:`, which YAML reads as a nested mapping; Prettier's check caught it and they were reworded before this run.)

### GREEN

- `templates/_config.tpl`: `OPENVERIFY_WORKFLOW_CODE_RUNNER=tcp:<fullname>-code-runner:<codeRunner.port>` on the API and the worker while `codeRunner.enabled` (nothing otherwise, so the worker keeps its in-process pool and its production warning); the runner's ConfigMap `OPENVERIFY_CODE_RUNNER_LISTEN=0.0.0.0:<port>` and `OPENVERIFY_CODE_RUNNER_POOL_SIZE` when `codeRunner.poolSize` is above 0. The token is never in a ConfigMap: it is a file from `secrets.worker` and `secrets.codeRunner` (chart-policy-11c's `openverify.secretFileEnv`).
- `templates/_helpers.tpl`: the refusal while the runner is on and `OPENVERIFY_CODE_RUNNER_TOKEN` is missing from either Secret's `keys`.

```
$ cat /proc/loadavg
7.06 6.00 4.28 15/860 2018800
$ helm unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify     (rc 0)  Tests: 126 passed, 126 total
$ helm3 unittest -f 'tests/c263-*_test.yaml' deploy/helm/openverify    (rc 0)  Tests: 126 passed, 126 total
$ helm unittest deploy/helm/openverify   (every suite, chart-policy-11c's c264 ones too; information)   (rc 0)  Tests: 196 passed, 196 total
$ helm lint and helm3 lint deploy/helm/openverify: default values, the full set, pvc mode     (rc 0 each, six calls)
$ kubeconform -strict -summary over helm template, 1.35.9 / 1.36.5 / 1.37.1:
default 33 valid; full set 42 valid; pvc mode 30 valid; runner off 29 valid   (rc 0 each; 0 invalid, 0 errors, 0 skipped)
$ pnpm exec prettier --check deploy/helm/openverify     (rc 0)
$ HELM4=... HELM3=... bash infra/tests/chart-skeleton.test.sh    (rc 0) 51 passed, 0 failed, 0 skipped
$ python3 -I -m unittest discover -s deploy/helm/openverify/files -p 'test_*.py'   (rc 0) Ran 15 tests, OK
$ pnpm format:check     (rc 0, 146 s, load 7.20 6.20 4.42 at its start) All matched files use Prettier code style!
```

### Gate: the last checkpoint's full gate (this area's "at the end" list, on the final tree)

All exit 0, recorded in the GREEN block above: `helm lint` on Helm 4.3.1 and 3.22.1 over the default values (and two more sets; chart-policy-11c's `ci/` values files did not exist yet when this ran: `ci/` held only `chart-checks.sh` and `tests/`); `helm unittest -f 'tests/c263-*_test.yaml'` on both Helms (126 passed); `helm template | kubeconform -strict` against the 1.35.9, 1.36.5 and 1.37.1 bundles of `scripts/fetch_k8s_schemas.py` (every resource valid in four value sets); `pnpm format:check`. Also the program's 15 tests (96%), `ruff`, `mypy --strict`, and contracts-11c's `chart-skeleton.test.sh` (51 passed). No package, Android, e2e or compose path changed, so no other suite applies (rule 25).

CHECKPOINT runner DONE at 07faf7aca1a701beb6f5945f06fb723a9f0bc024

Handoff for the runner (chart-policy-11c's no-egress and worker-only-ingress policies, images-11c, integration-11c):
- Deployment and Service `<fullname>-code-runner` (component `code-runner`), port name `runner`, `codeRunner.port` 7700, only while `codeRunner.enabled` (default true). Its pods need ingress from the worker's pods (component `worker`) on that port only, and no egress beyond DNS (none needed: it resolves nothing).
- The worker (and the API, which parses it and never connects) reads `OPENVERIFY_WORKFLOW_CODE_RUNNER=tcp:<fullname>-code-runner:<port>`; the runner reads `OPENVERIFY_CODE_RUNNER_LISTEN=0.0.0.0:<port>` and, with `codeRunner.poolSize` above 0, `OPENVERIFY_CODE_RUNNER_POOL_SIZE`. `OPENVERIFY_CODE_RUNNER_TOKEN` is a file from `secrets.worker` and `secrets.codeRunner` (both default `keys` hold it; the chart refuses otherwise).
- Probes `exec [node, bin/code-runner-server.mjs, --health]`: images-11c's health mode has to check the `tcp:` listener when `OPENVERIFY_CODE_RUNNER_LISTEN` is set (today it connects to the socket).

After the checkpoint (information, at `80ab6b194`): chart-policy-11c's `ci/` values files appeared in the tree (uncommitted, theirs): `helm lint` and `helm3 lint` with each of `ci/kind-values.yaml`, `ci/lint/full-values.yaml` and `ci/upgrade/kind-upgrade-values.yaml` exit 0 (six calls), and the c263 suites still pass at that commit on both Helms (126).
