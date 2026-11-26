# Phase 11 research: threat model, ASVS, security scanning, load testing, deployment and the documentation set (engineering)

Status: complete, 2026-10-29. Every section was written as it was finished.

**Summary.**
- **k6 fails rule 4.** It is AGPL-3.0 (`LICENSE.md` at v2.3.0). Use **Locust 2.46.7** (MIT) for scenarios and **vegeta v12.13.0** (MIT, constant rate) for per-route p95, with the proposed budgets of section 6.4. Artillery is MPL-2.0 with telemetry on by default; autocannon has not been released since 2024.
- **SAST:** the Semgrep CE engine and Opengrep are LGPL-2.1, and Semgrep's rules carry a source-available licence, so all three fail. CodeQL's terms allow analysis only of OSI-licensed codebases, and code scanning on a private repository needs a paid GitHub Code Security licence. The SAST baseline is therefore ESLint with `eslint-plugin-security` (Apache-2.0), ruff's bandit rules (already on) and Android lint.
- **Scanners that pass:** Trivy v0.76.0, osv-scanner v2.7.0, Grype v0.120.1, Syft v1.54.1, zizmor v1.31.x, gitleaks 8.30.1 (in use), pip-audit 2.10.1, ZAP v2.17.0, cdxgen 12.8.6, the CycloneDX Gradle plugin 3.5.1 and cosign v3.1.3. The Trivy supply-chain compromise of 2026-03-19 (CVE-2026-33634: a malicious v0.69.4, and 76 of 77 `trivy-action` tags force-pushed) leads to one rule: install scanners as pinned, checksummed binaries, never through mutable action tags, and pull images by digest.
- **ASVS 5.0.0 is final** (2025-05-30). It has 345 requirements; the Level 2 set is 253, of which about 205 apply here. It is licensed CC BY-SA, so commit requirement ids and our evidence only, never its text. There are 13 day-one gaps, including HSTS, the console's script CSP, the flow's `frame-ancestors`, an idle timeout, TLS to the data stores, a secrets manager, SBOMs, a log inventory and the per-process login limiter.
- **Threat model:** 46 STRIDE rows over 14 boundaries, kept as Markdown with ids and a parsing test. Threat Dragon v2.6.2 (Apache-2.0) is an optional editor.
- **Deployment:** production images come first; the compose image is a dev image. Then a Helm chart: restricted Pod Security, default-deny NetworkPolicies (vision and the code runner get no egress), one Secret per process, a separate migration role and a locked migrate hook, `/ready` probes, Kubernetes ≥ 1.35 (1.34 reached end of life on 2026-10-27), and tests on Helm 4.3.1 and 3.22.1 with helm-unittest, kubeconform and chart-testing. No Bitnami dependency.
- **Docs:** a self-hosting guide (with a generated configuration reference, KEK rotation, backups with the keys kept apart, `jit = off` per role once measured) and a compliance guide that splits what the software provides from what the operator must do (UK GDPR and the Data (Use and Access) Act 2025, BIPA, Washington, Texas, the CCPA regulations of 2026, and the AI Act's carve-out for 1:1 verification). The check catalog and the Persona-to-OpenVerify mapping are generated from the registries and OpenAPI. A DSAR access export is promised by PLAN but built nowhere.

## 0. Scope, method and conventions

Prepared 2026-10-29 for the hardening and documentation half of OpenVerify Phase 11 ("Connect / reusable KYC and hardening", `docs/PLAN.md` §6 [R1]): the threat model, an OWASP ASVS Level 2 checklist, security scanning, a load test, a Helm chart and the documentation set (self-hosting, compliance, the check catalog, and a mapping for teams moving from Persona's public API). The other half of Phase 11 (share tokens, connections, consent) is the sibling note `phase11-connect.md` [S1]; this note touches it only where sharing becomes a trust boundary.

**Conventions.** Everything is in our own words. Identifiers (field names, header names, configuration keys, URL paths, requirement ids such as `V6.2.1`, chapter names of a standard) are reproduced only where parity or traceability needs them; no requirement text, help text or UI copy is copied. A statement the sources do not make is marked **not documented**; a statement we infer and no source makes is marked **(inference)**. Every claim carries a citation key defined in section 9, read on 2026-10-29. Licence verdicts follow repository rule 4 as the task restates it [R2]: ✅ passes, ⚠️ passes with a caveat, ❌ fails. Rule 4 applies to tooling too: AGPL, GPL and LGPL fail even as tooling; MPL-2.0 and EPL-2.0 pass only for unmodified build, test and dev tooling that never ships; a proprietary service is acceptable only as an optional extra the project works without.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-15**. Each tool row gives the latest version and the newest one that passes. Tools that are not installed through pnpm, uv or Gradle (Go binaries, container images, GitHub Actions) follow the same 14 days by project convention (the repository already pins every action to a commit SHA and every binary to a SHA-256 [R14][R18]).

**Method.**
- The repository was read, never changed, at `91c83e02` plus the Phase 6 work in progress in the same tree: `docs/PLAN.md` §2, §3, §5, §6, §9, §10; `CLAUDE.md`; ADRs 0001 to 0005; the surface index; every plan grepped for Phase 9, 10 and 11 hand-offs; the security code (envelope encryption, sealed columns, the blind index, API keys, session tokens, operator authentication, the SSRF guard and the outbound HTTP client, the console and flow security headers), `infra/` (compose file, both Dockerfiles, Postgres init, infra tests), `.github/workflows/ci.yml`, `THIRD_PARTY_LICENSES.md`, `docs/api/openapi.json` and the Phase 6 calibration [R1]–[R30].
- External facts come from the issuer's own page, the GitHub releases API (tags and `published_at`), the LICENSE file at the release tag on `raw.githubusercontent.com`, and the npm and PyPI registries. Every host's `robots.txt` was read before any other request to it (cached per host by the fetch script), with at least 1.2 s between requests to one host, no redirect followed automatically, a descriptive User-Agent without contact details, and no personal data sent. The GitHub API was used unauthenticated. Downloads went into new, empty directories under `downloads/hard-*/`; scripts are `scripts/hard_*.py`; Python ran with `-I`; nothing downloaded was executed or installed.

## 1. Carried into this phase

Every item earlier plans and the progress log hand to Phase 11, or leave to "a later phase" in this note's subject (hardening, deployment, documentation). Items that belong to the Connect half are listed for completeness and marked so.

| # | Item | Where it is handed over | Subject | What this note proposes |
|---|---|---|---|---|
| H1 | Per-tenant queue quotas: no cap on pending adverse-media runs per environment; "per-tenant queue quotas belong to Phase 11 hardening" | `docs/plans/phase-6.plan.md` line 1280 (decision 22); `docs/PROGRESS.md` line 83 [R22][R21] | hardening | Threat-model entries B3-D1 and B5-D1 (DoS by one tenant, section 3.2) and an admission cap per environment and queue, measured by the load test (section 6.4) |
| H2 | The UN Security Council list: an opt-in with an acknowledgement of the UN's terms | `phase-6.plan.md` line 1279 (decision 21); `PROGRESS.md` line 84 | compliance docs | The compliance guide's licensed-data section (section 8.2) describes the acknowledgement; the switch itself is a small API change for the Phase 11 plan |
| H3 | An HTTP conditional request (ETag or Last-Modified) for list syncs, optional, a `200` still compared by SHA-256 | `phase-6.plan.md` line 1258 (decision 10); `PROGRESS.md` line 81 | Phase 11, not hardening | Listed only; it is an ingestion saving with no security effect |
| H4 | Connect snapshots of reports | `phase-6.plan.md` line 577 | Connect half | [S1] |
| H5 | The console's script CSP with per-request nonces, "left for a later phase" since Phase 2; the explorer and editor are only tested under an injected policy | `apps/dashboard/next.config.ts` header comment [R12]; `phase-7.plan.md` lines 104 and 1463; `phase-8.plan.md` line 88 [R23][R24] | hardening (ASVS V3.4) | Not assigned to a phase by any plan. Phase 9 owns the console; if Phase 9 does not ship it, Phase 11 must (section 4.3, gap G-CSP) |
| H6 | The flow's response headers: `frame-ancestors`, `Permissions-Policy: camera=(self)` and `Referrer-Policy` need a serving layer; `vite preview` sends none, and a `<meta>` CSP cannot carry `frame-ancestors` | `PROGRESS.md` line 1280 (Phase 1 carry); `apps/flow/src/security/security-meta.ts` header [R13] | hardening and deployment | A production flow server (or the chart's ingress) sends them; Phase 9's allowed-domains list fills `frame-ancestors` (section 7.2) |
| H7 | Production images: the compose `app` profile uses one development image that keeps dev dependencies | `PROGRESS.md` line 1275; `infra/docker/apps.Dockerfile` header [R17] | deployment | Separate, minimal, non-root images per process before any chart is published (section 7.1) |
| H8 | The code runner's isolation in production: a startup warning naming the missing isolation, `socket:<path>` as the production setting, with a Kubernetes sidecar and an egress-denying NetworkPolicy as the documented example | `phase-8-review-resolution.md` line 25 (P17); `phase-8.plan.md` line 485 [R24] | deployment | The chart ships that sidecar and policy (section 7.2) |
| H9 | Vision's isolation (C60.2): alone on an internal network, uid 10001, read-only root, no capabilities, no new privileges, memory limit | `phase-5.plan.md` line 636; `infra/docker-compose.yml` vision service; `infra/tests/vision-container.test.sh` [R16][R28] | deployment | The chart reproduces it with a NetworkPolicy and the restricted Pod Security profile, and a chart test asserts it (section 7) |
| H10 | JIT off for the whole application, an optional performance item "that needs its own measurement"; retrieval already runs `set local jit = off` | `phase-6.plan.md` lines 1476, 1660 and 1709 [R22] | self-hosting docs | The self-hosting guide's database settings (section 8.1) with the role-level setting, measured by the load test first |
| H11 | Session-integrity collection rests on the operator's strictly-necessary assessment; "the basis goes in the compliance guide" (WP29 9/2014 §7.5, CNIL délibération 2020-091 ¶49, UK PECR Sch. A1 para 4 from 2026-02-05) | `phase-7.plan.md` line 612 [R23] | compliance docs | Section 8.2 |
| H12 | The QR handoff threat model lives in `docs/flow/handoff.md` | `phase-7.plan.md` line 751 | threat model | The threat model links it as the handoff boundary's detail (section 3.2) |
| H13 | `docs/compliance/automated-decisions.md` (Phase 8): the operator's duties for automated adverse decisions | `phase-8.plan.md` line 570 [R24] | compliance docs | The compliance guide is its index (section 8.2) |
| H14 | "DSAR export" is promised by PLAN §3 and §9; no plan builds it (redaction exists for accounts, inquiries and transactions, an access export does not) | `docs/PLAN.md` lines 155 and 501 [R1]; grep of `docs/plans/` | compliance tooling | A per-account export (section 8.2); otherwise the compliance guide must say it is missing |
| H15 | "gitleaks + PII scan in CI" against fixture leaks | `docs/PLAN.md` line 508 (risk table) | scanning | gitleaks runs; no PII scan exists in `ci.yml` [R18]. Section 5.3 proposes one |
| H16 | "Use RE2 or a time limit for operator-supplied regexes" | `PROGRESS.md` line 1311 (Phase 0 carry, never closed in a later entry) | hardening | A threat-model entry (DoS) and an ASVS V15.3 line; the Phase 11 plan should confirm whether a later phase closed it |
| H17 | "Before release: legal review of SFace's upstream licence" | `PROGRESS.md` line 1317 | release checklist | Needs the owner (section 11) |
| H18 | The rate limiter fails open when Valkey is down (availability over limits) | `phase-2.plan.md` line 280 [R26] | threat model | A documented accepted risk with its monitoring (section 3.3) |
| H19 | `user:reset-mfa` for self-hosters, with an audit entry | `phase-2.plan.md` line 919; `CLAUDE.md` [R30] | self-hosting docs | Section 8.1 (break-glass procedures) |
| H20 | Public-sector PKI data (CSCA master lists) as an operator-fetched runtime exception to rule 4; the SCUBA files' exception before Phase 10 | `phase-5.plan.md` line 758 (decision 40) | compliance docs | Section 8.2 (licensed and public-sector data) |
| H21 | Operator watch items: the first real EU and UN syncs and the first `pep:sync` | `PROGRESS.md` line 90 | self-hosting docs | Section 8.1 (first-run checklist) |
| H22 | PLAN §10 acceptance: docs cover self-hosting, the check catalog, the API reference, the threat model, the compliance guide and the Persona mapping | `docs/PLAN.md` line 519 | documentation | Section 8 |

## 2. What the repository has today

The security pieces Phase 11 builds on, and the gaps the threat model and the ASVS checklist will find. Each row was read in the working tree.

| Area | What exists | What it does not cover | Source |
|---|---|---|---|
| PII at rest | Envelope encryption: a fresh 256-bit DEK per value under AES-256-GCM, the DEK wrapped by the KEK with AES-256-GCM, fresh 96-bit IVs, a key id derived with HKDF, associated data binding version, key id and column; files use the same scheme with the file id as context; `kek:rewrap` after rotation; retired KEKs in `OPENVERIFY_KEK_PREVIOUS` | The KEK is an environment variable (no KMS adapter yet, though PLAN §3 names an "env/KMS adapter"); ciphertexts cannot be indexed; the documented IV budget is 2^32 wraps per KEK | `packages/db/src/crypto.ts` [R5] |
| Row binding | Schema v2 columns bind the ciphertext to `<table>.<column>#<row id>`, so a value copied to another row fails authentication | Phase 1 columns are bound to the column only (a value can move between rows of one column) | `packages/db/src/sealed.ts` [R6] |
| Lookups without plaintext | A blind index: HMAC-SHA-256 under a per-environment subkey of `OPENVERIFY_BLIND_INDEX_KEY`; `blind-index:rebuild` after a key change | An index is a deterministic token: equal numbers within one environment are linkable by anyone who reads the table (by design) | `packages/db/src/blind-index.ts` [R7] |
| API keys | Prefixed tokens (`ov_sbx_`, `ov_prod_`) with 256 random bits; stored as HMAC-SHA-256 under a server pepper of at least 32 bytes; a short token prefix kept for display; scopes, expiry, IP allowlist and rotation in the API (C12) | The pepper has no rotation command (inference from the code read: no `pepper:rotate` script); a pepper change invalidates every key | `packages/db/src/api-keys.ts` [R8] |
| Sessions | Opaque flow (`ovs_`) and console (`ovu_`) tokens stored as SHA-256; console sessions live 12 hours | No idle timeout found in the contract read (only the absolute lifetime) — to check against ASVS V7.3 | `packages/db/src/tokens.ts`, `packages/contracts/src/tokens.ts` [R9] |
| Operator authentication | Argon2id at the OWASP minimum (19 MiB, t=2, p=1) with the PHC prefix pinned by a test; TOTP (RFC 6238, SHA-1, 6 digits, 30 s, ±1 step; the last accepted step is stored per factor, so a code cannot be reused); WebAuthn; 10 single-use recovery codes hashed with Argon2id; `user:reset-mfa` with a system audit entry; login limits of 50 per address and 10 per email in 15 minutes | The login limiter keeps its windows **in process memory**, so with N replicas the effective limit is N times higher (inference from `new Map` in the limiter and its construction per process); no notification to the user after repeated failures was found | `apps/api/src/operator-auth/*` [R10] |
| Outbound requests | One SSRF guard for webhooks and every provider call: resolution inside the socket's lookup, every answer vetted (private, loopback, link-local, CGNAT, metadata, documentation, reserved, NAT64 and IPv4-mapped forms refused), connect to the vetted address, no redirects, 1 MiB response cap, a content-type allowlist, 10 s deadline, errors without URLs; private networks allowed only outside production | Egress is still possible to any public address: a NetworkPolicy or proxy is the second layer in a cluster (section 7.2) | `apps/api/src/webhooks/ssrf.ts`, `apps/api/src/http/index.ts` [R11] |
| Browser headers, console | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, a Permissions-Policy denying camera, microphone, geolocation and payment | **No script CSP** (H5); no HSTS header in the app (expected from the TLS terminator; must be documented) | `apps/dashboard/next.config.ts` [R12] |
| Browser headers, flow | A build-time `<meta>` CSP: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` to the API origin, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` | `frame-ancestors`, Permissions-Policy and Referrer-Policy need response headers that no production server sends yet (H6) | `apps/flow/src/security/security-meta.ts` [R13] |
| Secrets in git | gitleaks 8.30.1 binary, SHA-256 pinned twice (release checksums and an in-repo pin), a fail-closed pre-commit hook, a full-history scan in CI; gitleaks-action excluded for its licence | No PII pattern scan (H15) | `.githooks/pre-commit`, `infra/scripts/install-gitleaks.sh`, `ci.yml` job `secrets` [R14][R18] |
| Downloads | Models, data and fixtures fetched by standard-library scripts that pin HTTPS URL, SHA-256, size and SPDX licence, and write a file only after its digest matches; the apps image re-checks three digests at build time | Base images are tag-pinned, not digest-pinned (`node:22.22.1-bookworm-slim`, `python:3.12-slim`, `ghcr.io/astral-sh/uv:0.13.3`) | `scripts/fetch_*.py`, `infra/docker/apps.Dockerfile`, `services/vision/Dockerfile` [R15][R17] |
| Containers | Every host port bound to loopback; secrets required with no defaults; vision isolated (internal network, uid 10001, read-only root, `cap_drop: ALL`, `no-new-privileges`, 4 GiB) with a contract test; Postgres never logs bind parameters | The apps image runs as `node` but keeps dev dependencies and a writable root; no resource limits on api, worker, flow, dashboard; Valkey has no TLS and one shared password; RustFS console enabled | `infra/docker-compose.yml`, `infra/tests/*.sh` [R16] |
| CI hygiene | `permissions: contents: read`; every action pinned to a commit SHA with its tag in a comment; `persist-credentials: false`; actionlint in the CI contract test; the Gradle wrapper JAR checked against `services.gradle.org` | No dependency audit, container scan, SBOM, workflow security lint (zizmor), SAST, DAST or provenance | `.github/workflows/ci.yml`, `infra/tests/ci-workflow.test.sh` [R18] |
| Rate limits | GCRA in Valkey per principal (300 a minute by default) with standard headers | Fails open when Valkey is down (H18); no per-tenant queue quotas (H1) | `apps/api/src/rate-limit/`, `phase-2.plan.md` line 280 [R26] |
| Licences | A component table with versions, licences and status; the weak-copyleft tooling exceptions in §5; an excluded list (MinIO, Redis 7.4+, gitleaks-action, gradle/actions, PyMuPDF, poppler, Ghostscript, ...) | Scanners, load testers and chart tools are not listed yet; published images would redistribute Debian packages, some GPL (the file's note covers only pulled images) | `THIRD_PARTY_LICENSES.md` [R19] |
| API surface | OpenAPI 3.1.0 generated from zod, 121 paths under `/api/v1/` plus `/health`; request ids in `x-request-id`; date versions in `OpenVerify-Version`; webhook signatures in `OpenVerify-Signature`; idempotency keys on `POST` and `PATCH` | — | `docs/api/openapi.json`, `packages/contracts/src/api-versions.ts`, `packages/node/src/webhook-signature.ts` [R20][R27] |
| Performance evidence | Screening budgets of 100 ms p95 at 100,000 list names and 250 ms at 2,000,000 (C78.7), measured 109.5 ms and 399.4 ms on the development machine; a re-screen of 200,000 subjects after 1,000 added entries in 91.0 s; vision budgets of 5 s (ID), 3 s (selfie) and 4 s (document) logged in CI, never gated | No HTTP-level load test; no per-route budget; no worker throughput figure | `docs/calibration/watchlist-phase6c.md`, `ci.yml` job `vision` [R25][R18] |

## 3. The threat model: STRIDE per trust boundary

### 3.1 Method

- **STRIDE** names six threat classes: spoofing identity, tampering with data, repudiation, information disclosure, denial of service and elevation of privilege; Microsoft's threat-modeling guidance applies them to the elements and data flows of a diagram [T1]. The OWASP Threat Modeling Cheat Sheet frames the work as four questions (what are we building, what can go wrong, what do we do about it, did we do a good job), which the Threat Modeling Manifesto also states [T2][T3]. The model below is a first pass from the repository as read (section 2); every threat gets an id so the ASVS rows (section 4.4), tests and findings can point at it.
- **Trust boundaries** (B1–B14) follow PLAN §3's architecture [R1], plus three that exist in the plans but not in the diagram: the code runner (Phase 8), Connect sharing (Phase 11, [S1]) and the supply chain. The embedded flow's SDK (`@openverify/js`, `packages/sdk-js`) **does not exist yet** in `packages/` (only `node` does), so B2 is modelled from PLAN §3 and Phase 9.
- **Status words:** *control* (exists, with its evidence), *gap* (a proposal for Phase 11), *accepted* (a documented residual risk), *operator* (only the deployment can meet it). Statements about code not read line by line are marked "to verify".

### 3.2 Threats per boundary (first pass)

| Id | Boundary | STRIDE | Threat | Control today (evidence) | Gap or proposal |
|---|---|---|---|---|---|
| B1-S1 | Hosted flow: end user ↔ `apps/flow` ↔ `/api/v1/flow/*` | S | A forwarded or intercepted flow link lets someone else complete the inquiry; QR handoff phishing ("illicit onboarding") | Credentials ride in the URL **fragment** (never sent to a server or in a Referer), are removed from the address bar with `replaceState` before use, kept per tab in sessionStorage; one-time links are single use; sessions expire; Phase 7's handoff controls [R13][R23] | accepted: a link used before its owner is not detectable by the flow; the handoff note `docs/flow/handoff.md` is linked as this row's detail (H12) |
| B1-T1 | Hosted flow | T | Injected camera streams, replayed or synthetic images, deepfakes | Server-side analysis only; randomised pose challenge with a server nonce; liveness labelled beta with FAR/FRR evidence (PLAN §9) [R1] | accepted (HIGH in PLAN §9); the docs must say what liveness does not cover |
| B1-I1 | Hosted flow | I | XSS on the flow origin reads the session token from sessionStorage and the captures | A build-time CSP: `script-src 'self' 'wasm-unsafe-eval'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; no third-party script [R13] | gap: the policy is a `<meta>` tag; Phase 9's operator copy and themes must stay data (escaped), never markup |
| B1-I2 | Hosted flow | I | The flow framed by a hostile page (clickjacking, overlay) | none at the response level (`frame-ancestors` cannot be set by `<meta>`) [R13] | gap G-FRAME (H6) |
| B1-D1 | Hosted flow | D | Upload floods and oversized or decompressing files | Multipart limits, per-principal rate limits, the vision pixel and page limits [R16] | measure in the load test (section 6) |
| B1-R1 | Hosted flow | R | An end user later denies consenting to biometric processing | The consent step comes first and is recorded through `/api/v1/flow/consent` [R20] | to verify that the record holds the text version shown, the time and the locale; [S1] covers the consent record |
| B2-S1 | Embedded flow: customer page ↔ iframe ↔ SDK (`postMessage`) | S | A hostile page embeds the flow or spoofs messages to the iframe | PLAN §3: origin-checked `postMessage`, a domain allowlist, `localhost` only in sandbox [R1] | build: allowed domains as `frame-ancestors` and an `event.origin` plus `event.source` check on both sides (Phase 9); messages carry no PII |
| B2-T1 | Embedded flow | T | The parent page changes prefill or reference data in the iframe URL | Inquiries are created server-side with an API key; the flow reads the inquiry from the API (inference from the C3 flow view) | keep it so: never accept identity fields from the parent page |
| B2-I1 | Embedded flow | I | Events posted with target `*` leak inquiry ids and statuses to other frames | — | require an exact target origin in the SDK; a unit test per message type |
| B3-S1 | Public API: customer backend ↔ `/api/v1/*` with API keys | S | A stolen API key | 256-bit keys, HMAC-SHA-256 under a pepper at rest, recognisable prefixes for scanners, scopes, expiry, IP allowlists, sandbox and production prefixes [R8] | operator: register the `ov_prod_` prefix as a custom secret pattern where their scanners allow it; gap: no pepper rotation path |
| B3-T1 | Public API | T | Replayed or duplicated writes; a forged webhook | Idempotency keys on `POST` and `PATCH`; webhooks signed with a timestamp and HMAC, dual-signed during rotation; `@openverify/node` verifies [R27] | document the receiver's timestamp tolerance |
| B3-R1 | Public API | R | A customer denies an API action | API logs with request ids (30-day default), events, user audit logs [R20] | gap G-LOGINV: ship logs off-box (V16.4.3) |
| B3-I1 | Public API | I | Object-level authorisation failure across environments or organisations (BOLA) | Repositories scoped by environment; masked PII unless `pii:view`; problem+json without PII [R1] | a cross-tenant test per resource family in the ASVS V8 rows; DAST with two tenants (section 5.5) |
| B3-D1 | Public API | D | Floods; expensive endpoints (searches, reports, exports); one tenant starving others | GCRA per principal, 300 a minute by default; report limits per environment [R16][R26] | accepted: the limiter fails open without Valkey (H18), with an alert; gap H1: per-tenant queue quotas |
| B3-E1 | Public API | E | A key clones or creates keys broader than its own scopes | `api-keys/{id}/clone` exists [R20] | to verify that a clone or a new key can never exceed the caller's scopes; a test |
| B4-S1 | Console: operator browser ↔ Next.js server ↔ API | S | Credential stuffing, phishing | Argon2id; login limits; TOTP, WebAuthn (origin-bound), recovery codes [R10] | gap G-LOGIN: limits per process; an optional "MFA required" organisation setting (to verify whether it exists) |
| B4-T1 | Console | T | Cross-site request forgery against cookie-authenticated actions | httpOnly session cookie with `SameSite=Lax`; the MFA challenge cookie `SameSite=Strict`; Next.js server actions [R12] | to verify: an Origin check on every state-changing route handler, not only server actions |
| B4-I1 | Console | I | Stored XSS through attacker-supplied data an operator views: OCR text, document fields, list entries, webhook answers, report hits | React escaping; uploaded files served as attachments with `nosniff` and `no-store` | gap G-CSP: no script CSP on the most privileged surface (H5) |
| B4-R1 | Console | R | An operator denies reading or changing PII | User audit logs of operator reads and writes; redaction actions name their actor (Phase 6 decision 12) [R1][R22] | ship audit logs off-box; retention per the compliance guide |
| B4-E1 | Console | E | An operator grants themself a role or permission; a session survives offboarding | RBAC with built-in and custom roles; sessions hashed | gap G-IDLE; verify V7.4.2 (disable ends sessions) and V7.4.5 (admin ends a user's sessions) |
| B5-S1 | Workers: BullMQ consumers on Valkey | S | Anyone who can write to Valkey enqueues jobs | Jobs carry ids only and the worker re-reads Postgres, so a forged job can only reprocess an existing record [R31] §1 | operator: Valkey reachable only from the app's pods (section 7.2) |
| B5-I1 | Workers | I | Error messages and stacks stored in Valkey carry PII | Failures described by class and code, never message (Workflow 4B H001) [R31] | keep; a test exists per that decision |
| B5-D1 | Workers | D | One tenant's jobs starve the others; retry storms; poison jobs | Fair sweeps, per-minute limits, crash-loop caps (Phase 6) | gap H1: admission caps per environment and queue, measured (section 6.4) |
| B5-E1 | Workers | E | The worker holds most provider secrets | Compose gives each process only its own provider bindings and secrets (C63) [R16] | the chart keeps that split (one Secret per process) |
| B6-T1 | Vision: API and worker ↔ `services/vision` | T | Hostile PDFs and JPEG 2000 portraits exploit a parser | Guarded child with rlimits and `no_new_privs`; read-only root; uid 10001; `cap_drop: ALL`; default seccomp; no jbig2dec; contract test [R16][R28] | the chart reproduces each control and a chart test asserts them (H9) |
| B6-S1 | Vision | S | A caller other than the API or worker reaches vision | Shared service token; internal network only | gap G-TLS: the token crosses plain HTTP; a NetworkPolicy in the chart |
| B6-D1 | Vision | D | Decompression bombs, huge images | Pixel and page limits, two children, 4 GiB limit | measure (section 6) |
| B7-I1 | Postgres | I | A database dump or backup exposes PII | Envelope encryption with row-bound AAD; KEK outside the database; blind index under its own key; bind parameters never logged [R5][R6][R7][R16] | operator: backups encrypted and their keys apart from the KEK; G-TLS for connections |
| B7-T1 | Postgres | T | Ciphertext moved between rows or columns | AAD binds column, and for schema v2 the row id [R6] | accepted for Phase 1 columns (column-bound only) |
| B7-E1 | Postgres | E | The runtime role can run DDL (migrations and the API use one `DATABASE_URL` in compose) [R16] | — | gap: a migration role (DDL) and a runtime role (DML only, no `CREATE`), with `statement_timeout` and `jit` set per role (section 8.1) |
| B7-R1 | Postgres | R | Direct database changes bypass the application's audit | Append-only triggers on some audit tables (Phase 6) | operator: pgAudit (PostgreSQL licence) as an option, named in the guide (inference: licence not re-checked here) |
| B8-S1 | Valkey | S | One shared password, no TLS, no per-process users [R16] | `requirepass`; not published beyond loopback in compose | gap: Valkey ACL users per process, `rediss://`, dangerous commands denied for app users |
| B8-D1 | Valkey | D | Memory exhaustion evicts queue keys | Phase 8 research decision 17 [R31]: warn unless `maxmemory-policy` is `noeviction` | operator: memory sized and policy set (section 8.1) |
| B9-I1 | S3 store | I | Bucket exposure | Objects are encrypted before upload with a DEK per file and the file id as AAD; the store sees ciphertext only [R5] | operator: public access blocked; least-privilege credentials |
| B9-T1 | S3 store | T | Redaction leaves noncurrent versions behind | `delete` removes every version of a key in a versioned bucket; needs `s3:ListBucketVersions` and `s3:DeleteObjectVersion` [`apps/api/src/storage/index.ts`] | operator: grant exactly those; object lock and backup copies must be reconciled with redaction (section 8.2) |
| B10-I1 | Outbound fetches: webhooks, providers, list syncs, PEP, media, trust anchors, EVM RPC, the HTTPS action | I | SSRF to metadata or internal services | One guard: vetted DNS answers, no redirects, private ranges refused in production, caps, timeouts [R11] | operator: an egress NetworkPolicy or proxy as a second layer (section 7.2) |
| B10-T1 | Outbound fetches | T | A tampered list or trust-anchor publication | Lists verified and refused on schema errors (ADR 0005); master lists verified against pinned roots [R3] | keep |
| B10-I2 | Outbound fetches | I | Personal data disclosed to third parties (screened names to GDELT, numbers to Twilio Lookup) | Opt-in with an explicit acknowledgement (GDELT); adapters off unless bound | the compliance guide lists every outbound recipient (section 8.2) |
| B11-T1 | Android SDK: host app ↔ SDK ↔ API | T | Rooted or emulated devices, hooking, virtual cameras | Phase 10: heuristics (beta, with a confidence) and an optional Play Integrity adapter [R1] | accepted: the server never trusts the device; the docs say what the heuristics miss |
| B11-I1 | Android SDK | I | Captures left in app storage, logcat, screenshots or the recents view | — (Phase 10) | Phase 10: no PII in logs, captures in memory or the no-backup cache and deleted after upload, `FLAG_SECURE` on capture screens (proposed) |
| B11-S1 | Android SDK | S | A man-in-the-middle with a user-installed CA | Platform trust store (the Android default for apps targeting API 24+ ignores user CAs; inference, not re-read) | optional certificate pinning configured by the operator, off by default because each self-hoster has its own certificates (inference) |
| B12-E1 | Code runner (Phase 8 Evaluate Code) | E | Sandbox escape from operator-authored code | QuickJS WASM with limits; a separate service with no network, read-only root, no secrets (P17) [R24] | the chart ships the sidecar and egress-deny policy (H8) |
| B13-I1 | Connect sharing (Phase 11) | I, S | A leaked or replayed share token exposes a verified identity to the wrong organisation | — | [S1]: entropy, hashing at rest, receiver binding, expiry, consent; add its rows here when designed |
| B14-T1 | Supply chain: dependencies, actions, images, models | T | A compromised dependency, action or tool release | 14-day release age; `allowBuilds` false by default; actions pinned to SHAs; binaries and models pinned by SHA-256; gitleaks-action and gradle/actions excluded [R14][R15][R18][R19] | section 5: dependency and image scanning, SBOMs, signed images and provenance; the Trivy incident of 2026-03-19 (section 5.2) is the case study |
| B14-I1 | Supply chain | I | Secrets committed | gitleaks pre-commit (fail-closed) and full-history CI scan [R14] | H15: a PII-pattern scan of fixtures |
| BX-D1 | All | D | Catastrophic regular expressions in operator-supplied patterns | Phase 0 carry: RE2 or a time limit (H16) | to verify; a test with a known catastrophic pattern |

### 3.3 Accepted risks to state in the docs

- **The rate limiter fails open** when Valkey is down (H18): availability was chosen over limits in Phase 2. The guide must say so and give the metric to alert on.
- **Liveness and document forensics are spoofable** (PLAN §9): open models, no PAD certification; layered controls and beta labels.
- **Phase 1 ciphertexts are column-bound, not row-bound** (B7-T1).
- **A forwarded flow link** can be completed by whoever uses it first (B1-S1); the handoff note's mitigations apply.
- **The blind index links equal numbers within one environment** by design (B7, section 2).

### 3.4 Format and upkeep

| Option | Licence and version | Fit |
|---|---|---|
| Markdown in the repository (`docs/security/threat-model.md`), with a Mermaid data-flow diagram | — | **Recommended.** Reviews happen in diffs like every other plan; ids link to ASVS rows and tests; agents and humans edit it alike |
| OWASP Threat Dragon | ✅ Apache-2.0 (`license.txt` at `v2.6.2`); **v2.6.2, 2026-05-10** (also the newest that passes) [T4][T5] | Good as an optional editor: models are JSON files that the desktop app stores locally, and the web app can store locally or in GitHub, GitLab, Bitbucket or Google Drive; threats can be categorised by STRIDE, LINDDUN, CIA, CIA-DIE or PLOT4ai; its analytics are off by default and never run in the desktop app [T5][T6]. JSON diffs of a diagram are hard to review (inference) |
| OWASP pytm (threat model as Python code) | ✅ MIT (`LICENSE` at `v1.4.0`); **v1.4.0, 2026-07-06** [T7] | Generates diagrams and a threat list from code; another language to maintain for one document (inference) |

**Recommendation:** Markdown as the source of truth; Threat Dragon optional for a workshop, exported back to Markdown. **Keeping it current (proposed):**
1. A test parses the threat table: every boundary considers all six STRIDE letters (a threat row or a "not applicable because" line), every row has a status, every *control* cites a path that exists, every *gap* names a phase or a finding.
2. Triggers for a review: a new external input or route family, a new data store, a new outbound integration, a new secret or privilege, a new client (the embedded SDK, Android, Connect). The phase plan template gains one line: "threat-model rows added or changed".
3. A full review at each phase end, beside the ASVS review (section 4.4), recorded with the commit in `docs/PROGRESS.md`.

## 4. OWASP ASVS: version, Level 2 and a checklist with evidence

### 4.1 Version and status

- **5.0.0 is final.** The GitHub release `v5.0.0_release` was published on **2025-05-30** and is the latest stable release; the repository's `latest` tag is a bleeding-edge build regenerated from `master` (last on 2026-10-26) that the project itself labels for preview only, and it still carries the 5.0.0 numbering [V1]. The flat JSON export of 5.0.0 (SHA-256 `8201b20e…2311`, 162,870 bytes) is byte-identical in both releases [V2].
- **Licence of the standard:** CC BY-SA 4.0 (`LICENSE.md` at the release tag) [V3]. It is not a dependency, so rule 4 does not apply to it, but share-alike matters for what we commit: a file that reproduces requirement texts becomes a derivative under CC BY-SA. **Recommendation:** commit only requirement ids, our status and our evidence; a `scripts/fetch_*` entry pins the official export by SHA-256 so a local tool can show the texts beside our rows, uncommitted (inference about the licence consequence; not legal advice).
- **Shape (counted from the export [V2]):** 17 chapters, 345 requirements: 70 at L1, 183 at L2 only and 92 at L3 only. A level includes the levels below it, so **Level 2 is 253 requirements** (L1 + L2), which matches the standard's own description of L2 as about 70% of the whole [V4].
- **How to cite a requirement:** the standard asks tools and reports to use `v<version>-<chapter>.<section>.<requirement>`, for example `v5.0.0-6.2.1`, because ids move between versions [V4]. **OWASP certifies nothing**: any "ASVS certified" claim is not OWASP's, and a verification report should state its scope, every requirement checked, the not-applicable ones with reasons, and the exceptions [V5]. Our docs must say "self-assessed against ASVS 5.0.0 Level 2", never "certified".
- **Automation:** the standard says off-the-shelf SAST and DAST cover only the simplest requirements and that most need application-specific tests (often unit or integration tests) or documentation review [V5]. This matches how the repository already works (contract tests per decision), so most evidence rows will point at tests.

### 4.2 Level 2 by chapter, and what applies to OpenVerify

| Chapter | L1 | L2 only | Level 2 set | Applies to OpenVerify | Notes |
|---|---|---|---|---|---|
| V1 Encoding and Sanitization | 8 | 19 | 27 | yes | Drizzle parameterises SQL; operator text in exports goes through the Phase 7 CSV writer; templates (Phase 8) through our value-level substitution |
| V2 Validation and Business Logic | 4 | 7 | 11 | yes | zod at every boundary; V2.4 anti-automation maps to the rate limiter and OTP limits |
| V3 Web Frontend Security | 8 | 11 | 19 | yes | Gaps: HSTS (V3.4.1, L1), the console's script CSP (V3.4.3), `frame-ancestors` on the flow's responses (V3.4.6) |
| V4 API and Web Service | 2 | 8 | 10 | yes, except V4.3 GraphQL (2) and V4.4 WebSocket (4) | 4 apply |
| V5 File Handling | 4 | 5 | 9 | yes | Upload limits, the guarded vision child, encrypted objects, the authenticated file proxy |
| V6 Authentication | 13 | 22 | 35 | yes, except V6.8 identity providers (4) until SSO exists | Argon2id, TOTP, WebAuthn, recovery codes, OTP (Phase 5 already cites V6.5 and V6.6 [R28]) |
| V7 Session Management | 6 | 12 | 18 | yes, except V7.6 federated re-authentication (2) | Gap: inactivity timeout (V7.3.1); check V7.4.3 and V7.4.5 (terminate other sessions; admins terminate a user's sessions) |
| V8 Authorization | 4 | 3 | 7 | yes | RBAC with custom roles, environment scoping, `pii:view` |
| V9 Self-contained Tokens | 4 | 3 | 7 | not today | Every token is opaque and hashed at rest [R9]; Phase 11 share tokens bring V9 in only if they are signed (inference; [S1]) |
| V10 OAuth and OIDC | 5 | 24 | 29 | no | No OAuth server or client; if console SSO is added later, V10.2 and V10.5 apply |
| V11 Cryptography | 3 | 11 | 14 | yes | Gaps are documentary: a key-management policy (V11.1.1) and a cryptographic inventory (V11.1.2) |
| V12 Secure Communication | 3 | 6 | 9 | yes | Gap: TLS between internal services and to the data stores (V12.3.1, V12.3.3); compose runs them in plain text |
| V13 Configuration | 1 | 12 | 13 | yes | Gap: a secrets manager (V13.3.1); today every secret is an environment variable |
| V14 Data Protection | 2 | 7 | 9 | yes | Gap: a data classification with protection levels (V14.1.1, V14.1.2), which the compliance guide can carry |
| V15 Secure Coding and Architecture | 3 | 10 | 13 | yes | Gaps: remediation time frames (V15.1.1), an SBOM (V15.1.2), no dev functionality in production images (V15.2.3, H7) |
| V16 Security Logging and Error Handling | 0 | 16 | 16 | yes | pino with redaction and problem+json exist; gaps: a log inventory (V16.1.1), shipping logs to a separate store (V16.4.3) |
| V17 WebRTC | 0 | 7 | 7 | no | No WebRTC |
| **All** | 70 | 183 | **253** | about **205** apply | 48 not applicable today (V10, V17, V4.3, V4.4, V6.8, V7.6), plus V9's 7 until a self-contained token exists |

### 4.3 Gaps the checklist will open on day one (proposed findings, from section 2)

| Id | Requirement(s) | Gap | Proposed fix | Owner phase |
|---|---|---|---|---|
| G-HSTS | v5.0.0-3.4.1 (L1) | No HSTS from the apps; nothing documents that the TLS terminator must send it | The chart's ingress annotations and the self-hosting guide set it (one year, subdomains); a DAST rule checks it | 11 |
| G-CSP | v5.0.0-3.4.3 | Console: framing only, no script CSP (H5) | Per-request nonce CSP through Next.js middleware with `'strict-dynamic'`, the policy Phase 7's explorer test already injects | 9, else 11 |
| G-FRAME | v5.0.0-3.4.5, 3.4.6 | The flow's `frame-ancestors`, `Referrer-Policy` and `Permissions-Policy` need response headers (H6) | A small production server (or the chart's ingress) sends them; `frame-ancestors` comes from Phase 9's allowed domains | 9 and 11 |
| G-IDLE | v5.0.0-7.3.1 | Console sessions have a 12-hour absolute lifetime and no inactivity timeout found | An idle timeout (for example 30 minutes, an environment setting) with a sliding `last_seen_at` | 11 |
| G-KEYDOC | v5.0.0-11.1.1, 11.1.2 | No key-management policy or cryptographic inventory document | `docs/security/crypto-inventory.md`: KEK, DEKs, pepper, blind-index key, webhook secrets, TOTP secrets, WebAuthn, session tokens, the vision token, TLS; where each may be used, how each rotates | 11 |
| G-TLS | v5.0.0-12.3.1, 12.3.3, 12.3.4 | Postgres, Valkey, RustFS and vision are reached in plain text in compose | The chart accepts TLS settings for every data store (`sslmode=verify-full`, `rediss://`, HTTPS S3) and the guide requires them across hosts; vision gets TLS or a mesh, or the guide records the accepted risk inside one namespace | 11 |
| G-SECRETS | v5.0.0-13.3.1, 13.3.2 | Secrets are environment variables; the KEK has no KMS adapter | Kubernetes Secrets mounted as files per process (least privilege, as compose already splits provider secrets per process [R16]); an External Secrets example; a KMS adapter for the KEK as an optional extra | 11 |
| G-CLASS | v5.0.0-14.1.1, 14.1.2 | No data classification document | A table of data classes (biometric, identity document, contact, device and network, operator, secrets) with encryption, retention, logging and access rules; it doubles as the compliance guide's record of processing | 11 |
| G-SBOM | v5.0.0-15.1.1, 15.1.2 | No remediation time frames; no SBOM | A policy (for example critical 7 days, high 30, medium 90) and CycloneDX SBOMs per image and per artifact (section 5) | 11 |
| G-DEVIMG | v5.0.0-15.2.3 | The apps image keeps dev dependencies and runs `tsx` scripts (H7) | Production images per process (section 7.1) | 11 |
| G-LOGINV | v5.0.0-16.1.1, 16.2.3, 16.4.3 | No log inventory; logs go to stdout only | `docs/security/logging.md` (what each process logs, the redaction paths, where logs may go) and the chart's guidance to ship to a separate store | 11 |
| G-LOGIN | v5.0.0-6.3.x, 2.4.1 (anti-automation) | The login limiter is per process memory, so its limit multiplies with replicas | Move the login windows to the Valkey limiter, failing closed for login only | 11 |
| G-REGEX | v5.0.0-15.2.2 | Operator-supplied regexes: RE2 or a time limit was a Phase 0 carry (H16) | Confirm or build; a DoS entry in the threat model | 11 |

### 4.4 Keeping the checklist in the repository

- **One file per standard version:** `docs/security/asvs-5.0.0-l2.csv` (or YAML), one row per requirement id in the Level 2 set (253 rows), with the columns `id` (`v5.0.0-x.y.z`), `level`, `status` (`met`, `partial`, `gap`, `not_applicable`, `operator`), `evidence` (repository paths: a test, a contract test, a doc, a CI job), `notes` (our words), `threats` (the threat-model ids it mitigates), `reviewed_at` and `reviewed_commit`. `operator` marks what only the operator can meet (TLS certificates, a secrets manager, log shipping); the self-hosting guide lists those rows.
- **No requirement text committed** (licence, section 4.1). A fetch script pins the 5.0.0 flat JSON by SHA-256; a test checks that the CSV holds exactly the Level 2 ids of that export (no missing, no extra rows), so a new ASVS release is a deliberate migration (inference: the export's `L` field is the input).
- **Evidence is checked mechanically:** a test resolves every evidence path in the repository and fails on a dead link; a `met` row must cite at least one test or CI job; a `not_applicable` row must carry a reason. The same test can render a Markdown summary per chapter for the docs.
- **When it is reviewed:** at the end of every phase (with the threat model, section 3.4) and whenever a row's evidence file changes (a CODEOWNERS-style path list in the test's fixture); `reviewed_commit` makes stale rows visible.
- **MASVS for the Android SDK.** ASVS covers web applications and APIs; the mobile counterpart is OWASP MASVS, whose latest release on GitHub is **v2.1.0 (2024-01-18)**, the release that added the `MASVS-PRIVACY` group [V6]. A short MASVS v2.1.0 checklist for `openverify-sdk` and `openverify-nfc` (the storage, crypto, auth, network, platform, code, resilience and privacy groups; only `MASVS-PRIVACY` was re-read here, the other group names are to confirm against the release) belongs with Phase 10's release, kept in the same format (proposed).

## 5. Security scanning, SBOMs, signing and provenance

### 5.1 Tools, licences and versions

Rule 4 applies to tooling (section 0). Versions come from each project's GitHub releases (`published_at`, UTC) or registry; licences from the LICENSE file at the tag named. "Passes" means released on or before 2026-10-15.

| Tool | Licence (file read) | Verdict | Latest | Newest that passes | What it covers here |
|---|---|---|---|---|---|
| Trivy (aquasecurity/trivy) | Apache-2.0 (`LICENSE` at `v0.76.0`) | ✅ | v0.76.1, 2026-10-21 | **v0.76.0, 2026-10-14** | Targets: container images, filesystems, remote git repositories, VM images, Kubernetes; scanners: packages and dependencies (SBOM), known CVEs, IaC misconfiguration (Helm charts included, per its advisories), secrets, licences [K1][K2] |
| osv-scanner (google/osv-scanner) | Apache-2.0 (`LICENSE` at `v2.7.0`) | ✅ | **v2.7.0, 2026-10-12** (also passes) | v2.7.0 | Lockfiles against OSV.dev: `pnpm-lock.yaml`, `uv.lock`, `gradle.lockfile`, `gradle/verification-metadata.xml` among others; container images; licence scanning [K3][K4] |
| Grype (anchore/grype) | Apache-2.0 (`LICENSE` at `v0.120.1`) | ✅ | v0.121.0, 2026-10-19 | **v0.120.1, 2026-10-06** | Vulnerabilities in container images, filesystems and SBOMs; OpenVEX filtering [K5] |
| Syft (anchore/syft) | Apache-2.0 (`LICENSE` at `v1.54.1`) | ✅ | v1.55.0, 2026-10-19 | **v1.54.1, 2026-10-06** | SBOMs of images and directories, output as CycloneDX, SPDX or Syft JSON, with conversion between formats [K5] |
| zizmor (zizmorcore/zizmor; also on PyPI) | MIT (`LICENSE` at `v1.31.0`) | ✅ | v1.31.1, 2026-10-15T23:16Z (PyPI upload 23:12Z) | **v1.31.1 by date**; v1.31.0 (2026-10-15T04:04Z) if uv counts the 14 days to the minute, since 1.31.1 turns 14 days old only late on 2026-10-29 | 41 audits of GitHub Actions workflows, among them `template-injection`, `excessive-permissions`, `unpinned-uses`, `unpinned-images`, `artipacked` (credentials persisted by checkout), `cache-poisoning`, `dangerous-triggers`, `known-vulnerable-actions`, `impostor-commit`, `ref-version-mismatch`, `secrets-inherit` [K6][K7] |
| Semgrep Community Edition engine (semgrep/semgrep) | **LGPL-2.1** (`LICENSE` at `v1.181.0`) | ❌ | v1.182.0, 2026-10-20 | v1.181.0, 2026-10-14 | — LGPL fails even as tooling |
| Semgrep registry rules (semgrep/semgrep-rules) | **Semgrep Rules License v1.0**: internal business use only, no redistribution, no offering as a service, patent termination clause [K8] | ❌ | — | — | Source-available terms, not an open licence |
| Opengrep (opengrep/opengrep, the community fork) | **LGPL-2.1** (`LICENSE` at `v1.31.0`) | ❌ | v1.33.1, 2026-10-29 | v1.31.0, 2026-10-15 | — fails for the same reason |
| CodeQL CLI and Action | **GitHub CodeQL Terms and Conditions** (proprietary, per user): analysis is licensed only for academic research, demonstrations, testing OSI-licensed queries, and "Open Source Codebases" (released under an OSI licence), with CI use only for open-source codebases hosted on GitHub.com [K9]. The queries (github/codeql) are MIT [K10]. GitHub sells code scanning for private repositories as **GitHub Code Security**, on Team or Enterprise plans [K11] | ⚠️ optional only | Action v4.39.1 and bundle 2.27.3, 2026-10-20/21 | Action v4.39.0, 2026-10-15 | JavaScript/TypeScript, Python, Kotlin/Java data-flow queries. **Not usable on the private `hnalpha323/openverify` without a paid Code Security licence**; usable if the repository becomes public. Never a required gate |
| gitleaks (in use) | MIT (`LICENSE` at `v8.30.1`) | ✅ | **v8.30.1, 2026-03-21** (pinned; also the newest) | v8.30.1 | Secrets in staged changes and full history [R14][K12] |
| pnpm audit (pnpm 12.14.0 [R29], MIT) | (pnpm itself) | ✅ | — | — | Queries the registry's bulk advisory endpoint; advisories are identified by GHSA id, without CVE ids; `audit.ignore` and `--audit-level`; **`pnpm audit signatures`** verifies registry ECDSA signatures of installed packages against the lockfile's integrity [K13] |
| pip-audit (pypa/pip-audit) | Apache-2.0 (`LICENSE` at `v2.10.1`) | ✅ | **2.10.1, 2026-06-10** (also passes) | 2.10.1 | Local environments and requirements files against the PyPI and OSV vulnerability services, with `--no-deps`, `--disable-pip` and `--require-hashes`; it can emit CycloneDX SBOMs; run on `uv export --format requirements-txt` output [K14] |
| `uv audit` (uv 0.13.3, pinned) | (uv itself) | ✅ | — | — | Exists, but every changelog entry through 0.12.24 lists it under **preview features** and 0.13.x stabilises nothing about it, so it is a preview command in the pinned uv (inference from the changelogs) [K15]. Prefer pip-audit or osv-scanner on `uv.lock` until it is stable |
| OWASP ZAP (zaproxy/zaproxy) | Apache-2.0 (`LICENSE` at `v2.17.0`) | ✅ | **v2.17.0, 2025-12-15** (weekly builds are pre-releases) | v2.17.0 | Dynamic scan: the Docker image's API scan imports an OpenAPI definition from a file or URL and runs an active scan tuned for APIs, plus a baseline (passive) scan for the flow and console [K16][K17] |
| CycloneDX specification | Apache-2.0 (`LICENSE` at `1.7.2`) | ✅ | 1.7.2, 2026-09-17 (1.7 itself 2025-10-21) | 1.7.2 | SBOM format [K18] |
| cdxgen (`@cyclonedx/cdxgen`, repository now cdxgen/cdxgen) | Apache-2.0 (npm metadata; `LICENSE` at `v12.8.6`) | ✅ | 12.9.0, 2026-10-22 | **12.8.6, 2026-10-14** | CycloneDX SBOMs from source; declares `pnpm >= 10` among its engines [K19] |
| CycloneDX Gradle plugin (`org.cyclonedx.bom`) | Apache-2.0 (`LICENSE` at `cyclonedx-gradle-plugin-3.5.1`) | ✅ | **3.5.1, 2026-10-09** (also passes) | 3.5.1 | SBOM of the Android SDK and NFC module's resolved dependencies [K20] |
| SPDX specification | (not re-read) | — | 3.0.1, 2024-12-17 (3.1-RC1 pre-release 2026-01-24) | 3.0.1 | The other SBOM format; Syft writes it [K21] |
| cosign (sigstore/cosign) | Apache-2.0 (`LICENSE` at `v3.1.3`) | ✅ | v3.1.4, 2026-10-20 | **v3.1.3, 2026-08-06** (the 2.x line: v2.6.5, 2026-08-06) | Signing images, SBOMs and attestations, keyless through OIDC or with a key [K22] |
| SLSA | (a specification) | — | **v1.2, status Approved** (`/spec/latest` redirects to v1.2): Build and Source tracks, provenance format [K23] | — | Provenance levels |
| actions/attest-build-provenance | MIT (`LICENSE` at `v4.2.2`) | ✅ code; ⚠️ service | v4.2.2, 2026-08-06 | v4.2.2 | GitHub artifact attestations. On Free, Pro and Team plans they work **only for public repositories**; private repositories need GitHub Enterprise Cloud [K24][K25] |
| slsa-framework/slsa-github-generator | Apache-2.0 (`LICENSE` at `v2.1.0`) | ✅ | v2.1.0, 2025-02-24 | v2.1.0 | SLSA Build L3 provenance from reusable workflows (inference about the level from the project's purpose; not re-read) [K26] |
| Dependabot alerts | GitHub service | ⚠️ optional | — | — | Included in every plan for user- and organisation-owned repositories, private ones included; dependency review and premium Dependabot features belong to Code Security [K11][K27] |

### 5.2 The 2026 Trivy compromise, and what it teaches this repository

GitHub advisory **GHSA-69fq-xp46-6x23 / CVE-2026-33634** (critical, 2026-03-21) [K2]: on 2026-03-19 a threat actor with compromised credentials published a malicious Trivy **v0.69.4** release, force-pushed **76 of 77** version tags of `aquasecurity/trivy-action` and all **7** tags of `aquasecurity/setup-trivy` to credential-stealing code, and on 2026-03-22 pushed malicious **v0.69.5 and v0.69.6** images to Docker Hub. The advisory lists who was not affected: users of v0.69.3 or earlier (v0.69.3 was protected by GitHub's immutable releases, enabled on March 3), users who referenced images **by digest**, and users who built from source. Fixed ranges: the action from 0.35.0, setup-trivy from 0.2.6. Later Trivy advisories also matter for a scanner run in CI on pull requests: a Helm chart tar bomb (fixed in 0.71.0), path traversal through a crafted database or OCI artifact (fixed in 0.71.1) and through the plugin manager (fixed in 0.72.0) [K2].

**Rules that follow (proposed):**
- No third-party scanner **action**: install each scanner binary by version and SHA-256, as `infra/scripts/install-gitleaks.sh` already does, and also verify its Sigstore signature or GitHub attestation where the project publishes one (Trivy's advisory itself points to Sigstore signatures to verify v0.69.2, which predates its immutable releases).
- Images by **digest**, everywhere a scanner or base image is pulled (today the Dockerfiles pin tags only, section 2).
- Scanners run with read-only tokens, no secrets, and a memory limit, on pull requests from forks too (the tar-bomb advisory's workaround).
- zizmor's `unpinned-uses`, `unpinned-images`, `impostor-commit` and `ref-version-mismatch` audits turn these rules into a CI gate.

### 5.3 What to run, where (proposed)

| Job | Tool and input | Gate |
|---|---|---|
| `deps` (every push and PR) | osv-scanner on `pnpm-lock.yaml` and `services/vision/uv.lock`; `pnpm audit --audit-level high` and `pnpm audit signatures`; pip-audit on the exported vision requirements | Fail on high and critical with a fix available, after an allowlist file whose entries carry an expiry date and a reason (V15.1.1 time frames) |
| `android-deps` | Gradle dependency locking (`gradle.lockfile`) or the CycloneDX Gradle plugin's SBOM, then osv-scanner or Grype | The SDK has neither a lockfile nor `verification-metadata.xml` today (section 2), so osv-scanner cannot see its resolved tree; adopt dependency locking, and consider Gradle dependency verification |
| `workflows` | zizmor (pinned binary or a uv tool pinned by hash) on `.github/workflows/` and `.github/actions/` | Fail on any finding at medium or above; actionlint already runs |
| `images` (on image builds) | Trivy `image` and Grype on each built image, Syft for the SBOM | Fail on critical with a fix; report high |
| `iac` | Trivy `config` on `infra/` and the chart | Fail on high |
| `secrets` (in use) | gitleaks, full history | as today |
| `pii` (new, H15) | gitleaks with a second config of custom rules over `fixtures/`, `docs/`, `e2e/`: email addresses outside `example.com`/`.org`/`.net`, IPv4 and IPv6 addresses outside the documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32), MRZ-shaped lines whose names are not the synthetic generator's | Fail, with a reviewed allowlist (inference: gitleaks' custom rules are regular expressions over content; PII detection by pattern is approximate) |
| `dast` (nightly and before a release) | ZAP API scan against the e2e stack's `/openapi.json` with a sandbox API key, plus a baseline scan of the flow and console | Report; fail on high. Never against a production install |
| `sast` | ESLint with the existing type-aware rules plus `eslint-plugin-security` 4.2.0 (Apache-2.0, 2026-10-01 [K28]); ruff's `S` (bandit) rules, already selected in `services/vision/pyproject.toml` [R29]; Android lint; CodeQL only if the repository becomes public | Fail on errors |

`eslint-plugin-no-unsanitized` (Mozilla) is **MPL-2.0** [K28]: allowed only as unmodified dev tooling and listed in `THIRD_PARTY_LICENSES.md` §5 if adopted (⚠️). Static regexes are already checked for super-linear backtracking (`packages/config/eslint/phase5-rules.js`); operator-supplied regexes are not (H16).

### 5.4 SBOMs, signing and provenance (proposed)

- **What gets an SBOM:** each published image (Syft, CycloneDX 1.7 JSON), the npm packages (`@openverify/node` and the browser SDK when it exists; cdxgen from source), the Android AAR and the NFC AAR (the CycloneDX Gradle plugin), and the vision service's environment. Attach them to the release; V15.1.2 is the requirement [V2].
- **Signing:** cosign v3.1.3 signs images and attaches SBOMs as attestations. **Keyless signing** binds the signature to the CI workflow's OIDC identity and records it in Sigstore's public Rekor transparency log, an immutable ledger anyone can query [K29]; from a private repository that publishes the repository and workflow identity (inference from how Rekor and short-lived certificates work; the Sigstore FAQ was not read). While the repository is private, either sign with a key held in a secrets manager or accept that disclosure (an owner decision, section 11).
- **Provenance:** SLSA v1.2's Build track [K23]. GitHub artifact attestations are the shortest path but need a public repository or Enterprise Cloud [K25]; otherwise `slsa-github-generator` v2.1.0's reusable workflows (Apache-2.0) [K26], which also publish to Rekor (inference).
- **Operator side:** the self-hosting guide shows `cosign verify` with the expected identity, and the chart's values can name a policy controller (out of scope to ship).
- **Release-age note:** the repository pins uv **0.13.3**, released **2026-10-20** [K15], in CI and in the vision Dockerfile; it was added on 2026-10-20 (`git log`), the day of its release. The release-age rule as written covers pnpm and uv packages, and the task extends it to Gradle by convention; whether toolchain binaries and base images fall under it should be written down (an owner question, section 11).

### 5.5 Dynamic testing scope

ZAP's API scan reads the generated OpenAPI 3.1 document [R20] and actively scans the routes it lists [K17]. What it will not find: cross-tenant authorisation (B3-I1) unless given two tenants' keys and a script, business-logic flaws, and anything behind the flow's session or the console's MFA without a scripted login (inference from the API scan's design). The ASVS evidence for V8 must therefore come from the API's own tests, with ZAP as a regression net for headers, errors and injection.

## 6. Load testing

### 6.1 k6 fails rule 4

**k6 is AGPL-3.0**: `LICENSE.md` at tag `v2.3.0` is the GNU Affero General Public License version 3 [L1]. Rule 4 fails AGPL even as unmodified tooling, so PLAN §6's "k6 load test" cannot stand. Its current releases are v2.3.0 (2026-09-21) and, on the 1.x line, v1.8.2 (2026-10-12) [L2]. **PLAN §6 Phase 11 and §3 must be amended** (section 10).

### 6.2 Alternatives

| Tool | Licence (file read) | Verdict | Latest | Newest that passes | Model and fit |
|---|---|---|---|---|---|
| Locust | MIT (`LICENSE` at `2.46.7`; PyPI classifier MIT) | ✅ | 2.47.0, 2026-10-21 | **2.46.7, 2026-10-04** | Python scenarios (requires Python ≥ 3.11), distributed workers; wait-time helpers `constant_throughput`, `constant_pacing` and `poisson` approximate an arrival rate per user [L3][L4]. Fits multi-step scenarios (create inquiry, open the flow session, upload, submit, wait for the webhook) and lives beside the vision service under uv with a lockfile and the release-age rule |
| vegeta | MIT (`LICENSE` at `v12.13.0`) | ✅ | **v12.13.0, 2025-10-31** (also passes) | v12.13.0 | Go binary; drives a **constant request rate** and its README says it avoids coordinated omission [L5]. Fits per-route p95 at a fixed rate (an open model) |
| oha | MIT (`LICENSE` at `v1.16.0`) | ✅ | **v1.16.0, 2026-08-23** (also passes) | v1.16.0 | Rust binary; a QPS limit with an optional latency correction for coordinated omission [L6]. A quick check of one route |
| autocannon | MIT (`LICENSE` at its 8.0.0 commit) | ✅ | **8.0.0, 2024-10-14** (also passes) | 8.0.0 | Node, HTTP/1.1 with pipelining, overall and per-connection rate limits [L7]. Last release two years ago: a maintenance risk |
| Gatling | Apache-2.0 (`LICENSE.txt` at `v3.16.0`) | ✅ | **v3.16.0, 2026-09-29** (GitHub release; also passes) | v3.16.0 | JVM with Java, Kotlin or Scala scenarios, open and closed injection profiles (inference: not re-read). Brings a JVM toolchain to the load test only; its enterprise edition is commercial and not needed [L8] |
| Artillery | **MPL-2.0** (`LICENSE.txt` at the 2.0.34 commit `5bcfa94c`) | ⚠️ unmodified dev tooling only, listed in §5 | **2.0.34, 2026-08-14** (also passes) | 2.0.34 | YAML scenarios; Node ≥ 22.18.0; 93 direct dependencies including cloud SDKs and Playwright; **telemetry on by default**, disabled with `ARTILLERY_DISABLE_TELEMETRY=true` [L9][L10] |
| k6 | AGPL-3.0 | ❌ | v2.3.0 / v1.8.2 | — | Excluded |

**Recommendation:** **Locust 2.46.7** for scenarios and worker throughput (pinned through uv in its own `load/` project, so it never enters the vision image), and **vegeta v12.13.0** (binary pinned by SHA-256 like gitleaks) for open-model per-route latency. Both are MIT. Record k6 in `THIRD_PARTY_LICENSES.md`'s excluded list.

### 6.3 Method (proposed)

- **Where:** a fixed reference machine or one named cloud instance size, never shared CI runners (the repository already logs CI benchmarks without gating them, for the same reason [R18]). Each report records the CPU model, core count, memory, disk class, load average before and after, the commit and the image digests.
- **Data:** a seeded environment from synthetic generators only (rule 3): N accounts and inquiries, the shipped variant groups, a 100,000- and a 2,000,000-name sanctions table as the Phase 6 calibration builds them [R25].
- **Shape:** an open model (constant arrival rate) for latency, so slow answers do not reduce the offered load (vegeta, Locust with `constant_throughput` or `poisson`); a step-up to find the knee; a 30-minute soak for leaks and queue growth. Three takes, the median of the take p95s as the headline, as the Phase 6 calibration does [R25].
- **Server-side truth:** p95 from the client and from the API's own timings (pino response times), plus `pg_stat_statements` for the top statements and BullMQ queue depth and lag.

### 6.4 What to measure, with a budget each (proposed, ours; to be ratified by the owner)

| Measurement | Budget | Basis |
|---|---|---|
| API reads (`GET /inquiries/{id}`, `GET /accounts/{id}`, list pages of 25) at 100 requests/s | p95 ≤ 150 ms, errors < 0.1% | Ours; typical for indexed reads (inference) |
| API writes (`POST /inquiries`, `PATCH`, tags, approve and decline) at 50 requests/s | p95 ≤ 300 ms | Ours; each write stages an event and deliveries in the same transaction [R31] |
| Flow file upload (1–3 MB image, encrypted, stored) at 10 uploads/s | p95 ≤ 1.5 s | Ours; AES-GCM plus one S3 `PUT` |
| Console login (Argon2id 19 MiB, t=2) at 5 logins/s | p95 ≤ 500 ms; memory per concurrent hash recorded | Ours; Argon2id is deliberately costly, and 19 MiB per hash bounds concurrency [R10] |
| Verification processing, submit to decision, per worker process at `OPENVERIFY_WORKER_CONCURRENCY=4` with one vision instance (two children) | Throughput reported; p95 per analysis within the existing budgets: government ID 5 s, selfie 3 s, document 4 s | The vision budgets of C32.4, C41.5 and C60 [R18] |
| Event to first webhook attempt | p95 ≤ 5 s at 50 events/s | Ours; the dispatcher enqueues after commit and sweeps overdue deliveries after 60 s [R31] |
| Screening (one report run, retrieval plus scoring) | **p95 ≤ 100 ms at 100,000 list names, ≤ 250 ms at 2,000,000** (C78.7); measured 109.5 ms and 399.4 ms on the development machine, both still over budget | Phase 6 calibration [R25] |
| Screenings per hour per worker process | Reported at concurrency 1 and 4 at both scales; proposed floor **10,000 per hour per process at 2,000,000 names** | Ours: a serial worker at the measured 399.4 ms p95 would still do about 9,000 an hour, and the mean is lower (inference) |
| Re-screen after a list update (200,000 subjects, 1,000 added entries) | Target 60 s; measured 91.0 s | Phase 6 decision 3 [R22] |
| Per-tenant fairness (H1) | With one environment flooding reports, another environment's report p95 stays within 2× its idle p95 | Ours; the acceptance test of the per-tenant quota |
| Workflow engine steps (once Phase 8 lands) | Reported; Phase 8 measured 1,577 effectful steps/s at 32 clients | [R31] §2.4 |
| Soak (30 minutes at 70% of the knee) | No memory growth over 10% after warm-up; queue lag returns to zero | Ours |

**What it does not show:** results from one machine carry ratios, not absolute numbers, to other hardware; a passing load test says nothing about correctness under failure (Valkey down, a Postgres failover), which needs its own chaos cases (inference).

## 7. Deployment: a Helm chart

### 7.1 Before a chart: production images (H7)

The compose `app` profile runs one development image for the API, worker, migrate, flow and dashboard; it keeps dev dependencies because `db:migrate` and the other operator commands run TypeScript through `tsx`, and the flow is served by `vite preview`, which sends no security headers [R16][R17][R21]. A chart that points at that image would ship dev tooling to production (ASVS V15.2.3). **Proposed images** (each non-root, read-only root filesystem, base image pinned **by digest**, an SBOM and a signature per section 5.4):

| Image | Contents | Command |
|---|---|---|
| `openverify/api` | Built `apps/api` with production dependencies only; compiled entry points for the server, the worker and every operator command (`db:migrate`, `retention:run`, `kek:rewrap`, `blind-index:rebuild`, `user:reset-mfa`, `watchlists:sync`, `pep:sync`, `trust-anchors:sync`) instead of `tsx` | `node apps/api/dist/server.js`, `…/worker.js`, `…/<command>.js` |
| `openverify/dashboard` | Next.js standalone output plus `server.ts` compiled | `node server.js` |
| `openverify/flow` | The built bundle behind a small static server that sends the CSP as a header, `frame-ancestors` from the allowed domains, `Permissions-Policy: camera=(self)`, `Referrer-Policy` and HSTS (H6), with the YuNet model and onnxruntime-web's WASM | a static server |
| `openverify/vision` | As today (multi-stage, uid 10001), base pinned by digest | as today |
| `openverify/code-runner` | Phase 8's isolated Evaluate Code runner (P17) | as Phase 8 defines |

**Model weights** are never committed (rule 4). Two options for the cluster: an init container that runs `fetch_models.py` with its pinned SHA-256 digests into an `emptyDir` (needs egress to the model hosts at start), or a volume the operator fills once. Baking the weights into a published image redistributes them; their licences allow it, but SFace's upstream licence review is still open (H17), so that is an owner decision (section 11).

**Published images and the base OS.** `THIRD_PARTY_LICENSES.md` notes that the images it lists are only pulled, never redistributed [R19]. Publishing OpenVerify's own images redistributes their Debian base packages, some under the GPL. That is ordinary aggregation, but it brings the base distribution's source-availability duties with it (inference, not legal advice); the release notes should point at the distribution's source archive for the exact base digest.

### 7.2 Chart structure (proposed)

```
deploy/helm/openverify/
  Chart.yaml            apiVersion v2; kubeVersion ">=1.35.0-0"; appVersion = release
  values.yaml           every default commented; no secret values
  values.schema.json    JSON Schema for the values (Helm's schema validation; not re-read here)
  templates/
    _helpers.tpl        names, labels, the shared securityContext
    api/                Deployment, Service, HPA, PDB, ServiceAccount
    worker/             Deployment (+ the code-runner sidecar and its socket volume, P17), PDB
    vision/             Deployment, Service, NetworkPolicy, PDB
    flow/  dashboard/   Deployment, Service, HPA
    migrate-job.yaml    pre-install and pre-upgrade hook (or a versioned Job for GitOps)
    networkpolicies.yaml default deny, then one allow list per component
    ingress.yaml        or Gateway API HTTPRoutes; HSTS and size limits
    configmap.yaml      non-secret settings
  tests/                helm-unittest suites
  ci/                   values files that chart-testing installs on kind
```

**Values (the shape, ours):**
- `image.{registry,tag,digest}` per component, digest preferred; `imagePullSecrets`.
- `external.postgres.{existingSecret,key}` for `DATABASE_URL` with `sslmode=verify-full` encouraged; a separate `external.postgres.migrationSecret` for the migration role (B7-E1).
- `external.valkey.{existingSecret}` for `REDIS_URL`, `rediss://` encouraged; per-process ACL users optional (B8-S1).
- `external.s3.{endpoint,region,bucket,forcePathStyle,existingSecret}`; `external.smtp.{existingSecret}` for `OPENVERIFY_SMTP_URL`.
- `secrets.<process>.existingSecret`: one Secret per process holding only what that process reads, following compose's split of provider settings per process (C63) [R16]: the KEK, its previous keys, the blind-index key and the vision token for the API and worker; the pepper for the API; the KEK for `migrate` (its event backfill) and the pepper when it seeds; nothing secret for the flow; the BFF token for the dashboard and the API. The chart creates no Secret by default; an `externalSecrets` example is documented only (G-SECRETS).
- `api.trustProxy`, `dashboard.trustedProxyHops`, `flow.allowedFrameAncestors` (from Phase 9's allowed domains), `ingress.hsts`, `ingress.maxBodySize`.
- `replicaCount`, `resources`, `autoscaling`, `podDisruptionBudget`, `topologySpreadConstraints`, `priorityClassName` per component.
- `networkPolicy.enabled` (default true) with `networkPolicy.egress.{webhooks,providers,listSyncs}` CIDR lists; `0.0.0.0/0` minus private ranges is the documented default for webhooks, because their receivers are public (inference).

**The migrate job.** `db:migrate` applies the Drizzle migrations and then backfills event object ids, which needs the KEK [R1] (CLAUDE.md commands). No advisory lock was found in `packages/db/src/migrate.ts`, so two concurrent runs (two releases, a retried hook, a GitOps tool that applies twice) are not serialised by the code (inference from the file read). **Proposed:** a session advisory lock around the run; the job as a `pre-install,pre-upgrade` hook with `hook-delete-policy: before-hook-creation,hook-succeeded`, `backoffLimit: 1`, an `activeDeadlineSeconds`; the migration role owns DDL and runs `CREATE EXTENSION IF NOT EXISTS vector` (the repository's convention), while the runtime role cannot create objects. On managed Postgres, creating an extension may need the provider's admin role, so the guide gives that one-time step.

**Probes.** The API has `/health` (liveness) only [R20]; the worker has no HTTP endpoint, and both handle SIGTERM (`server.ts` drains in-flight requests; the worker stops on SIGTERM) [`apps/api/src/server.ts`, `worker.ts`]. **Proposed:** a `/ready` route that checks Postgres and Valkey with short timeouts (readiness, never liveness, so a database blip does not restart every pod); a worker health signal (a tiny listener or a heartbeat file for an exec probe); `terminationGracePeriodSeconds` longer than the longest in-flight job, since fenced claims and lease expiry recover anything cut short (Phase 6 C74.1) [R22].

**Pod security.** Every pod meets the **restricted** Pod Security Standard: `runAsNonRoot: true`, a non-zero `runAsUser`, `allowPrivilegeEscalation: false`, capabilities dropped to none, `seccompProfile: RuntimeDefault`, and only the allowed volume types (`configMap`, `csi`, `downwardAPI`, `emptyDir`, `ephemeral`, `persistentVolumeClaim`, `projected`, `secret`) [D1]. Beyond the standard: `readOnlyRootFilesystem: true` with an `emptyDir` `/tmp` (vision already runs so [R16]), `automountServiceAccountToken: false`, and the namespace labelled `pod-security.kubernetes.io/enforce: restricted`.

**Network policies.** Network policies take effect only with a network plugin that implements them; without one, the objects do nothing [D2]. The API has no TLS features and cannot force traffic through a gateway [D2], so TLS stays the application's or a mesh's job (G-TLS). **Proposed:** default deny in both directions; DNS to the cluster resolver; vision accepts only the API and worker and has **no egress** (C60.2, H9); the code runner has no egress (P17, H8); Postgres, Valkey and S3 egress only from the processes that use them (the flow and dashboard never reach the data stores; the dashboard reaches only the API); the API and worker egress to the public internet for webhooks and providers, private ranges excluded, as the SSRF guard's second layer (B10-I1).

**Horizontal scaling.**
- **API and dashboard:** stateless behind the ingress, so an HPA on CPU works, **except** the login limiter, whose windows live in each process's memory (G-LOGIN): with three replicas an attacker gets three times the attempts until it moves to Valkey.
- **Workers:** scale on queue depth rather than CPU (KEDA can read a list length; whether its Redis scaler reads BullMQ's keys correctly is not documented here: inference to test). Each worker's `OPENVERIFY_WORKER_CONCURRENCY` (default 4) times replicas must stay within vision's capacity (two guarded children per vision pod, 4 GiB) [R16].
- **Repeatable jobs:** BullMQ job schedulers are upserted by every worker and the sweeps take rows with `FOR UPDATE SKIP LOCKED`, so several replicas are safe [R31] §1.
- **Connections:** each replica's pool times replicas must fit Postgres `max_connections`; a transaction-mode pooler breaks session state such as session advisory locks (inference), so size pools first.

### 7.3 Chart testing

| Tool | Licence (file read) | Verdict | Latest | Newest that passes | Use |
|---|---|---|---|---|---|
| Helm | Apache-2.0 (`LICENSE` at `v4.3.1`) | ✅ | **v4.3.1, 2026-10-15T01:08Z** and **v3.22.1, 2026-10-15T17:02Z** (both pass by date) | v4.3.1 / v3.22.1 | Helm 4.3.x supports Kubernetes 1.37 to 1.34; Helm 4 assumes compatibility with n−3 minor versions of the client it was built with [D3][D4]. Test the chart on both 4.3 and 3.22 while operators move |
| chart-testing (`ct`) | Apache-2.0 (`LICENSE` at `v3.15.0`) | ✅ | **v3.15.0, 2026-10-06** | v3.15.0 | Lint, version-bump check and install on a kind cluster [D5] |
| kubeconform | Apache-2.0 (`LICENSE` at `v0.8.0`) | ✅ | **v0.8.0, 2026-06-04** | v0.8.0 | Validates rendered manifests against the Kubernetes schemas of each supported minor, offline with pinned schemas [D5] |
| helm-unittest | MIT (`LICENSE` at `v1.2.1`) | ✅ | **v1.2.1, 2026-10-03** | v1.2.1 | Template unit tests: every pod restricted, vision without egress, secrets split per process, no default Secret, the hook annotations [D5] |
| Trivy `config` | Apache-2.0 | ✅ | v0.76.0 | v0.76.0 | Misconfiguration rules for the rendered chart (section 5) |

**Supported Kubernetes:** the project maintains 1.37, 1.36 and 1.35, ending 2027-10-28, 2027-06-28 and 2027-02-28; **1.34 reached end of life on 2026-10-27** [D6]. A `kubeVersion: ">=1.35.0-0"` constraint and kubeconform runs on 1.35, 1.36 and 1.37 match that.

### 7.4 What an operator must provide

| Dependency | Requirement | Notes |
|---|---|---|
| PostgreSQL 17 with pgvector | The extension available to the migration role; TLS; backups (section 8.1); `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0`, which compose sets so that screened names never reach the logs (C73.8) [R16] | Managed services offering pgvector, or an operator such as CloudNativePG (not evaluated here). **Do not depend on Bitnami's charts or images**: Bitnami's README now promotes its Photon-based "Secure Images" (some metadata only with a commercial subscription) and sends users of the previous Debian images to a separate legacy registry [D7] |
| A Redis-protocol store | Valkey 9.x as in development (BSD-3-Clause [R19]); persistence on (AOF); `maxmemory-policy noeviction` (Phase 8 research decision 17 [R31]); a password or ACL users; TLS across hosts | The Valkey project's own chart, `valkey-io/valkey-helm`, carries a BSD-3-Clause `LICENSE` (read on `main`, no release pinned) [D8] |
| S3-compatible storage | A bucket with versioning; credentials allowed `s3:ListBucketVersions` and `s3:DeleteObjectVersion` besides get and put, because redaction deletes every version [`apps/api/src/storage/index.ts`]; public access blocked | RustFS in development (Apache-2.0); any S3 API store; object lock or replication must be reconciled with redaction (section 8.2) |
| SMTP relay | `OPENVERIFY_SMTP_URL` and `OPENVERIFY_MAIL_FROM`; TLS | Invitations and email OTP |
| SMS provider (optional) | Twilio credentials, bound per environment | Phone OTP; sandbox needs none |
| TLS and an ingress | Certificates for the API, flow and console hosts; HSTS (G-HSTS); body-size limits matching the upload limits | |
| A NetworkPolicy-capable network plugin | Otherwise section 7.2's policies do nothing [D2] | |
| Secrets | One Secret per process, or an external secrets manager | The KEK kept apart from database backups |
| Observability | Log shipping to a separate store; metrics; alerts on queue lag, the rate limiter failing open, report run errors, sync failures | G-LOGINV |
| Model weights | Fetched with `fetch_models.py` (pinned SHA-256) into a volume, or the init-container option | Section 7.1 |

## 8. The documentation set

Four documents PLAN §10 requires besides the API reference (which `docs/api/openapi.json` already is) [R1]. Each should be generated where the repository holds the facts, so it cannot drift: the configuration reference from the configuration reader, the check catalog from the registries, the API mapping from the OpenAPI document and the surface index.

### 8.1 Self-hosting guide (`docs/self-hosting/`)

| Part | Content (proposed) | Basis |
|---|---|---|
| Architecture and components | The processes (API, worker, migrate, vision, flow, dashboard, code runner), what each talks to, the trust boundaries of section 3 | PLAN §3 [R1], compose [R16] |
| Two install paths | One host with Docker Compose (the `app` profile once production images exist) and Kubernetes with the chart (section 7) | H7 |
| What you must provide | Section 7.4's table | — |
| Configuration reference | **Generated** from `apps/api/src/config.ts` (every `OPENVERIFY_*` variable, its default, whether it is a secret, which process reads it), so a doc test fails when a variable is added without a description. Production refuses placeholder secrets already [`config.ts`] | `config.ts` |
| Sizing (starting points, to be replaced by the load test's figures) | Vision: 4 GiB and two guarded children per pod, as compose sets [R16]; worker concurrency 4 per process; Postgres memory and disk for the sanctions tables at 100,000 and 2,000,000 names (from the Phase 6 calibration) and for face templates; Valkey memory for queue depth with `noeviction`; S3 growth per verification (images and PDFs) times the retention window | Section 6.4 |
| Secrets and key rotation | **KEK:** move the current key to `OPENVERIFY_KEK_PREVIOUS`, set a new `OPENVERIFY_KEK`, roll the processes, run `kek:rewrap`, then remove the old key once the command reports nothing left [R5] (CLAUDE.md). **Blind-index key:** change it, then `blind-index:rebuild` [R7]. **Webhook secrets:** `POST /webhooks/{id}/rotate-secret` with dual signing during the overlap [R20][R27]. **API keys:** expiry, `clone` and `expire` [R20]. **API-key pepper:** no rotation path exists; changing it invalidates every key (gap, section 2). **Vision token, BFF token, database, Valkey and S3 credentials:** rolling restarts; state the order. **TOTP secrets and recovery codes:** per user, through the console | Section 2 |
| Backups and restore | Postgres: physical base backups plus WAL archiving for point-in-time recovery in production, `pg_dump` for small installs [P3]; **the KEK and the blind-index key backed up separately from the data**, because a backup without them cannot be read and a backup stored with them is plaintext in effect; S3: versioning and replication per the provider; **a restore drill** with a checklist (restore, `db:migrate` no-ops, a sealed value opens, a file downloads). **Redaction and backups:** redacted data survives in backups until they expire, so the backup retention window is the real erasure delay and the compliance guide must state it (inference; the operator decides the window) | [P3]; storage deletes all versions [`apps/api/src/storage/index.ts`] |
| Upgrades and migrations | Read the release notes; take a backup; `db:migrate` runs once per release (the chart's hook); migrations are forward-only, so a rollback means restoring the backup; Postgres major upgrades with `pg_upgrade`, installing extension shared objects (pgvector) in the new cluster first, as the PostgreSQL docs require for every extension with a shared library [P4]; then `ALTER EXTENSION vector UPDATE` where pgvector's own notes say so (not re-read). PostgreSQL 17 (17.11 current) is supported until **2029-11-08**; 18 is current (18.6) [P5] | [P4][P5] |
| Database settings | Runtime role without DDL rights; migration role with them (B7-E1). Per-role defaults with `ALTER ROLE … SET`, which become each new session's default [P2]: `statement_timeout`, `idle_in_transaction_session_timeout`, and **`jit = off` for the application role**: JIT pays off for long CPU-bound (often analytical) queries and its compile cost can exceed the saving on short ones [P1]; retrieval already sets it locally and measured p95 falling from 74.4 to 18.9 ms at 100,000 names and from 878.8 to 35.9 ms at 2,000,000 [R22]. Setting it for the whole role is H10's open item and needs the load test's measurement first. Also `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0` (C73.8) [R16]; `pg_stat_statements` for the load test | [P1][P2][R22] |
| Valkey settings | AOF on; `maxmemory-policy noeviction`; ACL users per process; TLS across hosts | [R31] decision 17 |
| First-run checklist | Seed the organisation without `seed:dev`'s demo users in production (to confirm whether a production seed exists); sync the sanctions lists and watch the first EU and UN syncs and the first `pep:sync` (H21); fill the trust store (`trust-anchors:sync`); bind providers per environment; set retention | [R21] |
| Break-glass | `user:reset-mfa <email>` writes a system audit entry (H19); who may run it; how to audit afterwards | [R30] |
| Monitoring and alerts | Queue lag and depth; the rate limiter failing open (H18); report run errors; sync freshness; webhook failure rates; vision child crashes; certificate expiry | — |
| Hardening checklist | The ASVS rows with status `operator` (section 4.4), listed with how to meet each | Section 4 |

### 8.2 Compliance guide (`docs/compliance/`) — not legal advice

**Roles.** The operator who deploys OpenVerify decides why and how identity data is processed, so it is the controller; when it runs verification for its own clients it is also their processor and needs Article 28 terms with them (inference from the GDPR's definitions; counsel to confirm per deployment). The OpenVerify project receives no data and is neither (inference). The guide says what the software provides and what only the operator can do.

| Topic | What the software provides | What the operator must do | Sources |
|---|---|---|---|
| Biometric data as special-category data | A consent step first; biometric checks configurable per template; the shortest default retention for biometric data (PLAN §3) [R1] | Choose and document the Article 9 condition: under the UK GDPR, biometric data processed to uniquely identify a person is in Article 9(1), and explicit consent is condition 9(2)(a) [G1]; the EU text has the same structure (not re-read [G8]) | [G1] |
| DPIA | The threat model, the data classification (G-CLASS) and the check catalog as inputs | Carry out and keep the DPIA (Article 35 of the GDPR, not re-read) | — |
| Data subject requests | Erasure: redaction routes for accounts, inquiries and transactions, with `*.redacted` events and every S3 version removed [R20]; **access and portability: no export exists** (H14) | Answer within the time limit: in the UK, Article 12(3) now points at a new Article 12A for the "applicable time period" and covers requests under Articles 15 to 22D, the Data (Use and Access) Act 2025's numbering [G1][G2]; the EU's one month, extendable, is in Article 12(3) (not re-read [G8]); the Act also adds sections on time limits (s. 76) and on reasonable searches in response to requests (s. 78) [G2] | [G1][G2] |
| Automated decisions | Phase 8's decision record and `docs/compliance/automated-decisions.md` (H13) | The basis, the notice, a way to contest; the UK Act's section 80 is titled automated decision-making, and the UK GDPR's Article 12 now counts Articles 22A to 22D among the rights (inference that s. 80 inserts them) [G1][G2] | [R24][G2] |
| Illinois BIPA (740 ILCS 14) | Retention settings and scheduled redaction; consent capture; audit | A public written retention and destruction policy; a written release before collection; destruction when the purpose is met or within three years of the last interaction, whichever comes first; no sale; liquidated damages per violation, with the 2024 amendment (Public Act 103-0769) counting repeated collection by the same method as one violation. **Not re-read on 2026-10-29: the Illinois General Assembly's site failed TLS certificate verification, and the check was not bypassed** | [G3] (not re-read) |
| Washington (RCW 19.375) | Consent capture; retention settings | Notice, consent, **or** a mechanism to prevent subsequent commercial use before enrolling a biometric identifier for a commercial purpose (corrected in fact-check: RCW 19.375.020(1) lists the three as alternatives, and the exact notice and consent are "context-dependent"); limits on disclosure; reasonable care; retention no longer than reasonably necessary; enforced only by the attorney general under the Consumer Protection Act; financial institutions subject to Title V of the Gramm-Leach-Bliley Act are excluded. The definition **excludes photographs and data generated from them**, which leaves open whether a face template computed from a selfie is covered (a question for counsel) [G4] | [G4] |
| Texas (Bus. & Com. Code ch. 503) and other states | As above | Texas requires notice and consent before capture for a commercial purpose and destruction within a year of the purpose ending, with civil penalties enforced by the attorney general; Colorado amended its privacy act for biometric data in 2024. **Neither re-read here** (the Texas statutes site renders its text by script) | [G5] (not re-read) |
| California (CCPA as amended by the CPRA) | Retention, redaction, the decision record | Biometric information is sensitive personal information with a right to limit its use (Civil Code §1798.140 and §1798.121, not re-read); the CPPA's regulations on cybersecurity audits, risk assessments and automated decision-making technology took effect on **2026-01-01**: risk assessments from 2026-01-01 with attestations due 2028-04-01; ADMT duties for significant decisions from **2027-01-01**; audit certifications due 2028-04-01, 2029-04-01 or 2030-04-01 depending on revenue [G6] | [G6] |
| EU AI Act | — | Annex III's high-risk biometrics entry covers remote biometric identification but **excludes biometric verification whose sole purpose is to confirm that a person is who they claim to be** [G7], which describes 1:1 selfie-to-ID matching. One-to-many uses (selfie repeat detection across accounts, face lists) are a question for counsel (inference) | [G7] |
| Device and network data | Session integrity collected after consent (Phase 7) | The strictly-necessary assessment and its basis: WP29 9/2014 §7.5, CNIL délibération 2020-091 ¶49, UK PECR Sch. A1 para 4 from 2026-02-05 (H11, as Phase 7 recorded them) | [R23] |
| Third-party recipients | Every adapter is off until bound; GDELT needs an explicit acknowledgement; provider secrets split per process | List each recipient in the record of processing: Twilio (SMS, Lookup), registries, RDAP, GDELT, threat feeds, EVM RPC, webhooks to the operator's own systems (B10-I2) | [R16] |
| Licensed and public-sector data | Sanctions lists synced at run time and never shipped (ADR 0005); the UN list cannot be enabled in this release (H2); CSCA master lists operator-fetched (H20) | Accept each source's terms; the UN opt-in when it exists | [R3][R22] |
| Retention and backups | C16 retention jobs and `retention:run` | Set the windows; align backup retention with them (section 8.1) | — |
| Breach response | Audit logs, API logs, request ids | Notification duties (Article 33's 72 hours in the GDPR, not re-read; state laws) | — |

### 8.3 Check catalog (`docs/checks/catalog.md`)

`CHECK_REGISTRY` in `packages/core/src/check-registry.ts` defines 89 checks with `defineCheck(id, verification type, check type, tier, description, spec)`, and the stage follows from the tier (a heuristic tier makes a check beta) [`check-registry.ts`]; `REPORT_REGISTRY` does the same for reports, and `docs/checks/*.md` and `docs/reports/*.md` already hold the per-family detail. **Proposed:** a generator writes one table per verification type (id, tier, type, stage, inputs, whether a model is used, the configuration keys with defaults, the calibration document and its numbers, what the check does **not** detect) and a test fails when a registry entry has no generated row or a family page does not mention it. Persona's check names from the surface index [R4] appear as a mapping column only where the id differs (PLAN §4 already holds that mapping [R1]).

### 8.4 Mapping from Persona's public API (`docs/migration/from-persona.md`)

Factual, naming Persona only as the source system, with no logo and a not-affiliated line. The facts below come from Persona's public OpenAPI repository at the commit the earlier notes pinned (`e64dbfbd…`, directory `2026-09-29`) and one public reference page [O1][O2], against OpenVerify's generated OpenAPI [R20].

| Concern | Persona's public API | OpenVerify | Migration note |
|---|---|---|---|
| Base path | `https://api.withpersona.com/api/v1` [O1] | `/api/v1/` on the operator's host [R20] | Change the host; paths keep the same family names in most cases |
| Authentication | `Authorization: Bearer <token>` [O2] | Bearer API keys `ov_sbx_…` / `ov_prod_…` [R8] | Issue new keys; scopes, IP allowlists and expiry are set per key |
| Version header | `Persona-Version`, dated values such as `2026-09-29` [O2] | `OpenVerify-Version`, dated values (C12) [R27] | Pin a version explicitly in both |
| Key casing | `Key-Inflection: camel`, `kebab` or `snake` [O1] | Kebab-case attributes only (PLAN §5) [R1] | A client relying on camel or snake casing needs a mapping layer |
| Idempotency | `Idempotency-Key` header [O2] | `Idempotency-Key` on `POST` and `PATCH`, 24-hour answers (C12) [R27] | Same header |
| Pagination | `page[after]`, `page[before]`, `page[size]` as a deep object [O1] | `page[after]`, `page[size]` (no `page[before]` on `GET /inquiries`) [R20] | Backward paging needs a change |
| Webhook signature | `Persona-Signature: t=<unix>,v1=<hmac>` [O1] | `OpenVerify-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, one `v1` per active secret during rotation [R27] | Same scheme, different header name and secret; `@openverify/node` verifies |
| Ids | `inq_` followed by a random string in examples [O2] | `<prefix>_<ULID>` with prefixes such as `inq`, `itmpl`, `itmplv`, `acc`, `ver`, `rep` [`packages/contracts/src/ids.ts`] | Source ids cannot be kept as OpenVerify ids; carry them in `reference-id` or an account field and keep a mapping table |
| Resources | 183 path files in the surface index [R4] | 121 paths today [R20]; Phases 7 to 11 add lists, graph, transactions, workflows, cases and Connect | **Generate** the path table: for each Persona path, the OpenVerify path or "not available" with the phase that adds it, from the surface index and the OpenAPI document; a test fails when either side changes without the table |
| Checks and reports | Names in example payloads [R4] | PLAN §4's catalog [R1] | The catalog's mapping column (section 8.3) |

**What a mapping cannot carry:** historical captures and results do not migrate as verified results (they were not produced by OpenVerify's checks), so the guide should tell operators to import them, if at all, as account fields or attachments labelled with their source, never as `passed` checks (rule 5; inference about the right default).

## 9. Sources and pins

Every source was read on **2026-10-29**. `robots.txt` was read before any other request to each host and cached: `api.github.com`, `raw.githubusercontent.com`, `release-assets.githubusercontent.com`, `docs.zizmor.sh`, `google.github.io`, `docs.astral.sh`, `helm.sh` and `app.leg.wa.gov` answered 404 (no restrictions under RFC 9309); `statutes.capitol.texas.gov` served its application page in place of a robots file (no rules; the statute page rendered no text without script); `www.threatdragon.com` answered 401 (unavailable, so no restrictions under RFC 9309); `github.com` allows release downloads (corrected in fact-check: its `User-agent: *` group has `Disallow: /*/*/download/*`, which matches `/OWASP/ASVS/releases/download/…`; the fact-check fetched the [V2] asset through `api.github.com/repos/OWASP/ASVS/releases/assets/259362919` instead, and its SHA-256 matches); `registry.npmjs.org` serves a document with no rules; `pypi.org` (corrected in fact-check: its robots file has `Disallow: /pypi/*/json`, so the [L3], [K6] and [K14] JSON URLs are disallowed; the fact-check re-verified those facts from GitHub releases and the allowed `pypi.org/project/<name>/` pages), `repo1.maven.org`, `learn.microsoft.com`, `cheatsheetseries.owasp.org`, `www.threatmodelingmanifesto.org`, `www.zaproxy.org`, `semgrep.dev`, `docs.github.com`, `slsa.dev`, `docs.sigstore.dev`, `pnpm.io`, `www.artillery.io`, `docs.locust.io`, `kubernetes.io`, `www.postgresql.org`, `cppa.ca.gov`, `www.legislation.gov.uk`, `ai-act-service-desk.ec.europa.eu` and `docs.withpersona.com` allow the paths used; **`plugins.gradle.org` disallows** the metadata path, so it was not fetched; **`eur-lex.europa.eu`** answered `202` with an empty body (a challenge page) for both `robots.txt` and the GDPR text, which was not pursued; **`www.ilga.gov` and `ilga.gov` failed TLS certificate verification**, which was not bypassed. At least 1.2 s between requests to one host; no redirect followed automatically (each redirect target was requested on its own after its host's robots check); User-Agent `OpenVerify-research/1.0 (phase 11 hardening research; no contact)`; the GitHub API unauthenticated; no personal data sent. Downloads total about **20 MB** under `downloads/hard-{asvs,docs,gh-api,legal,licenses,persona,pg,registry,src}/`; scripts are `scripts/hard_fetch.py`, `hard_releases.py`, `hard_registry.py`, `hard_asvs_counts.py` and `hard_html2text.py`; Python ran with `-I`; nothing downloaded was executed or installed.

**Repository (R)**, read-only at `91c83e02` plus the Phase 6 work in progress in the same tree
- [R1] `docs/PLAN.md` §2 (feature map), §3 (technology table, data protection by design, hardening), §5, §6 (Phases 9–11 and the iOS note), §9 (risks, lines 495–509), §10 (acceptance, line 519)
- [R2] `CLAUDE.md` rules 3–6 (as restated by the task)
- [R3] `docs/adr/0001-stack.md` … `0005-report-honesty-and-live-public-sector-data.md`
- [R4] `docs/research/persona-surface.md` (183 API path files; check, report and event identifiers)
- [R5] `packages/db/src/crypto.ts` (envelope encryption, `OPENVERIFY_KEK`, `OPENVERIFY_KEK_PREVIOUS`, IV budget)
- [R6] `packages/db/src/sealed.ts` (row-bound associated data)
- [R7] `packages/db/src/blind-index.ts` (per-environment subkeys; `blind-index:rebuild`)
- [R8] `packages/db/src/api-keys.ts` (prefixes, 256-bit secrets, HMAC under the pepper); `packages/contracts/src/api-keys.ts` (`allowed-ips` up to 50, `expires-at`)
- [R9] `packages/db/src/tokens.ts`, `packages/contracts/src/tokens.ts` (`USER_SESSION_TOKEN_TTL_SECONDS` = 12 h)
- [R10] `apps/api/src/operator-auth/{password-hasher,totp,webauthn,login-rate-limiter,reset-mfa-command}.ts`, `apps/api/src/services/mfa.ts`
- [R11] `apps/api/src/webhooks/{ssrf,http-sender}.ts`, `apps/api/src/http/index.ts`
- [R12] `apps/dashboard/next.config.ts`; `apps/dashboard/src/lib/{session,session-cookie,mfa-challenge}.ts`
- [R13] `apps/flow/src/security/security-meta.ts`; `apps/flow/src/session/session-bootstrap.ts`
- [R14] `.githooks/pre-commit`; `infra/scripts/install-gitleaks.sh` (gitleaks 8.30.1, SHA-256 `551f6fc8…70eb`)
- [R15] `scripts/fetch_models.py`, `fetch_data.py`, `fetch_fixtures.py`, `fetch_trust_anchors.sh`
- [R16] `infra/docker-compose.yml` (services, per-process provider environments, vision isolation, Postgres logging flags, Valkey flags, bucket versioning); `infra/postgres/initdb/001-extensions.sql`; `infra/tests/*.sh`
- [R17] `infra/docker/apps.Dockerfile`, `services/vision/Dockerfile`
- [R18] `.github/workflows/ci.yml` (jobs, pins, benchmarks logged and never gated)
- [R19] `THIRD_PARTY_LICENSES.md` §1, §5 and the excluded list
- [R20] `docs/api/openapi.json` (OpenAPI 3.1.0, 121 paths); `apps/api/src/routes/system.ts` (`/health`); `apps/api/src/routes/dashboard/files.ts` (attachment, `nosniff`, `no-store`); `apps/api/src/storage/index.ts` (every version deleted)
- [R21] `docs/PROGRESS.md` lines 81–90, 1275, 1280–1281, 1305–1317
- [R22] `docs/plans/phase-6.plan.md` lines 577, 1258, 1263 (decision 12, the redaction actor), 1279, 1280, 1283, 1476, 1660, 1709, and C74.1 (fenced claims)
- [R23] `docs/plans/phase-7.plan.md` lines 104, 612, 635, 751, 1463, 1941
- [R24] `docs/plans/phase-8.plan.md` lines 88, 485, 570; `docs/plans/phase-8-review-resolution.md` line 25 (P17)
- [R25] `docs/calibration/watchlist-phase6c.md` (C78.7 budgets and measures; decision 3)
- [R26] `apps/api/src/rate-limit/`, `apps/api/src/plugins/rate-limit.ts`; `docs/plans/phase-2.plan.md` line 280
- [R27] `packages/contracts/src/api-versions.ts` (`OpenVerify-Version`), `packages/contracts/src/http-headers.ts` (`IDEMPOTENCY_KEY_TTL_SECONDS` = 24 h), `apps/api/src/request-id.ts` (`x-request-id`), `packages/node/src/webhook-signature.ts` (`OpenVerify-Signature`)
- [R28] `docs/plans/phase-5.plan.md` lines 385, 387, 596, 636, 758
- [R29] `package.json` (`packageManager: pnpm@12.14.0`), `apps/api/package.json`, `packages/config/eslint/phase5-rules.js`, `services/vision/pyproject.toml` (ruff `S`)
- [R30] `docs/plans/phase-2.plan.md` line 919; `apps/api/package.json` scripts
- [R31] `docs/research/phase8-workflow-engine.md` §1 (ids-only jobs, Workflow 4B H001, the outbox, the 60 s sweep, `SKIP LOCKED` sweeps), §2.4 (1,577 effectful steps/s at 32 clients), §11 decision 17 (`noeviction` check)
- Also read: `packages/core/src/check-registry.ts` (89 `defineCheck` entries), `packages/core/src/report-registry.ts`, `packages/contracts/src/ids.ts`, `apps/api/src/config.ts` (placeholder secrets refused in production), `apps/api/src/server.ts` and `worker.ts` (SIGTERM), `apps/api/src/migrate.ts`, `packages/db/src/migrate.ts`, `apps/api/src/plugins/principal-auth.ts`.

**Sibling note (S):** [S1] `phase11-connect.md` in this directory (the Connect half; read for scope only, being written at the same time).

**ASVS and MASVS (V)**
- [V1] https://api.github.com/repos/OWASP/ASVS/releases?per_page=10 (`v5.0.0_release` published 2025-05-30T09:35:31Z; `latest` bleeding edge regenerated 2026-10-26T20:31:58Z)
- [V2] https://github.com/OWASP/ASVS/releases/download/v5.0.0_release/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json (162,870 bytes, SHA-256 `8201b20eec2908c3380ac600c91c8ba746346fbb808859366abb232027532311`, identical to the `latest` asset's published digest); counted with `scripts/hard_asvs_counts.py`
- [V3] https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0_release/LICENSE.md (CC BY-SA 4.0)
- [V4] https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0_release/5.0/en/0x03-What-is-the-ASVS.md (levels; about 20% L1, about 70% for L2; `v<version>-<chapter>.<section>.<requirement>`)
- [V5] https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0_release/5.0/en/0x04-Assessment_and_Certification.md (no OWASP certification; reporting scope; limits of automation)
- [V6] https://api.github.com/repos/OWASP/masvs/releases?per_page=4 (v2.1.0, 2024-01-18; introduces `MASVS-PRIVACY`)

**Threat modelling (T)**
- [T1] https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats (STRIDE categories)
- [T2] https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- [T3] https://www.threatmodelingmanifesto.org/
- [T4] https://raw.githubusercontent.com/OWASP/threat-dragon/v2.6.2/license.txt (Apache-2.0)
- [T5] https://api.github.com/repos/OWASP/threat-dragon/releases?per_page=5 (v2.6.2, 2026-05-10T20:30:07Z); https://www.threatdragon.com/docs/ (v2.6.2 docs: methodologies, storage providers)
- [T6] https://www.threatdragon.com/docs/trust/analytics.html (off by default; never in the desktop app); https://www.threatdragon.com/docs/configure/local.html
- [T7] https://api.github.com/repos/OWASP/pytm/releases?per_page=4 (v1.4.0, 2026-07-06T13:17:13Z); https://raw.githubusercontent.com/OWASP/pytm/v1.4.0/LICENSE (MIT)

**Scanning, SBOM, signing and provenance (K)**
- [K1] https://api.github.com/repos/aquasecurity/trivy/releases?per_page=8 (v0.76.1 2026-10-21T11:18:34Z; v0.76.0 2026-10-14T11:45:44Z); https://raw.githubusercontent.com/aquasecurity/trivy/v0.76.0/LICENSE (Apache-2.0) and `README.md` at the same tag (targets and scanners)
- [K2] https://api.github.com/repos/aquasecurity/trivy/security-advisories?per_page=20 (GHSA-69fq-xp46-6x23 / CVE-2026-33634, critical, 2026-03-21; GHSA-q3fv-x8vg-qqm4 / CVE-2026-54448, fixed 0.71.0; GHSA-mcj4-mphf-j9ff / CVE-2026-55092, fixed 0.71.1; GHSA-8rc5-4fr6-64pw / CVE-2026-63328, fixed 0.72.0)
- [K3] https://api.github.com/repos/google/osv-scanner/releases?per_page=8 (v2.7.0, 2026-10-12T01:32:07Z); https://raw.githubusercontent.com/google/osv-scanner/v2.7.0/LICENSE (Apache-2.0)
- [K4] https://google.github.io/osv-scanner/supported-languages-and-lockfiles/
- [K5] https://api.github.com/repos/anchore/grype/releases?per_page=8 and https://api.github.com/repos/anchore/syft/releases?per_page=8; `LICENSE` and `README.md` at `v0.120.1` and `v1.54.1` (Apache-2.0)
- [K6] https://api.github.com/repos/zizmorcore/zizmor/releases?per_page=8; https://raw.githubusercontent.com/zizmorcore/zizmor/v1.31.0/LICENSE (MIT); https://pypi.org/pypi/zizmor/json (1.31.1 uploaded 2026-10-15T23:12:56Z)
- [K7] https://docs.zizmor.sh/audits/ (41 audit ids)
- [K8] https://raw.githubusercontent.com/semgrep/semgrep/v1.181.0/LICENSE (LGPL-2.1); https://raw.githubusercontent.com/semgrep/semgrep-rules/develop/LICENSE; https://semgrep.dev/legal/rules-license/ (Semgrep Rules License v1.0, last updated 2024-12-13); https://api.github.com/repos/semgrep/semgrep/releases?per_page=6; https://api.github.com/repos/opengrep/opengrep/releases?per_page=6 and https://raw.githubusercontent.com/opengrep/opengrep/v1.31.0/LICENSE (LGPL-2.1)
- [K9] https://raw.githubusercontent.com/github/codeql-cli-binaries/main/LICENSE.md (GitHub CodeQL Terms and Conditions)
- [K10] https://raw.githubusercontent.com/github/codeql/main/LICENSE (MIT); https://api.github.com/repos/github/codeql-action/releases?per_page=4
- [K11] https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security (Code Security and Secret Protection for private repositories on Team and Enterprise plans; Dependabot alerts in all plans)
- [K12] https://api.github.com/repos/gitleaks/gitleaks/releases?per_page=8 (v8.30.1, 2026-03-21T02:17:58Z); https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/LICENSE (MIT)
- [K13] https://pnpm.io/cli/audit (bulk advisory endpoint; GHSA ids; `audit signatures`)
- [K14] https://pypi.org/pypi/pip-audit/json (2.10.1, 2026-06-10T22:17:00Z; its description: features and CLI options); https://raw.githubusercontent.com/pypa/pip-audit/v2.10.1/LICENSE (Apache-2.0)
- [K15] https://raw.githubusercontent.com/astral-sh/uv/0.13.3/CHANGELOG.md (0.13.3 released 2026-10-20); https://raw.githubusercontent.com/astral-sh/uv/0.13.3/changelogs/0.11.x.md and `0.12.x.md` (`uv audit` entries under preview features through 0.12.24); https://api.github.com/repos/astral-sh/uv/contents/changelogs?ref=0.13.3; https://docs.astral.sh/uv/reference/cli/ (`uv audit`, `uv tool audit`)
- [K16] https://api.github.com/repos/zaproxy/zaproxy/releases/latest (v2.17.0, 2025-12-15T14:41:51Z) and `releases?per_page=8` (weekly pre-releases); https://raw.githubusercontent.com/zaproxy/zaproxy/v2.17.0/LICENSE (Apache-2.0)
- [K17] https://www.zaproxy.org/docs/docker/api-scan/
- [K18] https://api.github.com/repos/CycloneDX/specification/releases?per_page=6 (1.7 2025-10-21; 1.7.2 2026-09-17); https://raw.githubusercontent.com/CycloneDX/specification/1.7.2/LICENSE (Apache-2.0)
- [K19] https://registry.npmjs.org/@cyclonedx%2fcdxgen (12.9.0 2026-10-22; 12.8.6 2026-10-14; Apache-2.0; engines include `pnpm >= 10`); https://raw.githubusercontent.com/cdxgen/cdxgen/v12.8.6/LICENSE
- [K20] https://api.github.com/repos/CycloneDX/cyclonedx-gradle-plugin/releases?per_page=5 (3.5.1, 2026-10-09T14:05:29Z); https://raw.githubusercontent.com/CycloneDX/cyclonedx-gradle-plugin/cyclonedx-gradle-plugin-3.5.1/LICENSE (Apache-2.0)
- [K21] https://api.github.com/repos/spdx/spdx-spec/releases?per_page=4 (3.0.1 2024-12-17; v3.1-RC1 2026-01-24)
- [K22] https://api.github.com/repos/sigstore/cosign/releases?per_page=8 (v3.1.4 2026-10-20; v3.1.3 and v2.6.5 2026-08-06); https://raw.githubusercontent.com/sigstore/cosign/v3.1.3/LICENSE (Apache-2.0)
- [K23] https://slsa.dev/spec/v1.2/ (reached from `/spec/` → `/spec/latest` → `/spec/v1.2/`; status Approved; Build and Source tracks)
- [K24] https://api.github.com/repos/actions/attest-build-provenance/releases?per_page=4 (v4.2.2, 2026-08-06); https://raw.githubusercontent.com/actions/attest-build-provenance/v4.2.2/LICENSE (MIT)
- [K25] https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations (public repositories only on Free, Pro and Team; Enterprise Cloud for private)
- [K26] https://api.github.com/repos/slsa-framework/slsa-github-generator/releases?per_page=4 (v2.1.0, 2025-02-24); https://raw.githubusercontent.com/slsa-framework/slsa-github-generator/v2.1.0/LICENSE (Apache-2.0)
- [K27] https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts
- [K28] https://registry.npmjs.org/eslint-plugin-security (4.2.0, 2026-10-01, Apache-2.0); https://registry.npmjs.org/eslint-plugin-no-unsanitized (4.1.5, 2026-02-19, MPL-2.0)
- [K29] https://docs.sigstore.dev/logging/overview/ (Rekor: an immutable, publicly queryable ledger; public instance `rekor.sigstore.dev`); https://docs.sigstore.dev/cosign/signing/overview/ (short-lived certificates bound to an identity)

**Load testing (L)**
- [L1] https://raw.githubusercontent.com/grafana/k6/v2.3.0/LICENSE.md (AGPL-3.0)
- [L2] https://api.github.com/repos/grafana/k6/releases?per_page=8 (v2.3.0 2026-09-21; v1.8.2 2026-10-12)
- [L3] https://pypi.org/pypi/locust/json (2.47.0 2026-10-21; 2.46.7 2026-10-04; MIT; Python ≥ 3.11); https://raw.githubusercontent.com/locustio/locust/2.46.7/LICENSE
- [L4] https://docs.locust.io/en/stable/writing-a-locustfile.html (`constant_throughput`, `constant_pacing`, `poisson`)
- [L5] https://api.github.com/repos/tsenart/vegeta/releases?per_page=8 (v12.13.0, 2025-10-31); `LICENSE` and `README.md` at `v12.13.0` (MIT; constant rate; coordinated omission)
- [L6] https://api.github.com/repos/hatoo/oha/releases?per_page=8 (v1.16.0, 2026-08-23); `LICENSE` and `README.md` at `v1.16.0` (MIT; `--latency-correction`)
- [L7] https://registry.npmjs.org/autocannon (8.0.0, 2024-10-14, MIT, `gitHead` `28540674…`); `LICENSE` and `README.md` at that commit
- [L8] https://api.github.com/repos/gatling/gatling/releases?per_page=8 (v3.16.0, 2026-09-29); https://raw.githubusercontent.com/gatling/gatling/v3.16.0/LICENSE.txt (Apache-2.0)
- [L9] https://registry.npmjs.org/artillery (2.0.34, 2026-08-14, MPL-2.0, `gitHead` `5bcfa94c…`, Node ≥ 22.18.0, 93 dependencies); https://raw.githubusercontent.com/artilleryio/artillery/5bcfa94c82df3d2f4e9b7bfe63aedaae2cb40bf0/LICENSE.txt
- [L10] https://www.artillery.io/docs/resources/telemetry (reached from `/docs/resources/core/telemetry`; on by default; `ARTILLERY_DISABLE_TELEMETRY=true`)

**Deployment (D)**
- [D1] https://kubernetes.io/docs/concepts/security/pod-security-standards/ (the restricted profile)
- [D2] https://kubernetes.io/docs/concepts/services-networking/network-policies/ (needs a supporting network plugin; no TLS features; limits as of 1.37)
- [D3] https://api.github.com/repos/helm/helm/releases?per_page=8 (v4.3.1 2026-10-15T01:08:37Z; v3.22.1 2026-10-15T17:02:01Z); https://raw.githubusercontent.com/helm/helm/v4.3.1/LICENSE (Apache-2.0)
- [D4] https://helm.sh/docs/topics/version_skew/ (4.3.x ↔ Kubernetes 1.37–1.34; n−3 from Helm 4)
- [D5] https://api.github.com/repos/helm/chart-testing/releases?per_page=8 (v3.15.0, 2026-10-06), https://api.github.com/repos/yannh/kubeconform/releases?per_page=8 (v0.8.0, 2026-06-04), https://api.github.com/repos/helm-unittest/helm-unittest/releases?per_page=8 (v1.2.1, 2026-10-03); `LICENSE` at `v3.15.0` (Apache-2.0), `v0.8.0` (Apache-2.0), `v1.2.1` (MIT)
- [D6] https://kubernetes.io/releases/ (1.37, 1.36, 1.35 maintained; end-of-life dates; 1.34 ended 2026-10-27)
- [D7] https://raw.githubusercontent.com/bitnami/charts/main/README.md (Bitnami Secure Images on Photon OS; legacy Debian images in a separate registry)
- [D8] https://raw.githubusercontent.com/valkey-io/valkey-helm/main/LICENSE (BSD-3-Clause)

**PostgreSQL (P)**
- [P1] https://www.postgresql.org/docs/17/jit-decision.html
- [P2] https://www.postgresql.org/docs/17/sql-alterrole.html
- [P3] https://www.postgresql.org/docs/17/continuous-archiving.html
- [P4] https://www.postgresql.org/docs/17/pgupgrade.html
- [P5] https://www.postgresql.org/support/versioning/ (17.11 current; 17 final release 2029-11-08; 18.6 current; PostgreSQL 19 RC 1 announced 2026-10-15)

**Law and regulation (G)**
- [G1] https://www.legislation.gov.uk/eur/2016/679/article/9 and https://www.legislation.gov.uk/eur/2016/679/article/12 (UK GDPR as amended; Article 12(3) refers to Article 12A and Articles 15 to 22D)
- [G2] https://www.legislation.gov.uk/ukpga/2025/18/contents (Data (Use and Access) Act 2025: ss. 76, 78, 80, 142)
- [G3] https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3004&ChapterID=57 (740 ILCS 14; **not retrieved**: TLS verification failed)
- [G4] https://app.leg.wa.gov/RCW/default.aspx?cite=19.375&full=true (RCW 19.375.010–.040)
- [G5] https://statutes.capitol.texas.gov/Docs/BC/htm/BC.503.htm (**text not rendered** without script; not re-read)
- [G6] https://cppa.ca.gov/announcements/2025/20250923.html (regulations approved; effective 2026-01-01; phased dates)
- [G7] https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3 (Annex III point 1)
- [G8] https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 (EU GDPR; **not retrieved**: a challenge page; EU article references in this note are not re-read)

**Persona's public API (O)**, identifiers only; Apache-2.0 repository, used for identifiers and never copied into OpenVerify
- [O1] https://raw.githubusercontent.com/persona-id/persona-openapi/e64dbfbd04968b4f48e41ad571eb85861ac969bf/2026-09-29/openapi.yaml (server `https://api.withpersona.com/api/v1`, bearer scheme) and `components/parameters/{key-inflection-header,pagination-query-params,persona-signature-header}.yaml` at the same commit
- [O2] https://docs.withpersona.com/2026-09-29/api-reference/inquiries/retrieve-an-inquiry.md (`Authorization` bearer, `Key-Inflection`, `Idempotency-Key`, `Persona-Version` with dated values)

## 10. What the phase plan should take from this (proposed)

1. **Amend PLAN §6 Phase 11 and §3: k6 is AGPL-3.0 and fails rule 4** [L1]. Replace it with **Locust 2.46.7** (MIT) for scenarios and worker throughput and **vegeta v12.13.0** (MIT) for open-model per-route latency; add k6, the Semgrep engine and rules, and Opengrep to `THIRD_PARTY_LICENSES.md`'s excluded list.
2. **Threat model as Markdown** (`docs/security/threat-model.md`) seeded from section 3.2's 46 rows with stable ids, a Mermaid data-flow diagram, a parsing test (six STRIDE letters per boundary, statuses, live evidence paths), and a review at every phase end. Threat Dragon v2.6.2 (Apache-2.0) optional for workshops.
3. **ASVS 5.0.0 Level 2, self-assessed**: `docs/security/asvs-5.0.0-l2.csv` with the 253 Level 2 ids (about 205 applicable), status, evidence and threat ids; no requirement text committed (CC BY-SA); the 5.0.0 export pinned by SHA-256 in a fetch script; a test that the ids match the export and that every evidence path exists. Never "certified".
4. **Close the day-one gaps of section 4.3** as Phase 11 slices: HSTS through the ingress (G-HSTS); the flow's response headers in a production flow server (G-FRAME, H6); a console idle timeout (G-IDLE); the login limiter in Valkey (G-LOGIN); a cryptographic inventory and key-management policy (G-KEYDOC); TLS settings for every data store (G-TLS); per-process secrets with an external-secrets example (G-SECRETS); a data classification (G-CLASS); remediation time frames and SBOMs (G-SBOM); production images (G-DEVIMG, H7); a log inventory (G-LOGINV); operator regexes bounded (G-REGEX, H16). The console's script CSP (G-CSP, H5) belongs to Phase 9; Phase 11 verifies it.
5. **Per-tenant queue quotas (H1)** with the Phase 8 admission model (per-environment in-flight slots), and a load-test acceptance: one flooding environment keeps another's report p95 within 2× idle.
6. **Scanning jobs of section 5.3** with each scanner installed as a pinned binary verified by SHA-256 (and its signature where published), never as a third-party action, following the Trivy compromise of 2026-03-19 [K2]: osv-scanner v2.7.0, `pnpm audit` and `pnpm audit signatures`, pip-audit 2.10.1, zizmor v1.31.0 (or 1.31.1 after 2026-10-29T23:13Z), Trivy v0.76.0 and Grype v0.120.1 on images, Syft v1.54.1 for SBOMs, Trivy `config` on `infra/` and the chart, gitleaks as today plus a PII-pattern config (H15), ZAP v2.17.0's API and baseline scans nightly against the e2e stack, ESLint with `eslint-plugin-security` 4.2.0 plus ruff `S` and Android lint for SAST. No Semgrep, no Opengrep; CodeQL only if the repository becomes public or Code Security is bought.
7. **Android dependency visibility:** Gradle dependency locking (and consider dependency verification) or the CycloneDX Gradle plugin 3.5.1's SBOM, so the SDK's resolved tree can be scanned; coordinate with Phase 10.
8. **SBOMs, signing and provenance at release:** CycloneDX 1.7 SBOMs per image and artifact, cosign v3.1.3 signatures, SLSA v1.2 Build-track provenance; the mechanism depends on repository visibility (section 11, decision 3).
9. **Images by digest** in both Dockerfiles, the compose file and the chart; write down whether the 14-day rule covers toolchain binaries, base images and actions (uv 0.13.3 was pinned the day it was released [K15]).
10. **Production images** (section 7.1): API (server, worker and compiled operator commands), dashboard (standalone), flow (static server with headers), vision, code runner; non-root, read-only root, SBOM and signature each.
11. **Helm chart** (section 7.2): restricted Pod Security everywhere; default-deny network policies with vision and the code runner egress-free; one Secret per process; a migration role separate from the runtime role; the migrate job as a hook with a session advisory lock added to `db:migrate`; `/ready` for the API and a worker health signal; HPA for API, dashboard and flow; queue-driven worker scaling tested; `kubeVersion >=1.35`; tested with helm-unittest v1.2.1, kubeconform v0.8.0 (1.35–1.37), chart-testing v3.15.0 on kind, Trivy `config`, on Helm 4.3.1 and 3.22.1. No Bitnami dependency.
12. **Load test** (section 6): reference machine, synthetic data, open-model arrival, three takes, the budgets of 6.4 recorded and never gated in shared CI; it also settles H10 (`jit = off` for the application role) with a before-and-after measurement.
13. **Documentation set** (section 8): the self-hosting guide with a generated configuration reference, key rotation procedures, backup and restore with a drill, upgrades, database and Valkey settings, first-run and break-glass checklists; the compliance guide with its controller and operator split and the sources of 8.2 (BIPA, Texas, Colorado and the EU GDPR articles re-read before publication); the generated check catalog; the generated Persona mapping table with the factual header and pagination differences of 8.4.
14. **DSAR access export (H14)**: a per-account export of the data the platform holds (fields, verification results, files, events, report hits), audited and asynchronous, or the compliance guide states that it is missing; Phase 11 is the last phase to build it in this release.
15. **MASVS v2.1.0 checklist** for the Android SDK and NFC module, in the ASVS checklist's format, delivered with Phase 10's release.
16. **Records to update:** PLAN §3 (no k6; scanners; Helm detail), PLAN §6 Phase 11 (the slices above), PLAN §9 (a supply-chain risk row citing the Trivy incident), `THIRD_PARTY_LICENSES.md` (every adopted tool with its version and licence, MPL tools in §5 if any, excluded tools), ADR 0001 (the Helm chart and the production images as deployment decisions).

## 11. Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Replace k6 (AGPL) in PLAN §6 | **Locust 2.46.7 + vegeta v12.13.0** (both MIT); Artillery (MPL-2.0, telemetry on by default) not adopted |
| 2 | SAST without Semgrep (LGPL engine, source-available rules) and without CodeQL on a private repository | **ESLint with `eslint-plugin-security`, ruff `S`, Android lint**; buy no Code Security licence; turn CodeQL on only if the repository becomes public |
| 3 | Repository visibility at release, which decides CodeQL, GitHub artifact attestations and whether keyless signing publishes the repository's identity to Rekor | **Stay private until the release; sign and attest at release once public** (keyless cosign, GitHub attestations); while private, publish no images |
| 4 | Publish container images, and where | **Yes, at release, to the project's own registry**, digest-pinned bases, SBOM and signature each, release notes pointing at the base distribution's sources |
| 5 | Model weights in published images, or fetched at start | **Fetched** into a volume by `fetch_models.py` (pinned SHA-256) until SFace's upstream licence review (H17) is done |
| 6 | Does the 14-day release-age rule cover toolchain binaries, base images and GitHub Actions? | **Yes**, with uv 0.13.3 (released 2026-10-20) accepted as an exception or replaced by an older pin |
| 7 | Vulnerability remediation time frames (ASVS v5.0.0-15.1.1) | **Critical 7 days, high 30, medium 90, low next release**, with an expiring allowlist |
| 8 | ASVS target and wording | **ASVS 5.0.0 Level 2, self-assessed**; never "certified" |
| 9 | The load-test budgets of section 6.4 | **Accept as proposed**, recorded and not gated in shared CI |
| 10 | Console session timeouts | **30-minute idle timeout, 12-hour absolute** (today's absolute lifetime), both configurable |
| 11 | Login limiter storage | **Valkey**, failing closed for login only (the API limiter keeps failing open, H18) |
| 12 | DSAR access export (H14) | **Build it in Phase 11** |
| 13 | Minimum Kubernetes and Helm | **Kubernetes ≥ 1.35; test on Helm 4.3.1 and 3.22.1** |
| 14 | TLS to data stores in production | **Required by the guide; the API logs a startup warning on a plain-text `DATABASE_URL` or `redis://` in production mode**, no refusal (in-cluster setups vary) |
| 15 | A separate migration database role | **Yes**; the chart takes two connection secrets |
| 16 | Threat-model format | **Markdown in the repository**; Threat Dragon optional |
| 17 | The "Migrating from Persona" page | **Yes**, factual, docs only, no logo, a not-affiliated line (CLAUDE.md bars the name only in product UI, branding and copied text) |
| 18 | A PII-pattern scan of fixtures and docs (H15) | **Yes**, gitleaks custom rules with a reviewed allowlist |
| 19 | Per-tenant queue quotas (H1) | **Per-environment in-flight caps per queue (default 50, as Phase 8 proposes for runs)**, overridable per environment |
| 20 | The BIPA, Texas and EU GDPR facts that could not be re-read today | **Re-read them from the official texts before the compliance guide is published**, and have counsel review the guide |

## Gaps (what this note could not establish)

- **Illinois BIPA** (740 ILCS 14) and Public Act 103-0769: the Illinois General Assembly's site failed TLS certificate verification on both host names, and the check was not bypassed; section 8.2's BIPA row rests on the statute as previously published, not on a 2026-10-29 reading.
- **The EU GDPR text** on EUR-Lex answered with a challenge page; EU article numbers (Arts. 12(3), 28, 33, 35) are cited from the Regulation as published, not re-read. The UK GDPR pages were read.
- **Texas Business and Commerce Code §503.001** and **Colorado's 2024 biometric amendment**: not re-read (the Texas site renders by script; Colorado not attempted).
- **CCPA sections** (§1798.140, §1798.121, §1798.130): not re-read; only the CPPA's 2025-09-23 announcement was.
- **Commencement of the Data (Use and Access) Act 2025**: the UK GDPR text already shows the Act's amendments to Article 12, but the commencement regulations themselves were not read.
- **Whether `uv audit` is still preview in 0.13.3**: inferred from the changelogs (preview through 0.12.24, nothing in 0.13.x); the 0.13.3 binary was not run.
- **Keyless signing from a private repository** publishing its identity to Rekor: inferred from the Rekor and Fulcio descriptions; Sigstore's FAQ or privacy statement was not read.
- **pgvector's upgrade notes** (`ALTER EXTENSION vector UPDATE`) and **pgAudit's licence**: not re-read.
- **KEDA's Redis scaler with BullMQ's keys**, **Next.js server actions' origin check**, and **Android's default refusal of user-installed CAs**: stated as inferences to test, not verified.
- **Gatling's injection profiles** and **SLSA-github-generator's level**: not re-read beyond releases and licences.
- **MASVS v2.1.0's control groups** other than `MASVS-PRIVACY`, and MASVS's licence: not re-read.
- **Whether RE2 or a time limit for operator-supplied regexes (H16)** was built in a later phase: no later progress entry closes it, but the code was not searched exhaustively.
- **Whether `seed:dev` has a production counterpart**, and whether the consent record stores the text version shown: not established from the files read.
- **Numbers**: no load test was run (rule 6 forbids running anything in the repository); every budget in section 6.4 is a proposal, except the Phase 6 figures quoted from the calibration.

## Fact-check (2026-10-29)

Independent re-check of the load-bearing facts against their primary sources, read on 2026-10-29 by a separate agent with
`scripts/fc/fc_fetch.py` (RFC 9309 robots matching before any other request to a host, at least 1.25 s between requests to
one host, no redirect followed automatically, no personal data sent; downloads under `downloads/fc-*/`, Python with `-I`,
nothing downloaded executed). Release dates are GitHub's `published_at`; licences are the files at the release tag or
`gitHead`; npm facts are the full packuments. The repository was read with `git show 91c83e02:<path>`. Summary:
**33 confirmed, 1 corrected, 2 could not verify in part**, plus one correction to the note's request-discipline paragraph.

**Request discipline (corrected in place in section 9).** `pypi.org/robots.txt` has `Disallow: /pypi/*/json`, so the
`pypi.org/pypi/<name>/json` URLs cited as [L3], [K6] and [K14] are disallowed for every user agent. `github.com/robots.txt`
has `Disallow: /*/*/download/*` in its `User-agent: *` group, so the [V2] release-download URL is disallowed too. The facts
those sources carried were re-verified here from allowed sources (GitHub releases, `pypi.org/project/<name>/` pages, and the
ASVS asset through `api.github.com/repos/OWASP/ASVS/releases/assets/259362919`, whose redirect target
`release-assets.githubusercontent.com` answers 404 for robots.txt). This check's own fetcher also sent four requests to
`pypi.org/pypi/<name>/json` before a gzip bug in its robots reader was fixed; those responses were deleted unread.

| # | Fact | Verdict | Primary source and what it shows |
|---|---|---|---|
| 1 | k6 AGPL-3.0 at `v2.3.0`; v2.3.0 2026-09-21, v1.8.2 2026-10-12 | confirmed | `LICENSE.md` at `v2.3.0` (GNU AGPL v3); GitHub releases |
| 2 | Locust MIT; 2.47.0 (2026-10-21), passing 2.46.7 (2026-10-04); Python ≥ 3.11; `constant_throughput`, `constant_pacing`, `poisson` | confirmed | GitHub releases; `LICENSE` at `2.46.7` (MIT); `pypi.org/project/locust/` (`>=3.11`, 2.47.0 files uploaded 2026-10-21); `docs.locust.io` "Writing a locustfile" |
| 3 | vegeta v12.13.0 (2025-10-31) MIT, constant rate, avoids coordinated omission | confirmed | GitHub release; `LICENSE` and `README.md` at the tag |
| 4 | Artillery 2.0.34 (2026-08-14) MPL-2.0, 93 direct dependencies; telemetry on unless `ARTILLERY_DISABLE_TELEMETRY=true` | confirmed | Packument (`gitHead` `5bcfa94c…`, 93 dependencies); `LICENSE.txt` at the `gitHead` (MPL 2.0); `artillery.io/docs/resources/telemetry` (opt-out variable) |
| 5 | oha v1.16.0 (2026-08-23) MIT; autocannon 8.0.0 (2024-10-14) MIT; Gatling v3.16.0 (2026-09-29) Apache-2.0 | confirmed | GitHub releases and packument; the three licence files |
| 6 | ASVS 5.0.0 (2025-05-30) latest stable; `latest` is a bleeding-edge preview | confirmed | `api.github.com/repos/OWASP/ASVS/releases` (`v5.0.0_release` 2025-05-30T09:35:31Z; `latest` regenerated 2026-10-26, body: "bleeding-edge … for testing and preview purposes only") |
| 7 | Flat JSON SHA-256 `8201b20e…`; 345 requirements (70 L1, 183 L2, 92 L3); Level 2 = 253 | confirmed | The `v5.0.0_release` asset (162,870 bytes) fetched through the API asset endpoint hashes to `8201b20eec29…027532311`; `L` counts 70 / 183 / 92 |
| 8 | CC BY-SA 4.0; citation `v<version>-<chapter>.<section>.<requirement>`; OWASP certifies nothing | confirmed | `LICENSE.md`, `0x03-What-is-the-ASVS.md`, `0x04-Assessment_and_Certification.md` at `v5.0.0_release` |
| 9 | MASVS latest v2.1.0 (2024-01-18), adds MASVS-PRIVACY | confirmed | GitHub releases ("Introducing MASVS-PRIVACY") |
| 10 | Threat Dragon v2.6.2 (2026-05-10) Apache-2.0, analytics off by default and never in the desktop app; pytm v1.4.0 (2026-07-06) MIT | confirmed in part; **could not verify** the analytics claim | GitHub releases; `license.txt` at `v2.6.2` (Apache-2.0); `LICENSE` at `v1.4.0` (MIT). `www.threatdragon.com/robots.txt` answers 401: RFC 9309 would allow crawling, but this checker treats 401 as a refusal and did not fetch the analytics page, and the `v2.6.2` tree has no analytics page under `docs/trust/` |
| 11 | Trivy Apache-2.0; latest v0.76.1 (2026-10-21), passing v0.76.0 (2026-10-14) | confirmed | GitHub releases; `LICENSE` at `v0.76.0` |
| 12 | GHSA-69fq-xp46-6x23 / CVE-2026-33634 (critical, 2026-03-21) details | confirmed | The repository advisory (`published_at` 2026-03-21T15:51:56Z, critical); the global advisory (published 2026-03-24) has the same text: v0.69.4, 76 of 77 `trivy-action` tags, all 7 `setup-trivy` tags, Docker Hub v0.69.5 and v0.69.6, "images referenced by digest" not affected, first patched 0.35.0 and 0.2.6; the CVE record (`cveawg.mitre.org`) was published 2026-03-23 |
| 13 | osv-scanner v2.7.0 (2026-10-12) Apache-2.0; reads `pnpm-lock.yaml`, `uv.lock`, `gradle.lockfile`, `verification-metadata.xml` | confirmed | GitHub release; `LICENSE` at the tag; `google.github.io/osv-scanner/supported-languages-and-lockfiles/` (all four named) |
| 14 | Grype v0.121.0 (2026-10-19) / v0.120.1 (2026-10-06); Syft v1.55.0 / v1.54.1 (2026-10-06); Apache-2.0 | confirmed | GitHub releases; `LICENSE` at `v0.120.1` and `v1.54.1` |
| 15 | zizmor MIT; v1.31.1 (GitHub 23:16Z, PyPI 23:12Z), v1.31.0 (04:04Z); 41 audits | confirmed in part; **could not verify** the PyPI upload time | GitHub releases (2026-10-15T23:16:39Z and 04:04:23Z); `LICENSE` at `v1.31.1` (MIT); `docs.zizmor.sh/audits/` (41 audit sections). `pypi.org/project/zizmor/1.31.1/` answered a script challenge page, so the 23:12Z upload was not read |
| 16 | Semgrep CE LGPL-2.1 (`v1.181.0`); Semgrep Rules License v1.0 (internal business use, no distribution, no service); Opengrep LGPL-2.1 (`v1.31.0`) | confirmed | Both `LICENSE` files (LGPL 2.1); `semgrep-rules` `develop/LICENSE` names the Rules License; `semgrep.dev/legal/rules-license/` (last updated December 13th, 2024; the three limitations) |
| 17 | CodeQL CLI terms; code scanning on private repositories needs Code Security on Team or Enterprise | confirmed | `codeql-cli-binaries` `LICENSE.md` (Open Source Codebase definition; CI use for codebases hosted on GitHub.com); `about-github-advanced-security` ("available for accounts on GitHub Team and GitHub Enterprise Cloud") |
| 18 | Artifact attestations on Free, Pro and Team only for public repositories | confirmed | `use-artifact-attestations` ("only available for public repositories") |
| 19 | `pnpm audit` bulk endpoint, GHSA ids, no CVEs; `audit signatures` ECDSA | confirmed | `pnpm.io/cli/audit` |
| 20 | uv 0.13.3 (2026-10-20) pinned in CI and the vision Dockerfile; `uv audit` under preview through 0.12.24 | confirmed | GitHub release and PyPI files (2026-10-20); `.github/workflows/ci.yml` (`version: '0.13.3'`), `services/vision/Dockerfile` (`uv:0.13.3`); `changelogs/0.12.x.md` at `0.13.3` (`uv audit` entries under "Preview features" in 0.12.22 and 0.12.24) |
| 21 | pip-audit 2.10.1 (2026-06-10) Apache-2.0, PyPI and OSV services | confirmed | GitHub release; `LICENSE` at `v2.10.1`; `pypi.org/project/pip-audit/` description |
| 22 | ZAP v2.17.0 (2025-12-15) latest stable, Apache-2.0; API scan imports OpenAPI | confirmed | `releases/latest`; `LICENSE` at the tag; `zaproxy.org/docs/docker/api-scan/` |
| 23 | cosign v3.1.4 / v3.1.3; SLSA v1.2 Approved; CycloneDX 1.7.2; cdxgen 12.8.6; CycloneDX Gradle plugin 3.5.1 (2026-10-09) | confirmed | GitHub releases and licence files; `slsa.dev/spec/v1.2/` ("Status: Approved"); cdxgen packument (12.8.6 of 2026-10-14, Apache-2.0); plugin release `cyclonedx-gradle-plugin-3.5.1` (2026-10-09T14:05:29Z). The plugin is not on Maven Central (its old coordinates stop at 1.4.0) |
| 24 | `eslint-plugin-security` 4.2.0 Apache-2.0; `eslint-plugin-no-unsanitized` 4.1.5 MPL-2.0 | confirmed | Packuments; licence files at the `gitHead`s |
| 25 | Helm v4.3.1 and v3.22.1, Apache-2.0; 4.3.x supports Kubernetes 1.37–1.34 | confirmed | GitHub releases; `LICENSE` at `v4.3.1`; `helm.sh/docs/topics/version_skew/` |
| 26 | Kubernetes 1.37, 1.36, 1.35 maintained (EOL 2027-10-28, 2027-06-28, 2027-02-28); 1.34 EOL 2026-10-27 | confirmed | `kubernetes.io/releases/` |
| 27 | chart-testing v3.15.0 Apache-2.0; kubeconform v0.8.0 Apache-2.0; helm-unittest v1.2.1 MIT | confirmed | GitHub releases; licence files at the tags |
| 28 | Restricted PSS; NetworkPolicy needs a plugin | confirmed, with a nuance | `pod-security-standards` (`runAsNonRoot: true`; "Containers must not set runAsUser to 0", so a non-zero value is required only when one is set; privilege escalation not allowed; seccomp `RuntimeDefault` or `Localhost`; a volume-type allowlist); `network-policies` ("will have no effect" without a controller) |
| 29 | Bitnami README: Photon-based Secure Images, some metadata needs a subscription, legacy Debian registry; `valkey-helm` BSD-3-Clause | confirmed | `bitnami/charts` `main/README.md`; `valkey-io/valkey-helm` `main/LICENSE` and repository licence |
| 30 | PostgreSQL 17 (17.11) supported to 2029-11-08; JIT for long CPU-bound queries; `ALTER ROLE SET` | confirmed | `postgresql.org/support/versioning/`; PostgreSQL 17 `jit-decision.html`, `sql-alterrole.html` |
| 31 | UK GDPR Art. 9(1) biometric data; Art. 12(3) refers to Art. 12A and Articles 15–22D; DUAA ss. 76, 78, 80, 142 | confirmed | `legislation.gov.uk/eur/2016/679/article/9` and `/article/12` (as amended); `legislation.gov.uk/ukpga/2025/18/contents` |
| 32 | RCW 19.375: notice and consent before commercial enrolment; AG enforcement only; GLBA Title V exclusion; photographs excluded | **corrected** | `app.leg.wa.gov/RCW/default.aspx?cite=19.375&full=true`: .020(1) requires "providing notice, obtaining consent, or providing a mechanism to prevent the subsequent use" (alternatives, "context-dependent"); .030(2) "enforced solely by the attorney general"; .040(1) GLBA Title V; .010 excludes photographs and data generated from them. Corrected in place in section 8.2 |
| 33 | CPPA regulations effective 2026-01-01; risk assessments from 2026-01-01 (attestation by 2028-04-01); ADMT from 2027-01-01; audit certifications 2028, 2029 or 2030 by revenue | confirmed | `cppa.ca.gov/announcements/2025/20250923.html` |
| 34 | AI Act Annex III 1(a) excludes biometric verification whose sole purpose is to confirm a claimed identity | confirmed | `ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3` |
| 35 | Persona public API at `e64dbfbd`: base URL, bearer, `Key-Inflection` camel/kebab/snake, `page[after]`, `page[before]`, `page[size]`, `Persona-Signature` `t=,v1=`; dated `Persona-Version` | confirmed | `openapi.yaml` and the three parameter files at `e64dbfbd` (raw); `retrieve-an-inquiry.md` (`Persona-Version` enum of dated values) |
| 36 | Repository facts | confirmed | `apps/dashboard/next.config.ts` (no script CSP); `security-meta.ts` (meta only); `login-rate-limiter.ts` (an in-process `Map`); `USER_SESSION_TOKEN_TTL_SECONDS = 12 * 60 * 60`; no `advisory` or `lock` in `packages/db/src/migrate.ts`; no Gradle lockfile or `verification-metadata.xml` under `android/`; `apps/api/src/storage/index.ts` (`ListObjectVersions`, both permissions named); 89 `defineCheck(` in `check-registry.ts`; `docs/api/openapi.json` OpenAPI 3.1.0 with 121 paths; no DSAR export found; no session idle timeout (the only `idle` hits in `apps/api/src`, `apps/dashboard/src` and `packages/db/src` are HTTP-stream and pool timeouts) |
