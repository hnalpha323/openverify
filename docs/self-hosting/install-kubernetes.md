# Install on Kubernetes

The Helm chart `deploy/helm/openverify` (C263, C264; chart version and app version `0.1.0`, `kubeVersion: '>=1.35.0-0'`). Its defaults are a restricted, secure starting point, not a guarantee: what they achieve depends on your cluster, its network plugin, your secret store and your data stores (the chart's own `templates/NOTES.txt` says the same after every install). Every key is commented in `deploy/helm/openverify/values.yaml`, and `values.schema.json` refuses an unknown key.

## Prerequisites

- **Kubernetes 1.35 or later.** The chart's install and `helm upgrade` were run on kind's 1.35 and 1.37 node images at the Workflow 11C close (`deploy/helm/openverify/ci/kind.sh`, `docs/tdd/phase11-integration-11c.tdd.md` section 3); a kind run proves the chart renders, installs, starts and upgrades on kind's own network plugin and storage, not its behaviour on a real cloud (C265.5).
- **Helm 4.3 or 3.22.** The chart's lint and unit tests run under both (`deploy/helm/openverify/ci/chart-checks.sh`; Helm 4.3.1 and 3.22.1 pinned in `infra/scripts/install-helm.sh`).
- **The namespace under the restricted Pod Security Standard.** Label it `pod-security.kubernetes.io/enforce=restricted` (with `warn` and `audit` too, as `deploy/helm/openverify/ci/fixtures/namespaces.yaml` does): every pod the chart renders is restricted, so admission refuses anything that is not.
- **A network plugin that enforces NetworkPolicy** (below).
- **Your data stores**, reachable with TLS ([requirements.md](requirements.md)), and one Secret per process.
- **The images**, built from this repository and pushed to your registry: no registry holds them ([verify-artifacts.md](verify-artifacts.md)). Pin each by digest in `<component>.image.digest`.

## Secrets

The chart creates no Secret. Each process reads its own Secret, named in `secrets.<process>.existingSecret`, whose keys are the variables' names; the chart mounts it at `/run/secrets/openverify/` with mode `0440` and the pod's `fsGroup`, and sets `<NAME>_FILE` for every name in `secrets.<process>.keys` (C264.3). The defaults list each process's required secrets; add the optional ones it holds (`OPENVERIFY_KEK_PREVIOUS`, `OPENVERIFY_API_KEY_PEPPER_PREVIOUS`, `OPENVERIFY_FLOW_SERVER_TOKEN_PREVIOUS`, provider credentials, `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` in the worker's). The database URLs come from `external.postgres.existingSecret` (`DATABASE_URL`, the runtime role) and `external.postgres.migrationSecret` (`OPENVERIFY_MIGRATION_DATABASE_URL`, read only by the migrate Job). A CA per store mounts at `/etc/openverify/ca/<store>.pem` and sets the store's `_CA_FILE` variable.

## Install

```bash
helm install openverify deploy/helm/openverify -n openverify -f my-values.yaml
```

The pre-install and pre-upgrade hook Job runs `db:migrate` as the migration role, then `db:grant-runtime <external.postgres.runtimeRole>` (C249.3, C263.3); `migrate.gitOps` renders it as a plain versioned Job for tools that run no hooks, and `migrate.grantRuntime: false` leaves the grant to you after every `db:migrate`. The migrate lock serialises two runs (`OPENVERIFY_MIGRATE_LOCK_TIMEOUT_SECONDS`, 600 s, under the Job's 900 s deadline). Then create the first organisation ([first-run.md](first-run.md)).

`publicUrls` (or `ingress.hosts`) must name the API, the flow and the console: the API refuses to start without `OPENVERIFY_FLOW_PUBLIC_URL`, and the console's links need `OPENVERIFY_DASHBOARD_PUBLIC_URL`.

## The ingress

- **Three hosts** (`ingress.hosts.api`, `flow`, `dashboard`), TLS required: plain HTTP is redirected to HTTPS on each host, the API host included. ASVS v5.0.0-4.1.2 asks that only browser-facing hosts redirect, and that an API refuse plain HTTP instead. The NGINX controllers have no annotation that refuses plain HTTP on one host, short of a snippet annotation, which both disable by default, and serving the API over plain HTTP would be worse than the redirect. The chart therefore keeps the redirect (KP11-81, open). To refuse plain HTTP on the API host, either use the Gateway route below on an HTTPS listener only, or have your load balancer accept only HTTPS for that host.
- **The API host is three Ingresses**: `/`, `/api/v1/importer` and `/api/v1/transactions`, because Workflow 7B's two larger routes need larger body limits and a Prefix cannot match inside a transaction file's path. Limits: `ingress.maxBodySize` 15m, `maxBodySizeImport` 28m (a 20 MB list import as base64, 26,670,764 bytes) and `maxBodySizeTransactionFile` 28m (a transaction file of up to 20,000,000 bytes). The API keeps its own per-route limits behind these (`docs/lists/importers.md`, `docs/transactions/README.md`).
- **The internal path** `/api/v1/internal` is sent to a Service the chart never creates, so no request reaches it; the internal listener's port (3101) is never routed (C250.3).
- **HSTS** comes from the ingress (`ingress.hsts`: one year with subdomains, no preload; `install.hstsMaxAge` stays 0). The chart writes it for the NGINX controllers (`nginx.org/hsts` and its two siblings; the community ingress-nginx controller sends HSTS from its own ConfigMap, whose default is the same). For **any other controller** the chart records the header's value in the annotation `openverify.dev/strict-transport-security`, which no controller reads: set that value in your controller's own HSTS setting. The body-limit annotations are NGINX's too (`nginx.ingress.kubernetes.io/proxy-body-size`, `nginx.org/client-max-body-size`); another controller needs its own.
- **`api.trustProxy`**: set it to the addresses of the proxies in front of the API (your controller's pods or load balancer), never `"true"`, which nulls every production network fact (`client_address_untrusted`); unset, the API sees the controller as every client ([requirements.md](requirements.md#the-client-address)).

### A Gateway API route instead

`gateway.httpRoute.enabled` renders one example `HTTPRoute` per host (`deploy/helm/openverify/templates/httproute.yaml`, C286: an example only), each attached to the parents `gateway.httpRoute.parentRefs` lists (each with a `name` and optionally a `namespace`, a `sectionName` and a `port`), or, when that list is empty (the default), to a Gateway named like the release's full name in the release's namespace, sending the host to its component's public port with the HSTS header set. Naming only your Gateway's HTTPS listener as the `sectionName` keeps every host off plain HTTP, so an API client that sends a plain-HTTP request is refused rather than redirected (ASVS v5.0.0-4.1.2; Workflow 11F, KP11-84). The Gateway API has no standard body limit, so your gateway's own settings must bound request bodies.

## Network policies

`networkPolicy.enabled` (on) renders default-deny policies both ways, then allow lists: DNS to the cluster resolver; the data stores by `egress.dataStores` CIDRs or, with `dataStoresInCluster`, by selector; SMTP by `egress.smtp`; private identity providers by `egress.identityProviders`; the public internet for the API and the worker, minus private, loopback, link-local, CGNAT and the IPv6 equivalents (`networkPolicy.publicInternetExcept`); no egress at all for vision and the code runner, not even DNS (`deploy/helm/openverify/templates/networkpolicies.yaml`). **A policy does nothing without a network plugin that enforces NetworkPolicy**: without one every pod reaches every pod and the internet. kind's default plugin enforces them (the kind runs above).

## Model weights

Weights are never in an image. `models.source: job` (the default) runs a models-fetch hook Job in the vision image (`files/models-fetch.py`, pinned SHA-256s) into a claim vision mounts read-only at `/models/<SHA-256 of the chart's models manifest copy>`; `pvc` mounts `models.existingClaim`, which you fill once with `python3 -I scripts/fetch_models.py --dest <mount>/<digest>`. The claim is kept after an uninstall; delete it by hand. More than one vision replica needs a ReadOnlyMany or ReadWriteMany claim.

## Optional containers and mounts

- **clamd**: none ships. Give your own clamd in `worker.extraContainers` (and its database and temporary paths in `worker.extraVolumes`); the chart then adds a shared `clamd-socket` emptyDir at `/run/clamd` and sets `OPENVERIFY_CLAMD_SOCKET=/run/clamd/clamd.sock`. Each extra container runs under the restricted container context.
- **IP reputation**: `ipReputation.existingClaim` (your licensed file's claim, mounted read-only at `/var/lib/openverify/ip-reputation`) and `ipReputation.path`, the file's absolute path there; set both or neither.
- **The code runner** runs as its own Deployment with no egress, reached at `OPENVERIFY_WORKFLOW_CODE_RUNNER=tcp:<fullname>-code-runner:7700` with `OPENVERIFY_CODE_RUNNER_TOKEN`.
- **Play Integrity**: `worker.playIntegrity.packageName` and `certificateDigests`; the service account key goes in the worker's Secret only.

## Scaling

The API scales by an optional CPU HPA (`api.autoscaling`, at most 4 replicas by default); the worker, vision and the code runner by replicas. Each API or worker pod opens up to 10 database connections, and the chart fails to render when every replica's pool could exceed `external.postgres.maxConnections` (C263.4). Scaling the worker on queue depth (for example with KEDA reading the BullMQ queues in Valkey) is an example only: the chart renders no such object. See [sizing.md](sizing.md) for what one process carried.

## Development tools

`face-scan:benchmark` is a development tool that the image does not contain (Workflow 11F, KP11-71); from a source checkout it writes a scratch organisation and refuses nothing about production. `seed:load` refuses production mode and any database not named `openverify_load`. Never point either at a production database.
