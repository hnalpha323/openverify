# Requirements

What an install needs before it starts (C277.1, hardening research 7.4's table, `docs/research/phase11-hardening.md`), and what only the operator can provide (C277.3). The chart runs none of the data stores (`deploy/helm/openverify/values.yaml`, `external`); the compose file runs development copies of them on one host.

## The data stores and services

| Dependency | What the code needs | Notes |
|---|---|---|
| PostgreSQL 17 with pgvector | The `vector` extension creatable by the migration role (each migration that needs it runs `CREATE EXTENSION IF NOT EXISTS vector` itself); two roles, the migration role and the runtime role ([database.md](database.md)); `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0`, which compose sets on its server so a screened name never reaches the server's log (C73.8, `infra/docker-compose.yml`) | Compose and the test suites pin `pgvector/pgvector:pg17` by digest. Avoid Bitnami's charts and images (hardening research 7.4) |
| A Redis-protocol store | Valkey 9.x, as compose pins it (`valkey/valkey:9.1`); append-only persistence; `maxmemory-policy noeviction`; a password or ACL users ([valkey.md](valkey.md)) | The code speaks only the Redis protocol |
| S3-compatible storage | A bucket with versioning; credentials that may get, put, list object versions and delete object versions, because a redaction deletes every version of an object (`apps/api/src/storage/index.ts`); public access blocked | RustFS in compose (`rustfs/rustfs:1.0.3`). Object lock or replication must be reconciled with redaction: a locked or replicated copy outlives it |
| SMTP | `OPENVERIFY_SMTP_URL` (`smtp://` with STARTTLS or `smtps://`) and `OPENVERIFY_MAIL_FROM` | Unset, no mail is sent: invitations, email codes and case emails fail or are dropped (`docs/cases/README.md`) |
| SMS (optional) | Twilio's credentials, bound per environment kind with `OPENVERIFY_PROVIDER_SMS_SANDBOX` and `OPENVERIFY_PROVIDER_SMS_PRODUCTION` | Phone codes and workflow messages; a sandbox needs none |
| Slack (optional) | A Slack binding per environment kind (`OPENVERIFY_PROVIDER_SLACK_SANDBOX`, `OPENVERIFY_PROVIDER_SLACK_PRODUCTION`) | Workflow messages only (`docs/workflows/messaging.md`) |
| Model weights | Fetched with `python3 -I scripts/fetch_models.py` (pinned SHA-256s in `models/manifest.json`) into a volume vision mounts read-only; never baked into an image (Q6's default) | Vision refuses to start when a model's SHA-256 differs from its pin (`OPENVERIFY_VISION_MODELS_MANIFEST`) |
| TLS and an ingress | Certificates for the API, the flow and the console hosts; HSTS; request body limits that fit the upload routes ([install-kubernetes.md](install-kubernetes.md#the-ingress)) | |
| A network plugin that enforces NetworkPolicy | Only on Kubernetes: without one, the chart's policies do nothing ([install-kubernetes.md](install-kubernetes.md#network-policies)) | |
| Secrets | One secret store entry per process ([secrets-and-rotation.md](secrets-and-rotation.md)) | The KEK and the blind-index key kept apart from the database's backups |
| Observability | A log store separate from the hosts, alerting on log events ([monitoring.md](monitoring.md)) | Metrics are log events; there is no metrics port |

## Optional parts and what each needs

- **The code runner** (Evaluate Code, `docs/workflows/evaluate-code.md`): `OPENVERIFY_WORKFLOW_CODE_ENABLED` (on by default) and `OPENVERIFY_WORKFLOW_CODE_RUNNER`: `pool` runs code in the worker's own children, `socket:<path>` reaches the `openverify/code-runner` service over a shared volume (compose), `tcp:<host>:<port>` over the network with `OPENVERIFY_CODE_RUNNER_TOKEN` (the chart). Give the runner no network in either install path.
- **The attachment scanner** (`docs/cases/attachments.md`): the sandbox binding, or clamd at `OPENVERIFY_CLAMD_SOCKET`. No clamd ships in any image (ClamAV is GPL-2.0); run your own beside the worker.
- **IP reputation** (`docs/network/README.md#ip-reputation-ipreputation`): an operator-licensed anonymous-IP MMDB file, mounted read-only (compose mounts `data/ip-reputation/` at `/var/lib/openverify/ip-reputation` in the API and the worker), its absolute path in `OPENVERIFY_IP_REPUTATION_MMDB_PATH`, bound per environment kind with `OPENVERIFY_PROVIDER_IP_REPUTATION_SANDBOX` or `OPENVERIFY_PROVIDER_IP_REPUTATION_PRODUCTION`. No file ships (ADR 0006).
- **Network data** (`docs/network/README.md`): the sync reaches the publishers named in `network/sources.json` (DB-IP Lite, the Tor exit list, the cloud range files) and nothing else; `pnpm --filter @openverify/api network:sync` runs it by hand, and the worker's `network-refresh` job only with `OPENVERIFY_NETWORK_REFRESH` set (off by default). `OPENVERIFY_NETWORK_SOURCES_DISABLED` and `OPENVERIFY_NETWORK_SOURCES_ENABLED` choose the sources.
- **Device integrity** (`docs/android/device-integrity.md`, `docs/compliance/session-integrity.md`): the `deviceIntegrity` provider per environment kind (`OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_SANDBOX`, `OPENVERIFY_PROVIDER_DEVICE_INTEGRITY_PRODUCTION`); `play-integrity` needs `OPENVERIFY_PLAY_INTEGRITY_PACKAGE_NAME`, `OPENVERIFY_PLAY_INTEGRITY_CERTIFICATE_DIGESTS` and the secret `OPENVERIFY_PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON` in the worker. OpenVerify ships no Google code (Phase 10 P3 declined).
- **NFC trust anchors** (`docs/android/nfc.md`): `trust-anchors:sync` fills the trust store; `OPENVERIFY_TRUST_ANCHOR_REFRESH` turns on the worker's periodic refresh and `OPENVERIFY_NFC_ALLOW_ICAO_CRLS` its CRL fetch (both off by default).
- **The flow server** (`docs/flow/README.md`, `docs/flows/embedding.md`): `OPENVERIFY_FLOW_SERVER_API_URL` (the API as the flow server reaches it), `OPENVERIFY_FLOW_SERVER_TOKEN` (also set in the API) and `OPENVERIFY_FLOW_SERVER_TRUSTED_PROXY_HOPS`. An operator who serves the flow bundle without the flow server must send its response headers themselves: `docs/flow/README.md#response-headers-plan-c157-replacing-c1079s-fixed-set`.
- **The console's CSP reports**: the console's policy reports to its own `/csp-reports` route; `OPENVERIFY_DASHBOARD_CSP_MODE` sets enforce or report-only.
- **Connect** (sharing, `docs/connect/README.md`): `OPENVERIFY_CONNECT_ENABLED`, off unless the install turns it on.

## The client address

Every network fact describes the request's address as the API resolves it under `OPENVERIFY_TRUST_PROXY` (`docs/network/README.md#the-client-address-and-the-trust-proxy-setting`). List the addresses of the proxies in front of the API: a list is preferred, a hop count logs a warning at start, and `true` makes every production network fact null (`client_address_untrusted`). Unset, the API sees its nearest proxy as every client. Behind Docker Desktop's published ports the peer the API sees is the forwarding gateway (as on 11D's load stack, `docs/calibration/load-phase11.md`), so a compose install behind such forwarding names that gateway.

## TLS and the accepted transport risk

The API, the worker and migrate read `sslmode=verify-full` with `OPENVERIFY_POSTGRES_CA_FILE`, `rediss://` with `OPENVERIFY_REDIS_CA_FILE`, an `https` S3 endpoint with `OPENVERIFY_S3_CA_FILE` and an `https` vision URL with `OPENVERIFY_VISION_CA_FILE` (C249.1). In production mode each logs one `insecure_transport` warning per store an interceptor could read or replace (plain text, `sslmode` below `verify-full`, TLS without a trusted CA), naming the store, never the URL; none refuses to start, and no setting turns certificate checks off. **Require TLS between hosts.** Plain text inside one namespace or one compose network is the operator's accepted risk (C277.4), listed in the threat model's accepted risks.

## What only the operator can do (C277.3)

- TLS between hosts and to every store, and the certificates.
- A secrets store, and the KEK and blind-index key kept apart from the data's backups.
- Log shipping to a store the hosts cannot rewrite, and alerts on it.
- Backups, their retention window and the restore drill ([backups-and-restore.md](backups-and-restore.md)).
- A network plugin that enforces NetworkPolicy, on Kubernetes.
- HSTS when no ingress of the chart terminates TLS (`OPENVERIFY_HSTS_MAX_AGE`, or the terminator's own setting).
- The licence of any data file the install adds (an IP reputation MMDB, a ClamAV database).

[hardening-checklist.md](hardening-checklist.md) lists the self-assessed checklist rows whose status is `operator`.
