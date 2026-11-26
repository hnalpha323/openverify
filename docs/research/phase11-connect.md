# Phase 11 research: reusable KYC, share tokens and connections (clean-room notes and standards)

Prepared 2026-10-29 for OpenVerify Phase 11 ("Connect / reusable KYC and hardening", `docs/PLAN.md` §6 and the "Connect /
Reusable" row of §2 [R1]); this note covers the Connect half. It records (a) the public behaviour of the vendor's sharing
between organisations (connections, share tokens, consent, reuse of a verified identity) and (b) the open standards a
self-hosted product could use beside or instead of it, with what each would cost.

Everything below is written in our own words. Field names, enum values, event names, API paths, scopes and SDK method names
are reproduced only because they are short identifiers needed for functional parity. No sentences, UI copy or help text are
copied. Anything the public sources do not state is marked **not documented**; statements we infer, and that no source
states, are marked **(inference)**. Every citation key (`[O5]`, `[D4]`, `[S1]`, ...) is defined in "Sources and pins" with
its full URL; every source was read on 2026-10-29. People, emails and ids are fictional (`example.com`); none of the
vendor's example values is reproduced except id prefixes. OpenVerify is not affiliated with Persona. Nothing here is legal
advice.

"OpenVerify today" means the working tree at `91c83e02`, read on 2026-10-29, with Phase 6 being closed by other agents: no
connection, share-token or consent-record resource exists; transactions (Phase 7), workflows (Phase 8) and the console work of
Phase 9 are planned but not built [R1].

---

## Summary

1. **Two objects, eight paths, five events.** `connect/connection` (`cxn_`) is a one-way link from a source organisation to
   a destination, created by the source, activated by the destination only in the dashboard, deactivated by either, never
   deleted. `connect/share-token` (`cnst_`) shares one inquiry, account, transaction or verification over an active
   connection [O1] [O2] [O7] [D2] [D3] [D6].
2. **The token is a handle, not a secret.** Only the connection's destination can read or redeem it, with its own API key or
   flow; it lives 60 s to 21 days (default 14 days); the source can expire it early; sandbox redeems only into sandbox
   [D3] [D4] [O3] [O5] [O6].
3. **Clone or hydrate.** Cloning copies an inquiry or a verification of six types with the source's statuses and checks;
   hydrating copies fields into an account, inquiry or transaction and runs the destination's own template; field mappings
   and account linking exist; redemption is a 202 and a job [D4] [O5] [H2].
4. **Peek before redeeming.** A destination with a separate capability sees a filtered snapshot where each attribute is the
   value or only whether it is present [O4] [O8].
5. **Consent is left to the customers.** Both organisations must obtain it; the vendor keeps no record, has no consent API,
   and documents no withdrawal; authenticity rests on the platform alone [H1] [D1] [D4].
6. **What OpenVerify should build now:** the same API between organisations on one install, plus consent records on both
   sides (recipient named, text hash, explicit biometric tick, withdrawal), a share policy per connection, explicit
   single-use and revocation rules, no tokens in URLs, and provenance with an opt-in before a cloned pass counts (gap tables;
   section 6.1).
7. **The law points the same way:** a consent record must show what was presented, every receiving controller must be named,
   withdrawal must be as easy as consent, and shared biometric data needs explicit consent [L2] [L3].
8. **The standards are ready but gated.** OpenID4VP 1.0 (Final, 2025-07-09), OpenID4VCI 1.0 (Final, 2025-09-16), HAIP 1.0
   (Final, 2025-12-24), SD-JWT (RFC 9901, 2025-11), VCDM 2.0 (Recommendation, 2025-05-15); SD-JWT VC and Token Status List are
   still drafts, the DC API a Working Draft, and the EUDI ARF is at v3.0.0 [S1]-[S10] [S13].
9. **Defer the wallet work.** Every wallet role needs a per-operator registration (EU relying-party access and registration
   certificates, Apple and Google onboarding), devices for testing, and libraries that published new versions today; Phase 5
   C68 still holds [S13] [R13] [R14] [N8].
10. **Defer** sharing between installs (an SD-JWT envelope design is in 3.4), report sharing (ADR 0005), the vendor's
    retiring wallet and its cross-network history check [R26] [H3] [H4].

## Gap tables

Verdicts: **MATCH** (adopt the public behaviour), **OURS** (no public counterpart, or we deliberately differ; labelled as
ours), **DEFER** (not in this release), **HONEST** (needs a third-party account or licensed data, or cannot be claimed: an
adapter with a deterministic sandbox provider under ADR 0002 tier A, or a stated limit) [R3]. Row ids R1... are not citation
keys; citation keys are always in brackets, and the repository sources are `[R1]`, `[R2]`, ... in "Sources and pins".

### Connections

| ID | Public behaviour (vendor) | What OpenVerify should do in Phase 11 | Why | Verdict |
|---|---|---|---|---|
| R1 | Objects `connect/connection` (`cxn_`) and `connect/share-token` (`cnst_`) [O1] [O2] | Same types and prefixes in `ID_PREFIXES` | Parity for migration | MATCH |
| R2 | One-directional, one per partner pair, created by the source from the destination's organisation id; self-connections for testing [D2] [H1] | Same; a self-connection allowed in both environments | Parity; testable on one install | MATCH |
| R3 | Activation only by the destination, only in the dashboard [D2] | Same: console only, by a user (not an API key) with the connect write permission | Activation is the destination's decision about a partner; a human should take it | MATCH (owner question) |
| R4 | Either side deactivates; only the source reactivates, back to `pending`; no deletion; `archived` internal [D2] [O7] [O2] | Same, plus: deactivation expires every unredeemed token on the connection | The spec only says deactivation stops further access [O7]; an outstanding token must not survive its connection | MATCH + OURS |
| R5 | The guide says the source picks the kinds of data to share at creation, but no API attribute exists; peek follows an undocumented source-side sharing configuration [D2] [O8] | A versioned share policy on the connection (source types, field allowlist, files, biometric, peek visibility), shown at activation | Minimisation and informed consent need the scope written down [L2] ¶55-65 | OURS |
| R6 | List filters `status`, `destination-organization-id`; both directions listed [O7] | Same | Parity | MATCH |

### Share tokens

| ID | Public behaviour (vendor) | What OpenVerify should do in Phase 11 | Why | Verdict |
|---|---|---|---|---|
| R7 | Create with `connection-id`, `source-id`, `expires-in-seconds` 60 to 1,814,400, default 14 days [D3] [O3] | Same, and require a consent record (or an attested consent) for the share | Consent is the lawful basis the vendor leaves to customers [H1] | MATCH + OURS |
| R8 | Sources: inquiry, account, transaction, verification; the spec adds report sources and destinations [D3] [O1] | Inquiry, account, verification now; transaction once Phase 7 ships it; reports deferred | Reports carry list- and time-bound "no match" results (ADR 0005) [R26] | MATCH (+ DEFER for reports) |
| R9 | Statuses `created`, `ready`, `pending`, `redeemed`, `expired`, `failed`; reasons `source_not_found`, `source_redacted`, `import_failed`, `unrecoverable_error` [D4] [O1] | Same without `ready` | No cached PII snapshot to redact | MATCH (OURS for `ready`) |
| R10 | `direction` `outbound`/`inbound` and the timestamps; what each side sees depends on who asks [O1] [O9] | Same; the destination never sees `creator` | Parity; least disclosure | MATCH |
| R11 | Early expiry only by the source [D3] [O6] | Same | Parity | MATCH |
| R12 | Redeem: clone (inquiry; verification of six types) or hydrate (account, inquiry, transaction), `meta.field-mappings`, account linking, 202 and a background job [D4] [O5] | Same | Parity | MATCH |
| R13 | Sandbox only to sandbox, production only to production [D4] | Same, with `environment_kind_mismatch` | ADR 0002 keeps sandbox data out of production [R3] | MATCH |
| R14 | Single use implied, not stated [O5] | Stated: a second redeem is 409 `share_token_already_redeemed`, under a row lock | Replay control must be explicit | OURS |
| R15 | Peek with `peek-source-data=true`, `{visibility: full\|presence, value}`, a separate capability [O4] [O8] | Same, behind `connect-share-tokens:peek` and `pii:view`, filtered by the R5 policy, audited | Parity; least privilege | MATCH |
| R16 | The token id is the handle; only the destination can redeem [D3] [O5] | Same; one indistinguishable 404; `connect-redeem` and `connect-peek` rate limits | Not a bearer secret, so no secret to store; enumeration slowed | MATCH + OURS |
| R17 | Client-side redemption: `share-token` in the hosted URL with a template id, or `shareToken` in the SDKs; the flow shows a consent screen [D4] | The destination's backend creates the inquiry with `meta.share-token-id`; the flow (web and Android `commonMain`) shows a share-consent step; no token in any URL | OpenVerify's flow has no template-id entry and keeps credentials in the fragment [R24]; ASVS 14.2.1 [X5] | OURS |
| R18 | Five token events; no connection events [D6] | The vendor's four (and `ready` only with a prefetch) plus ours for expiry, failure, connections, consent withdrawal and source redaction | Operators need every state change | MATCH + OURS |
| R19 | Scopes `connect.*`, `connect_connection.*`, `connect_share_token.*` [D7] | `connect-connections:read`/`write`, `connect-share-tokens:read`/`write`/`redeem`/`peek` | OpenVerify's scope naming [R15] | MATCH (renamed) |
| R20 | Cloned marker and banner naming the token; hydrated objects unmarked [H2] | Same in the console, and a `provenance` object in the API | Machine-readable provenance for the destination's own systems | MATCH + OURS |
| R21 | A cloned verification keeps the source's status and checks [H2] | Same data, but a cloned result satisfies a required check only if the destination template sets `accept-cloned-results`; otherwise `needs_review` | Never a fresh pass by default (CLAUDE.md rule 5, ADR 0002 §3b) [R2] [R3] | HONEST |
| R22 | API, dashboard, workflows and SDK integration [D1] [D3] [D4] | API, console (Phase 9 shell) and workflow actions (Phase 8 engine) in Phase 11 | Both engines exist by then | MATCH |
| R23 | Authenticity rests on the platform; no signature or proof [D1] [D4] | Same for one install, stated in the docs; signed envelopes only between installs, later | Honest statement of the trust assumption | MATCH + HONEST (shape 2 DEFER) |

### Consent

| ID | Public behaviour (vendor) | What OpenVerify should do in Phase 11 | Why | Verdict |
|---|---|---|---|---|
| R24 | Consent is each organisation's job; no record, API or token reference [H1] [D1] | A consent record per share on both sides: purpose, named recipient, data categories, the exact text's hash and stored copy, method (`flow` or `attested`), expiry | GDPR Art. 7(1) record keeping and the named-controller rule [L2] ¶64-65, ¶108 | OURS |
| R25 | Withdrawal not documented | Withdrawal by API and console, expiring every unredeemed token and notifying both sides | Art. 7(3) [L2] ¶112-114 | OURS |
| R26 | Biometric consent screen in the selfie module [H9]; nothing specific to sharing | A separate explicit tick for biometric categories in a share; face templates never shared | Art. 9 explicit consent [L2] ¶91-93 [L3] ¶76-82 | OURS |
| R27 | A production agreement with the vendor, signed by each side [D1] | At activation, the destination records the reference of its data-sharing agreement with the partner (free text, audited) | The two controllers need an agreement; the platform can only record that one exists | OURS (owner question) |

### Neighbouring features and standards

| ID | Public behaviour or standard | What OpenVerify should do in Phase 11 | Why | Verdict |
|---|---|---|---|---|
| R28 | Reusable personas: a passkey wallet held by the vendor; events `inquiry.reusable-persona-*`, `checkpoint.reusable-persona-used`; `from-reusable-persona` [D6] [O10] [C1] [H5] [H6] | Not built; the events and attribute are not emitted | The vendor is replacing it [H3] [H4] | DEFER |
| R29 | Cross-network history lookup with an opt-in (closed beta) [H3] [H4] | Not built | Needs many customers' verifications in one place (inference) | DEFER |
| R30 | OAuth object grants (restricted API) [D8] [O11] | Not built | Connect covers the need | DEFER |
| R31 | Claim-only results with Privacy Pass (RFC 9577/9578) [D9] [D10] [C2] | Not built | Specialised; later | DEFER |
| R32 | OpenID4VP 1.0 Final, HAIP 1.0 Final, SD-JWT VC draft, DC API Working Draft [S1] [S3] [S5] [S10] | No verifier this release; keep the C62 trust store generic | Section 4.3 | DEFER |
| R33 | OpenID4VCI 1.0 Final [S2] | No issuer this release | Section 4.3 | DEFER |
| R34 | ISO/IEC 18013-5 and TS 18013-7 [S11] [S12] [S15] | No mdoc verifier this release (Phase 5 C68) | Section 4.3 [R13] | DEFER |
| R35 | EUDI ARF v3.0.0: relying-party registration, access and registration certificates [S13] | Document what an operator would need; build nothing | Each operator registers on its own | HONEST (docs only) |
| R36 | (no public counterpart) sharing between two installs | Design notes only (3.4) | Shape 2 | DEFER |

## Carried into this phase

Found by grepping `docs/plans/*.md` (and, for context, `docs/PROGRESS.md` and the earlier research notes) for "Phase 11",
"Connect", "carried to", "later phase", "deferred" and "reusable" at `91c83e02` [R1] [R12] [R13] [R14] [R27] [R18] [R4]. Only `phase-6.plan.md`
names Phase 11 outright; Phase 5 defers mdoc and verifiable credentials without naming a phase, and its research note points
them at Phase 11.

**In this note's subject (Connect, reusable KYC, credentials):**

| # | Item | Where | What it hands over |
|---|---|---|---|
| K1 | "Connect snapshots (Phase 11)" | `docs/plans/phase-6.plan.md:577` (C88 Deferred) | Reports are not shared through Connect in Phase 6; the snapshot of a report for a receiving organisation is Phase 11 work |
| K2 | "X1–X5: workflows, cases, dashboard, sandbox inputs, Connect … the rest later (C88)" | `docs/plans/phase-6.plan.md:202` (parity table) | The Connect row (X5) of the Phase 6 parity table is left to a later phase |
| K3 | "C68. mdoc and verifiable credentials (deferred)" | `docs/plans/phase-5.plan.md:604-606`; owner decision 44 at `:764` ("Default: deferred") | Not in Phase 5: wallets gate verifiers per deployer, end-to-end tests need a phone and wallet, the TypeScript libraries moved in 2026, AAMVA's VICAL has its own terms. The C62 trust store stays generic so IACA roots can join later |
| K4 | "keep this out of Phase 5 … or as part of Phase 11 (Connect / reusable KYC)" | `docs/research/phase5-nfc.md:696` (research, not a plan) | The mdoc stretch slice, with a scope already proposed there (`org-iso-mdoc` plus `openid4vp-v1-unsigned`, `@owf/mdoc` pinned, fixtures, a sandbox provider, new check ids in PLAN §4 first; SD-JWT VC and EUDI PID later) |
| K5 | Phase 5 "mdoc / verifiable credentials are a stretch goal (OpenID4VP / Digital Credentials API)" | `docs/PLAN.md` §6 Phase 5 | Same subject as K3 |
| K6 | The Connect snapshot of a selfie verification carries `peekable-attributes` | `docs/research/phase4-selfie-behaviour.md:189` (research) | Selfie is one of the shareable verification types (section 1.3 below) |
| K7 | "Connect can share a PII-filtered snapshot of the verification" (phone) | `docs/research/phase5-behaviour.md:529` (research) | Phone is another shareable type (section 1.3) |
| K8 | `inquiry.reusable-persona-created`, `inquiry.reusable-persona-used`; `connect/*` paths | `docs/research/persona-surface.md:305-306, 427-434` | The coverage checklist's Connect identifiers (section 1) |

**Phase 11 items outside this note's subject** (hardening; listed so the phase plan keeps them, not researched here):

| # | Item | Where |
|---|---|---|
| K9 | An HTTP conditional request (ETag or Last-Modified) for the watchlist refresh, optional; a `200` still goes through the SHA-256 comparison | `docs/plans/phase-6.plan.md:1258` (decision 10); `docs/PROGRESS.md:81` |
| K10 | The UN list opt-in with an acknowledgement of the UN's terms | `docs/plans/phase-6.plan.md:1279` (decision 21); `docs/PROGRESS.md:83-84` |
| K11 | Per-tenant queue quotas (no cap on pending media runs per environment today) | `docs/plans/phase-6.plan.md:1280` (decision 22); `docs/PROGRESS.md:83` |
| K12 | Threat model (STRIDE), OWASP ASVS L2 checklist, security scan, k6 load test, Helm chart, complete docs | `docs/PLAN.md` §6 Phase 11 |

Nothing in `phase-7.plan.md` or `phase-8.plan.md` names Phase 11. No plan defers a DSAR export, a consent-withdrawal path or
data portability, although PLAN §3 lists "DSAR export" under data protection by design [R1]; section 2 below treats them as
part of the consent work, since sharing needs them.

## Corrections to the repository's records

1. **Events missing from `persona-surface.md`** [R4]. The events page lists `connect/share-token.outbound-created`,
   `connect/share-token.outbound-redeemed`, `connect/share-token.inbound-created`, `connect/share-token.ready`,
   `connect/share-token.inbound-redeemed`, `inquiry.reusable-persona-updated`, `inquiry.reusable-persona-assurance-failed`
   and `checkpoint.reusable-persona-used` [D6]; the spec has webhook files for none of them [G4], which is why the
   machine-extracted index missed them. (The index's 183 paths already include the eight `connect/*` paths, `oauth/*`,
   `relays*` and `privacy-passes` [R4].)
2. **PLAN §2, "Connect / Reusable" row** [R1]. Accurate as far as it goes ("share tokens between orgs (clone/hydrate),
   connections, consent"), but in the vendor's product consent is the customers' responsibility with no record [H1] [D1];
   the row should add the peek view with `full`/`presence` visibility, field mappings, client-side redemption,
   environment-kind matching, the asynchronous redeem, and that both organisations must be on the same platform. "Reusable"
   personas are being replaced by a cross-network history check, which does not apply to a self-hosted install [H3] [H4].
3. **`docs/research/phase5-nfc.md` §8 standards table** [R14], read 2026-10-21:
   - HAIP 1.0 is Final with a date: **24 December 2025** [S3];
   - SD-JWT VC is now `draft-ietf-oauth-sd-jwt-vc-22` (2026-10-27), in IESG evaluation, not `-19` [S5];
   - the Digital Credentials API is still a Working Draft, now dated **20 October 2026** [S10];
   - library rows moved: `@openid4vc/openid4vp` latest 0.9.0 (pinnable still 0.7.0), `@sd-jwt/sd-jwt-vc` latest 0.24.0
     (pinnable still 0.22.0), `@owf/mdoc` latest 0.9.2 (pinnable still 0.8.2) [N1] [N5] [N6].
4. **Phase 6 C88 "Connect snapshots (Phase 11)"** [R12]: the vendor's spec does include report sources, destinations and
   snapshot subtypes for five report types [O1] [O8]; this note recommends that Phase 11 defer them (R8), which the Phase 11
   plan should record against C88.
5. **The share token is not a secret in the vendor's design** (section 1.1): any plan text that treats `cnst_…` as a bearer
   token to hash at rest would be over-engineering shape 1; the protection is the destination binding [D3] [O5].

## Sources and pins

**Read date and method.** Every source below was read on **2026-10-29**. Each host's `robots.txt` was read before any other
request to it and matched under RFC 9309 (longest match, `*` and `$`, every other character literal; Python's `robotparser`
was replaced because it drops the literal `?` in W3C's `Disallow: /TR/?` and would wrongly refuse all of `/TR/`). Results:
`docs.withpersona.com` disallows only `/api/fern-docs/`; `help.withpersona.com` disallows only `/gated/` (its content-signals
preamble sets no signal); `openid.net` only `/wp-admin/`; `www.rfc-editor.org` only `/rfc/authors/`, `/rfc/rerendered/`,
`/rfc/v3test/`; `datatracker.ietf.org` only `/doc/pdf/`; `www.w3.org` refuses `/TR/` URLs with a query string, which we never
requested; `www.edpb.europa.eu` refuses Drupal internals, not the guideline paths; `api.github.com` and
`raw.githubusercontent.com` answered 404 (no restriction); `registry.npmjs.org` has no robots file (that path is an npm
package document). `www.iso.org` (HTTP 403) and `eur-lex.europa.eu` (HTTP 202, empty body) answered automated-traffic
challenges, robots file included; nothing was retried or worked around, and those sources are marked as not read. At least
2 s between requests to one host (sibling agents use the same hosts), redirects never followed automatically (the two EDPB
redirects, within the same host, were fetched explicitly after the checks), User-Agent
`OpenVerify-cleanroom-research/1.0 (standards and docs reading; no contact)`, GitHub API unauthenticated, no personal data
sent. 175 requests in all: 171 answered 200. Downloads, about 16 MB, sit outside git under
`resume/phase9-11-research/downloads/` in `cn-persona/`, `cn-standards/`, `cn-law/`, `cn-security/` and `cn-npm/`, stored
as served; the readers are `scripts/cn_fetch.py`, `cn_verify_blobs.py`, `cn_html_text.py` and `cn_npm.py`, run with
`python3 -I` (the Phase 8 `as_pdf_text.py` was reused, read-only, for the two EDPB PDFs). Nothing downloaded was executed.
Names, emails and ids in the vendor's examples are not reproduced except as id prefixes.

**OpenAPI (O).** Repository `github.com/persona-id/persona-openapi`, licence Apache-2.0 [G1], commit
**`e924fe7f92ae3a0696d9fd194370afe6cf8faf57`** (HEAD on 2026-10-29, committed 2026-10-29T08:06:59Z, root tree `060b41e3`)
[G2], directory `2026-09-29/` (tree `b665d27249a0e1d072e4d1650c9152a0b761b728`, 914 entries, not truncated) [G3] [G4]. This
is two commits newer than the Phase 7 and 8 pin `e64dbfb`. Licence verdict: ✅ Apache-2.0 for reading; used for identifiers
only, nothing copied or shipped. 62 files were downloaded from `raw.githubusercontent.com` at that commit and all 62 match
the git blob hashes of the tree. Every `O` link is
`https://github.com/persona-id/persona-openapi/blob/e924fe7f92ae3a0696d9fd194370afe6cf8faf57/2026-09-29/` followed by the
path (`{`/`}` written `%7B`/`%7D`).

| Key | What | Path |
|---|---|---|
| O1 | Share token schema | `components/schemas/connect-share-token.yaml` |
| O2 | Connection schema | `components/schemas/connect-connection.yaml` |
| O3 | List and create share tokens | `paths/connect_share-tokens.yaml` |
| O4 | Retrieve a share token (`peek-source-data`) | `paths/connect_share-tokens_{share-token-id}.yaml` |
| O5 | Redeem a share token | `paths/connect_share-tokens_{share-token-id}_redeem.yaml` |
| O6 | Expire a share token | `paths/connect_share-tokens_{share-token-id}_expire.yaml` |
| O7 | Connections: list, create, retrieve, deactivate, reactivate | `paths/connect_connections.yaml`, `paths/connect_connections_{connection-id}.yaml`, `_deactivate.yaml`, `_reactivate.yaml` |
| O8 | Source-data snapshots (25 files) | `components/schemas/source-data.yaml`, `source-data-base.yaml`, `source-data-peekable-attribute.yaml`, `source-data-related-object.yaml`, `source-data-inquiry.yaml`, `source-data-account.yaml`, `source-data-txn.yaml`, `source-data-verification-*.yaml`, `source-data-report-*.yaml` |
| O9 | Examples | `components/examples/connect-share-token*.yaml`, `connect-connection*.yaml`, `create-share-token.yaml`, `create-connection.yaml`, `redeem-share-token-*.yaml` |
| O10 | Reusable-persona webhooks and bodies | `webhooks/inquiry.reusable-persona-{created,used}.yaml`, `components/examples/inquiry-reusable-persona-{created,used}-webhook-body.yaml` |
| O11 | OAuth object grants | `paths/oauth_authorize.yaml`, `paths/oauth_token.yaml` |
| O12 | Relay and Privacy Pass | `paths/relays.yaml`, `paths/relays_challenge.yaml`, `paths/relays_{relay-token}_generate-claim.yaml`, `paths/privacy-passes.yaml` |
| O13 | Root document | `openapi.yaml` |

| Key | GitHub API (`https://api.github.com/repos/persona-id/persona-openapi` + suffix) |
|---|---|
| G1 | (none): `license.spdx_id: Apache-2.0`, default branch `main`, pushed 2026-10-29T08:07:03Z |
| G2 | `/commits?per_page=5`: HEAD `e924fe7`, 2026-10-29T08:06:59Z, root tree `060b41e3a93529c59242f1f172eea0e65f46e870` |
| G3 | `/git/trees/060b41e3a93529c59242f1f172eea0e65f46e870`: version directories `2020-05-18` … `2026-09-29`, `LICENSE`, `README.md` |
| G4 | `/git/trees/b665d27249a0e1d072e4d1650c9152a0b761b728?recursive=1`: 914 entries, `truncated: false`; no `webhooks/connect*` file |

**Developer docs (D) and changelog (C).** `https://docs.withpersona.com/2026-09-29/` + path, read as Markdown, found through
the root index `https://docs.withpersona.com/llms.txt` (18 lines) and the version index `…/2026-09-29/llms.txt` (579 lines)
[D11]. The changelog index `…/updates/changelog/llms.txt` lists 97 entries; the Phase 8 research had downloaded all of them
on 2026-10-27 and a search of those copies found Connect-adjacent changes only in the two entries below, which were fetched
again today.

| Key | Path | Key | Path |
|---|---|---|---|
| D1 | `connect.md` | D7 | `api-keys.md` (permissions) |
| D2 | `managing-connections.md` | D8 | `api-reference/oauth.md` |
| D3 | `creating-share-tokens.md` | D9 | `relay.md` |
| D4 | `redeeming-share-tokens.md` | D10 | `relay-privacy-pass-challenge.md`, `relay-getting-started.md` |
| D5 | `api-reference/connect.md` | D11 | `llms.txt` (root and version) |
| D6 | `events.md` | D12 | the ten `api-reference/connect/...` pages and the two reusable-persona webhook pages (generated from the spec; read to confirm only) |
| C1 | `updates/changelog/2025/2/18.md` (`from-reusable-persona`) | C2 | `updates/changelog/2026/6/9.md` (Relay API) |

**Help Center (H).** `https://help.withpersona.com/articles/<id>.md`, found through `https://help.withpersona.com/llms.txt`
(1,092 lines) [H11].

| Key | Article (id) | Key | Article (id) |
|---|---|---|---|
| H1 | Connect overview (`zzRSkDCvFP5sRV175hH1Yg`) | H6 | Deleting the wallet (`5TFD1PWqZauorJIx4xZINx`) |
| H2 | Cloned verifications (`YSIPeGXqLsbAVz7otmw3e5`) | H7 | Deleting my data (`L7RVZ2m0jZjmHqbMzoLYAJ`) |
| H3 | Cross-network history check overview (`4Yl6a7VEH2ScPfAHDif0Ts`, updated 2026-10-09) | H8 | Who sees a result (`JdiWgdkg6jQcDrI1d9BuxV`) |
| H4 | The same, for end users (`4DXUhrP7e1sLBj2SKIDsMX`) | H9 | Selfie verification module (`2LL51Yo6PvO7uIu2FYfZ16`) |
| H5 | The wallet app (`5CFj1LaOtoFmzbTA2vRUBO`) | H10 | Security and privacy overview (`4SxXLtuLwYAWSkxWbHQtoo`) |
| H11 | `https://help.withpersona.com/llms.txt` | | |

**Standards (S).**

| Key | Document | Status as read | URL |
|---|---|---|---|
| S1 | OpenID for Verifiable Presentations 1.0 | Final, 9 July 2025 | https://openid.net/specs/openid-4-verifiable-presentations-1_0.html |
| S2 | OpenID for Verifiable Credential Issuance 1.0 | Final, 16 September 2025 | https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html |
| S3 | OpenID4VC High Assurance Interoperability Profile 1.0 | Final, 24 December 2025 | https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0.html |
| S4 | RFC 9901, Selective Disclosure for JSON Web Tokens | Standards Track, November 2025 | https://www.rfc-editor.org/rfc/rfc9901.txt |
| S5 | `draft-ietf-oauth-sd-jwt-vc` | rev 22, 2026-10-27; Active, IESG Evaluation | https://datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/ (read through `https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-oauth-sd-jwt-vc/?format=json` and `/api/v1/doc/state/<n>/`) |
| S6 | `draft-ietf-oauth-status-list` | rev 21 of 2026-06-21 (the datatracker record was last updated 2026-08-13; corrected in fact-check); RFC Editor queue, in progress | https://datatracker.ietf.org/doc/draft-ietf-oauth-status-list/ (same API) |
| S7 | W3C Verifiable Credentials Data Model 2.0 | Recommendation, 15 May 2025 | https://www.w3.org/TR/vc-data-model-2.0/ (dated: https://www.w3.org/TR/2025/REC-vc-data-model-2.0-20250515/) |
| S8 | W3C Securing VCs using JOSE and COSE | Recommendation, 13 October 2026 (earlier 15 May 2025) | https://www.w3.org/TR/vc-jose-cose/ (https://www.w3.org/TR/2026/REC-vc-jose-cose-20261013/) |
| S9 | W3C Bitstring Status List 1.0 | Recommendation, 15 May 2025 | https://www.w3.org/TR/vc-bitstring-status-list/ |
| S10 | W3C Digital Credentials | Working Draft, 20 October 2026 | https://www.w3.org/TR/digital-credentials/ (https://www.w3.org/TR/2026/WD-digital-credentials-20261020/) |
| S11 | ISO/IEC 18013-5:2021 | **not read** (bot challenge) | https://www.iso.org/standard/69084.html |
| S12 | ISO/IEC TS 18013-7:2025 | **not read** (bot challenge); content from [R14] | https://www.iso.org/standard/91154.html |
| S13 | EUDI Wallet Architecture and Reference Framework v3.0.0 | released 2026-07-23T19:10:17Z; CC BY 4.0 (README); read `docs/main/03-roles-within-the-eudi-wallet-ecosystem.md` §3.11, `05-data-model-and-data-exchange-protocols.md` §5.4, `06-trust-model.md` at tag `v3.0.0` | https://github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework (releases: `…/releases`, API `https://api.github.com/repos/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework/releases`) |
| S14 | Regulation (EU) 2024/1183 (European Digital Identity), Art. 5b(10) | **not read** (EUR-Lex challenge); quoted from [S13] §3.11.4 | https://eur-lex.europa.eu/eli/reg/2024/1183/oj |
| S15 | ISO/IEC JTC 1/SC 17/WG 10 public working drafts | repository last pushed 2025-12-24; `Working Documents/` lists the 18013-5 second-edition CD ballot resolution (v3, v4) and N2549 drafts and the "N2544 18013-7 second edition DTS candidate" | https://github.com/ISOWG10/ISO-18013 |

**Law and guidance (L).**

| Key | Document | URL |
|---|---|---|
| L1 | Regulation (EU) 2016/679 (GDPR) | https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng (**not read**: HTTP 202 with an empty body) |
| L2 | EDPB Guidelines 05/2020 on consent under Regulation 2016/679, version 1.1 (adopted 4 May 2020; v1.1 of 13 May 2020) | https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf (landing: https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en) |
| L3 | EDPB Guidelines 3/2019 on processing of personal data through video devices, version 2.0 (adopted 29 January 2020; v2.1 of 26 February 2020) | https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_201903_video_devices_en_0.pdf |

**Security (X).**

| Key | Document | URL |
|---|---|---|
| X1 | RFC 9449, OAuth 2.0 Demonstrating Proof of Possession (DPoP), September 2023 | https://www.rfc-editor.org/rfc/rfc9449.txt |
| X2 | RFC 9700 (BCP 240), Best Current Practice for OAuth 2.0 Security, January 2025 (§2.2, §2.3, §4.3) | https://www.rfc-editor.org/rfc/rfc9700.txt |
| X3 | RFC 8725 (BCP 225), JSON Web Token Best Current Practices, February 2020 | https://www.rfc-editor.org/rfc/rfc8725.txt |
| X4 | OWASP ASVS releases: `v5.0.0_release` published 2025-05-30 | https://api.github.com/repos/OWASP/ASVS/releases |
| X5 | OWASP ASVS 5.0.0: V7 Session Management, V8 Authorization, V9 Self-contained Tokens, V14 Data Protection, Appendix C | https://github.com/OWASP/ASVS/tree/v5.0.0_release/5.0/en (files `0x16-V7-…`, `0x17-V8-…`, `0x18-V9-…`, `0x23-V14-…`, `0x92-Appendix-C_…`) |

**Packages (N).** Registry metadata from `https://registry.npmjs.org/<name>` (packuments, for dates) or
`https://registry.npmjs.org/<name>/<version>` (version documents, for licences of transitive packages).

| Key | What | URL |
|---|---|---|
| N1 | `@openid4vc/openid4vp` | https://registry.npmjs.org/@openid4vc%2Fopenid4vp |
| N2 | `@openid4vc/openid4vci` | https://registry.npmjs.org/@openid4vc%2Fopenid4vci |
| N3 | `@openid4vc/oauth2`, `@openid4vc/utils` | https://registry.npmjs.org/@openid4vc%2Foauth2, https://registry.npmjs.org/@openid4vc%2Futils |
| N4 | `@sd-jwt/core` | https://registry.npmjs.org/@sd-jwt%2Fcore |
| N5 | `@sd-jwt/sd-jwt-vc` | https://registry.npmjs.org/@sd-jwt%2Fsd-jwt-vc |
| N6 | `@owf/mdoc` | https://registry.npmjs.org/@owf%2Fmdoc |
| N7 | `jose` (6.2.12 of 2026-09-05; 6.2.14 of 2026-10-29) | https://registry.npmjs.org/jose |
| N8 | `openwallet-foundation-labs/identity-common-ts`: Apache-2.0, created 2026-02-04, 12 stars; `LICENSE` (Apache-2.0 text) at tag `v0.4.2`, the release tag of 2026-10-07, the day `@openid4vc/*` 0.7.0, `@sd-jwt/*` 0.22.0 and `@owf/*` 0.4.2 and `@owf/mdoc` 0.8.2 were published (that all of them were built from that tag is **(inference)** from the shared date; the packuments carry no `gitHead`) | https://api.github.com/repos/openwallet-foundation-labs/identity-common-ts, `/tags?per_page=100`, https://raw.githubusercontent.com/openwallet-foundation-labs/identity-common-ts/v0.4.2/LICENSE |
| N9 | `panva/jose`: MIT; `LICENSE.md` at `v6.2.12` | https://api.github.com/repos/panva/jose, https://raw.githubusercontent.com/panva/jose/v6.2.12/LICENSE.md |
| N10 | Transitive: `@owf/token-status-list`, `@owf/identity-common`, `@owf/cose` (packuments); `pako` 3.0.2 ("MIT AND Zlib"), `cbor-x` 1.6.6 (MIT, optional `cbor-extract`), `zod-validation-error` 5.0.0 (MIT), `buffer` 6.0.3 (MIT) (version documents) | https://registry.npmjs.org/@owf%2Ftoken-status-list, `…/@owf%2Fidentity-common`, `…/@owf%2Fcose`, https://registry.npmjs.org/pako/3.0.2, `…/cbor-x/1.6.6`, `…/zod-validation-error/5.0.0`, `…/buffer/6.0.3` |

**Repository (R).** Read-only paths at `91c83e02` (2026-10-29 09:23 -0400).

| Key | Path | Key | Path |
|---|---|---|---|
| R1 | `docs/PLAN.md` §2, §3, §6 | R15 | `packages/core/src/permissions.ts` |
| R2 | `CLAUDE.md` rules 4 and 5 | R16 | `packages/db/src/tables/audit-logs.ts` |
| R3 | `docs/adr/0002-check-tiers.md` | R17 | `packages/contracts/src/ids.ts` |
| R4 | `docs/research/persona-surface.md` | R18 | `docs/research/phase5-behaviour.md` §9, `docs/research/phase4-selfie-behaviour.md` :189 |
| R5 | `packages/contracts/src/tokens.ts` | R19 | `docs/adr/0004-mobile-kotlin-multiplatform.md` |
| R6 | `packages/db/src/tables/inquiries.ts` (consent record, sessions) | R20 | `packages/contracts/src/flow-api.ts` |
| R7 | `apps/api/src/services/one-time-links.ts` | R21 | `packages/contracts/src/inquiry-templates.ts` (default consent step) |
| R8 | `packages/db/src/tables/tenancy.ts` | R22 | `apps/api/src/services/flow.ts` |
| R9 | `apps/api/src/services/redaction.ts`, `accounts.ts` | R23 | `packages/contracts/src/rate-limits.ts` |
| R10 | `apps/api/src/services/retention.ts` | R24 | `packages/contracts/src/flow-url.ts` |
| R11 | `packages/contracts/src/event-names.ts`, `apps/api/src/services/events.ts`, `webhooks.ts` | R25 | `packages/checks/package.json`, `pnpm-workspace.yaml` (`@noble/curves` 2.4.0) |
| R12 | `docs/plans/phase-6.plan.md` :202, :577, :1258, :1279, :1280 | R26 | `docs/adr/0005-report-honesty-and-live-public-sector-data.md` |
| R13 | `docs/plans/phase-5.plan.md` C68 :604-606, decision 44 :764, decision 31 confirmed :1264 | R27 | `docs/PROGRESS.md` :18, :81-84 |
| R14 | `docs/research/phase5-nfc.md` §8 (:694-760) | R28 | `THIRD_PARTY_LICENSES.md` (Zlib and 0BSD records) |

## 1. Share tokens and connections (public behaviour)

Everything in this section describes the vendor's public behaviour in our own words. "Organisation" means a customer
organisation of the hosted service; both sides of every share are customers of the same hosted service [D1] [H1].

### 1.1 Objects and ids

| Object | Type | Id prefix | Source |
|---|---|---|---|
| Connection | `connect/connection` | `cxn_` | [O2] [D2] |
| Share token | `connect/share-token` | `cnst_` | [O1] [D3] |
| Source-data snapshot (peek) | `connect/source-data/<subtype>`, for example `connect/source-data/inquiry`, `connect/source-data/verification/government-id`, `connect/source-data/report/watchlist` | carries the source object's own id | [O8] |

The share token's id is also the value that travels between the organisations: the redeem path parameter is described as
"the token/ID" [O5], the hosted-flow URL carries `share-token=cnst_…` [D4], and the create response holds no separate secret
[O1] [O9]. So the public design is **not a bearer secret**: a token is redeemable only by the destination organisation named by
its connection, authenticated by that organisation's own API key or flow [D3] (the binding is stated; the absence of any
other secret is **(inference)** from the schema, which has no secret attribute).

### 1.2 Connections

- **One direction, one partner.** A connection pairs one source organisation with one destination organisation and allows
  data to move only from source to destination; two-way sharing takes two connections; each partner pair has one connection
  [D2]. An organisation may connect to itself, which is how testing without a partner works [H1] [D1].
- **Creation.** Only the source creates it, by the destination's organisation id
  (`data.attributes.destination-organization-id`); it starts `pending` [D2] [O7].
- **Activation.** Only the destination activates it, and only from the dashboard; there is no API for activation [D2].
  Tokens cannot be issued while a connection is `pending` or `inactive` [D2]; the create path says tokens cannot be redeemed
  through it until it is active [O7].
- **Deactivation.** Either side can move `pending` or `active` to `inactive`; deactivation stops further access but keeps the
  record; an `inactive` connection cannot be deactivated again [O7] [D2].
- **Reactivation.** Only the source can reactivate, and it returns the connection to `pending`, so the destination must
  accept again before data flows; the docs frame this as the destination re-consenting [D2] [O7].
- **No deletion.** Connections cannot be deleted [O7]. The schema adds `archived`, which is never listed or retrieved directly
  and appears only as the connection of an existing token [O2].
- **Attributes:** `status`, `source-organization-id`, `destination-organization-id`, `created-at`, `updated-at`; relationship
  `creator` (`user` or `api-key`) [O2]. List filters: `status`, `destination-organization-id`; the list holds both outbound
  and inbound connections [O7].
- **What a connection scopes.** The guide says the source picks the kinds of data to share when it creates the
  connection [D2], but neither the create body nor the schema has any such attribute [O2] [O7]. The peek snapshot is filtered
  by a sharing configuration of the source organisation (the spec calls it its PII-share configuration) [O8], whose API and
  shape are **not documented**.

### 1.3 What can be shared

| Mode | Source object | Destination | What moves | Source |
|---|---|---|---|---|
| **Clone** (no `destination-id`) | an inquiry (with its verifications) or one verification | a new object of the same kind in the destination | a copy of the results with the same status and check results as at the source; supported verification types: government ID, selfie, database, generic document, email address, phone number | [D4] [O5] [H2] |
| **Hydrate** (`destination-id` given) | an account, inquiry or transaction | an existing account, inquiry or transaction, any combination | fields only; no verifications or reports are copied; an inquiry destination is run through the destination's own template, its verifications and reports | [D4] [O5] |

- **Sources by document.** The guides name inquiries, transactions, accounts and verifications [D3]; the Help Center names
  inquiries, accounts and transactions [H1]; the schema's examples also show `report/email-address`,
  `report/politically-exposed-person` and `report/screening` as sources and destinations, and the snapshot union has subtypes
  for five report types [O1] [O8]. Report sharing is therefore in the spec but **not documented** in the guides.
- **Field mapping (hydrate only).** Fields match by name; `meta.field-mappings` pairs `source-field-name` with
  `destination-field-name` for the rest, with dot notation for nested destinations [D4] [O5].
- **Account linking (clone of an inquiry only).** `meta.account-id`, or `meta.auto-create-account-reference-id` with
  `meta.auto-create-account-type-id` (required to create, since there is no default account type); mutually exclusive with
  each other and with `destination-id` [O5].
- **Missing data.** A hydrated inquiry that lacks a field the destination template needs stops in `created` or `pending`;
  the end user can be sent back to finish only what is missing [D4] [H1].
- **Provenance in the console.** A cloned verification shows a "Cloned" marker and a cloned inquiry a banner naming the
  share token; hydrated objects are not marked, because they ran their own checks; the marker needs the verification-view
  permission [H2]. The record calls this the replication method, `clone` or `hydrate` [H2]; the API attribute for it is
  `redeem-mode` on the token [O1]. Whether the cloned object itself carries a provenance attribute in the API is **not
  documented**.

### 1.4 Token lifetime, use and statuses

- **Lifetime.** `expires-in-seconds` from 60 to 1,814,400 (21 days); 14 days when omitted [D3] [O3]. The examples show a new
  token with `expires-at: null` [O9], which contradicts the default **(inconsistency in the vendor's material)**.
- **Statuses.** `created` (redeemable), `ready` (the source snapshot was prefetched and cached), `pending` (redemption in
  progress), `redeemed`, `expired`, `failed` (not retryable) [D4]. The schema's list omits `ready` [O1].
- **Failure reasons:** `source_not_found`, `source_redacted`, `import_failed`, `unrecoverable_error` [O1].
- **Single use.** Redemption is asynchronous (202 with `pending`), and `redeemed` and `failed` are final [D4] [O5]. That a
  redeemed token cannot be redeemed again is implied by the final statuses and the 409 in the error list, but is **not
  stated** [O5].
- **Environments.** Sandbox tokens redeem only into sandbox and production only into production [D4].
- **Attributes:** `status`, `direction` (`outbound` for the source, `inbound` for the destination), `created-at`,
  `updated-at`, `pending-at`, `redeemed-at`, `expires-at`, `failed-at`, `failure-reason`, `redeem-mode`, and `source-data`
  (peek only); relationships `connection`, `creator`, `source`, `destination` [O1]. The schema says the attributes and
  relationships returned depend on which organisation asks [O1]; the examples show the destination's view without `creator`
  or `source` [O9].

### 1.5 Revocation

- The source can expire a token early (`POST /connect/share-tokens/{id}/expire`); only the source can [D3] [O6].
- Deactivating the connection stops further access through it [O7]; whether that also kills unredeemed tokens is
  **(inference)** from that wording, not stated.
- **After redemption nothing is revocable.** Each organisation is the controller of its own copy; the destination's copy is
  its own [H1] [D1]. A deletion request has to go to each organisation separately [H7].

### 1.6 What the receiving organisation sees before and after

- **Before redemption (peek).** `GET /connect/share-tokens/{id}?peek-source-data=true` returns `source-data` only to the
  destination, only on retrieve (never in lists), and only if it holds a separate "peek" capability [O4] [O1]. Every exposed
  attribute is wrapped as `{visibility, value}`: `full` gives the value, `presence` gives only a boolean saying whether the
  source has a non-null value; attributes the configuration strips are absent; inquiries, accounts and transactions add a
  nested `fields` bucket; an inquiry adds `related-objects`, each its own filtered snapshot [O8].
- **After redemption.** A clone is the destination's own inquiry or verification, with the source's statuses and checks
  [H2] [D4]; a hydrated object is the destination's own object filled with fields [D4].
- **Authenticity.** The destination trusts the platform: data is copied server-side between two tenants of one service, and
  no signature, proof or attestation is described [D1] [D4] **(not documented; inference that none exists in the API)**. The
  docs present cloning as the mode for relying on another firm's KYC [D4], which means the destination relies on the
  source's checks and configuration, without the API telling it what that configuration was **(inference)**.

### 1.7 API paths, scopes and events

The API reference groups the two resources under one Connect section [D5]; its generated pages match the spec files below
[D12], and the root document lists the same eight paths [O13].

| Path | Who | Source |
|---|---|---|
| `GET`, `POST /connect/connections` | list (both directions) / create (source) | [O7] |
| `GET /connect/connections/{connection-id}` | either side | [O7] |
| `POST /connect/connections/{connection-id}/deactivate` | either side | [O7] |
| `POST /connect/connections/{connection-id}/reactivate` | source | [O7] |
| `GET`, `POST /connect/share-tokens` | list (filters `connection-id`, `status`, `direction`) / create (`connection-id`, `source-id`, `expires-in-seconds`) | [O3] |
| `GET /connect/share-tokens/{share-token-id}` | either side; `peek-source-data` for the destination | [O4] |
| `POST /connect/share-tokens/{share-token-id}/expire` | source | [O6] |
| `POST /connect/share-tokens/{share-token-id}/redeem` | destination; 202 | [O5] |

- **Scopes:** `connect.read`, `connect.write`, and the narrower `connect_connection.read`, `connect_connection.write`,
  `connect_share_token.read`, `connect_share_token.write` [D7].
- **Events** (on the events page; the spec has no webhook files for them [G4]): `connect/share-token.outbound-created` and
  `connect/share-token.outbound-redeemed` in the source; `connect/share-token.inbound-created`, `connect/share-token.ready`
  and `connect/share-token.inbound-redeemed` in the destination [D6] [D3] [D4]. No connection event is documented.
- **Other integration points.** Workflow actions to create and redeem tokens (a destination can redeem automatically on
  `inbound-created`) [D3] [D4]; console pages for connections and tokens [D2] [D3].

### 1.8 Client-side redemption

The destination can pass the token to its own flow instead of redeeming by API: a `share-token` query value beside
`inquiry-template-id` (new inquiry) or `inquiry-id` (existing one) on the hosted flow, `shareToken` in the web SDK, and a
`shareToken` builder method in the mobile SDKs (the Android SDK from v2.40.0, on its template, template-version, inquiry and
one-time-link-code entry points) [D4]. The flow then shows the end user a consent screen describing what is being shared,
redeems the token, completes on its own when the shared data covers the template, and otherwise asks for what is missing
[D4]. Inquiry destinations only [D4].

**Risk the docs do not discuss (inference).** The hosted URL carries the token id next to a template id. If the token id
leaks and the destination's template accepts client-side redemption, a third party who opens that URL could trigger the
redemption into an inquiry session it controls; what that session would show of the shared data is **not documented**.

### 1.9 Consent, as the vendor describes it

Both organisations are responsible for the end user's consent; the vendor does not collect it on their behalf [H1] [D1]. The
documented practice is a terms or privacy-policy update plus an explicit opt-in and opt-out moment before sharing, usually
shown in the flow [H1] [D1]. The data is said to belong to the end user; each organisation is a controller of its own copy and
the vendor a processor for both [H1]. Production use requires a separate agreement signed by each side with the vendor; the
feature is in beta [D1] [H1]. No consent record, consent API, consent id on the token or withdrawal path is documented
(**not documented**). The vendor's end-user help says no other business is shown a person's result [H8]; Connect is the
opt-in exception to that [H1].

### 1.10 Neighbouring features (recorded, mostly not for this release)

- **Reusable personas / the wallet (being retired).** A passkey-protected wallet the end user creates, held by the vendor
  and reusable across flows; the user deletes it in the vendor's app [H5] [H6] [H7]. Events `inquiry.reusable-persona-created`,
  `-updated`, `-used`, `-assurance-failed` and `checkpoint.reusable-persona-used` [D6] [O10]; government ID and selfie
  verifications carry `from-reusable-persona` since 2025-02-18 [C1]. A newer feature replaces it [H3] [H4].
- **Cross-network history check (closed beta).** With an opt-in on the flow's first screen, the vendor compares today's
  session with the person's earlier verifications for any customer, through what it calls encrypted lookups, and returns a
  signal rather than data; deletion or opt-out goes through the vendor's privacy portal [H3] [H4]. It needs a population of
  verifications across many customers, which a self-hosted install does not have **(inference)**.
- **OAuth object grants (restricted API).** `POST /oauth/authorize` with `client-id` (the other organisation), `response-type`
  `code` and a `scope` of `permission:object` pairs returns a code usable only by that organisation (the example lives 599 s);
  `POST /oauth/token` with `grant-type` `authorization_code` returns an access token valid exactly one hour for those objects
  [O11] [D8]. The same token endpoint also accepts `client_credentials` with a `private_key_jwt` assertion (RS256 or ES256,
  at most 5 minutes) for machine access [O11].
- **Claim-only verification (2026-06-09).** A claim such as "over 18" or "live human" is returned without identity data,
  the verification data is deleted once the claim exists, and redemption is authenticated with a Privacy Pass token (RFC
  9577, blind RSA per RFC 9578), so the verifier and the relying party cannot correlate [D9] [D10] [C2] [O12].

## 2. Consent

Nothing here is legal advice. The GDPR text could not be fetched from EUR-Lex on 2026-10-29 (it answered an automated-traffic
challenge, HTTP 202 with an empty body) [L1]; the points below come from the EDPB's own guidelines, which quote and interpret
the articles [L2] [L3]. Article and paragraph numbers are the guidelines'.

### 2.1 What the law asks of a consent record

| Requirement | What it means for a share | Source |
|---|---|---|
| **Definition (Art. 4(11)).** Freely given, specific, informed, unambiguous; a statement or a clear affirmative act | A pre-ticked box, silence, simply carrying on with the service, or scrolling and swiping through a page are not consent; a share needs its own affirmative act | [L2] §2, ¶79, ¶86 |
| **Free.** Consent bundled as a non-negotiable part of terms is presumed not free; refusal or withdrawal must be possible without detriment | The vendor's practice of announcing sharing in the terms or privacy policy [H1] [D1] is a notice, not consent by itself **(inference)**; refusing a share must leave the normal flow open | [L2] ¶13 |
| **Specific (Art. 6(1)(a), 5(1)(b)).** One or more specific purposes, a choice for each, separated from other matters | One consent per share purpose; the sharing consent is separate from the verification consent | [L2] ¶55-56 |
| **Informed (minimum content).** The controller's identity; the purpose of each processing; the type of data; the right to withdraw; automated decision-making where relevant; transfer risks where relevant | The screen must say who receives what and why | [L2] ¶64 |
| **Every controller named.** When data goes to other controllers that rely on the original consent, they should all be named | **The destination organisation must be named on the consent screen** of every share | [L2] ¶65 |
| **Explicit consent** for special-category data (Art. 9), Art. 22 decisions and Art. 49 transfers: an express statement | Shared biometric material needs an express, separate statement | [L2] ¶91-93 |
| **Demonstrable (Art. 7(1)).** The burden of proof is the controller's; keep enough to link the consent to the processing, but no more; keep the proof only as long as the processing lasts and, after it, only as long as legal obligations or claims require | A record per consent, retained with the data it covers | [L2] ¶104-107 |
| **What a record shows.** How and when consent was obtained and what the person was told; online, the session, the documentation of the workflow at that time and **a copy of the information presented**; pointing to how the site was configured is not enough | Store what was shown (or its hash plus a retained copy), not only a key | [L2] ¶108 |
| **Withdrawal (Art. 7(3)).** At any time and as easy as giving it; one click to give means about one click to withdraw | A withdrawal path in the same channel (flow link or SDK) and through the operator | [L2] ¶112-114 |
| **No swap of basis.** A controller that relied on consent cannot switch to another basis (for example legitimate interest) after a withdrawal | Withdrawal must actually stop the share-based processing | [L2] ¶121-123 |
| **No fixed lifetime; refresh.** Consent lasts as long as the context supports; a material change needs new consent; refresh at intervals is good practice | A share consent covers one token (or one connection's purpose) and expires with it | [L2] ¶110-111 |

### 2.2 Biometric data

- Art. 9 applies when biometric data, most commonly templates built from facial measurements, is processed **to uniquely
  identify** a person; a photograph is not automatically special-category data (Recital 51); private uses with recognition
  usually need explicit consent under Art. 9(2)(a) [L3] ¶76-82.
- Applied to identity verification **(inference; not legal advice)**: a face template (OpenVerify's sealed SFace embeddings,
  C42), a selfie compared one-to-one with an ID portrait, and a face-match result are processing to identify a person, so a
  share that carries the selfie, the portrait, the template or the match result is a disclosure of Art. 9 data and needs the
  person's explicit consent naming the recipient. The conservative default is to treat every shared selfie, portrait,
  template and liveness or match result as biometric.
- Face templates should never be shared at all (ours): the destination can recompute what it needs from images it is allowed
  to receive, and a template is useless outside the model version that made it.

### 2.3 Minimisation

- The law's purpose-limitation and minimisation principles are applied through the specific-consent rules above [L2] ¶55-56.
- The credential standards build minimisation in: OpenID4VP asks verifiers to request only the claims strictly needed and
  wallets to obtain explicit, informed consent before release [S1] §15.1, §15.4.2; SD-JWT discloses claims one by one, each
  hidden behind a salted hash [S4] §9.3.
- The vendor's peek view already models two levels, the value or only its presence [O8]; a claim-only answer ("over 18",
  "verified at assurance X") is the strongest form [D9].

### 2.4 What the vendor records

The vendor leaves consent to both organisations, shows a consent screen only in client-side redemption, treats a
destination's re-activation of a connection as its re-consent, and documents no consent record, consent id on the token, or
withdrawal path (section 1.9) [H1] [D1] [D2] [D4]. Its privacy overview sends data-subject requests to the customer as the
controller and describes redaction as permanent deletion that leaves a PII-free record [H10].

### 2.5 What OpenVerify records today

- **One consent per flow session** (`inquiry_sessions.consent`, jsonb): `accepted_at`, `text_keys` (the consent step's keys
  shown), `optional_text_keys` (ticked optional texts, such as `consent.biometric-matching`), `locale`, and the client `ip`
  and `user_agent`, both envelope-encrypted inside the document [R6]. The body of `POST /api/v1/flow/consent` is
  `accepted: true`, `text-keys`, `optional-text-keys`, `locale` [R20]; the server checks every key against the pinned
  template version's consent step [R22]; uploads before consent answer 409 [R20]. The default template's consent step shows
  `consent.biometric` and `consent.processing` and offers `consent.biometric-matching` as optional [R21].
- **What is missing for sharing** (ours, from the table in 2.1): no purpose, no named recipient, no data categories, no copy
  or hash of the rendered text (the key and locale point at translation files that change with each release of the flow and
  the Android SDK, which is the kind of reference to configuration that [L2] ¶108 calls insufficient), no withdrawal and no consent id that a
  token could reference.
- **Redaction and retention** clear the consent's IP and user agent with the inquiry, and keep the session row with its
  inquiry [R9] [R10]. The audit log is append-only, per environment, with a `NULL` actor for the system [R16].

### 2.6 Proposed consent model for Phase 11 (ours)

A separate, append-only **consent record** per grant, referenced by the share token that it authorises:

| Field | Content |
|---|---|
| `id` | a new prefix, for example `cnsr` |
| `purpose` | a closed code, for example `share.reuse-kyc` |
| `subject` | the inquiry or account whose data is shared |
| `recipient` | the destination organisation's id **and the name shown** |
| `data-categories` | the closed list the share carries (for example `identity-fields`, `document-images`, `biometric`, `check-results`); `biometric` forces an explicit, separate tick |
| `text` | locale, keys, and the SHA-256 of the exact rendered text (placeholders filled), with the text itself stored once per hash in a consent-text table |
| `method` | `flow` (witnessed by OpenVerify: session id, sealed IP and user agent, time) or `attested` (the operator's backend says it obtained consent: its evidence reference and time, labelled as not witnessed) |
| `expires-at` | the authorised token's expiry |
| `withdrawn-at`, `withdrawn-via` | `flow`, `operator`, `api`; withdrawal expires every unredeemed token it authorised and emits an event to both sides |

Both sides keep their own record: the source records consent to disclose to the named destination, the destination records
consent to receive and process (and, for biometric data, explicit consent) when it redeems, in its own flow or by attestation.
Records follow the data they cover under C16: kept while the share's data is kept, then redacted with it, except the bare
fact of the grant and withdrawal (time, purpose, recipient, hash) for as long as the operator's legal-claims period, an
environment setting (ours, per [L2] ¶107).

## 3. Security of sharing

### 3.1 Two deployment shapes

1. **Same install.** Both organisations live on one OpenVerify install (a provider hosting several customers, or a group of
   companies run as separate organisations). The platform copies data between tenants server-side, as the vendor does. The
   install's operator is trusted by both sides **(this is the trust assumption to state)**.
2. **Two installs.** Each organisation runs its own OpenVerify. Data must cross the network between them, so the receiver
   needs proof of origin and integrity, the token must be bound to the receiver's key, and the two installs need a trust
   bootstrap. None of this exists in the vendor's product, because both sides are always its customers [D1] [H1].

The rows below are written for shape 1, which this note recommends for this release (section 6); shape 2's additional needs
are in 3.4.

### 3.2 Properties, the proposed control, and what it does not cover

| Property | Proposed control (ours unless cited) | What it does not cover |
|---|---|---|
| **Token entropy and storage** | Keep the vendor's model: the `cnst_` id is a handle, not a secret, because every read and redeem is authenticated as the destination [D3] [O5]. OpenVerify ids are ULIDs (48-bit time, 80 random bits) [R17], which is fine for a non-secret. If a secret is ever needed (shape 2, or a link for the end user), use the existing token format: a prefix plus 256 CSPRNG bits in base64url [R5], stored as HMAC-SHA256 with the server pepper, as API keys are, so a database-only leak cannot test candidates [R8]; this exceeds ASVS 7.2.3's 128-bit floor (ASVS 5.0.0, released 2025-05-30 [X4]) [X5] | A handle can be guessed or copied; it is safe only because the server checks the caller on every request |
| **Bound to its receiver** | On every retrieve, peek, redeem and expire: the token's connection is `active`, the caller's organisation is that connection's destination (or source, for expire and outbound reads), and the environment kinds match (sandbox to sandbox, production to production [D4]); one indistinguishable 404 for every token the caller may not see, so ids are no oracle (ASVS 8.2.2 object-level and 8.4.1 cross-tenant checks [X5]) | A destination API key that leaks exposes every inbound token of that organisation: hence the narrow scopes below, the existing IP allowlist on keys [R8], and short default lifetimes |
| **Least privilege** | Separate scopes: `connect-connections:read`, `connect-connections:write`, `connect-share-tokens:read`, `connect-share-tokens:write` (create and expire), `connect-share-tokens:redeem`, and `connect-share-tokens:peek`, which also needs `pii:view` for a dashboard user [R15]; mirrors the vendor's split scopes [D7] (RFC 9700 §2.3 privilege restriction [X2]) | Scopes do not stop a destination from misusing data it was entitled to receive |
| **Single use and replay** | Redeem takes a row lock and moves `created`/`ready` to `pending` in one transaction; a second redeem answers 409 `share_token_already_redeemed`; an `Idempotency-Key` repeat returns the first answer (existing C12 behaviour); redemption runs as a job that ends `redeemed` or `failed` with the vendor's reasons [O1] | A destination can still copy what it received after redemption; single use limits only the platform-mediated transfer |
| **Expiry** | `expires-in-seconds` from 60 to 1,814,400, default 14 days (MATCH [D3] [O3]), never past the consent's own expiry; an environment setting can lower the maximum; the C16 retention pass deletes expired token rows after 30 days, as it does for one-time links [R10] | A long lifetime widens the window for a misdirected token; the default is parity, the operator can shorten it |
| **Revocation** | Source `expire`; deactivating the connection expires every unredeemed token on it (ours: the spec only says deactivation stops further access [O7]); consent withdrawal expires every unredeemed token it authorised (2.6) | Nothing is recalled after redemption [H1] [D1]; OpenVerify only notifies the destination (an event) so its operator can act |
| **Source changes before redemption** | Snapshot at redemption, not at creation; a source redacted before redemption fails with `source_redacted` [O1]; the `ready` prefetch (vendor [D4]) is not built (ours: a cached copy of PII is one more thing to redact) | After redemption the destination's copy is independent; a later redaction at the source does not reach it, and the docs must say so |
| **Rate limits** | New C12 buckets: `connect-redeem` and `connect-peek` per API key and per organisation, low (for example 60 per minute), plus the existing per-key `api` bucket [R23] | Limits slow enumeration and bulk extraction by a compromised key; they do not stop a slow one |
| **What a leaked token exposes** | Alone: nothing, outside the destination organisation. With a destination key holding `peek`: the filtered snapshot of every inbound token; with `redeem`: copies of them. With a source key holding `write`: new tokens to existing active partners only, each needing a consent record | A compromised operator account at either side is out of scope of any token design |
| **Tokens in URLs** | Never: OpenVerify's flow has no "start from a template id" entry, and its credentials travel only in the URL fragment [R24]. A client-side redemption is created by the destination's backend (`POST /inquiries` with `meta.share-token-id`), and the flow then only shows the share consent screen. This closes the leak path of 1.8 and follows ASVS 14.2.1 (no tokens in query strings) [X5] and RFC 9700 §4.3 (browser history) [X2] | The end user's device and session are as trusted as any flow session |
| **Provenance and honesty** | A cloned verification keeps the source's statuses and check results [H2], but is labelled: `provenance: { kind: 'connect-clone', share-token-id, source-organization, source-environment-kind, cloned-at }`, every check keeps its tier, stage and provenance (ADR 0002 §3f [R3]), and the destination's decision engine counts a cloned result toward a required check only if the destination's template opts in (`accept-cloned-results`); otherwise the inquiry goes to `needs_review` (ADR 0002 §3b) [R3]. A cloned result never shows as a fresh pass (CLAUDE.md rule 5 [R2]) | Reliance on another organisation's checks is a business and legal decision of the destination; the platform only makes it visible |
| **Authenticity (shape 1)** | The platform is the witness: both rows live in one database, the copy is made by the API, and both sides' audit logs record it | A malicious or compromised install operator can fabricate any share; shape 1 offers no cryptographic proof, and the docs must say so |
| **Audit** | Append-only audit entries in both environments: connection created, activated, deactivated, reactivated; token created, peeked, redeemed, expired, failed; consent recorded, withdrawn; each names the actor, never the data [R16] | Audit entries prove who did what on the platform, not what the receiver did afterwards |

### 3.3 Events (ours, vendor-compatible where the vendor names them)

- The vendor's five token events [D6]: `connect/share-token.outbound-created`, `connect/share-token.outbound-redeemed`,
  `connect/share-token.inbound-created`, `connect/share-token.ready` (only if the prefetch is built; recommended not),
  `connect/share-token.inbound-redeemed`.
- Ours, because the vendor names none: `connect/share-token.expired`, `connect/share-token.failed`,
  `connect/connection.created`, `.activated`, `.deactivated`, `.reactivated`, `consent.withdrawn` (both sides), and an
  advisory `connect/share-token.source-redacted` to the destination of an already-redeemed share.
- Payloads carry the token and connection resources only, never shared data; the existing webhook attribute blocklist and
  PII masking apply [R11].
- A `/` in the subject breaks today's `eventSubject` lookup table, which maps only flat subjects and special-cases
  `report/` [R11]; the contracts slice must add a `connect` subject (ours, inference from the code).

### 3.4 What a second install would need (shape 2, deferred)

- **Trust bootstrap.** At activation each side pins the other's signing-key set (a JWKS fetched over TLS from a configured
  base URL, with its SHA-256 fingerprint confirmed out of band by an operator); rotation by publishing the next key in advance.
- **Integrity and origin.** The source signs a share envelope; a natural choice is an SD-JWT (RFC 9901, Standards Track,
  November 2025 [S4]) carrying only the consented claims as disclosures, each behind its own salt (a new salt per claim is a MUST; 128 bits is the RECOMMENDED minimum, corrected in fact-check) [S4]
  §9.3, with images as hashed references fetched separately.
- **Receiver binding and replay.** A key-binding JWT signed by the destination's key over a source-issued nonce and the
  destination's identifier (the same binding OpenID4VP requires of presentations: audience plus nonce [S1] §14.1.2), or
  DPoP-style proofs on the fetch (RFC 9449 [X1]); audience checks per ASVS 9.2.3 and 9.2.4 [X5]; algorithm allowlist, no
  keys from token headers (ASVS 9.1.2, 9.1.3 [X5]; RFC 8725 [X3]).
- **Library.** `jose` 6.2.12 (MIT, 2026-09-05; 6.2.14 of 2026-10-29 is too young) [N7] [N9], or the `@noble/curves` already
  in the tree [R25].
- **Cost (inference, not measured).** About 2-3 engineer-weeks on top of shape 1 for the envelope, the key exchange, the
  fetch endpoint, the guard on outbound calls (the Phase 8 SSRF guard can be reused) and the tests, plus an operator guide.

## 4. Open standards a self-hosted product could use

The vendor's sharing is a closed, platform-internal mechanism (section 1). The open route to reusable KYC is different in
kind: an issuer gives the person a signed credential, the person keeps it in a wallet, and any verifier checks it without
asking the issuer. For OpenVerify that means two possible roles: **verifier** (accept credentials such as an EU PID or a
mobile driving licence as evidence in an inquiry) and **issuer** (after an approved inquiry, issue the person a credential
that others can verify). Both are separate from organisation-to-organisation Connect.

### 4.1 Status and dates (read 2026-10-29)

| Standard | Status and date | What it defines (identifiers only) | Source |
|---|---|---|---|
| **OpenID for Verifiable Presentations 1.0** | **Final**, published 9 July 2025 | Verifier-to-wallet requests: `dcql_query` (DCQL), `vp_token`, response modes `direct_post`, `direct_post.jwt`, `dc_api`, `dc_api.jwt`; client identifier prefixes (`redirect_uri`, `x509_san_dns`, `x509_hash`, `verifier_attestation`, `decentralized_identifier`, `openid_federation`, `origin`, pre-registered); `transaction_data`; replay protection by binding each presentation to `client_id` and `nonce` (§14.1.2); wallet consent and minimal-claims guidance (§15.1, §15.4.2) | [S1] |
| **OpenID for Verifiable Credential Issuance 1.0** | **Final**, published 16 September 2025 | Credential offer (`credential_offer`, `credential_offer_uri`), pre-authorized code grant (`urn:ietf:params:oauth:grant-type:pre-authorized_code`, `tx_code`) and authorization code flow, token, nonce (`c_nonce`), credential, deferred and notification endpoints, `proofs` (`openid4vci-proof+jwt`, key attestations), issuer metadata (`credential_configurations_supported`), batch issuance | [S2] |
| **OpenID4VC High Assurance Interoperability Profile 1.0** | **Final**, published 24 December 2025 | Formats `dc+sd-jwt` and `mso_mdoc` (at least one); signed requests with `x509_hash`; `direct_post.jwt` encryption over redirects; the DC API with `dc_api.jwt`; DPoP for issuance; key and wallet attestations; Token Status List; ES256 as the floor | [S3] |
| **SD-JWT** | **RFC 9901**, Standards Track, November 2025 | Salted-hash disclosures, decoy digests, optional key binding (KB-JWT); a new salt per claim (MUST) with a RECOMMENDED minimum of 128 random bits (§9.3; corrected in fact-check: "at least 128 bits" read a recommendation as a requirement); unlinkability limits (§10.1) | [S4] |
| **SD-JWT VC** | **Internet-Draft** `draft-ietf-oauth-sd-jwt-vc-22`, 2026-10-27; in IESG evaluation, not an RFC | The credential profile on SD-JWT | [S5] |
| **Token Status List** | **Internet-Draft** `draft-ietf-oauth-status-list-21`, 2026-06-21 (record last updated 2026-08-13; corrected in fact-check); in the RFC Editor queue, not an RFC | Revocation and suspension of issued tokens | [S6] |
| **W3C Verifiable Credentials Data Model 2.0** | **W3C Recommendation**, 15 May 2025 | The JSON-LD credential model | [S7] |
| **W3C VC JOSE COSE** | **W3C Recommendation**, republished 13 October 2026 (first 15 May 2025) | Securing VCDM 2.0 with JOSE, SD-JWT and COSE | [S8] |
| **W3C Bitstring Status List 1.0** | **W3C Recommendation**, 15 May 2025 | VCDM status lists | [S9] |
| **W3C Digital Credentials API** | **Working Draft**, 20 October 2026 | Browser wallet invocation; presentation protocols `openid4vp-v1-unsigned`, `openid4vp-v1-signed`, `openid4vp-v1-multisigned`, `org-iso-mdoc`; issuance `openid4vci-v1` | [S10] |
| **ISO/IEC 18013-5** (mobile driving licence) | Published 2021 edition; a **second edition** is in WG 10's public working drafts (CD ballot resolution and N2549) | mDL data model, MSO signed with COSE, device engagement and proximity transport | [S11] [S15] |
| **ISO/IEC TS 18013-7** (online mDL) | The repository's Phase 5 record gives TS 18013-7:2025 (second edition) with Annex A (REST), Annex B (OpenID4VP) and Annex C (DC API, `org-iso-mdoc`, HPKE-encrypted response); WG 10's repository also holds an "18013-7 second edition DTS candidate" working draft | Remote presentation of an mdoc | [S12] [R14] [S15] |
| **EUDI Wallet ARF** | **v3.0.0**, released 2026-07-23 (CC BY 4.0) | Wallets must support mdoc and SD-JWT VC, VCDM 2.0 is optional and only for non-qualified attestations; SD-JWT VC is presented remotely over OpenID4VP and HAIP and cannot be used in proximity; relying parties register in their Member State, get an EU-wide identifier, access certificates (to authenticate to wallets) and registration certificates (their registered intended uses); intermediaries are deemed relying parties and may not store data about the content of the transaction; trust anchors come from Trusted Lists (ETSI TS 119 612) and Lists of Trusted Entities (ETSI TS 119 602) | [S13] [S14] |

ISO's catalogue pages answered a bot challenge (HTTP 403) on 2026-10-29 and were not read; the ISO rows rest on WG 10's
public repository and the repository's Phase 5 record [S15] [R14].

### 4.2 Libraries (npm, read 2026-10-29; pinnable means released on or before 2026-10-15)

| Package | Latest | Newest pinnable | Licence (file read) | Verdict | Source |
|---|---|---|---|---|---|
| `@openid4vc/openid4vp` | 0.9.0 (2026-10-29) | **0.7.0** (2026-10-07) | Apache-2.0 (monorepo `LICENSE` at tag `v0.4.2`) | ✅ passes; deps `@openid4vc/oauth2`, `@openid4vc/utils`, `zod` ^4.6.5 (OpenVerify has ^4.6.7) | [N1] [N8] |
| `@openid4vc/openid4vci` | 0.9.0 (2026-10-29) | **0.7.0** (2026-10-07) | Apache-2.0 | ✅ passes | [N2] [N8] |
| `@openid4vc/oauth2`, `@openid4vc/utils` | 0.9.0 | **0.7.0** | Apache-2.0; `utils` pulls `buffer` 6 (MIT) and `zod-validation-error` 5 (MIT) | ✅ passes | [N3] [N10] |
| `@sd-jwt/core`, `@sd-jwt/sd-jwt-vc` | 0.24.0 (2026-10-29) | **0.22.0** (2026-10-07) | Apache-2.0 | ⚠️ passes; `sd-jwt-vc` pulls `@owf/token-status-list`, which pulls **`pako` 3 under "MIT AND Zlib"**: Zlib is not named in rule 4 but the owner confirmed it permissive for PDFium (Phase 5 decision 31 [R13]), and `THIRD_PARTY_LICENSES.md` already lists Zlib parts that way [R28]; record `pako` there before adoption | [N4] [N5] [N10] |
| `@owf/mdoc` | 0.9.2 (2026-10-29) | **0.8.2** (2026-10-07) | Apache-2.0 | ⚠️ passes; same `pako` path, plus `cbor-x` (MIT) whose optional native `cbor-extract` needs an `allowBuilds` decision or exclusion | [N6] [N10] |
| `jose` | 6.2.14 (2026-10-29) | **6.2.12** (2026-09-05) | MIT (`LICENSE.md` at `v6.2.12`) | ✅ passes; no dependencies | [N7] [N9] |

The `identity-common-ts` monorepo (OpenWallet Foundation Labs) was created 2026-02-04, has 12 stars, and published new
versions of every package above on 2026-10-29 [N8]: the code moves fast, so a pin must be re-read when the slice starts.

### 4.3 What each would cost OpenVerify

| Capability | Work | Blockers outside the code | Estimate (inference, not measured) | Verdict |
|---|---|---|---|---|
| **Verifier for SD-JWT VC over OpenID4VP + HAIP** (EU PID and attestations) | Signed request objects with `x509_hash`, JWE response decryption (`direct_post.jwt`, `dc_api.jwt`), DCQL builder from the template's required claims, SD-JWT VC validation (issuer keys, disclosures, KB-JWT with nonce and audience, status list), a flow step and a DC API call, a new verification type and checks in PLAN §4 | Each operator must register as a relying party and hold an access certificate; the Phase 5 note found the same gate at Apple and Google for mdocs [S13] [R14]; real tests need a wallet on a phone | 3-5 engineer-weeks with fixture tests only | **DEFER** (with Phase 5 C68) |
| **Verifier for mdoc (18013-7 Annex B/C)** | MSO COSE verification, IACA chain through the generic C62 trust store, DeviceAuth over the SessionTranscript, HPKE for Annex C | Same registrations, AAMVA's VICAL terms, wallets on devices [R14] | 2-3 engineer-weeks for the server crypto on `@owf/mdoc` (the Phase 5 agent's estimate) [R14] | **DEFER** (C68) |
| **Issuer over OpenID4VCI** (a reusable "verified by this operator" credential; the vendor documents issuing a credential after verification through one partner [R18]) | An authorization server or pre-authorized code flow, issuer metadata, signing keys and rotation, a hosted status list tied to C16 redaction and decisions, wallet interop | EUDI wallets trust only registered PID and attestation providers that hold access and registration certificates [S13]; an operator issuing identity attestations takes on liability | 4-6 engineer-weeks plus interop | **DEFER** |
| **W3C VCDM 2.0 credentials** | JSON-LD contexts, Data Integrity or VC-JOSE-COSE | Optional in the EU framework [S13] | n/a | **DEFER** (not planned) |
| **SD-JWT as the envelope of a two-install share** (3.4) | Sign, disclose, bind and verify between two OpenVerify installs; no wallet involved | Key exchange between operators | 2-3 engineer-weeks after shape 1 | **DEFER** (next release) |

**Why defer rather than build now.** The release ships the web platform and Android; Phase 11 also carries the hardening
work (K9 to K12). Every wallet capability needs a per-operator registration or onboarding that a self-hosted project cannot
provide, and none can be tested end to end on the development machine. Building the verifier as an adapter with only a
sandbox provider would satisfy ADR 0002 formally but would ship unproven cryptography against real wallets. The repository's
own C68 reasoning still holds [R13].

## 5. OpenVerify today

Read-only, at `91c83e02` (2026-10-29 09:23 -0400), with Phase 6 being closed by other agents in the same tree.

| Area | What exists | What Connect needs from it | Source |
|---|---|---|---|
| **Tenancy** | `organizations` (`org_`) with at most one sandbox and one production `environments` (`env_`); everything else is environment-scoped | Connections are organisation-to-organisation (the vendor's model [O2]), tokens are environment-bound with matching kinds [D4]; a connection row therefore names two organisations, and a token names its source and destination environments | [R8] |
| **Ids** | ULIDs with a prefix registry `ID_PREFIXES` (`inq`, `ver`, `acc`, `rep`, ...) | New prefixes `cxn` and `cnst` (the vendor's), plus ours for consent records and consent texts | [R17] |
| **Tokens** | `ovs_` sessions, `ovu_` user sessions, `ovo_` one-time links, `ovm_` MFA, `ovi_` invitations: prefix plus 256 random bits, SHA-256 at rest; API keys HMAC-SHA256 with a pepper | A share token needs no secret in shape 1 (3.2) | [R5] [R8] |
| **One-time links** | Single-use, hashed, revoke older unused links, never outlive the inquiry, one generic 401 for every refusal, rate-limited per IP | The model for redemption semantics: single use under a lock, generic refusals | [R7] |
| **Inquiries** | Statuses, sessions, consent, template versions pinned | A hydrated inquiry runs the destination's own template; a cloned one is created in a final status with provenance | [R6] |
| **Accounts** | Types, sealed `fields`, tags, relations, consolidation; redaction cascades to inquiries | Hydrate into accounts; clone of an inquiry can link or create an account by reference id (the vendor's `meta.account-id` and `auto-create-*` [O5]) | [R9] |
| **Transactions** | Not built yet; Phase 7 plans them | Hydrate into and from transactions waits for Phase 7 | [R1] |
| **Workflows** | Not built yet; Phase 8 plans them | Create and Redeem Share Token actions, and an `inbound-created` trigger, wait for Phase 8 | [R1] |
| **Events and webhooks** | `<subject>.<action>` names in `EVENT_NAMES`, subjects looked up from a fixed map with a `report/` special case; payloads stored and redacted to stubs; webhooks with filters, attribute blocklists, PII masking | A `connect` subject with `/` in its event names (3.3) | [R11] |
| **Consent** | One record per flow session: keys, optional keys, locale, sealed IP and user agent, time | A per-share consent record (2.6) | [R6] [R20] [R22] |
| **Redaction** | Irreversible, idempotent; files deleted, fields nulled, event payloads stubbed, sessions canceled, links revoked; account redaction reaches its inquiries and consolidated accounts | A redacted source fails a pending token (`source_redacted`); a redacted destination copy is redacted like any object; shared copies are separate rows, never references | [R9] |
| **Retention** | Daily C16 pass: inquiries by template or environment setting, events, logs, deliveries, sessions, links, reports, face templates | Expired tokens and withdrawn consents join the pass; consent proofs follow their data (2.6) | [R10] |
| **Audit** | Append-only, per environment, sealed IP and user agent, `NULL` actor for the system | Both environments of a share get entries | [R16] |
| **Scopes** | `inquiries:*`, `accounts:*`, `reports:*`, `pii:view` for dashboard users, and others | The six `connect-*` scopes of 3.2 | [R15] |
| **Rate limits** | Buckets `api`, `flow-session`, `flow-ip`, `one-time-link-redeem`, `reports` | `connect-redeem`, `connect-peek` | [R23] |
| **Flow links** | Credentials only in the URL fragment; no template-id entry | The client-side redemption shape of 3.2 | [R24] |
| **Trust store** | Phase 5 C62 store kept generic so IACA roots can join later | Reused by a future mdoc verifier, not by Connect | [R13] |

## 6. What Phase 11 should build in this release, and what to defer

### 6.1 Build (this release)

**Connect between organisations on one install (shape 1), at API parity with the vendor, with consent and honesty added.**
Reasons: the API surface is fully public and small (eight paths, five events, six scopes) [O3]-[O7] [D6] [D7]; everything it
needs exists or arrives in Phases 7 to 9 (accounts, inquiries, redaction, retention, audit, transactions, workflows, the
console); it can be tested end to end on the development machine with two seeded organisations; and it needs no third-party
account, so it is real, not an adapter.

1. **Contracts first:** `cxn`, `cnst` and consent-record ids; the `connect/connection`, `connect/share-token` and consent
   resources; the `source-data` envelope with `{visibility, value}`; the events of 3.3 with a `connect` subject; the six
   scopes; problem codes (`connection_not_active`, `share_token_not_redeemable`, `share_token_already_redeemed`,
   `share_token_expired`, `consent_required`, `environment_kind_mismatch`, `destination_not_found`).
2. **Connections:** create (source), activate (destination, in the console), deactivate (either), reactivate (source, back
   to `pending`), no deletion, `archived` internal; a **share policy** on each connection (allowed source types, a field
   allowlist, files yes or no, biometric yes or no, peek visibility per attribute), shown to the destination at activation
   and frozen per version, so activation means accepting a stated policy.
3. **Share tokens:** create (needs a consent record or an attested consent), list with `direction`, retrieve, expire, redeem
   as a job; clone of inquiries and of government ID, selfie, database, document, email and phone verifications; hydrate of
   accounts and inquiries (and transactions once Phase 7 has them); `meta.field-mappings`; account linking; the vendor's
   statuses without `ready`, and its failure reasons.
4. **Peek** behind `connect-share-tokens:peek`, filtered by the connection's policy, audited.
5. **Consent records** (2.6) on both sides, the share-consent flow step (web flow and the Android SDK's `commonMain`
   screens, so iOS inherits it, per ADR 0004 [R19]), attested consent by API, withdrawal by API and console that expires unredeemed tokens and
   notifies both sides.
6. **Provenance and decision policy:** the `provenance` object on cloned objects, check provenance kept, and
   `accept-cloned-results` on the destination template (off by default).
7. **Console** (Phase 9's shell): connections, tokens in and out, the peek view, the cloned marker and banner, consent
   records on the inquiry page.
8. **Workflows** (Phase 8's engine): Create Share Token and Redeem Share Token actions and the `inbound-created` trigger,
   matching the vendor's workflow integration [D3] [D4].
9. **Docs:** a sharing guide that states the trust assumption (the install operator), what is not recalled after redemption,
   the consent duties of both controllers (not legal advice), and the mapping to the vendor's paths.

### 6.2 Defer (with the reason)

| Item | Why not now |
|---|---|
| Sharing between two installs (shape 2) | Needs keys, a trust bootstrap and a signed envelope (3.4); no public counterpart to match; 2-3 more weeks (inference) |
| Report sharing (K1, the spec's report sources) | A cloned screening result is a "no match" for lists, versions and a matcher the destination never chose; ADR 0005 allows "no match" only beside the search actually made [R26]; the destination runs its own reports on hydrated data |
| The `ready` prefetch | A cached PII snapshot adds a copy to redact and a window of staleness, for a latency gain only |
| Wallet verifier (OpenID4VP, HAIP, SD-JWT VC, mdoc, DC API) | Section 4.3: per-operator registration, real-device testing, young libraries; Phase 5 C68 stands [R13] |
| Credential issuer (OpenID4VCI) | Section 4.3: registration as an attestation provider, liability, interop |
| Reusable personas, cross-network history lookups | The vendor is retiring the first [H3] [H4]; the second needs a population of verifications across many customers, which a self-hosted install does not have (inference) |
| OAuth object grants, claim-only verification with Privacy Pass | Restricted or specialised vendor features [D8] [D9]; Connect covers the sharing need |

## What the phase plan should take from this (proposed)

Recommendations for the Phase 11 plan, not decisions; the owner questions follow. The hardening half of Phase 11 (K9 to
K12) is the subject of the sibling note `phase11-hardening.md`.

### Must match (parity)

1. **Resources and ids:** `connect/connection` (`cxn`), `connect/share-token` (`cnst`), the `connect/source-data/<subtype>`
   envelope with `{visibility, value}` and `fields` and `related-objects` (R1, R15).
2. **The eight paths** of 1.7 with the vendor's bodies: `destination-organization-id`; `connection-id`, `source-id`,
   `expires-in-seconds` (60 to 1,814,400, default 14 days); redeem with or without `destination-id`, `meta.field-mappings`,
   `meta.account-id`, `meta.auto-create-account-reference-id`, `meta.auto-create-account-type-id`; `peek-source-data` on
   retrieve; list filters `connection-id`, `status`, `direction` and `status`, `destination-organization-id` (R2-R4, R6, R7,
   R10-R12).
3. **Lifecycles:** connections `pending` → `active` → `inactive` → (`pending`), no deletion, `archived` internal; tokens
   `created` → `pending` → `redeemed` | `failed`, and `expired`; failure reasons `source_not_found`, `source_redacted`,
   `import_failed`, `unrecoverable_error`; environment kinds must match (R3, R4, R9, R13).
4. **Redeem modes:** clone of inquiries and of government ID, selfie, database, document, email and phone verifications;
   hydrate of accounts, inquiries and (after Phase 7) transactions; a hydrated inquiry runs the destination's own template and
   stops where data is missing (R12).
5. **Events:** `connect/share-token.outbound-created`, `.outbound-redeemed`, `.inbound-created`, `.inbound-redeemed` (R18).
6. **Console:** connections and tokens pages, activation by the destination in the console, the cloned marker and banner
   (R3, R20, R22); **workflow actions** to create and redeem tokens and an `inbound-created` trigger (R22).

### Ours, keep and label

7. **A share policy per connection**, versioned, shown at activation (R5).
8. **Consent records on both sides** with the recipient named, data categories, the exact text's SHA-256 and a stored copy,
   `flow` or `attested` method, expiry and withdrawal; biometric categories behind a separate explicit tick; face templates
   never shared (R24-R26, section 2.6).
9. **Explicit replay and revocation rules:** single redemption under a row lock with 409 on a repeat; deactivation and
   consent withdrawal expire unredeemed tokens; no `ready` prefetch (R4, R9, R14).
10. **No token in any URL:** client-side redemption through a server-created inquiry (`meta.share-token-id`) and a
    `share-consent` flow-spec step rendered by the web flow and by the Android SDK in `commonMain` (R17).
11. **Provenance and honesty:** a `provenance` object on cloned objects, check provenance kept, `accept-cloned-results` off
    by default so a cloned pass never satisfies a required check silently (R20, R21).
12. **Agreement reference at activation** (R27); **extra events** for expiry, failure, connections, consent withdrawal and
    source redaction, with a `connect` subject in `eventSubject` (3.3).
13. **Scopes and limits:** `connect-connections:read`/`write`, `connect-share-tokens:read`/`write`/`redeem`/`peek`; rate-limit
    buckets `connect-redeem` and `connect-peek`; one indistinguishable 404 (R16, R19).
14. **Retention:** expired and redeemed token rows deleted 30 days after they end; consent records redacted with the data they
    cover, with an optional proof-retention period (2.6).
15. **Docs:** the trust assumption of one install, what redemption cannot recall, both controllers' duties (not legal
    advice), the vendor path mapping.

### Build order (proposed slices)

1. **11A contracts** (alone): ids, resources, envelopes, events and subject, scopes, problem codes, the `share-consent`
   flow-spec step, the consent-record and consent-text tables (migration), OpenAPI regeneration; stubs and RED tests.
2. **11B API** (parallel): connections and policy; tokens, expiry and peek; the redeem job (clone, hydrate, mappings, account
   linking, provenance, decision policy); consent records, attested consent and withdrawal; audit, events, retention; the
   Postgres race tests (double redeem, redeem against expire, redeem against source redaction, withdrawal against redeem).
3. **11C clients** (parallel, after 11A): the web flow step; the Android `commonMain` screen with `commonTest` and host tests
   (no device needed); console pages on the Phase 9 shell; workflow actions on the Phase 8 engine.
4. **Integration:** a two-organisation full-stack spec on one install (create connection, activate, consent in the source
   flow, create token, peek, redeem into a destination inquiry, cloned banner, withdrawal of a second token), an
   authorization matrix test (source, destination, a third organisation, each endpoint, each environment kind), and the
   security review.

### Records to correct

The four items of "Corrections" (persona-surface events, the PLAN §2 row, the C88 note, the Phase 5 standards table).

### Nice to have / later

Sharing between installs with an SD-JWT envelope (3.4); report sharing with ADR 0005 provenance; an end-user withdrawal
link; the wallet verifier and issuer (section 4.3); claim-only answers.

### Open questions (no public answer)

The vendor's source-side sharing configuration and its defaults; whether deactivation kills outstanding tokens; whether a cloned
object carries provenance in the API; how the peek capability is granted; why the spec omits `ready` while the guide lists
it; why a new token's example shows `expires-at: null` (sections 1.2-1.6).

## Needs the owner

Each item gives the decision and the default we recommend. Phase 11 can proceed on the defaults; record the answers in the
Phase 11 plan and `docs/PROGRESS.md`.

1. **Scope of Connect in this release.**
   - **Default:** organisations on the same install only (shape 1); sharing between installs in the next release.
     Reason: parity with a fully public API, testable locally, no keys or trust bootstrap to design under time pressure.
2. **Activation channel.** The vendor allows activation only in its dashboard [D2].
   - **Default:** console only, by a user with the connect write permission and a second factor; no API-key activation.
3. **Cloned results and required checks.**
   - **Default:** `accept-cloned-results` off; a template that turns it on records an audited acknowledgement at publish, and
     the decision engine routes to `needs_review` otherwise (ADR 0002 §3b).
4. **Default token lifetime.**
   - **Default:** 14 days (parity), 60 s to 21 days, an environment setting to lower the maximum, never past the consent's
     expiry.
5. **Report sharing (Phase 6 C88).**
   - **Default:** deferred; destinations run their own reports on hydrated data (ADR 0005).
6. **Biometric data in shares.**
   - **Default:** images and liveness or match results only when the connection's policy allows `biometric` and the person
     ticks the separate explicit consent; face templates never.
7. **Attested consent** (a share created by the source's backend without an OpenVerify consent step).
   - **Default:** allowed, labelled `attested`, with a required evidence reference and time; shown as "not witnessed" in both
     consoles.
8. **Consent proof after the data is gone.**
   - **Default:** no extra retention (the record is redacted with the data); an environment setting
     `consent-proof-retention-days` (0 to 3,650) keeps only time, purpose, recipient and text hash for the operator's
     legal-claims period [L2] ¶107.
9. **Data-sharing agreement at activation.**
   - **Default:** a required, audited free-text reference to the agreement between the two organisations; the platform does
     not judge it.
10. **End-user withdrawal channel.** OpenVerify has no end-user account.
    - **Default:** operator-mediated withdrawal (API and console) in this release, documented in the flow's consent text; a
      self-service withdrawal link later.
11. **Wallets and credential issuance** (OpenID4VP, HAIP, SD-JWT VC, mdoc, OpenID4VCI, EUDI).
    - **Default:** deferred to the next release with Phase 5 C68; keep the C62 trust store generic; when adopted, pin
      `@openid4vc/*` 0.7.0, `@sd-jwt/*` 0.22.0, `@owf/mdoc` 0.8.2 or later pinnable versions re-read at that time.
12. **`pako` ("MIT AND Zlib") when the wallet libraries are adopted.**
    - **Default:** accept under Phase 5 decision 31's reading of Zlib as permissive, recorded in `THIRD_PARTY_LICENSES.md`;
      not needed in this release.

## Fact-check (2026-10-29)

Independent re-check of the load-bearing facts against their primary sources, read on 2026-10-29 by a separate agent with
`scripts/fc/fc_fetch.py` (RFC 9309 robots matching before any other request to a host, at least 1.25 s between requests to
one host, no redirect followed automatically, no personal data sent; downloads under `downloads/fc-*/`, Python with `-I`,
nothing downloaded executed). The two EDPB PDFs were read with a new parse-only extractor (`scripts/fc/fc_pdf_text.py`:
FlateDecode, object streams, `/ToUnicode` CMaps). The repository was read with `git show 91c83e02:<path>`. Summary:
**27 confirmed, 2 corrected, 0 could not verify.**

| # | Fact | Verdict | Primary source and what it shows |
|---|---|---|---|
| 1 | Pin `e924fe7f…` (2026-10-29T08:06:59Z), tree `b665d272…` (914 entries), Apache-2.0; 62 files match | confirmed | GitHub API repository, commits and tree; the note's `downloads/cn-persona/` holds 61 tree blobs plus the root `LICENSE` (blob `261eeb9e`), all matching; the Connect files this check fetched match too |
| 2 | Create body: `connection-id`, `source-id`, `expires-in-seconds` 60–1,814,400 (21 days), default 14 days | confirmed | `paths/connect_share-tokens.yaml` (both required; "Must be between `60` … and `1814400` (21 days). If omitted, defaults to 14 days") |
| 3 | Statuses created, ready, pending, redeemed, expired, failed (schema omits `ready`); four failure reasons | confirmed | `components/schemas/connect-share-token.yaml` (five statuses; `source_not_found`, `source_redacted`, `import_failed`, `unrecoverable_error`); `redeeming-share-tokens.md` (adds `ready`) |
| 4 | Redeem 202; clone vs hydrate; clonable verification types; optional `meta` members | confirmed | `paths/connect_share-tokens_{share-token-id}_redeem.yaml` (`'202'`; clone without `destination-id` for Inquiry and Verification tokens; hydrate for Account, Transaction, Inquiry; `meta.account-id`, `auto-create-account-reference-id`, `auto-create-account-type-id`, `field-mappings`); `redeeming-share-tokens.md` (Government ID, Selfie, Database, Generic Document, Email Address, Phone Number) |
| 5 | Lifecycle pending → active (destination, dashboard only); either side deactivates; only the source reactivates, to pending; no deletion; `archived` internal | confirmed | `managing-connections.md`; `paths/connect_connections_{connection-id}_deactivate.yaml`, `_reactivate.yaml`; `paths/connect_connections_{connection-id}.yaml` has only `get`; `connect-connection.yaml` (`archived` never listed or retrievable directly) |
| 6 | Matching environment kinds only | confirmed | `redeeming-share-tokens.md` ("Sandbox to Sandbox and Production to Production") |
| 7 | Peek: `peek-source-data=true`, destination only, separate capability; `{visibility: full or presence, value}` | confirmed | `paths/connect_share-tokens_{share-token-id}.yaml`; `source-data-peekable-attribute.yaml` |
| 8 | Five token events; none has a webhook file | confirmed | `events.md` (the five names); the tree has no `webhooks/connect*` file |
| 9 | Scopes `connect.*`, `connect_connection.*`, `connect_share_token.*` | confirmed | `api-keys.md` permission table |
| 10 | Consent left to both organisations, no consent record or withdrawal documented; a separate production agreement per side; beta | confirmed | H1 `zzRSkDCvFP5sRV175hH1Yg.md` ("currently in Beta"; both organisations responsible; no record or withdrawal text); `connect.md` ("Both the Source Organization and the Destination Organization are required to sign the agreement … each agreement is executed separately") |
| 11 | OpenID4VP 1.0 Final, 9 July 2025 | confirmed | `openid.net/specs/openid-4-verifiable-presentations-1_0.html` ("Published: 9 July 2025 Status: Final") |
| 12 | OpenID4VCI 1.0 Final, 16 September 2025 | confirmed | `…/openid-4-verifiable-credential-issuance-1_0.html` ("Published: 16 September 2025 Status: Final") |
| 13 | HAIP 1.0 Final, 24 December 2025; `x509_hash`, `direct_post.jwt`, `dc_api.jwt`, DPoP, ES256 | confirmed | `…/openid4vc-high-assurance-interoperability-profile-1_0.html` ("Published: 24 December 2025 Status: Final"); `x509_hash` is required for signed requests; DPoP "MUST support"; ES256 the minimum algorithm |
| 14 | RFC 9901 (Standards Track, November 2025): salts of at least 128 bits, a new one per claim (§9.3) | **corrected** | `rfc-editor.org/rfc/rfc9901.txt` §9.3: a new, cryptographically random salt per claim is a MUST, but "The RECOMMENDED minimum length of the randomly generated portion of the salt is 128 bits". Corrected in place in sections 3.4 and 4.1 |
| 15 | SD-JWT VC `draft-ietf-oauth-sd-jwt-vc-22` (2026-10-27), IESG Evaluation | confirmed | `datatracker.ietf.org/doc/draft-ietf-oauth-sd-jwt-vc/` (rev 22 dated 27 October 2026; IESG state "IESG Evaluation", on the 2026-11-05 telechat agenda) |
| 16 | Token Status List `draft-ietf-oauth-status-list-21` (2026-08-13), RFC Editor queue | **corrected**: rev 21 is dated **2026-06-21**; 2026-08-13 is the record's last update | `datatracker.ietf.org/doc/draft-ietf-oauth-status-list/` ("Last updated 2026-08-13 (Latest revision 2026-06-21)"; IESG state "RFC Ed Queue"; the draft itself is dated 21 June 2026). Corrected in place in Sources (S6) and section 4.1 |
| 17 | VC Data Model 2.0 Recommendation 15 May 2025; VC-JOSE-COSE Recommendation 13 October 2026 | confirmed | `www.w3.org/TR/vc-data-model-2.0/` (latest version still "W3C Recommendation 15 May 2025"); `www.w3.org/TR/2026/REC-vc-jose-cose-20261013/` |
| 18 | Digital Credentials WD 20 October 2026; protocol ids | confirmed | `www.w3.org/TR/2026/WD-digital-credentials-20261020/` (`openid4vp-v1-unsigned`, `-signed`, `-multisigned`, `org-iso-mdoc`, `openid4vci-v1`) |
| 19 | ARF v3.0.0 (2026-07-23, CC BY 4.0): mdoc and SD-JWT VC mandatory, VCDM optional; RP registration and certificates; intermediaries (Art. 5b(10) as quoted) | confirmed | GitHub release v3.0.0 (2026-07-23T19:10:17Z); `README.md` at the tag ("licensed under … CC BY 4.0"; the API reports the licence as "Other"); `05-data-model-and-data-exchange-protocols.md` §5.4.1 ("Wallet Support: Mandatory, Mandatory, Optional"); `03-roles-…md` §3.11.4 (the Art. 5b(10) quotation), §3.17–3.19 (registrars, access and registration certificates) |
| 20 | EDPB 05/2020 v1.1 paras 65, 108, 113–114, 121–123 | confirmed | The PDF (v1.1 of 13 May 2020): para 65 (name every controller relying on the consent), 108 (keep "a copy of the information that was presented"; "not sufficient to merely refer to a correct configuration"), 113–114 (withdrawal as easy as giving), 122–123 (no swap from consent to another basis) |
| 21 | EDPB 3/2019 v2.0 paras 76–82 | confirmed | The PDF (v2.0 adopted 29 January 2020, v2.1 of 26 February 2020): para 77 (private biometric uses "will, in most cases, require explicit consent … (Article 9 (2) (a))"), para 82 (Art. 9 applies to stored templates used to uniquely identify) |
| 22 | Newest pinnable by 2026-10-15 and their licences; every latest published 2026-10-29 | confirmed | Packuments: `@openid4vc/openid4vp` and `openid4vci` 0.7.0 (2026-10-07, Apache-2.0; latest 0.9.0 on 2026-10-29); `@sd-jwt/core` and `sd-jwt-vc` 0.22.0 (2026-10-07; latest 0.24.0 on 2026-10-29); `@owf/mdoc` 0.8.2 (2026-10-07; latest 0.9.2 on 2026-10-29); `jose` 6.2.12 (2026-09-05, MIT; latest 6.2.14 on 2026-10-29); `identity-common-ts` `LICENSE` Apache-2.0; `panva/jose` `LICENSE.md` at `v6.2.12` MIT |
| 23 | `@owf/token-status-list` pulls `pako` 3.0.2 ("MIT AND Zlib"); Zlib confirmed permissive under Phase 5 decision 31 | confirmed, with nuances | `token-status-list` 0.4.2 depends on `pako` `^3.0.2` (a range: it now resolves to 3.0.3 of 2026-10-26, same licence); pulled in by `@sd-jwt/sd-jwt-vc` 0.22.0 and `@owf/mdoc` 0.8.2; `docs/plans/phase-5.plan.md:1264` confirms Zlib among the licences compiled into PDFium, so applying it to `pako` is an extension (the note's section 4.2 already says so) |
| 24 | ASVS 5.0.0 7.2.3, 8.4.1, 14.2.1, 9.2.3 | confirmed | The 5.0.0 flat JSON release asset (SHA-256 `8201b20e…`): the four requirement texts as summarised |
| 25 | RFC 9700 (BCP 240, January 2025) §2.3 and §4.3 | confirmed | `rfc-editor.org/rfc/rfc9700.txt` header and both sections |
| 26 | Consent record per session: text keys, optional keys, locale, sealed IP and user agent, time; no recipient, purpose, hash or withdrawal | confirmed | `packages/db/src/tables/inquiries.ts` (`ConsentRecord`) |
| 27 | Credentials only in the URL fragment; no entry from a template id | confirmed | `packages/contracts/src/flow-url.ts` (session or one-time-link credentials, fragment only) |
| 28 | Tokens: prefix + 256 random bits, stored as SHA-256; API keys HMAC-SHA256 with a pepper | confirmed | `packages/contracts/src/tokens.ts` (`TOKEN_BYTES = 32`); `packages/db/src/api-keys.ts` (`createHmac`, pepper ≥ 32 bytes) |
| 29 | `eventSubject` resolves flat subjects plus `report/` | confirmed | `packages/contracts/src/event-names.ts:133-143` |
