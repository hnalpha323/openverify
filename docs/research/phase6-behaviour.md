# Phase 6 research: how Persona reports behave (clean-room notes)

Prepared 2026-10-22 for OpenVerify Phase 6 ("Reports", `docs/PLAN.md` §6 and §4.4 [R1]): watchlist ingestion
with scheduled refresh, the fuzzy matcher, match review, dismissal, ignore lists and continuous monitoring, and the
PEP, adverse-media, crypto-address, email-risk, phone-risk, address-lookup and business-watchlist reports.

Everything below is written in our own words. Field names, enum values, event names, report type names,
configuration keys and URL paths are reproduced only because they are short identifiers needed for functional
parity. No sentences, UI copy, display names or help text are copied; where the public sources give only a display
label (dashboard buttons, category captions), the behaviour is described instead. Anything the public sources do
not state is marked **not documented**. Statements we infer, and that no source states, are marked
**(inference)**. Every citation key (`[O7]`, `[H15]`, `[P5]`, ...) is defined in section 0 with its full URL; every
source was read on 2026-10-22.

"OpenVerify today" means the working tree at `70a9929` plus the Phase 5 work in progress, read on 2026-10-22: no
report resource, report template, watchlist package or report event exists yet. `ID_PREFIXES` has no `rep`/`rptp`
entry [R6], `EVENT_NAMES` has no `report/*` name [R7], and `packages/watchlist` (planned in PLAN §3) has not been
created [R1].

---

## Summary

1. **One resource with many subtypes.** A report is `report/<type>` with a `rep_` id. The OpenAPI union has 20
   subtypes [O1], the surface index lists 52 type names [R4], and the events page lists 48 types with events [D5].
   Every subtype shares `status`, `created-at`, `completed-at`, `redacted-at`, `report-template-version-name`,
   `has-match`, `is-continuous`, `is-recurring` and `tags` [O2], and the relationships `inquiry`, `account`,
   `accounts`, `transaction` and `report-template` [O3].
2. **Status is about processing, never about the result.** `pending` → `ready` | `errored`. A ready report never
   goes back to pending, and a monitored report moves ready → ready or ready → errored on each run [H2] [D2]. Some
   vendor-backed types also pass through `submitted` [D5] [O42]. Whether anything matched is `has-match`, which
   counts only active (undismissed) matches [H2].
3. **Templates (`rptp_`) are dashboard objects with no public API and, by the Help Center's account, no version
   history**, yet every report names the template version it ran with (`report-template-version-name`, `v1` in all
   examples). A saved change applies to new reports only [H3] [O2] [O16]. In the dashboard only the person-watchlist
   template is editable (one article adds PEP); everything else is changed by Persona support [H3] [H6] [H13] [H14].
4. **Four ways to create a report:** the API (type, template id, a per-type `query`, account auto-creation in
   `meta`) [O5] [O4] [C11]; a workflow Run Report action, which Persona recommends [H4] [H5] [H30]; the dashboard
   (manual, or CSV bulk with at most 10,000 rows) [H5] [H8]; and from an account or case [H29] [H6]. The API reference
   also says reports run when an inquiry completes [D2]: inquiry templates can carry reports **(inference: a legacy
   path; how it is configured is not documented)**.
5. **Continuous monitoring** applies to recurrable types only: person and business watchlist, person and business
   adverse media, PEP, crypto address watchlist and business nonprofit, plus the screening report [H27] [H7] [H17].
   - The interval runs from 1 to 365 days, and each run reuses the original inputs [H27].
   - The schedule is set on the template, by Persona support [H13] [H14] [H21].
   - Monitoring can be paused and resumed, but only while a run is scheduled. A report can also be re-run at once,
     outside its schedule [O11] [O12] [O13] [H27].
   - Each run is a history entry: `rpr_`, with `run-type` `manual` or `scheduled`, a `scheduled-date`,
     `completed-at` and a match count. Each action is one too: `ract_`, of type `dismiss`, `review`, `pause` or
     `resume` [O9] [O10].
6. **Two match-review models.**
   - *Legacy* (watchlist, PEP, person and business adverse media, business watchlist, custom list):
     - a dismissal needs a reason and lands in the report's own `ignore-list`;
     - dismissals carry forward to later runs;
     - a hit stops all later runs until it is dismissed, and the next run then comes about 30 minutes later
       [O8] [H15] [H27].
   - *Screening*: each matched record carries a `review-status` (`pending`, `indeterminate`, `true_positive`,
     `false_positive`), a `risk-level` (`material`, `immaterial`), `present-in-last-run` and `notify-on-change`
     [O37] [O7]. A notify-on-change record returns to `pending` when its data changes. The report keeps running
     after a match [H17]. Each review emits `report/screening.reviewed`, with a `context` block that names the
     reviewer [O41] [C2].
7. **Events are `report/<type>.<action>`, with a slash** [O23] [D5]. `.ready` fires on every run, match or not.
   `.matched` fires when `has-match` turns true; on a monitored report, that is the run that brings a new match.
   `.dismissed` fires when a reviewer dismisses a match, and `.errored` when processing fails [O42] [H26].
   `docs/research/persona-surface.md` lists the webhook *file names* (`report_watchlist.matched`), not the event
   names. It also misses 76 report events and two report types that the events page lists [R4] [D5].
8. **Watchlist (person):**
   - **Inputs:** a name (parts or `term`), an optional birthdate and an optional country [O20] [H26].
   - **Lists:** chosen by category subscription or one list at a time (`search-lists` with `slug` and `type`)
     [O17] [H13].
   - **Name presets:** Exact, Strict, Tolerant and Custom, with published typo budgets [H16].
   - **Birthdate:** exact date, exact year, or ±1 year (the default) [H13].
   - **Country filter:** compares birthplace, citizenship, nationality or residency, and drops a candidate only when
     both sides carry a country and the countries differ [H13].
   - **Results:** `matched-lists[]`, whose entities carry `name`, `alias-type` and partial `birthdates` with a
     `granularity` [O19] [O21], plus `match-types` (example value `name_exact`). There is no numeric score.
9. **PEP:** four risk classes, with classes 1–2 the default.
   - **Toggles:** relatives and close associates, candidates, unknown class, portrait comparison, a default country,
     and sources without a URL [H14] [H25].
   - **Birthdate:** a filter that also keeps PEPs with no recorded birthdate [H25].
   - **Positions:** each carries `pep-class`, `source-key`, topics and start and end dates [O25] [C5].
   - **Refresh:** the sources are checked daily [H25].
10. **Adverse media:** a vendor archive of more than 300 million articles.
    - **Matching:** entity resolution groups the articles by person, and the groups are sorted by relevance, with
      reasons [H19].
    - **Configuration:** 14 categories; article filters for maximum age, dated articles only and allowed countries
      [H19] [H20].
    - **Dismissal:** a whole entity or a single article (`dismiss-type` `entity` | `media`) [O8].
    - **Workflows:** can read the article URLs that are still undismissed [H19].
11. **Crypto address watchlist:**
    - one input, checked against OFAC only, with no configuration [H22] [O30];
    - its results reuse the watchlist list shape, with each entity's `crypto-addresses[]` (`type`, `address`) [O30];
    - it has a `.matched` event but no `.dismissed` one [O42] [D5].
12. **Email risk and phone risk are vendor signals with no match events and no configuration** [H23] [H24].
    - **Email:** most attributes have been deprecated since August 2023 [C14].
    - **Phone:** 12 phone types, a carrier, a risk score, level and recommendation, and an optional SIM-swap level
      [O32] [H24]. The sources disagree on the scales: the API gives the score out of 1000 and the Help Center out
      of 100; the levels appear as five numbered levels in one place and free strings in another [O32] [H24] [H28].
13. **Address lookup is USPS CASS/DPV output** (DPV, RDI, CMRA, LACSLink, SuiteLink, carrier route, ZIP type),
    with only limited fields outside the US and a `submitted` step before the result [O33] [H18] [D5]. That data
    comes from licensed postal sources.
14. **Business watchlist:**
    - a `term` and an optional country [O36];
    - results in separate arrays for sanctions, fitness and probity, and warnings [O35] [H21];
    - sanctions are refreshed within 24 hours, warnings within a month [H21].
    The **screening report** merges person watchlist, PEP, person adverse media, business watchlist and business
    adverse media. Its inputs add address, email and an ID number, its records are richer, and its template chooses
    the coverage with `screening-coverage` [O37] [O38] [O18] [H17].
15. **Sandbox hits are triggered by fixed inputs per type** [H9].
    - For watchlist, PEP and adverse media those inputs are the names of real public figures, and for crypto a
      real listed address.
    - Email and phone use fixed test values; the profile and social-media types always return one fixed synthetic
      person; address lookup has no test input.
    - OpenVerify must not copy this, because `CLAUDE.md` rule 3 forbids real personal data in tests [R2].
16. **Data licences (section 7):**
    - **OFAC:** passes; it is a US government work [P1] [P2].
    - **EU:** passes with attribution (CC BY 4.0 under Decision 2011/833) [P7] [P8].
    - **UK:** passes with attribution under OGL v3.0, but the **OFSI list closed on 28 January 2026**. The FCDO's UK
      Sanctions List is now the only UK source [P9] [P10].
    - **UN:** fails as a shipped default, because the UN site grants only personal, non-commercial use [P5].
    - **Wikidata:** passes (CC0) [P12].
    - **GDELT:** passes with citation [P13].
    - **OpenSanctions bulk data:** fails; it is non-commercial only [P16].

---

## Gap table

Verdicts used in the last column of each row: **MATCH** (adopt the public behaviour as is), **OURS** (no public
counterpart; our design, labelled as ours), **DEFER** (later phase), **HONEST** (we cannot do it for free: adapter
plus sandbox, or beta heuristic).

### Shared model

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 6 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| G1 | `report/<type>` resources, `rep_` ids, JSON:API, attributes listed in Summary 1 | Same type strings and attribute names; add `report: 'rep'` to `ID_PREFIXES` | Migration parity; our ids are already `<prefix>_<ULID>` | MATCH | [O1] [O2] [R6] |
| G2 | `pending` / `ready` / `errored`, plus `submitted` for async vendor types; ready never returns to pending; status is independent of match | Same machine in `packages/core` (`report-state-machine.ts`); `submitted` only for adapter-backed types | Parity; a pure state machine is easy to test first | MATCH | [O2] [H2] [D5] |
| G3 | Errors are only "insufficient inputs or upstream failure"; no reason codes are documented | `errors[]` with reason codes `insufficient_input`, `list_unavailable`, `list_stale`, `provider_error`, `provider_not_configured`; **never `ready` with `has-match: false` when a selected list was not loaded or is stale** | ADR 0002 rule 3a applied to reports: a false "no match" is the screening equivalent of a fake pass | OURS | [H2] [R3] |
| G4 | Templates `rptp_`; no template API; no version history, though reports name a version | `rptp_` templates with immutable published versions (`rptpv_`), a template API and a dashboard editor; each report pins its version and still returns `report-template-version-name` | Self-hosters have no support desk to edit templates; immutability gives the audit trail that "reports keep the configuration they ran with" implies | OURS (versioning), MATCH (attribute) | [H3] [O16] [O2] |
| G5 | `POST /api/v1/reports` with `data.type`, `report-template-id`, `query`, `meta.auto-create-account*`; deprecated `reference-id`; `meta.processing-mode` (example `sync`) | Same body and `meta` keys; refuse `reference-id` in new versions; `processing-mode: sync` waits up to a bounded time, else 202-like `pending` (ours, semantics **not documented**) | Parity; we already have idempotency keys and date-versioned API | MATCH | [O5] [O4] [C11] |
| G6 | Created by workflow Run Report (recommended), dashboard, account, case | Phase 6: API, dashboard "create report", and an inquiry-template `reports` list run on `inquiry.completed`; workflow action and case actions in Phase 8 | Workflows are Phase 8 [R1]; something must trigger reports before then | DEFER (workflow) / OURS (inquiry trigger) | [H4] [H30] [D2] |
| G7 | CSV bulk create, at most 10,000 rows per file | Phase 9 (dashboard); Phase 6 exposes only the API | Keeps Phase 6 focused | DEFER | [H8] |
| G8 | Relationships `inquiry`, `account` (home or first linked), `accounts` (all; expanding needs `account.read`), `transaction`, `report-template`; inquiries list `reports` | Same; `transaction` stays null until Phase 7 transactions | Parity | MATCH | [O3] [O43] [C1] [C10] |
| G9 | `add-tag`, `remove-tag`, `set-tags` (by `tag-name` or `tag-id` in `meta`) | Same routes over the existing tag service | Parity, reuse | MATCH | [O15] |
| G10 | `GET /reports/{id}/history`: runs (`rpr_`) and actions (`ract_`), newest first, paginated; `run-history` attribute removed from report bodies in 2025-12-08 | Same endpoint and shapes; actions record the actor as a user, API key or (Phase 8) workflow run | Parity; history is the audit trail | MATCH | [O9] [O10] [C6] [C7] |
| G11 | `DELETE /reports/{id}` redacts the report's PII only; `redacted-at` set; no dismissal on redacted reports | Same; sealed `query` and match snapshots nulled; review routes answer 409 on redacted, pending or errored reports; emit `report/<type>.redacted` | Parity, plus our `*.redacted` event convention | MATCH / OURS (event) | [O6] [H15] [R7] |
| G12 | `GET /reports/{id}/print` returns a PDF; the dashboard offers PDF for person watchlist and PEP only | Defer to Phase 9's print-to-PDF; do not register the route before then | No PDF writer in the API yet; a route that 501s misleads OpenAPI readers | DEFER | [O14] [H28] |
| G13 | Event names `report/<type>.<action>` | Exactly these names in `EVENT_NAMES` (subject = payload type, our C5 convention); fix the surface index | Parity; the index is wrong today | MATCH | [O23] [D5] [R4] [R7] |

### Continuous monitoring

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 6 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| M1 | Interval 1–365 days, set on the template by support; plan-gated | Template key `recurrence-interval-days` (1–365, null = one-off); the API may override it per report (ours) | No support desk in a self-hosted product | MATCH (range) / OURS (API) | [H27] [H13] |
| M2 | `POST /reports/{id}/run` re-runs a monitored report now; history `run-type: manual` | Same; 409 for non-recurrable types | Parity | MATCH | [O13] [H7] |
| M3 | Pause and resume need an upcoming scheduled run; extra permissions | Same rule (409 otherwise); scope `reports:monitor` | Parity | MATCH | [O11] [O12] [H27] |
| M4 | Legacy types stop recurring on a hit until it is dismissed; screening keeps running and refreshes cases | Default: keep running, and alert only on **new or changed** matches; template option `pause-on-match` (default false) restores the legacy behaviour | Stopping monitoring at the first hit leaves a gap while a reviewer is away **(inference)**; the newer screening product chose to continue | OURS (default) / MATCH (option) | [H27] [H17] |
| M5 | After the last dismissal the next run is about 30 minutes later, then the normal cadence | Same when `pause-on-match` is on (`resume-delay-minutes`, default 30) | Parity | MATCH | [H15] |
| M6 | Watchlist sources refreshed as often as every 10 minutes; PEP daily; adverse media within 48 hours; business sanctions within 24 hours, warnings within a month | Scheduled list syncs (default hourly for OFAC, EU and UK; daily for the PEP mirror); each report records the list versions it used; **optionally re-screen monitored subjects against a list's added entries right after a sync** | Freshness parity; delta re-screening catches new designations without waiting for the interval | MATCH / OURS (delta) | [H26] [H22] [H25] [H19] [H21] |
| M7 | `is-continuous` is "has run more than once" in the schema but "can recur and is recurring" in the changelog; `is-recurring` means a future run is queued | Define both precisely in our schema: `is-continuous` = more than one completed run; `is-recurring` = a next run is scheduled and not paused | The public sources disagree | OURS (definition) | [O2] [C12] [C9] |

### Match review

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 6 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| V1 | `POST /reports/{id}/dismiss`: `reason` required; `dismiss-type` (`entity` / `media`) and `entity-id` required for person and business adverse media; without them, all active matches go | Same body; also accept `entity-id` on every legacy type to dismiss a single identity | The dashboard can dismiss one identity on every type, but the API cannot; we close that gap | MATCH / OURS | [O8] [H15] |
| V2 | Per-report `ignore-list[]` with `ignored-at`, `run-history-completed-at`, a `match` snapshot, `user`, `ignore-reason` (PEP adds `is-internal`) | Same attribute; the suppression key is the source list plus the publisher's entity id (plus the article URL for media), so a dismissal survives re-runs | Parity; the comparison key itself is **not documented** | MATCH / OURS (key) | [O19] [O24] [O25] [O29] |
| V3 | Screening review: `review-type` (`all_records` / `record`), `record-token`, `review-status`, `risk-level`, `comment`, `notify-on-change`; records carry `present-in-last-run`; listings carry their own review fields | One review engine for all types; a legacy dismissal is stored as a `false_positive` review with a reason **(inference: a single engine fits both models)** | Avoid two divergent code paths | MATCH (screening API) | [O7] [O37] [O40] |
| V4 | `report/screening.reviewed` with `context` (`review-type`, `review-status`, `risk-level`, `record-token`, `reviewer-token` prefixed `user_`, `wfr_` or `api_`, `comment`) | Same event; carry the same fields in `payload.meta` (our C10 convention) with our prefixes (`usr_`, `key_`, later the workflow-run prefix) | Parity in content, consistency with our event envelope | MATCH (content) | [O41] [C2] [O46] [R7] |
| V5 | API scopes `report.read` / `report.write`; dashboard rights for details, re-run, dismiss, pause/resume, templates, scoped to environments and templates | Scopes `reports:read`, `reports:write`, `reports:review`, `reports:monitor`, `reports:redact`, `report-templates:read`, `report-templates:write`; template scoping later | Our scopes use `resource:action` [R8]; review deserves its own right | MATCH (split) | [D6] [H31] [H15] [R8] |
| V6 | No organisation-wide "never alert on this person for this entity" list is documented | Do not build one in Phase 6 (owner question 6) | It can suppress true hits across many accounts | N/D → not built | — |

### Per type

| ID | Type | Public behaviour (Persona) | What OpenVerify should do in Phase 6 | Tier | Sources |
|---|---|---|---|---|---|
| T1 | `watchlist` | Name, birthdate, country; list selection; Exact/Strict/Tolerant/Custom; birthdate modes; four country fields | Same `query` and template keys over OFAC, EU and UK lists (UN opt-in), matcher built on C58 | R, `beta` until a recall benchmark passes | [O20] [O17] [H13] [H16] |
| T2 | `watchlist` results | `matched-lists[]` with list metadata and entities; `match-types`; no score | Same shape plus `score` (0–1), per-attribute levels and the list versions used (ours) | R | [O19] [O21] |
| T3 | `politically-exposed-person` | Four classes, toggles, positions, associates, sources | Local mirror of Wikidata position holders, our own class mapping; associates only where Wikidata has family relations | H (`beta`) + A adapter | [O25] [H14] [H25] [P12] |
| T4 | `adverse-media` | Vendor archive, entity resolution, 14 categories, article filters, entity or article dismissal | GDELT DOC 2.0 adapter: name query plus our category lexicon, rolling 3-month window, no entity resolution beyond name and country; commercial adapter port | H (`beta`) / A | [H19] [O27] [P13] [P14] |
| T5 | `crypto-address-watchlist` | One address, OFAC only, exact match, no configuration | Exact match against OFAC digital-currency address fields after per-chain canonicalisation; dismissal allowed (ours) | R | [O30] [H22] [P4] |
| T6 | `email-address` | Vendor reputation and signals | Real subset from Phase 5 (syntax, MX, disposable, domain age by RDAP); reputation, breach and spam-trap signals only through an adapter; unknowns are `null`, never `false` | R + A | [O31] [H23] [R5] |
| T7 | `phone-number` | Type, carrier, location, risk score, level, recommendation, SIM swap | libphonenumber validity, type (where determinable) and country; carrier, risk and SIM swap only through an adapter | R + A | [O32] [H24] [R5] |
| T8 | `address-lookup` | USPS CASS/DPV metadata; international limited | Adapter port with a sandbox; the real subset is our C58 normaliser plus PO-box and military-address patterns, without deliverability claims | A (+ R subset) | [O33] [H18] |
| T9 | `business-watchlist` | Term and country; sanctions, fitness and probity, warnings | Sanctions from the OFAC, EU and UK entity entries with C58.6 business-name matching; the warnings and fitness-probity arrays stay empty with a `list_not_configured` note | R (sanctions) / A (warnings) | [O35] [O36] [H21] |
| T10 | `screening` | Five screenings in one report, richer inputs, record review | Build the screening engine first and render the legacy types from it **(inference)** | composite | [O37] [O38] [O18] [H17] |

### Platform

| ID | Public behaviour (Persona) | What OpenVerify should do in Phase 6 | Why | Verdict | Sources |
|---|---|---|---|---|---|
| X1 | Run Report workflow action with field mapping, a target object and "continue on error"; conditions on a report's `match_found` | Expose a `runReport(templateId, query, links)` service and the `has-match` attribute for Phase 8 to call | Phase 8 owns workflows | DEFER | [H30] [H5] |
| X2 | Reports and report runs attachable to accounts and cases | Accounts now (`account` / `accounts` relationships); cases in Phase 8 | Cases are Phase 8 | MATCH / DEFER | [O44] [O45] |
| X3 | Dashboard: report index (filters, saved views), detail (matches, history, actions), template editor, account and inquiry Reports tabs, CSV and PDF exports | Phase 6: index with filters on template, status, match and tag; detail with matches, dismiss or review, history, pause, resume and run; watchlist and screening template editor; inquiry and account tabs. Saved views and exports in Phase 9 | Acceptance needs reports usable from the dashboard [R1] | MATCH (core) / DEFER | [H10] [H15] [H7] [H34] [H29] [H28] |
| X4 | Sandbox magic inputs are real people's names and a real listed address | Synthetic fixture lists and magic values, in `docs/checks/sandbox-providers.md` | `CLAUDE.md` rule 3 | OURS | [H9] [R2] |
| X5 | Connect shares a PII-filtered snapshot of a screening report | Phase 11 | Connect is Phase 11 | DEFER | [O47] |

---

## Corrections to the repository's records

1. **UK source.** `docs/PLAN.md` §3 and `THIRD_PARTY_LICENSES.md` (the "UK OFSI Consolidated List" row) name the
   OFSI list [R1] [R9]. It closed on **28 January 2026** and is no longer updated. The FCDO's **UK Sanctions List**
   is now the only source of UK designations; it is published as XML (with an XSD, version 4.33.3), CSV, ODS, ODT,
   HTML, TXT and PDF [P9] [P10].
2. **UN licence.** `THIRD_PARTY_LICENSES.md` records the UN list as "Public, UN terms of use" [R9]. Those terms
   grant permission only for a user's "personal, non-commercial use" (quoted because the exact wording decides the
   question), with no right to redistribute or to build derivative compilations [P5]. No separate data licence for
   the consolidated list was found; its page could not be fetched (section 0). So the UN file cannot be a default
   runtime source for an Apache-2.0 project meant for commercial use (section 7).
3. **Event names in the surface index.** `persona-surface.md` lists `report_<type>.<action>` [R4]. Those are the
   OpenAPI webhook file names. The event `name` is `report/<type>.<action>` [O23] [D5].
4. **Missing report events and types.** The index has 50 report events [R4]; the events page lists 126 [D5].
   - **Missing types:** `business-legal-history` and `ip-address` [D5].
   - **Missing event:** `report/business-nonprofit.changed` [D5].
   - **Missing `.submitted` variants**, for the business types (associated persons, classification, enforcement
     action, industry classification, legal history, media coverage, online presence, personnel insights) and for
     `middesk` and the two `novacredit` types [D5].
   - **A type path the index does not show:** the sentilink scores type is `report/integration/sentilink-scores`
     [O1].
5. **"Ignore list" in PLAN §2 and §4.4** [R1]. The only public ignore list belongs to a single report: it holds the
   matches that report dismissed [O19] [H15]. No organisation-wide ignore list is documented.

---

## 0. Sources and pins

**Read date.** Every source below was read on **2026-10-22**.

**OpenAPI (O).** Repository `github.com/persona-id/persona-openapi`, licence Apache-2.0 (GitHub API metadata), commit
**`805512b348af1c5d345bea8d7db7eb43d1821872`** (HEAD on 2026-10-22, committed 2026-10-21; the Phase 5 notes use the same
pin), directory `2026-09-29/`. Read from a shallow sparse clone of that directory only. Every `O` link is
`https://github.com/persona-id/persona-openapi/blob/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/` followed by the path
shown; `{` and `}` in path file names are written `%7B` and `%7D`.

**Developer docs (D) and changelog (C).** `docs.withpersona.com`, version 2026-09-29, read as Markdown (`.md`
suffix), starting from the version's index [D9]. The robots file disallows only `/api/fern-docs/` and sets no content signals. The changelog page shows only
its 20 newest entries, so all 96 entry pages listed in its index were read, and the report-related ones are cited
individually.

**Help Center (H).** Article ids under `https://help.withpersona.com/articles/<id>/`. The text was read from the
site's full dump, `https://help.withpersona.com/llms-full.txt` (4,501,197 bytes on 2026-10-22), which carries a
`Source:` URL per article. `H0` is the site's one-line index, used only where marked. The robots file disallows only
`/gated/`.

**Publishers (P).** Each publisher's own page, fetched at most once per second per host, with a descriptive
User-Agent that carries no contact details. The 10-second crawl delays of `www.un.org`, `www.usa.gov` and
`www.opensanctions.org` were respected.

**Repository (R).** Read-only paths in `/home/mhnoor/persona-opensource` at `70a9929`.

| Key | What | Location |
|---|---|---|
| O1 | Report union and type list | `components/schemas/report.yaml` |
| O2 | Shared report attributes | `components/schemas/report-shared-attributes.yaml` |
| O3 | Shared report relationships | `components/schemas/report-shared-relationships.yaml` |
| O4 | Shared request attributes (`account-id`, `reference-id`, `report-template-id`) | `components/schemas/report-shared-request-attributes.yaml` |
| O5 | List and create reports | `paths/reports.yaml` |
| O6 | Retrieve and redact | `paths/reports_%7Breport-id%7D.yaml` |
| O7 | Review matches | `paths/reports_%7Breport-id%7D_review.yaml` |
| O8 | Dismiss matches | `paths/reports_%7Breport-id%7D_dismiss.yaml` |
| O9 | Report history | `paths/reports_%7Breport-id%7D_history.yaml` |
| O10 | History entry schemas (run, dismiss, review, pause, resume) | `components/schemas/report-history-run.yaml` and siblings `report-history-{dismiss,review,pause,resume}.yaml`, `report-history.yaml` |
| O11 | Pause monitoring | `paths/reports_%7Breport-id%7D_pause.yaml` |
| O12 | Resume monitoring | `paths/reports_%7Breport-id%7D_resume.yaml` |
| O13 | Re-run | `paths/reports_%7Breport-id%7D_run.yaml` |
| O14 | Print PDF | `paths/reports_%7Breport-id%7D_print.yaml` |
| O15 | Tags | `paths/reports_%7Breport-id%7D_add-tag.yaml`, `_remove-tag.yaml`, `_set-tags.yaml` |
| O16 | Template shared attributes and `meta.version` | `components/schemas/report-template-shared-meta.yaml`, `report-template-shared-attributes.yaml` |
| O17 | Watchlist template (`search-lists`) | `components/schemas/report-template-watchlist.yaml` |
| O18 | Screening template (`screening-coverage`) | `components/schemas/report-template-screening.yaml` |
| O19 | Watchlist report | `components/schemas/report-watchlist.yaml` |
| O20 | Watchlist request | `components/schemas/report-watchlist-request.yaml` |
| O21 | Watchlist entity | `components/schemas/report-watchlist-entity.yaml` |
| O22 | Watchlist example | `components/examples/report-watchlist.yaml` |
| O23 | `report/watchlist.matched` webhook | `webhooks/report_watchlist.matched.yaml` |
| O24 | `report/watchlist.dismissed` example | `components/examples/report-watchlist-dismissed-webhook-body.yaml` |
| O25 | PEP report | `components/schemas/report-politically-exposed-person.yaml` |
| O26 | PEP request | `components/schemas/report-politically-exposed-person-request.yaml` |
| O27 | Adverse media report | `components/schemas/report-adverse-media.yaml` (request: `report-adverse-media-request.yaml`) |
| O28 | Business adverse media report | `components/schemas/report-business-adverse-media.yaml` (request: `report-business-adverse-media-request.yaml`) |
| O29 | Business adverse media ignore-list entry and match | `components/schemas/report-business-adverse-media-ignore-list-entry.yaml`, `report-business-adverse-media-match.yaml` |
| O30 | Crypto address watchlist report and request | `components/schemas/report-crypto-address-watchlist.yaml`, `report-crypto-address-watchlist-request.yaml` |
| O31 | Email address report and request | `components/schemas/report-email-address.yaml`, `report-email-address-request.yaml` |
| O32 | Phone report (`report/phone-number`) and request | `components/schemas/report-phone-risk.yaml`, `report-phone-risk-request.yaml` |
| O33 | Address lookup report | `components/schemas/report-address-lookup.yaml` |
| O34 | Address lookup request | `components/schemas/report-address-lookup-request.yaml` |
| O35 | Business watchlist report | `components/schemas/report-business-watchlist.yaml` |
| O36 | Business watchlist request | `components/schemas/report-business-watchlist-request.yaml` |
| O37 | Screening report | `components/schemas/report-screening.yaml` |
| O38 | Screening request | `components/schemas/report-screening-request.yaml` |
| O39 | Screening example | `components/examples/report-screening.yaml` |
| O40 | Review-matches request example | `components/examples/review-matches.yaml` |
| O41 | `report/screening.reviewed` example | `components/examples/report-screening-reviewed-webhook-body.yaml` |
| O42 | All `report_*` webhook definitions (50 files) | `webhooks/` (`https://github.com/persona-id/persona-openapi/tree/805512b348af1c5d345bea8d7db7eb43d1821872/2026-09-29/webhooks`) |
| O43 | Inquiry `reports` relationship | `components/schemas/inquiry.yaml` |
| O44 | Accounts add-objects (reports, report runs) | `paths/accounts_%7Baccount-id%7D_add-objects.yaml` |
| O45 | Cases (filter by report, attach reports and report runs) | `paths/cases.yaml` |
| O46 | Event object `context` | `components/schemas/event.yaml` |
| O47 | Connect screening source data | `components/schemas/source-data-report-screening.yaml` |

| Key | URL |
|---|---|
| D1 | https://docs.withpersona.com/2026-09-29/reports.md |
| D2 | https://docs.withpersona.com/2026-09-29/api-reference/reports.md |
| D3 | https://docs.withpersona.com/2026-09-29/reports-cookbook.md |
| D4 | https://docs.withpersona.com/2026-09-29/integration-guide-reports-via-api.md |
| D5 | https://docs.withpersona.com/2026-09-29/events.md |
| D6 | https://docs.withpersona.com/2026-09-29/api-keys.md |
| D7 | https://docs.withpersona.com/2026-09-29/workflows.md |
| D8 | https://docs.withpersona.com/2026-09-29/accounts.md |
| D9 | https://docs.withpersona.com/2026-09-29/llms.txt |
| D10 | https://docs.withpersona.com/2026-09-29/integration-guide-kyb-via-api.md |
| C1 | https://docs.withpersona.com/2026-09-29/updates/changelog/2026/10/21.md (`accounts` relationship) |
| C2 | https://docs.withpersona.com/2026-09-29/updates/changelog/2026/10/14.md (review endpoint; `reviewer-token`) |
| C3 | https://docs.withpersona.com/2026-09-29/updates/changelog/2026/9/29.md (business adverse media `related-sources` fields) |
| C4 | https://docs.withpersona.com/2026-09-29/updates/changelog/2026/6/15.md (phone location fields) |
| C5 | https://docs.withpersona.com/2026-09-29/updates/changelog/2026/1/12.md (PEP position topics and dates) |
| C6 | https://docs.withpersona.com/2026-09-29/updates/changelog/2025/12/16.md (history endpoint) |
| C7 | https://docs.withpersona.com/2026-09-29/updates/changelog/2025/12/8.md (`run-history` attribute removed) |
| C8 | https://docs.withpersona.com/2026-09-29/updates/changelog/2025/4/1.md (run-history fields incl. `report-template-version-id`) |
| C9 | https://docs.withpersona.com/2026-09-29/updates/changelog/2024/9/30.md (`is-recurring`) |
| C10 | https://docs.withpersona.com/2026-09-29/updates/changelog/2024/9/16.md (`transaction` relationship) |
| C11 | https://docs.withpersona.com/2026-09-29/updates/changelog/2024/3/4.md (`meta.auto-create-account*`) |
| C12 | https://docs.withpersona.com/2026-09-29/updates/changelog/2023/11/13.md (`is-continuous`) |
| C13 | https://docs.withpersona.com/2026-09-29/updates/changelog/2023/8/28.md (input fields echoed on watchlist and adverse media) |
| C14 | https://docs.withpersona.com/2026-09-29/updates/changelog/2023/8/7.md (email attributes deprecated) |
| C15 | https://docs.withpersona.com/2026-09-29/updates/changelog/2023/6/12.md (birthdate and country validation errors) |
| C16 | https://docs.withpersona.com/2026-09-29/updates/changelog/2023/5/15.md (business adverse media dismissal) |
| C17 | https://docs.withpersona.com/2026-09-29/updates/changelog/2023/5/8.md (business watchlist dismissal) |
| C18 | https://docs.withpersona.com/2026-09-29/updates/changelog/2021/5/14.md (watchlist list arrays removed) |
| C19 | https://docs.withpersona.com/2026-09-29/updates/changelog/2025/2/4.md (business associated persons and registrations types) |
| C20 | https://docs.withpersona.com/2026-09-29/updates/changelog/2023/11/27.md (`phone-number` input) |

| Key | Help Center article (id) | Key | Help Center article (id) |
|---|---|---|---|
| H0 | index `https://help.withpersona.com/llms.txt` | H27 | Continuous monitoring (`7LRMBbxLshF7sCcLhfhwF4`) |
| H1 | Reports overview (`hI9YUPxjW7v46pFfyk6J1`) | H28 | Exporting report results (`1VPjBU6QajQDmMrVZ9E47g`) |
| H2 | Report statuses (`3GUjrXmwigjXHRX4U29DTt`) | H29 | Report from an account (`3DgR5AirdF0NKpTJhVub6U`) |
| H3 | Template change management (`4H04oOmzQRhVgVXrmt9GHC`) | H30 | Workflow Run Report step (`20fGyKJCYgiR9NMY9nlKkN`) |
| H4 | Creating reports (`3qGLZYtRNreVNZHxXAZqhw`) | H31 | Dashboard permissions reference (`6IQlWEmAy2E4emOYjzeLD8`) |
| H5 | Running reports and reviewing matches (`042goubhldtkoKAA6AmiZ`) | H32 | KYC + AML solution (`21hfiVrSCVXUqLQxKS8zvo`) |
| H6 | Templates in platform connections (`M25qszX9Ke7ECMTFVhmCyv`) | H33 | KYC + crypto watchlist solution (`6n23LISjc8xg0dvSm8awNY`) |
| H7 | Re-run and report history (`3mQ9txwDLQu4qeBgGmKcIR`) | H34 | Reviewing an inquiry (`3JkqiHmtOWftGHDPKYcOCW`) |
| H8 | Bulk create (`1rzpXVJt1tTpRdhPuhaIkX`) | H35 | Chainalysis integration (`7ykrjzOJl668pf6QFThNWH`) |
| H9 | Sandbox test hits (`56sLAbSytkmI57zpbug3xc`) | H36 | TRM Labs integration (`5yal3xQnhclQIsXxWYVBR7`), H0 summary |
| H10 | Report filters and views (`2hGrnweU3N3nMMqteJ4NIr`) | H37 | Coinbase integration (`3YdP2nPGZmKloGGzxRrP05`), H0 summary |
| H11 | Splitting names before a report (`6OJJ3uGkFfmHEFPH7AGnbM`) | H38 | SentiLink integration (`2aYEhpHKbRvd2GWieHIbkv`), H0 summary |
| H12 | Reviewing screening matches (`NWRTQpVeAAZA3xxw1Fpjdp`) | H39 | Profile report (`tk722HpTwHvVx3wQxiM9j`), H0 summary |
| H13 | Configuring the watchlist report (`3gcpePErNfB1lPrMAcLjeI`) | H40 | Social media report (`HVISi7lloep5Vy8GVyljRL`), H0 summary |
| H14 | Configuring the PEP report (`5GFg31N2oNlxZm5SxLR7nz`) | H41 | Business associated persons (`3pBDySJ0AAqp35RaYmeKzc`), H0 summary |
| H15 | Dismissing matches (`2aIx2l7MNTh62ZhKcIqD7o`) | H42 | Business registrations (`4CoTmwLAOugJst2XGScXgb`), H0 summary |
| H16 | Name match requirements (`1FOJzuI3uMFmcDuR5zkged`) | H43 | Business nonprofit (`6NMGFLlOatKM2lA7RNXjta`), H0 summary |
| H17 | Screening report (`4qlOluQAU5mZdMTSWufij6`) | H44 | Business classification (`60dDv0ttzy8rDFNPLaiszs`), H0 summary |
| H18 | Address lookup (`79VIhKIprbykNbIDkzkAHt`) | H45 | Business online presence (`4PXsPj48k67OR26o2ToN5x`), H0 summary |
| H19 | Adverse media (`7K0LSbrfPvUsuBHGCjUhsr`) | H46 | Better Business Bureau (`jhDBuvMFielfzLqNO1SUM`), H0 summary |
| H20 | Business adverse media (`7wGfEzTPrmtHdt9FzZbS1m`) | H47 | Business liens (`6xsrP9WjiPfRjRAIYPqrsi`), H0 summary |
| H21 | Business watchlist (`4y3oaeL7pc2f5DHKT50smE`) | H48 | NCES (`3dDBB5UD9AusBiu0POjn8l`), H0 summary |
| H22 | Crypto address watchlist (`562IPh6XJ91ekE3kAEOrLj`) | H49 | MX integration (`3ypIdJ9UFqWt44nlyKF3WZ`), H0 summary |
| H23 | Email risk (`4IqHs9oWE6ihGakWUzYCcL`) | H50 | Nova Credit integration (`4ii9GelrUPReTcOQERMH8f`), H0 summary |
| H24 | Phone risk (`6MsSJ5GQjHhtIN0xxLLeby`) | H51 | Clearbit integration (`oFXiN9UhYPJ8QACppAds0`), H0 summary |
| H25 | PEP report (`116MoqsoZ0B5FYkdR8Hufp`) | H52 | Yardstik integration (`2cvnPIzAcuxukLQE3UsMw9`), H0 summary |
| H26 | Watchlist report (`UQGaDEhkQ7TLAMJsjuXiX`) | H53 | CRS Credit integration (`hViKfl505UuxUG9rcTGZO`), H0 summary |
| — | — | H54 | Fine-grained permissions, July 2023 (`g8n0BjVSmFAkmvXjbuOGB`) |

| Key | Publisher page | Used for |
|---|---|---|
| P1 | https://www.usa.gov/government-copyright | US government works carry no copyright when made by federal staff in their duties |
| P2 | https://ofac.treasury.gov/sanctions-list-service | OFAC's SDN and non-SDN datasets, delta files and custom datasets through its Sanctions List Service |
| P3 | https://ofac.treasury.gov/faqs/topic/1641 | Formats (XML, CSV, fixed-field, delimited), delta files, sporadic update timing (FAQ 88), UIDs (FAQ 1031) |
| P4 | https://ofac.treasury.gov/faqs/topic/1626 | Digital currency addresses on the SDN list (FAQs 562, 563, 594) |
| P5 | https://www.un.org/en/about-us/terms-of-use | UN website terms (personal, non-commercial use) |
| P6 | https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list | Not retrievable: HTTP 202 with an empty body (a bot challenge); not retried beyond once |
| P7 | https://data.europa.eu/api/hub/search/search?q=EU%20financial%20sanctions%20consolidated%20list&filter=dataset&limit=5 | EU dataset `consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions`: licence `COM_REUSE`, XML and CSV distributions on `webgate.ec.europa.eu/fsd/fsf`. Licences are set per distribution: all but two are `COM_REUSE`; the CSV 1.0 file is tagged CC BY 4.0 and the linked Sanctions Tracker app CC BY-ND 4.0; accrual is `daily` (corrected in fact-check) |
| P8 | https://commission.europa.eu/legal-notice_en | Commission reuse policy: Decision 2011/833/EU and CC BY 4.0 by default |
| P9 | https://www.gov.uk/government/publications/the-uk-sanctions-list (also via `https://www.gov.uk/api/content/...`) | UK Sanctions List: sole UK source, formats, XSD, update log; GOV.UK OGL v3.0 notice |
| P10 | https://www.gov.uk/government/publications/financial-sanctions-consolidated-list-of-targets | OFSI Consolidated List withdrawn on 28 January 2026 |
| P11 | https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml | HEAD only: `text/xml`, 22,051,514 bytes, last modified 2026-10-16 |
| P12 | https://www.wikidata.org/wiki/Wikidata:Licensing | Structured data is CC0 |
| P13 | https://www.gdeltproject.org/about.html#termsofuse | GDELT terms: any use including commercial, citation and link required |
| P14 | https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ | DOC 2.0 API: rolling 3-month window, `ArtList` mode, `MAXRECORDS` default 75, maximum 250, JSON output |
| P15 | https://www.opensanctions.org/licensing/ | OpenSanctions commercial licences |
| P16 | https://www.opensanctions.org/docs/commercial/exemption/ | OpenSanctions bulk data free only for non-commercial use |

| Key | Repository path (read-only) |
|---|---|
| R1 | `docs/PLAN.md` §2, §3, §4.4, §6, §10 |
| R2 | `CLAUDE.md` rules 3, 4, 5 |
| R3 | `docs/adr/0002-check-tiers.md` |
| R4 | `docs/research/persona-surface.md` ("Report types (52)", webhook events, `reports/*` paths) |
| R5 | `docs/plans/phase-5.plan.md` C54.6, C56, C58, C61, C62.7, C63 |
| R6 | `packages/contracts/src/ids.ts` (`ID_PREFIXES`) |
| R7 | `packages/contracts/src/event-names.ts` (C5 naming, `payload.meta` on `inquiry.transitioned`) |
| R8 | `packages/core/src/permissions.ts` (`resource:action` permission names) |
| R9 | `THIRD_PARTY_LICENSES.md` §4 data rows (OFAC, UN, EU, UK) |
| R10 | `data/manifest.json` (pinned data files fetched by `scripts/fetch_data.py`) |

**Not publicly reachable or not found.**
- The full list of watchlist sources sits behind the dashboard [H26].
- The UN consolidated-list page returned a bot challenge [P6].
- OFAC's file-format pages now redirect into a script-only application whose robots file answers 403, so file names
  and schemas were not read there; the libraries and data note should take them from OFAC's published data
  specification [P3].
- No USPS API terms page was found at the obvious paths, so whether USPS address data may be used for KYC outside
  mailing is **not established** here.

---

## 1. The shared report model

### 1.1 Resource and identifiers

| Object | Id prefix | Notes | Sources |
|---|---|---|---|
| Report | `rep_` | `type` is `report/<subtype>`; one integration type is nested: `report/integration/sentilink-scores` | [O1] [O2] |
| Report template | `rptp_` | `type` is `report-template/<subtype>` | [O3] [O17] [H3] |
| Report run (history entry) | `rpr_` | Also attachable to accounts and cases as "report runs" | [O10] [O44] [O45] |
| Report action (history entry) | `ract_` | dismiss, review, pause, resume | [O9] |
| Screening matched record | `scrre_` | `token` of a `matched-records[]` entry; used as `record-token` | [O37] [O7] |
| Screening listing | `scatr_` | `token` of a record's `listings[]` entry | [O37] |

The OpenAPI create body accepts 17 request subtypes, while the response union has 20 subtypes, so some can be
retrieved but not created by API [O5] [O1]. Persona tells integrators to expect new status values, alias types and
screening types without a version bump [O2] [O21] [O37].

### 1.2 Statuses and transitions

| Status | Meaning (our words) | Sources |
|---|---|---|
| `pending` | Data is being fetched; the create response normally shows this; most reports finish within about a second | [O2] [D3] [H2] |
| `submitted` | Sent to an upstream source; results not back yet (address lookup in the OpenAPI; several business and vendor types on the events page) | [O42] [D5] |
| `ready` | The source answered and the result is viewable; never returns to `pending` | [O2] [H2] |
| `errored` | Fetch failed, either from insufficient inputs or a source failure | [O2] [H2] |

- Monitored reports move `ready` → `ready` or `ready` → `errored` on each run [H2].
- The dashboard export also uses `redacted` as a status value [H28]. Whether the API's `status` changes on
  redaction is **not documented**; the API exposes `redacted-at` [O2].
- The dashboard filters by `matched` and "no matches" alongside the statuses [H10]. These are views over
  `has-match`, not statuses [H2].
- Error bodies: an invalid birthdate (not ISO 8601) or country code (not ISO 3166 alpha-2) is answered with an
  explanatory message [C15]. Error reason codes on an `errored` report are **not documented**.

### 1.3 Attributes every report carries

`status`, `created-at`, `completed-at` (nullable), `redacted-at` (nullable), `report-template-version-name`,
`has-match`, `is-continuous`, `is-recurring`, `tags` [O2]. Per type, the report echoes its inputs: on watchlist and
adverse media as top-level fields since 2023 [C13], on PEP, crypto and screening under `query` [O25] [O30] [O37].

- `has-match` counts active matches only. A report whose matches were all dismissed reads as no match, and a later
  run with new matches reads as matched again [H2].
- `is-continuous`: the schema says the report has run more than once [O2]; the changelog says it can recur and is
  recurring [C12].
- `is-recurring`: another run is queued [O2] [C9].
- Before API version 2025-12-08, reports carried a `run-history` attribute; it now lives in the history endpoint
  [C7] [C6]. Its fields included `scheduled-at`, `completed-at` and `report-template-version-id` [C8], so each run
  likely recorded the template version used **(inference)**.

### 1.4 Relationships

| Relationship | Meaning | Sources |
|---|---|---|
| `inquiry` | The inquiry the report belongs to (nullable) | [O3] |
| `account` | The home account, or the first linked account; kept for compatibility; including it needs no `account.read` | [O3] [C1] |
| `accounts` | Every associated account, de-duplicated, in account-creation order, uncapped; expanding it needs `account.read` | [O3] [C1] |
| `transaction` | The transaction the report belongs to (nullable) | [O3] [C10] |
| `report-template` | The template used; its `type` is polymorphic | [O3] |

The reverse links:
- inquiries list their `reports` [O43] [D2];
- accounts and cases can attach reports and report runs, and cases can be filtered by report [O44] [O45];
- `included` may carry the inquiry, accounts, the transaction and the template [O5].

### 1.5 How a report is created

1. **API.** `POST /api/v1/reports` with `data.type` and `data.attributes`:
   - `report-template-id`;
   - an optional `account-id`, and the deprecated `reference-id`;
   - `query`, whose fields depend on the type (section 4).

   `meta` takes `auto-create-account` (default true), `auto-create-account-type-id`,
   `auto-create-account-reference-id` (attach to, or create, the account with that reference id),
   `processing-mode` (example `sync`) and `request-flags` [O5] [O4] [C11]. What `processing-mode` and
   `request-flags` do is **not documented**. The list endpoint filters by `reference-id` and `account-id`, newest
   first, cursor-paginated [O5].
2. **Workflow Run Report action** (recommended) [H4] [H5] [H30]:
   - it names a template;
   - it shows the template's input fields, which can be edited or removed for that step;
   - it chooses the object to run against, such as an inquiry or an account;
   - it can continue on error.

   A typical workflow runs on `inquiry.completed`, branches on a report's `match_found`, marks the inquiry for review
   and opens a case [H5]. Shipped solutions run a watchlist report and a PEP report after every completed inquiry
   [H32], or a crypto-address report [H33]. A transaction plus a workflow can drive the same reports with no user
   interface [D4]. Workflow functions can, for example, split a first-name field that also holds a middle name before
   the report runs [H11].
3. **Dashboard:**
   - manual entry of a template's inputs;
   - CSV bulk upload, at most 10,000 rows per file, one report per row. A row missing a required input creates
     nothing. The person-watchlist CSV needs first and last name, with optional birthdate, country and
     `reference_id` [H5] [H8].
4. **From an account or a case.** The inputs are prefilled from the account and the report is attached to it [H5]
   [H29]. A case action is itself a published workflow [H6].
5. **At inquiry completion.** The API reference says reports are created and processed asynchronously when an
   inquiry completes [D2], and another article contrasts workflow-created reports with reports "included in" an
   inquiry template [H4]. How that inclusion is configured is **not documented**.

### 1.6 Report templates

- **Purpose:** a template is a saved configuration, so the same kind of report can be run many times [D1].
- **Shape:** `rptp_` id, `name`, `created-at`, `updated-at`, and `meta.version` (`name`, `created-at`,
  `updated-at`) [O16].
  - The watchlist template adds `search-lists[]`, each with `slug` and `type` [O17].
  - The screening template adds `screening-coverage`, five booleans: `person-watchlist`, `business-watchlist`,
    `politically-exposed-person`, `person-adverse-media`, `business-adverse-media` [O18].
  - Every other type's template exposes no configuration in the API [O16].
- **No public endpoint** creates or edits templates (no `report-templates` path) [O5] [R4].
- **Change management** [H3] [H6]:
  - templates have no draft, publishing step or history, and a saved change applies at once to new reports;
  - existing reports keep the configuration they were created with;
  - the dashboard can edit only person-watchlist templates.

  The PEP configuration article describes an editable PEP template [H14], while the PEP report article calls PEP
  configuration view-only [H25]; the sources conflict.
- **Configuration keys that are public in substance** are covered per type in section 4: lists, name preset,
  birthdate mode and country fields for watchlist; PEP classes and toggles; adverse-media categories and article
  filters; the recurrence interval. Their wire names are **not documented** except `search-lists` and
  `screening-coverage`.

### 1.7 Tags, history, print, run, pause, resume

| Action | Path | Body or result | Sources |
|---|---|---|---|
| Add tag | `POST /reports/{report-id}/add-tag` | `meta.tag-name` or `meta.tag-id` | [O15] |
| Remove tag | `POST /reports/{report-id}/remove-tag` | same | [O15] |
| Set tags | `POST /reports/{report-id}/set-tags` | `meta.tag-name[]` or `meta.tag-id[]` | [O15] |
| History | `GET /reports/{report-id}/history` | Newest first, paginated; entries `run` (`id` `rpr_`, `run-type` `manual` / `scheduled`, `scheduled-date`, `completed-at`, `matches`) and `dismiss` / `review` / `pause` / `resume` (`id` `ract_`, `created-at`, `creator-name`) | [O9] [O10] [C6] |
| Print | `GET /reports/{report-id}/print` | `application/pdf` | [O14] |
| Re-run | `POST /reports/{report-id}/run` | Monitored reports only; runs now, off schedule | [O13] [H7] |
| Pause | `POST /reports/{report-id}/pause` | Needs extra permissions; needs an upcoming run | [O11] [H27] |
| Resume | `POST /reports/{report-id}/resume` | same | [O12] [H27] |

- No `updated-tags` event exists for reports [D5].
- A dashboard "flag issue" action files a support ticket about a report [H7]; it has no API.
- The dashboard PDF covers person watchlist and PEP only, and marks dismissed content [H28].

### 1.8 Redaction

`DELETE /reports/{report-id}` permanently removes the report's PII, but not the related inquiries, accounts or
verifications, and returns the report [O6].
- Dismissal is refused on redacted reports [H15].
- Exports keep redacted reports with their data removed [H28].
- The dashboard's redaction right covers reports together with inquiries, verifications and cases, as one
  cross-product permission since a 2023 permissions change [H54].
- **Not documented:** a report redaction event, and what happens to a monitored report's schedule after redaction.

### 1.9 Events shared by all types

- **Payload and envelope.** The payload is the report itself; `included` appears only when the webhook enables
  related-object inclusion, and is omitted, not empty, otherwise [O23]. The event object has a `context` map that
  some event types fill [O46].
- **Per-type event sets** [O42] [D5]:
  - **match types** (watchlist, PEP, person and business adverse media, business watchlist, custom list):
    `.ready`, `.matched`, `.dismissed`, `.errored`;
  - **crypto address watchlist:** `.ready`, `.matched`, `.errored`;
  - **screening:** `.ready`, `.matched`, `.reviewed`, `.errored`;
  - **plain enrichment types:** `.ready`, `.errored`;
  - **some asynchronous types** also emit `.submitted`;
  - **business nonprofit** also emits `.changed`.
- **Firing rules:** `.ready` fires on every run whatever the result [H26] [H25]. `.matched` fires when `has-match`
  becomes true, on monitored reports at the run that brings a new match [O23] [O42]. Whether `.matched` fires again
  for a further new match while `has-match` is already true is **not documented**.

### 1.10 Sandbox (shared)

Sandbox reports are created in the sandbox environment from the dashboard's manual tab with fixed test inputs [H9]:
- **match types:** watchlist, PEP and person and business adverse media each have one known input that produces a
  hit;
- **crypto:** a known listed address;
- **email risk:** one synthetic address returns low reputation and all others high;
- **phone risk:** two fixed numbers give low and high risk;
- **profile and social media:** always return one fixed synthetic person;
- **business lookup:** returns one fixed address;
- **address lookup:** has no test hit.

The names used for watchlist, PEP and adverse media are those of real public figures and a real company, and the
crypto input is a real SDN-listed address [H9] (deliberately not reproduced here). Whether sandbox reports query
the live lists is **not documented**.

---

## 2. Continuous monitoring

| Topic | Public behaviour | Sources |
|---|---|---|
| Which types | Person and business watchlist, person and business adverse media, PEP, crypto address watchlist, business nonprofit; screening reports also run continuously | [H27] [H7] [H17] |
| Interval | Any whole number of days from 1 to 365, typically run against an account (for example monthly or yearly) | [H27] [D1] |
| Where it is set | On the template, set up through Persona support; PEP, business watchlist and business adverse media show monitoring settings read-only | [H13] [H14] [H20] [H21] |
| Inputs | Each run reuses the report's original inputs | [H27] |
| What a run produces | The same report (`rep_`) is updated; a `run` history entry (`rpr_`) records `run-type`, `scheduled-date`, `completed-at` and `matches`; the dashboard's last-updated time changes | [O9] [O10] [H7] |
| Events per run | `.ready` on every run; `.matched` on the run that introduces a new match; `.errored` on failure | [O42] [H26] |
| New vs old matches | `has-match` plus `is-continuous` let integrators tell an initial match from one found on a later run | [C12] |
| Hit on a legacy type | All later runs stop until the hits are dismissed; after the last dismissal the next run comes about 30 minutes later, then the normal cadence resumes | [H27] [H15] |
| Hit on a screening report | Runs continue at the interval; cases created from the report are refreshed | [H17] |
| Changed or vanished records (screening) | `present-in-last-run` per record; listings have `active` and `deactivated-at`; a reviewed record with `notify-on-change` returns to `pending` when its data changes on a later run | [O37] [O7] |
| Pause and resume | Only when the report is scheduled with an upcoming run; the dashboard shows "paused" or monitoring; API actions need extra permissions; history records `pause` and `resume` | [H27] [O11] [O12] [O10] |
| Manual re-run | `POST /run`, or the dashboard; recorded as `run-type: manual` | [O13] [H7] [O10] |
| Plans | Not available on the two smallest plans, limited on the third, available on enterprise | [H27] |
| Source freshness | Watchlist and crypto sources as often as every 10 minutes; PEP daily; adverse media within 48 hours of publication; business sanctions within 24 hours, warnings within a month | [H26] [H22] [H25] [H19] [H21] |

**Not documented:**
- the time of day or time zone of `scheduled-date`;
- whether a paused report keeps its schedule date or recomputes it on resume;
- whether a list update triggers a run (the interval appears to be the only trigger **(inference)**);
- whether a delisted entity clears `has-match` on legacy types;
- how "new match" is defined: by entity, by list, or by any changed field;
- limits on the number of monitored reports;
- whether an account's redaction stops its reports' schedules.

---

## 3. Match review

### 3.1 Legacy dismissal (watchlist, PEP, person and business adverse media, business watchlist, custom list)

- **Endpoint:** `POST /reports/{report-id}/dismiss` with `data.attributes` [O8]:
  - `reason`, required;
  - `dismiss-type` (`entity` or `media`) and `entity-id`, required for person and business adverse media.

  The description says it dismisses the active matches of supported types [O8]. Whether a watchlist or PEP
  dismissal can target one identity through the API is **not documented** (inference: no, it dismisses all).
  Business watchlist and business adverse media gained this endpoint in May 2023 [C17] [C16].
- **What the dashboard can dismiss** [H15]:
  - a single identity (watchlist, PEP, adverse media);
  - every active match (watchlist, business watchlist);
  - every identity at once (person and business adverse media, PEP);
  - single articles under an identity (adverse media);
  - a ticked selection, which is off by default and not enabled for every organisation.
- **Recording:** each dismissal stores its reason, the reviewer and the time. Matches move from an active tab to a
  dismissed tab, and history gains a `dismiss` entry [H15] [O10].
- **Where dismissals land:** the report's `ignore-list[]`. Each entry has `ignored-at`, `run-history-completed-at`
  (the run that found the match), a `match` snapshot (list name, URL, `list-type` and `list-types`, `match-types`,
  `slug`, `flag-code`, and entities with `name`, `alias-type`, `birthdates` and a publisher-prefixed `group-id` such
  as `EU:<number>`), `user` and `ignore-reason` [O19] [O22].
  - The PEP entry snapshots the full PEP entity and adds `is-internal` [O25].
  - Adverse media keeps `ignore-list-entity` and `ignore-list-media` (untyped objects on the person type [O27];
    typed entries with `entity-id`, `match`, `ignore-reason` and `user` on the business type [O28] [O29]).
  - Business watchlist entities add `match-levels` [O35].
- **Next runs:** a dismissed match does not come back on later runs [H15]. How a later run recognises it (by
  `group-id`, by list `slug`, or by name) is **not documented**. A plausible key is list plus `group-id`
  **(inference)**.
- **Refusals:** dismissal is refused while a report is pending, errored or redacted [H15].
- **Rights:** a role needs the report-matches edit right, which can be scoped to environments and templates [H15]
  [H31].
- **Event:** `report/<type>.dismissed`; the example payload shows the new `ignore-list` entry [O24] [O42].
- **Crypto:** the crypto address watchlist is absent from the dismissal article and has no `.dismissed` event
  [H15] [O42]. Whether its matches can be dismissed is **not documented**.

### 3.2 Screening review

- **Endpoint:** `POST /reports/{report-id}/review` with `data.attributes` [O7] [O40] [C2]:
  - `review-type`: `all_records`, or `record` together with a `record-token`;
  - `review-status`: `pending`, `indeterminate`, `true_positive` or `false_positive`;
  - optional `risk-level` (`material` or `immaterial`, nullable), `comment` and `notify-on-change`.

  It needs the report write permission [C2].
- **Record-level state:** each matched record carries `matched`, `created-at`, `reviewed-at`, `review-status`,
  `risk-level`, `present-in-last-run` and `notify-on-change` [O37].
- **Listing-level state:** each listing under a record carries `active`, `created-at`, `deactivated-at`,
  `reviewed-at` and `review-status`. Records can be reviewed at the identity level and at the attribute level, such
  as single articles [O37] [H17] [H12].
- **Material vs immaterial:** "material" applies to a true positive whose risk bears on the decision; "immaterial"
  to a correct match that does not [H12]. Every decision keeps who, what and why [H12] [H17].
- **Next runs:** a record reviewed with `notify-on-change` goes back to `pending` when its data changes [O7]. A
  record reviewed without it keeps its review on later runs **(inference)**.
- **Event and history:** `report/screening.reviewed` carries a `context` with `review-type`, `review-status`,
  `risk-level`, `record-token`, `reviewer-token` and `comment` [O41]. The reviewer token is a user (`user_`), a
  workflow run (`wfr_`) or an API key (`api_`), and is null on events from before October 2026 [C2]. A `review`
  history entry is written [O10] [C2].

---

## 4. Per report type

### 4.1 Watchlist (person) — `report/watchlist`

**Query** [O20] [H26] [H8]:
- `name-first`, `name-middle`, `name-last` or `term`; at least one of these is required. The dashboard and CSV
  require first and last name.
- `birthdate` (YYYY-MM-DD) and `address-country-code` (ISO 3166-1 alpha-2), both optional.

**Template configuration:**

| Setting | Public behaviour | Sources |
|---|---|---|
| Lists | By category subscription (for example all OFAC lists) or by individual list; stored as `search-lists[]` of `slug` and `type`; by default every list is on; 200+ global sanctions and warning lists | [O17] [H13] [H26] |
| Name matching | Presets Exact, Strict, Tolerant, Custom (table below) | [H13] [H16] |
| Birthdate matching | Exact date; exact year; within one year either side of the birth year (default) | [H13] |
| Country matching | Compare the input country with the candidate's birthplace, citizenship, nationality and/or residency; a candidate is dropped only when the user gave a country, the candidate has country data, and they differ | [H13] |
| Recurrence | Through support | [H13] |

**Name-matching presets** [H16] (behaviour in our words; option names are configuration identifiers):

| Rule | Exact | Strict | Tolerant | Custom |
|---|---|---|---|---|
| Primary name, no typos | yes | yes | yes | yes |
| Known aliases (still exact) | yes | yes | yes | choice |
| Subset of the name's words, or initials for some words | no | yes | yes | choice |
| Joined names (letters compared in order, ignoring spaces and punctuation) | no | yes | yes | choice |
| First and last words only | no | yes | yes | choice |
| Equivalent names (nicknames, homophones) | no | no | yes | choice |
| Typos | no | no | medium | low / medium / high |

- **Watchlist typo budgets:**
  - without partial names, one typo in the whole name, needing at least 18 (low), 10 (medium) or 3 (high)
    characters;
  - with partial names, one typo per word, needing at least 18, 5 or 3 characters per word.
- **Typo kinds:** on watchlist, a typo is an inserted, deleted or substituted letter; most other types allow only
  vowel-level phonetic substitutions [H16].
- **Input normalisation (PEP):** case, extra punctuation and spacing, and titles and honorifics are ignored [H14].

**Result** [O19] [O21] [O22]:
- `matched-lists[]`, each entry with:
  - `name`, `url`, `list-type` (example `sanction`) and `list-types[]`;
  - `match-types[]` (example `name_exact`; the vocabulary is **not documented**);
  - `slug` (for example a programme-level EU list slug), and `flag-code` (the publisher's country or union code);
  - `entities[]`, each with `name`, `alias-type` (`primary_name`, `aka`) and `birthdates[]` of `day`, `month`,
    `year`, `granularity`.
- `ignore-list[]` (section 3.1).
- No numeric score or confidence is exposed.
- Before May 2021 the response split matches into `pep-list`, `sanction-list`, `fitness-probity-list` and
  `warning-list` [C18].

**Hit export columns** hint at the entity data held [H28]:
- primary names, aliases and titles;
- birthdates and sexes;
- emails and phone numbers;
- nationalities, birthplaces, residencies and citizenships;
- sanctions and warnings.

**Events:** `report/watchlist.ready`, `.matched`, `.dismissed`, `.errored` [O42] [H26]. **Sandbox:** one known
name in either order produces a hit [H9].

### 4.2 Politically exposed person — `report/politically-exposed-person`

**Query:** name parts or `term` (at least one), `birthdate` and `country-code`, both optional [O26]. When a
birthdate is given, the report keeps PEPs with that birthdate **and** PEPs with no recorded birthdate [H25].

**Template configuration** [H14] [H25]:

| Setting | Public behaviour | Default |
|---|---|---|
| PEP classes | Class 1 (highest): heads of state and government, national and regional ministers and legislators, heads of the armed forces, courts and police, central-bank board members, party leadership. Class 2: senior officials below them (military, judiciary, police, other agencies, senior civil servants), senior religious figures, diplomats. Class 3: leadership and boards of state-owned enterprises. Class 4 (lowest): mayors and local assemblies, senior staff of international bodies | classes 1 and 2 |
| Relatives and close associates | Include people linked to a PEP | off |
| Candidates | Include candidates as well as office holders | off (the PEP article mentions current US candidates specifically) |
| Unknown class | Include matches whose class is unknown | **not documented** |
| Portrait comparison | Compare the inquiry's selfie with public portraits of PEPs | **not documented** |
| Default country | The country assumed when the input has none; with no default and no input country, all countries match | **not documented** |
| Sources without URLs | Allow sources that have no link | on |
| Name matching | Same presets as watchlist | Strict |
| Birthdate matching | Same three modes as watchlist | ±1 year |

**Result** [O25] [C5] [H25]:
- `result[]` entities with `entity-id`, `name`, `birthdates[]`, `death-dates[]`, `locations[]`, `country`, `sex`,
  `topics[]`, `match-types[]` (example `aka-exact`) and `pep-type`;
- `positions[]`: `pep-class` (example `pep-class-1`), `source-key`, `name`, `topics[]`, `start-date`, `end-date`;
- `associates[]`: `name`, `relationship`, `topics[]`;
- `affiliations[]`: `source-key`, `name`;
- `related-urls[]` and `images[]`;
- `sources`, a map from `source-key` to `url`, `name` and `flag-code`;
- `ignore-list[]` (section 3.1).

A relative's or associate's positions are listed at the class of the person they are linked to [H25].

**Freshness:** checked daily [H25]. **Events:** `.ready`, `.matched`, `.dismissed`, `.errored` [O42].
**Sandbox:** one known name produces a hit [H9].

### 4.3 Adverse media — `report/adverse-media` (and `report/business-adverse-media`)

**Query:**
- person: name parts or `term` (one required), `birthdate` and `country-code` optional [O27] [H19];
- business: `term` in the request [O28]. The response echoes a `query` with `business-name`, `address-street`,
  `address-city`, `address-state`, `address-country` and `incorporation-date` [O28]. The help article names only
  the business name (required) and its country (optional) [H20].
- The screening report adds `formation-date`: business articles published before it are dropped, while undated
  articles stay eligible [O38].

**Method** [H19] [H20]:
- the search runs over a vendor archive of more than 300 million articles, from news outlets and less structured
  sources;
- articles that very likely concern the same person are grouped by entity resolution;
- the groups are sorted by relevance, and each says why it matched: exact name, a synonym of the name or of an
  alias, exact alias, birth-year filter met or approximately met, a complex reason such as an acronym, a close
  spelling, a phonetic match, or the input's personal suffixes or clerical marks removed;
- the archive is updated within 48 hours of publication.

**Template configuration** (view-only; Persona support changes it) [H19] [H20]:
- **categories**, all on by default: five AML/CFT-relevant groups (financial, fraud-linked, general, narcotics,
  violence), terrorism, cybercrime, property crime, financial difficulty, regulatory, and three catch-alls (other
  financial, other serious, other minor), plus non-AML violence. Fourteen in total; the business type rolls them
  into three compliance groups;
- **article filters:** maximum article age, dated articles only, allowed article countries;
- **name matching:** presets as above;
- **birthdate matching:** as for watchlist.

**Result:**
- **person** [O27]: `related-sources[]`, each with `entity-id`, `name`, `akas[]`, `birthdates[]`,
  `match-types[]`, `media[]` (`date`, `title`, `url`, `snippet`) and `sources[]` (`name`, `types[]`,
  `country-codes[]`), plus `birthdate-year`, `ignore-list-media` and `ignore-list-entity`;
- **business** [O28] [C3]: `related-sources[]` restricted since API 2026-09-29 to `id`, `name`, `akas`,
  `match-types`, `sources`, `media` and `birthdates`, plus a `result.adverse-media[]` list (`title`, `url`, `date`);
- the dashboard shows birthdates, ages, aliases, categories and the countries where the coverage appeared [H19];
- workflows can read the URLs of articles that are not yet dismissed, and a dismissal removes its URL from that
  list [H19] [H20].

**Events:** `.ready`, `.matched`, `.dismissed`, `.errored` for both types [O42]. **Sandbox:** one known name (or,
for the business type, a known company) produces a hit [H9]. **Plans:** not on the smallest plan [H19].

### 4.4 Crypto address watchlist — `report/crypto-address-watchlist`

- **Query:** `crypto-address`, required [O30].
- **Result** [O30] [H22]: `result[]` hits, each with:
  - list `name`, `url`, `list-type`, `slug`, `flag-code`;
  - `entities[]`: `name`, `alias-type`, `birthdates[]` and `crypto-addresses[]` (`type`, for example `XBT`, and
    `address`).

  An empty `result` means the address is on no list. The only list searched is OFAC, so a hit normally returns a
  single result.
- **Configuration:** none [H22]. **Freshness:** as often as every 10 minutes [H22].
- **Events:** `.ready`, `.matched`, `.errored`; there is no `.dismissed` [O42].
- **Sandbox:** one known listed address [H9].
- **OFAC background** [P4]:
  - OFAC adds digital currency addresses to SDN entries in a field per currency named `Digital Currency Address`
    plus a dash and the currency symbol;
  - an address may be up to 256 characters;
  - OFAC's own search tool matches addresses exactly, never fuzzily;
  - OFAC says its address listings are not exhaustive.

### 4.5 Email address — `report/email-address`

- **Query:** `email-address`, required [O31].
- **Result** [O31] [H23] [C14]: `email-address`, `email-domain`, `email-reputation` (`high`, `medium`, `low`),
  and these signals:

  | Group | Fields |
  |---|---|
  | Domain | `email-domain-exists`, `email-domain-age-days`, `email-is-valid-mx` |
  | Mailbox | `email-is-deliverable`, `email-is-disposable`, `email-is-spam` (spam or spam trap) |
  | Behaviour | `email-is-suspicious`, `email-estimated-age-days` (since first seen by the vendor's network) |
  | Recent incidents | `email-credentials-leaked-recent`, `email-malicious-activity-detected-recent` |
  | Age estimates | `age-estimated-13-plus`, `age-estimated-16-plus`, `age-estimated-18-plus` |

  Eleven older attributes return null for reports made after 10 August 2023: `email-reference-count`,
  `email-domain-reputation`, `email-first-seen-days`, `email-last-seen-days`, `email-data-breached`,
  `email-malicious-activity-detected`, `email-is-blocklisted`, `email-is-free-provider`, `email-is-spoofable`,
  `email-is-spf-strict` and `email-is-dmarc-enforced`. `email-estimated-age-days` was added at the same time.
- **Static domain blocklist** [H23]: addresses at privacy-relay and masking domains are skipped and reported as no
  match, without analysis.
- **Configuration:** none. **Events:** `.ready`, `.errored` [O42]. **Sandbox:** one synthetic address returns
  low reputation, all others high [H9].
- **Sources:** the vendor combines first-party and third-party data [H23]; the vendor is **not documented**.

### 4.6 Phone number — `report/phone-number`

- **Query:** `phone-number` with its international code, required [O32] [C20].
- **Result** [O32] [C4] [H24]:
  - `phone-type`: `FIXED_LINE`, `MOBILE`, `PREPAID`, `TOLL_FREE`, `VOIP`, `PAGER`, `PAYPHONE`, `INVALID`,
    `RESTRICTED_PREMIUM`, `PERSONAL`, `VOICEMAIL`, `OTHER`;
  - `phone-carrier`, plus the location fields `phone-city`, `phone-subdivision` and `phone-country-code`;
  - `phone-risk-score`: the schema says out of 1000, the Help Center says 0–100 in five bands;
  - `phone-risk-level`: a string such as `medium-low` in the schema, levels 1–5 in the Help Center, and five
    phrases in the export;
  - `phone-risk-recommendation`: `block`, `allow`, `flag`;
  - `phone-risk-sim-swap`: `very-low`, `low`, `medium`, `high`, `N/A`.
- **Risk mapping** [H24]: each phone type carries a default risk and recommendation (for example, toll-free and
  non-fixed VOIP are blocked, prepaid is flagged), and the score bands map to a level and a recommendation.
- **Vendor factors** [H24]: number attributes, two fraud databases, and traffic-pattern and velocity signals.
  SIM-swap risk and better EMEA coverage come from other templates.
- **Configuration:** none. **Events:** `.ready`, `.errored` [O42]. **Sandbox:** two fixed numbers give low and
  high risk [H9].

### 4.7 Address lookup — `report/address-lookup`

- **Query:** `address-street-1`, `address-city`, `address-subdivision`, `address-postal-code` and
  `address-country-code` are required; `addressee` and `address-street-2` are optional [O34].
- **Result** [O33] [H18]:

  | Group | Fields |
  |---|---|
  | The input, echoed | `addressee`, `address-*` |
  | The standardised address | `resolved-*` |
  | Location and postal metadata | `metadata-record-type`, `metadata-zip-type`, `metadata-county-fips`, `metadata-county-name`, `metadata-carrier-route`, `metadata-carrier-route-type`, `metadata-congressional-district`, `metadata-building-default-indicator`, `metadata-residential-delivery-indicator`, `metadata-latitude`, `metadata-longitude`, `metadata-precision`, `metadata-time-zone`, `metadata-utc-offset`, `metadata-obeys-daylight-savings`, `metadata-ews-match` |
  | Delivery analysis | `analysis-dpv-match-code` (+ `-decoded`), `analysis-dpv-footnotes` (+ `-decoded`), `analysis-dpv-cmra`, `analysis-dpv-vacant`, `analysis-active`, `analysis-footnotes` (+ `-decoded`), `analysis-lacs-link-code`, `analysis-lacs-link-indicator` (+ `-decoded`), `analysis-suite-link-match` |
  | Errors | `error-message` |

  - The ZIP types are unique, military, PO box and standard.
  - Precision runs from ZIP9 down to ZIP5, or unknown.
  - The residential indicator is residential, commercial or blank; USPS marks PO boxes residential.
  - Carrier-route prefixes are city, rural, highway contract, PO box section and general delivery.
- **Coverage** [H18]: US by default, using USPS-sourced outputs (DPV, RDI, CMRA, LACSLink, carrier route, ZIP type).
  International addresses get limited fields (formatted address, coordinates, time zone). Optional add-ons, on
  request, are Street View and satellite insights from Google imagery and US-only virtual-address detection.
- **Events:** `.submitted`, `.ready`, `.errored` [O42] [D5]. **Sandbox:** no test input [H9].

### 4.8 Business watchlist — `report/business-watchlist`

- **Query:** `term`, required (the business name), and `address-country-code`, optional (normally the registered
  address's country) [O36] [H21].
- **Result** [O35] [H21]:
  - `matched-lists[]`, a list of slugs;
  - `sanction-list[]`, `fitness-probity-list[]` and `warning-list[]`, each holding `name` and `url`;
  - `ignore-list[]`, whose entries add `country-code` and entity `match-levels[]`.

  Sanctions are punitive government or international measures; warnings come from law-enforcement and regulatory
  bodies [H21].
- **Configuration** (view-only) [H21]: sanctions and warnings categories, both on; name matching Strict; 100+
  lists.
- **Freshness:** sanctions within 24 hours of the source changing, warnings within a month [H21].
- **Events:** `.ready`, `.matched`, `.dismissed`, `.errored` [O42]. **Sandbox:** one known company name [H9].
- **Usage:** KYB solutions run it from workflows after a KYB inquiry [H21] [D10].

### 4.9 Screening — `report/screening` (the generic screening report)

- **Coverage:** person watchlist, person adverse media, PEP, business watchlist and business adverse media in one
  report. The template selects them through `screening-coverage` [H17] [O18].
- **Query** [O38]:
  - name parts or `term` (`term` must contain a letter);
  - `birthdate` and `formation-date`;
  - an address (`address-street-1`, `address-street-2`, `address-city`, `address-subdivision`,
    `address-postal-code`, `address-country-code`);
  - `email` and `identification-number`.

  At least one field is required.
- **Result** [O37] [O39]:
  - `matched-screening-types[]` (for example `sanction`);
  - `matched-records[]`, each with:
    - review state: `token`, `matched`, `created-at`, `reviewed-at`, `review-status`, `risk-level`,
      `present-in-last-run`, `notify-on-change`;
    - identity: `record-types[]` (for example `person`), `names[]` (`type`, `name`), `birthdates[]` as `start` /
      `end` ranges, `locations[]` (address parts and a `type`, for example `birthplace`), `sexes[]`, `emails[]`,
      `identifications[]` (`type`, `number`, `country-code`, `issue-date`, `expiration-date`, `comment`), and
      `details[]` (`type`, `value`);
    - sources: `listings[]` (`token`, `name`, `type`, `url`, `active`, `created-at`, `deactivated-at`,
      `reviewed-at`, `review-status`);
    - PEP data: `positions[]` (`name`, `country-code`, `classes[]`, `topics[]`, `active` and dates), `pep-classes[]`,
      `pep-roles[]`, `topics[]`;
    - media: `articles[]` (`title`, `snippet`, `source`, `primary-source`, `url`, `language`, `categories[]`,
      `perpetrators[]`, `victims[]`, `publish-date`).
- **Matching** [H17]: exact, strict and tolerant presets plus configurable match-group logic. Each record shows how
  each input attribute contributed to the match. The wire format of that per-attribute view is **not documented**;
  the `matched-records` schema has no such field.
- **Review and monitoring:** sections 3.2 and 2.
- **Events:** `.ready`, `.matched`, `.reviewed`, `.errored` [O42]. **Plans:** limited on the smallest plan [H17].
- **Connect:** it can share a PII-filtered snapshot of a screening report [O47].

---

## 5. Where reports meet the rest of the platform

| Surface | Public behaviour | Sources |
|---|---|---|
| Inquiry templates | Reports can be part of an inquiry template and run when the inquiry completes; the inquiry view has a Reports tab listing reports run during the inquiry or by workflows on it | [D2] [H4] [H34] |
| Workflows | The Run Report action and its options; event triggers on report events; recurring triggers over sets of reports; conditions on report results (watchlist or adverse-media matches, synthetic-fraud scores); parallel steps can run two reports at once; tagging reports | [H30] [D7] [D5] [H5] |
| Accounts | Reports join the account through `account-id`, a reference id or auto-creation. Account pages have a Reports tab and module and a create-report action that prefills inputs. Account actions are workflow macros that can run reports | [O4] [O5] [H29] [D8] [H0] |
| Cases | Reports and report runs can be attached; cases filter by report; a case module shows reports; screening refreshes cases it created | [O45] [H17] [H0] |
| Transactions | `transaction` relationship; API-first flows create a transaction whose workflow runs reports and sets custom statuses (for example review on a hit) | [O3] [C10] [D4] |
| Dashboard (described, not copied) | Report index with a date filter by default plus template, status (including matched and unmatched), tag and match-criteria filters, saved views, and 10–200 rows per page; report detail with inputs, identity matches in active and dismissed tabs, per-identity detail, dismiss actions, history, re-run, pause and resume, flag issue and PDF; template editor (person watchlist); CSV exports of up to 10,000 reports, as a summary file plus per-type report and hit files for watchlist, adverse media, email, phone and PEP | [H10] [H15] [H7] [H13] [H28] |
| Webhooks and events API | Report events are delivered to webhooks and listed by the events API; payloads optionally carry `included`; events are kept in the dashboard for three months | [O23] [D5] |
| API keys | `report.read`, `report.write`; payload filters exist for some resources (enterprise) | [D6] |
| Dashboard roles | Rights for report details (create, list, edit), re-run (including ad-hoc reports), dismiss matches, pause or resume, and report templates (create, view, edit), scoped to environments and templates | [H31] [H15] |
| Legal positioning | Persona says it is not a consumer reporting agency and forbids using report data for FCRA purposes such as credit, employment or housing eligibility | [H1] [H17] |

---

## 6. The other report types (one line each)

"Ship?" is a recommendation for Phase 6: **no** means it is not in the PLAN §4.4 scope; an adapter port can come
later. **Sources:**
- per-type rows cite their own keys;
- the events page lists the types and their events [D5];
- where an `H` key is marked "H0 summary" in section 0, only the Help Center index was read;
- every other row rests on the type name alone, from the surface index [R4] and the events page [D5].

| Type | What it needs | Ship in Phase 6? |
|---|---|---|
| `background-check` | Licensed background-screening vendor (FCRA-regulated); Persona's integration is Yardstik [H52] | no |
| `better-business-bureau` | BBB data feed or API (commercial) [H46] | no |
| `business-associated-persons` | Registry officers and PSC data; Companies House PSC is reusable, others are commercial [H41] [C19] | no (Phase 5 C61 covers officers in verification) |
| `business-classification` | NAICS and MCC classification from name and website; an LLM or vendor [H44] | no |
| `business-enforcement-action` | Regulator enforcement data, mostly commercial aggregations | no |
| `business-industry-classification` | As business classification | no |
| `business-legal-history` | Court and litigation data (commercial); absent from the surface index [D5] | no |
| `business-liens-lookup` | UCC filing data (commercial aggregators) [H47] | no |
| `business-lookup` | Business identity and addresses from a commercial KYB provider [C13] | no (Phase 5 KYB covers registry lookups) |
| `business-lookup-eu` | European registries through a vendor | no |
| `business-media-coverage` | News coverage of a business (vendor); has a `matched` event | no |
| `business-nonprofit` | IRS exempt-organisation data and California AG/FTB data; a `changed` event; recurrable [H43] [H27] | no (public IRS data could make it R later) |
| `business-online-presence` | Web and social discovery for a business (vendor or crawler) [H45] | no |
| `business-personnel-insights` | Vendor people data | no |
| `business-registrations-lookup` | Secretary of State registrations (vendor), with document enrichment status [H42] | no |
| `business-search` | Vendor business search | no |
| `business-social-media` | Vendor social data | no |
| `business-website` | Website analysis; Phase 5 has the website verification [R5] | no |
| `chainalysis-address-screening` | Operator's Chainalysis account; risk levels severe, high, medium, low [H35] | no (adapter later) |
| `clearbit-business-lookup` | Operator's Clearbit account [H51] | no |
| `coinbase-check-crypto-risk` | Operator's Coinbase KYT account [H37] | no |
| `community-safety` | Vendor safety data; has a `matched` event | no |
| `comply-advantage-search` | Operator's ComplyAdvantage account (sanctions, PEP and media) | no, but a natural first commercial adapter for T3/T4 |
| `comprehensive-profile` | Credit-bureau or identity-graph vendor | no |
| `custom-list` | Screening against the customer's own lists; dismissible | no (Phase 7 lists; the review engine should allow it later) |
| `employer-lookup` | Employment-data vendor | no |
| `equifax-oneview` | Equifax contract; credit data otherwise reaches Persona through integrations such as CRS Credit [H53] | no |
| `finra-broker-check` | FINRA BrokerCheck data (terms to check) | no |
| `integration` | Generic third-party integration container | no |
| `ip-address` | IP intelligence; absent from the surface index [D5] | no (Phase 7 network intel) |
| `kyckr-business-lookup` | Kyckr contract | no |
| `middesk` | Middesk contract; asynchronous (`submitted`) | no |
| `mx-account` | MX bank-data contract [H49] | no |
| `nces` | US public-school data (NCES Common Core of Data) [H48] | no |
| `novacredit-cash-atlas`, `novacredit-credit-passport` | Nova Credit contract [H50] | no |
| `profile`, `profile-non-authoritative` | US identity graph or bureau data (SSN, phone, address enrichment) [H39] | no |
| `sec-action-lookup` | SEC enforcement actions (public data; terms to check) | no |
| `sentilink-application-risk`, `sentilink-scores`, `synthetic` | SentiLink contract (synthetic-identity scores) [H38] | no |
| `social-media` | Vendor social discovery with likelihood scores [H40] | no |
| `trm-wallet-screening` | Operator's TRM Labs account [H36] | no |

---

## 7. Data each behaviour needs, with licence verdicts

Rule 4 of `CLAUDE.md` governs runtime data [R2]. This section decides feasibility only. The libraries and data note
should pin formats, sizes and parsers, and package versions under the 14-day rule: this note recommends no packages,
so no version pins appear here.

| Source | Publisher terms (decisive part) | Format and cadence | Verdict | Sources |
|---|---|---|---|---|
| OFAC SDN list and non-SDN consolidated lists (with digital currency addresses) | A US government work made by federal staff in their duties carries no copyright; OFAC publishes the data for public download and use in screening | XML, CSV, fixed-field and delimited files, plus delta files, through the Sanctions List Service; updates are sporadic, and OFAC leaves the download schedule to each institution | ✅ (public domain) | [P1] [P2] [P3] [P4] |
| EU consolidated financial sanctions list (FSF) | The dataset is labelled `COM_REUSE` (Commission Decision 2011/833/EU); the Commission's legal notice licenses EU-owned content under CC BY 4.0 by default and warns that content depicting identifiable private individuals may need extra rights cleared | Two XML variants (`xmlFullSanctionsList`, `xmlFullSanctionsList_1_1`) and CSV, at public FSF URLs carrying a fixed public token, plus an RSS feed; the catalogue record gives accrual `daily` (corrected in fact-check; earlier "cadence not documented") | ⚠️ attribution required; the listed persons' data is personal data under GDPR, so retention, minimisation and the "identifiable individuals" caveat belong in the compliance guide | [P7] [P8] |
| UK Sanctions List (FCDO) | GOV.UK states that all its content is under the Open Government Licence v3.0 unless stated otherwise; the files sit on `sanctionslist.fcdo.gov.uk`, and that OGL covers them there is our reading **(inference)** | XML (XSD 4.33.3, about 22 MB), CSV, ODS, ODT, HTML, TXT and PDF; several changes a week in October 2026; email alerts | ⚠️ attribution under OGL; ask FCDO or rely on the OGL notice; personal data under UK GDPR | [P9] [P11] |
| UK OFSI Consolidated List | — | **Closed on 28 January 2026**, kept for reference only | ❌ do not use (stale) | [P10] |
| UN Security Council consolidated list | The UN website grants only "personal, non-commercial use", with no right to redistribute or compile; no separate data licence was found | XML and HTML at `scsanctions.un.org` **(inference from common knowledge; the page was unreachable)** | ❌ as a shipped default; ⚠️ as an operator-run, opt-in sync that the operator accepts under those terms. UN designations are also carried by the EU and UK lists, which implement them (for example the UK's ISIL and Al-Qaida regime) **(inference: completeness and lag not verified)** | [P5] [P6] [P9] |
| Wikidata (PEP positions) | Structured data (main, Property, Lexeme, EntitySchema namespaces) is CC0 | Query service or dumps; continuous edits | ✅ CC0. Caveats: it holds personal data of living people (GDPR; the screening purpose must be documented); coverage is incomplete; **never send an end user's name to the public query service**, mirror locally instead | [P12] |
| GDELT DOC 2.0 API (adverse media) | Any use, including commercial, is allowed without fee, with a citation and link to GDELT required | JSON; rolling three-month window; `ArtList` returns 75 articles by default, at most 250; articles carry title, source country, language, date and image, and no snippet is listed **(inference: no article text is returned)**; 65 machine-translated languages | ⚠️ attribution; the article texts belong to third parties (store URL, title and date only); each query sends the searched name to GDELT, a third-party disclosure the operator must accept | [P13] [P14] |
| OpenSanctions bulk data | Free only for non-commercial use; commercial use needs a paid licence | Bulk files and an API | ❌ as a default (non-commercial terms); possible only as an adapter where the operator holds a licence | [P15] [P16] |
| Commercial PEP and adverse-media data (ComplyAdvantage and similar) | Contract | API | A-tier adapter only; not verified here | [R4] |
| Email reputation, breach and spam-trap data | Vendor contracts | API | A-tier adapter only; Phase 5 already gives disposable (CC0 list), MX and RDAP domain age for free | [R5] [R10] |
| Phone carrier, line-type certainty for NANP, SIM swap, risk score | Vendor contracts (carrier data) | API | A-tier adapter only; libphonenumber metadata (Apache-2.0) gives validity, region and type, with no carrier, and cannot tell US mobile from fixed | [R5] |
| US postal deliverability (DPV, RDI, CMRA, LACSLink, SuiteLink) | USPS-licensed products, resold by CASS vendors; USPS API terms not located | API | A-tier adapter only | [H18] |

---

## 8. What Phase 6 should take from this (proposed)

These are recommendations for the Phase 6 plan, not decisions; owner questions are in section 9.

### 8.1 Must match (parity)

1. **Resource, ids and attributes.**
   - Add `report/<type>` resources with `rep_` ids and `rptp_` templates.
   - History entries are `rpr_` (runs) and `ract_` (actions); screening record and listing tokens are `scrre_` and
     `scatr_`.
   - Carry the shared attributes and relationships in sections 1.3 and 1.4, `accounts` included.
   - The zod schemas are the contract and generate the OpenAPI, as usual.
2. **State machine.** `pending` → `ready` | `errored`, plus `submitted` for adapter-backed types; ready never returns
   to pending; monitored runs go ready → ready or ready → errored. A pure function in `packages/core`, test-first.
3. **API surface.** These routes, with Persona's bodies, as Fastify plugins:
   - `POST/GET /api/v1/reports` (filters `account-id`, `reference-id`);
   - `GET/DELETE /api/v1/reports/:id`;
   - `add-tag`, `remove-tag`, `set-tags`;
   - `dismiss`, `review`;
   - `pause`, `resume`, `run`;
   - `history`.

   `print` waits for Phase 9.
4. **Events.**
   - `report/<type>.ready`, `.errored` and `.submitted` per type.
   - `.matched` when `has-match` turns true, and on a monitored run that brings a new or changed match (OpenVerify
     defines both explicitly).
   - `.dismissed`, and `report/screening.reviewed` with the review details in `payload.meta`.
   - Add our `report/<type>.redacted`.
   - Register every name in `EVENT_NAMES`, and give webhook filters and the events API the new names.
5. **Review semantics.**
   - A dismissal needs a reason and is stored in the report's `ignore-list` with snapshot, user, time and the run
     that found the match; it carries forward on later runs.
   - Screening reviews take the four statuses, the two risk levels and `notify-on-change` (reopen on data change),
     with `present-in-last-run`.
   - Both are refused on pending, errored or redacted reports (409).
   - Both write `ract_` history entries.
6. **Monitoring.**
   - Template `recurrence-interval-days` in [1, 365]; same inputs on each run; run, pause and resume with the
     upcoming-run rule.
   - The scheduler is one BullMQ repeatable sweep that claims due reports with `FOR UPDATE SKIP LOCKED`, not one
     repeatable job per report **(inference: scales better and survives restarts)**.
   - Record every run in history.
7. **Watchlist matching configuration, mapped onto C58** [R5]:
   - presets `exact`, `strict`, `tolerant`, `custom`, each a fixed set of C58 methods (aliases, subset and
     initials, joined, first/last, nickname, typo budget by length as in 4.1);
   - birthdate modes `exact_date`, `exact_year`, `year_plus_minus_one` (default), using C58.5's partial-date rules
     for list entries with only a year or a month;
   - country fields `birthplace`, `citizenship`, `nationality`, `residency`, filtering only on a proven
     disagreement;
   - list selection by category or list (`search-lists`).
8. **PEP configuration keys.** Classes (default 1 and 2), associates (off), candidates (off), unknown class, default
   country, sources without URLs (on). Portrait comparison is deferred: it needs selfie matching against public
   portraits, which raises consent and licence questions.
9. **Adverse-media configuration keys.** Categories, maximum article age, dated-only, allowed countries; dismissal by
   entity or article; an undismissed-URLs attribute for Phase 8 conditions.

### 8.2 Ours, keep and label

1. **Report honesty (a new ADR, the next free number, 0005 at the time of writing).**
   - ADR 0002's tiers and stages apply to report types.
   - **A report never answers "no match" for a list it did not screen.** A missing or stale list (older than the
     template's `max-list-age-hours`, default 48) makes the report `errored` with `list_unavailable` or
     `list_stale`.
   - Results carry provenance: the list id, publication timestamp and sync SHA-256 for each list used, the matcher
     version and the preset.
   - Sandbox providers and fixture lists are refused in production, as in C62.8 [R5].
2. **Proposed tiers and stages:**

   | Report type | Tier | Stage and basis |
   |---|---|---|
   | Watchlist, business watchlist (sanctions) | R | `beta` until a synthetic recall and precision benchmark (aliases, transliterations, typos) passes |
   | Crypto address watchlist | R | exact match; `ga`-able |
   | PEP (Wikidata) | H | `beta`, with a coverage notice |
   | Adverse media (GDELT) | H | `beta` |
   | Email, phone | R subset + A | — |
   | Address lookup | A + R normalisation | — |
3. **Scores and attribute levels.** Each match carries a `score` in [0, 1] and per-attribute levels (name, birthdate,
   country, identifiers), which Persona shows for screening but does not specify. These are ours; label them in the
   docs.
4. **Template versioning** (`rptpv_`, immutable published versions) and a template API. The report pins its
   version and keeps `report-template-version-name`.
5. **Continue on hit by default** (`pause-on-match: false`), with the legacy pause-until-dismissed behaviour as an
   option (`resume-delay-minutes`, default 30).
6. **Delta re-screening.** After a list sync, re-screen monitored subjects against added or changed entries only,
   and emit `.matched` for new hits. Persona documents only the fixed interval.
7. **Suppression key.** The source list id plus the publisher's entity id (OFAC UID, EU logical id, UK unique id),
   with the article URL for media. A changed entity record (new alias, new birthdate) reopens a dismissed or reviewed
   match when `notify-on-change` is set, and otherwise is recorded in history.
8. **Transliteration.** C58 answers `missing` with `script_mismatch` for two scripts. Screening must not stop there:
   transliterate to Latin before matching and keep the original. Until a permissive transliterator is chosen (a
   question for the libraries note), report cross-script comparisons as `not_compared` in the per-attribute levels.
   A cross-script comparison never counts as a silent "no match".
9. **Synthetic sandbox.** A fixture list in each publisher's format, with obviously fictional persons, companies and
   a crypto address derived from a published test key; magic values in `docs/checks/sandbox-providers.md` for every
   type (email, phone in the NANP fictional 555-01xx range, address-lookup outcomes). Real lists also sync in sandbox
   environments when the operator enables them. The fixture list is loaded only in sandbox environments.

### 8.3 Build order (proposed slices, matching PLAN §6 Phase 6)

1. **Contracts first:** ids, statuses, resource and request schemas, event names, scopes, template schemas (stubs,
   then RED tests).
2. **`packages/watchlist` ingestion.**
   - Parsers for OFAC SDN and non-SDN, EU FSF and UK Sanctions List (UN optional) into one normalised entity model:
     names and aliases with type and script, birthdates with granularity, countries by role, identifiers,
     digital-currency addresses, programmes, list and publisher ids, listed and delisted timestamps.
   - An operator-run sync job through the C54.6 outbound client (size caps, content-type allowlists, no redirects).
   - Schema validation, a rollback guard that refuses a list older than the stored one, and a per-sync SHA-256
     audit row.
   - Never committed; synthetic fixtures for tests.
3. **Matcher.** Normalisation, transliteration hook, Jaro-Winkler and token-set over C58, the presets, birthdate and
   country filters, scores; a recall and precision harness on synthetic aliases.
4. **Report engine and API.** Creation, the worker job, history, tags, redaction, dismissal and review, events,
   account linkage, the inquiry-template `reports` trigger.
5. **Monitoring.** Scheduler, pause, resume and run, delta re-screen, `pause-on-match`.
6. **Type providers.**
   - PEP: a Wikidata mirror job building a local position-holder table with our class mapping.
   - Adverse media: a GDELT adapter, off by default.
   - Crypto: OFAC addresses with per-chain canonicalisation from Phase 5's validators.
   - Email and phone: R subsets from Phase 5, plus adapter ports.
   - Address lookup: an adapter port, plus the C58 normaliser.
   - Business watchlist.
   - Screening as the composite.
7. **Dashboard minimum.** Index, detail, review and dismiss, history, monitoring actions, the watchlist and screening
   template editor, and the inquiry and account tabs.

### 8.4 Nice to have / later

CSV bulk create (≤ 10,000 rows) and CSV exports; PDF print (Phase 9); workflow Run Report action and `match_found`
conditions (Phase 8); cases attaching reports and report runs (Phase 8); Connect snapshots (Phase 11); custom-list
reports (Phase 7 lists); commercial adapters (an OpenSanctions/yente adapter for licensed operators,
ComplyAdvantage-style PEP and media, phone and email reputation vendors, CASS address vendors, Chainalysis, TRM).

### 8.5 Open questions (no public answer)

- The full `match-types` vocabularies of watchlist, PEP and adverse media, and the wire names of every template
  setting except `search-lists` and `screening-coverage`.
- How a dismissed legacy match is recognised on a later run, and whether delisting clears `has-match`.
- Whether `.matched` repeats for further new matches while `has-match` is already true.
- How reports are attached to inquiry templates, and what `processing-mode` and `request-flags` do.
- Which permission the pause and resume endpoints need beyond `report.write`.
- How the screening report exposes its per-attribute match transparency on the wire.

---

## 9. Needs the owner

Each item gives the decision, the default we recommend, and why. Phase 6 can proceed on the defaults; record the
answers in the Phase 6 plan and `docs/PROGRESS.md`.

1. **UN Security Council list.** The UN site terms allow only personal, non-commercial use [P5].
   - **Default:** do not ship or enable the UN file. Rely on the OFAC, EU and UK lists, which carry UN designations,
     and offer an operator opt-in sync (`watchlists:sync --source un`) whose documentation states the UN terms and
     makes the operator accept them.
2. **Live list data vs rule 4's pinned SHA-256.** Sanctions lists change several times a week, so a pinned hash
   cannot exist.
   - **Default:** the C62.7 pattern [R5]. Pin the source URL, expected content type and schema version in a
     `watchlists/manifest.json`. Fetch with an operator-run sync that is never committed or baked into an image.
     Verify the schema, refuse rollback, and record each sync's SHA-256, publication date and entry count. Write
     this down as an ADR interpreting rule 4 for live public-sector data.
3. **GDELT adverse media sends names to a third party.**
   - **Default:** the adapter ships disabled (`adverseMedia` provider kind unset, so reports answer
     `provider_not_configured`). When enabled it is `beta`, sends only the name (and optional country), cites GDELT,
     stores URL, title and date only, and is listed in the compliance guide's processor and transfer section.
4. **PEP from Wikidata: coverage and classification are ours.**
   - **Default:** ship as `beta` (H) with a coverage notice and our own documented class mapping, built from a
     local mirror refreshed daily. Never query Wikidata with an end user's name. A commercial PEP adapter port is the
     route to authoritative coverage.
5. **Continue or pause on a hit.**
   - **Default:** continue (screening semantics), with a per-template `pause-on-match` for parity.
6. **Organisation-wide ignore list** ("never alert on subject X for entity Y" across reports).
   - **Default:** not in Phase 6. Suppression stays per report, because a shared list can hide true hits on other
     accounts.
7. **Sandbox magic values.** Persona uses real people and a real listed address [H9].
   - **Default:** synthetic only. Real lists may also be synced into sandbox environments, but tests and docs never
     name real listed persons.
8. **Reports and inquiry decisions before Phase 8 workflows.**
   - **Default:** a match never changes an inquiry's status on its own (Persona's model). Add an inquiry-template
     option `on-report-match: needs_review` (ours, default off) so Phase 6 is usable before workflows exist.
9. **Bundled commercial adapters.**
   - **Default:** ports plus deterministic sandbox providers only. No vendor adapter in Phase 6, because each needs
     the owner to pick a vendor and accept its terms. The first candidate for later is an OpenSanctions/yente adapter
     for operators who hold a licence.
10. **The EU and UK attribution and personal-data duties.**
    - **Default:** attribution strings in `THIRD_PARTY_LICENSES.md` and the dashboard footer of the watchlist
      pages. List entity data is stored unencrypted (it is public), but match snapshots on reports are sealed with
      the report's PII and follow its retention and redaction.
11. **Legal positioning.** Persona states it is not a consumer reporting agency [H1].
    - **Default:** the compliance guide says in our own words that OpenVerify is software, that reports are screening
      aids, and that the operator decides how screening results feed eligibility decisions. Not legal advice.
12. **Correct the records.**
    - **Default:** update PLAN §3, `THIRD_PARTY_LICENSES.md` (UK source, UN licence) and `persona-surface.md` (event
      names, the two missing types, the 76 missing report events) in the Phase 6 contracts slice.

---

## Fact-check (2026-10-22)

An independent pass re-opened each load-bearing fact at its primary source: the OpenAPI tarball of commit `805512b` downloaded from codeload into its own directory, the GitHub API, the `docs.withpersona.com` Markdown pages, the Help Center articles, and the publishers' own pages. The pass sent at most one request per second per host and no personal data. **Totals: 29 facts; 28 confirmed, 1 corrected, 0 unverified.** One correction is marked "(corrected in fact-check)" in the text: the P7 row and the EU row of §7.

| # | Fact | Verdict | Evidence from the fact-check |
|---|---|---|---|
| 1 | OpenAPI pin `805512b…`, HEAD, committed 2026-10-21, directory `2026-09-29`, Apache-2.0 | confirmed | GitHub API: committer date 2026-10-21T08:07:03Z; it is the newest commit on `main`; repository licence Apache-2.0; `LICENSE` in the tarball is Apache 2.0 |
| 2 | Statuses `pending`/`ready`/`errored`; the nine shared attributes | confirmed | `components/schemas/report-shared-attributes.yaml` at the pin |
| 3 | Ready never returns to pending; monitored runs go ready→ready or ready→errored; status says nothing about matches | confirmed | H2, read in full |
| 4 | Address lookup passes through `submitted`, and so do several business and vendor types | confirmed | `webhooks/report_address-lookup.submitted.yaml` exists; the events page lists 12 `*.submitted` report events (address-lookup, 8 business types, middesk, two novacredit) |
| 5 | Id prefixes `rep_`, `rptp_`, `rpr_`, `ract_`, `scrre_`, `scatr_` | confirmed | All six occur in the spec's examples. `scrre_` is the `record-token` of the review endpoint; `scatr_` is a `listings[].token` |
| 6 | Event names `report/<type>.<action>`; 126 report events over 48 types against 50 in the surface index | confirmed | Our own count: 126 distinct `report/…` names and 48 types on `events.md`; 50 `report_*` lines in `docs/research/persona-surface.md`. The OpenAPI itself defines 50 report webhooks over 18 types |
| 7 | Review body fields and values; `notify-on-change` reopens on a data change; `reviewer-token` with `user_`/`wfr_`/`api_` | confirmed | `reports_{report-id}_review.yaml` (required: `review-type`, `review-status`); changelog 2026/10/14 |
| 8 | Dismiss: `reason` required; `dismiss-type` `entity`/`media` and `entity-id` required for adverse media | confirmed, with a nuance | The requirements are stated only in field descriptions; the schema's `required` list does not enforce them |
| 9 | Recurrable types; interval 1–365 days; legacy types stop on a hit until dismissed | confirmed, with a nuance | H27 lists the seven types and says any continuously monitored report stops on a hit. The word "legacy" is the note's contrast with H17, not H27's wording |
| 10 | Dismissals carry forward; next run about 30 minutes after; refused on pending, errored or redacted | confirmed | H15 (last updated 2026-08-26) |
| 11 | Screening reports keep running after a match and refresh cases | confirmed | H17 (last updated 2026-10-16) |
| 12 | Templates have no versioning; changes apply to new reports; only person watchlist is editable | confirmed | H3 |
| 13 | `run-history` removed in API 2025-12-08 in favour of the history endpoint | confirmed | Changelog 2025/12/8, under "API version: 2025-12-08" |
| 14 | Presets Exact/Strict/Tolerant/Custom; one typo at 18/10/3 characters for the whole name, 18/5/3 per word with partial names | confirmed | H16 |
| 15 | Birthdate modes exact date, exact year, ±1 year (default); four country fields applied only on a disagreement | confirmed | H13. The article says "two options" but lists three |
| 16 | PEP defaults: classes 1 and 2, Strict, relatives and associates off, sources without URL on; sources checked daily | confirmed | H25. It also lists "current US candidates: OFF" |
| 17 | CSV bulk creation capped at 10,000 rows per file | confirmed | H8 |
| 18 | Scopes `report.read` and `report.write` | confirmed | `api-keys.md` |
| 19 | Phone risk score out of 1000 in the schema, 0–100 in the Help Center | confirmed | `report-phone-risk.yaml` says "Risk score out of 1000"; H24 says "ranges from 0 to 100" |
| 20 | Eleven email attributes return null for reports created after 2023-08-10 | confirmed | Changelog 2023/8/7 lists exactly eleven |
| 21 | Address lookup outputs are USPS DPV, RDI, CMRA, LACSLink, SuiteLink and carrier-route fields | confirmed, with a nuance | Schema and H18 carry all six. Neither source uses the word "CASS"; that label is the note's own |
| 22 | OFAC data is a US government work; formats XML, CSV and fixed-field plus delta files; sporadic changes | confirmed, with a nuance | usa.gov explains §105. It also warns that the US may assert copyright in its works abroad, but Treasury's own CC0 record (data-sources note [F11]) covers that. OFAC FAQ topic 1641 (FAQs 79, 88 and 90) |
| 23 | Digital currency field naming, up to 256 characters, exact-match search, listings not exhaustive | confirmed | FAQ 563 (2018-06-06), FAQ 594 ("ID #" field, exact matches only), FAQ 562 (2018-03-19) |
| 24 | EU FSF licence `COM_REUSE`, XML and CSV at `webgate…/fsd/fsf` with a public token; Commission content CC BY 4.0 by default | **corrected** | The licence is set per distribution in the catalogue record: all but two are `COM_REUSE`. The CSV 1.0 file is tagged CC BY 4.0 and the Sanctions Tracker app CC BY-ND 4.0. Accrual is `daily`, so the §7 "cadence not documented" is also corrected. The CC BY 4.0 default is confirmed on the legal notice |
| 25 | OFSI list closed 2026-01-28; FCDO list the sole source; XSD 4.33.3; OGL v3.0; XML 22,051,514 B, last modified 2026-10-16 | confirmed | GOV.UK pages (OFSI page: "withdrawn on 28 January 2026"); HEAD of the XML: 22,051,514 B, `Last-Modified` Fri, 16 Oct 2026 09:29:07 GMT |
| 26 | UN website terms: personal, non-commercial use, no redistribution | confirmed | Terms §(a) |
| 27 | Wikidata structured data is CC0 | confirmed | Wikidata:Licensing (main, Property, Lexeme and EntitySchema namespaces) |
| 28 | GDELT allows any use with a citation and link; DOC 2.0 covers a rolling 3 months, at most 250 results (default 75) | confirmed | GDELT terms of use; the DOC 2.0 post's MAXRECORDS paragraph |
| 29 | OpenSanctions bulk data free only for non-commercial use | confirmed | The exemption page, and the licensing page (CC BY-NC 4.0) |
