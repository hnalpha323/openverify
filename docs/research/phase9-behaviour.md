# Phase 9 research: inquiry templates, the flow editor and the dashboard settings as Persona documents them (clean-room notes)

Prepared 2026-10-29 for OpenVerify Phase 9 ("Dashboard completeness and flow builder", `docs/PLAN.md` §6 Phase 9 and the
Inquiries and Platform rows of §2 [R1]): the inquiry-template flow builder (screens, steps, branching and dynamic friction,
check configuration), theme sets and translations (en, es, fr, de, ar with right-to-left), analytics (funnel, pass rates,
check failure distribution), settings (allowed domains, keys, webhooks, team, roles) and the WCAG 2.2 AA audit. This release
ships the web platform and Android; iOS moved to the next release on 2026-10-29 [R1].

Everything below is written in our own words. Field names, enum values, event names, API and SDK option names,
configuration keys and URL paths are reproduced only because they are short identifiers needed for functional parity. No
sentences, UI copy, display names or help text are copied; help-centre articles are cited by id under our own labels.
Anything the public sources do not state is marked **not documented**; statements we infer, and that no source states, are
marked **(inference)**. Every citation key (`[O2]`, `[H19]`, `[C7]`, ...) is defined in "Sources and pins" with its full URL;
every source was read on 2026-10-29. Example people, emails and ids in the vendor's material are not reproduced; this note
uses `example.com`, documentation address ranges and fictional values. OpenVerify is not affiliated with Persona.

"OpenVerify today" means the working tree at `91c83e02`, read on 2026-10-29, with Phase 6 being closed by other agents and
Phases 7 and 8 planned but not built (section 5).

---

## Summary

1. **Templates are versioned, and the flow itself is not public.** `itmpl_` templates and `itmplv_` versions: one editable
   draft, locked published versions, each inquiry pinned to its version [D1] [H2]. The spec exposes only list and retrieve,
   version list, and translations get and import, all to production keys; no path creates, edits or publishes a template,
   and no source shows how screens, steps or conditions are serialised [O4] [O5] [O6] [O2] [H53]. OpenVerify's full
   template and version API already goes further and should stay (F5).
2. **Publishing is about to stop meaning "live".** From early November 2026 a published version serves traffic only once
   deployed to an environment; deployments (`dply_`) have history, rollback, removal and a `deployment.completed` event, and
   templates are organisation-level [H3] [O21]. OpenVerify's templates are environment-scoped; we recommend a promote action,
   as Phase 8 chose for workflows (F3, owner question 1).
3. **The flow model:** screens holding components, branching steps (ordered routes, a catch-all last), action sequences
   built like small workflows, connectors that jump to any screen, and modules that insert a verification's screens with a
   pass/retry/fail branch; retries are a branch over an attempts counter [H4] [H5] [H19] [H29] [H31] [H33] [H9]. About 29
   components with Design, Data and Logic tabs [H34] [H35].
4. **What a branch can read:** inquiry status and fields, every earlier verification's status, extractions and check results,
   the account, and on paid tiers signals and reasons; device is **not documented** [H19] [H30] [H28]. OpenVerify's clients
   evaluate transitions over `{inquiry: {status}}` while the server requires every verification step, so dynamic friction
   needs the server to decide the next step (F8): the main engineering change of Phase 9.
5. **Fields, prefill and redirects:** typed template fields (at most 1,000; immutable keys; write-once; redaction policy);
   prefill through the API or URL parameters; redirects append `inquiry-id`, `reference-id`, `status` and `fields` [H40]
   [H23] [D12] [D14]. We keep PII out of URLs (F16, F17).
6. **The editor** shows every path on a canvas, validates on publish while letting drafts save with errors, previews in
   sandbox only, and simulates per verification and per check with pass and fail presets [H8] [H7] [H15].
7. **Themes:** `theset_` sets with sparse light and dark style trees of typed cells (the full cell list is not public), an
   organisation default, per-template attachment and per-component overrides; versions also carry a flat theme of 88
   nullable string properties (corrected in fact-check: "about 100" before), including a remote font URL [O8] [O9] [O2] [H14]. Ours: a closed token set, a WCAG contrast gate, no remote
   fonts or SVG (T2–T5).
8. **Locales and copy:** 46 BCP 47 tags; the device or browser language, a `language` parameter and an in-flow selector;
   per-version `enabled-locales`; per-component translations, CSV export and import, and a draft-only translations API
   [D9] [H39] [H12] [O5]. Right-to-left behaviour is **not documented** (T13).
9. **Analytics:** an overview (created, started, interacted, finished, success and rejected rates, median time to finish)
   and a per-screen funnel by version; verification pass rates by capture method; case analytics; a signal distribution;
   saved views; CSV exports; a SQL explorer; no analytics API; no check-failure view [H26] [H25] [H78] [H28] [H24] [H27]
   [H75] [O20].
10. **Settings:** allowed domains per template or organisation (`localhost` in sandbox only); API keys with 49 listed
    permissions, IP allowlists, expiry within 30 days and manual rotation; webhooks with overlapping secret rotation, 7
    retries over about 51 hours, a delivery log, failure alerts and OAuth; 14-day invitations; roles with environment-level
    grants and per-template constraints; a request-level audit log kept six months; app, email or SMS 2FA; SAML SSO and SCIM
    [D15] [D22] [D26] [O14] [O16] [D29] [D37] [H57] [H56] [O13] [H65] [H67] [H68]. OpenVerify has most of the API side
    already; Phase 9 adds the console and the gaps in table S.

## Gap tables

Verdicts: **MATCH** (adopt the public behaviour), **OURS** (no public counterpart, or we deliberately differ; labelled as
ours), **DEFER** (not in Phase 9), **HONEST** (needs a third-party account or licensed data: an adapter with a deterministic
sandbox provider, ADR 0002 tier A [R4]). Row ids (F1, T1, A1, S1, K1) are not citation keys; citation keys are always in
brackets. "Today" is the tree at `91c83e02` (section 5).

### Flow builder (F)

| ID | Public behaviour (Persona) | OpenVerify today | What Phase 9 should do | Verdict | Sources |
|---|---|---|---|---|---|
| F1 | `itmpl_`, `itmplv_`; template `status` `active`/`inactive` (open set) | `itmpl`, `itmplv`; `active`/`archived` | Keep our ids and `archived` (shipped contract); document the mapping | MATCH (ids) / OURS (status word) | [O1] [R16] |
| F2 | One draft, locked published versions, each inquiry pinned; version `description`, `name-display`, `last-updater` (email) | `draft`, `published`, `superseded`; pinning; no description | Add a locked publish note (≤ 255 chars) and an editable description; `last-updater` as an actor id, never an email in the API | MATCH / OURS (actor id) | [H2] [H3] [O2] [R16] |
| F3 | Publish ≠ deploy (Nov 2026): per-environment deployments (`dply_`), history, rollback, undeploy, `deployment.completed`; templates organisation-level | Environment-scoped templates; publishing makes a version current | Keep environment-scoped templates (as Phase 8 did for workflows) and add **promote**: copy a published version into another environment, re-resolving references by key; record each publish and promote as a deployment-like history entry | OURS (owner question 1) | [H3] [O21] [R8] |
| F4 | Weighted-random splits and criteria (`context: mobile`) on template deployments | None | Not in Phase 9; the Phase 8 rollout split is for workflows | DEFER | [O2] [O3] [R8] |
| F5 | No public API to create, edit or publish a template; production keys only | Full create, draft, update, publish API in every environment | Keep (configuration as code); add `GET`/`POST` translations in the public shape (T11) | OURS | [O4] [O6] [O5] [R20] |
| F6 | Flow = screens + branching, action and connector steps (+ "parallel"); modules insert step groups | A step list with transitions; each step a fixed screen | `flow-spec` v2: `screen` steps holding components, `branch` steps (ordered routes, an unconditioned catch-all last), server `action` steps, `goto` connectors to screens; modules are editor macros that expand into v2 steps, not a runtime type; v1 flows stay valid and render as today | MATCH (semantics) / OURS (serialisation) | [H4] [H5] [H33] [R15] |
| F7 | Parallel steps named once, never specified | None | Not built | DEFER | [H5] |
| F8 | Where branches run: **not documented** | Clients evaluate JSONLogic over `{inquiry: {status}}`; the server requires every verification step of the flow | The **server decides the next step** after each submission, evaluating branches with the Phase 8 condition dialect over a typed scope; clients render the step the session API names; the required-verification set becomes "the verifications on the path actually taken", recorded per inquiry | OURS (security property; see 1.11) | [R17] [R18] [R19] [R8] |
| F9 | Branch inputs: inquiry status and fields, earlier verifications (status, extracted class, country, birthdate, check outcomes), account; signals and reasons on paid plans | `inquiry.status` only | A typed flow scope: `inquiry` (status, fields by key), `verifications.<step-id>` (status, attempts, attempts-remaining, check outcomes, the extracted values the type exposes), `account` (type, status, tags), `signals.<name>` (Phase 7, nullable), `lists.<key>` (Phase 7 match booleans), `device` (desktop web, mobile web, native; ours) | MATCH / OURS (`device`, `lists`) | [H19] [H30] [R9] |
| F10 | Signals may drive branches; the vendor advises review over decline | Phase 7 `signal-config`; `on-signal` review rule, never declines | A branch may add friction or send to review on signals; a path that reaches a failure step on signals, list matches or other non-verification inputs needs a publish-time acknowledgement, as Phase 8's automated-decline rule does | OURS (honesty; GDPR Art. 22, not legal advice) | [H28] [R8] [R9] |
| F11 | Retries: a branch compares `flow_state.run_<v>_attempts` with a limit (5) and loops back | `maxAttempts` per step | Keep `maxAttempts` as the hard bound; expose `attempts` and `attempts-remaining` in the scope; the editor generates the pass/retry/fail branch | MATCH (behaviour) / OURS (names) | [H9] [H19] [R15] |
| F12 | ~29 components: elements, forms, advanced forms | No component model; `form` step (6 field types) rejected by the template contract | Component catalogue v1: Text, Image (uploaded asset), Button (submit, action, complete, cancel, link), Spacer, Container, Footer, Stepper; Text input, Text area, Number, Date, Email, Phone, Select, Radio group, Checkbox, Checkbox group, Multi select, Country select, URL, Masked text (PII-marked); Address input without autocomplete. File upload, Home, List Container, Device Handoff Button and the vendor-bound bank component later | MATCH (subset) / DEFER (rest) | [H34] [H35] [R15] [R16] |
| F13 | Component Logic tab: show, hide, enable, disable on load or update | None | Client-side visibility rules over the same screen's field values only (no signals or verification data leave the server for this); the server re-checks required fields whatever was shown | MATCH / OURS (scope limit) | [H34] [H9] |
| F14 | Action sequences in flows: run verification, copy extractions, update account, custom JavaScript, HTTPS request | Verifications created by the server per step | Flow `action` steps from a closed list: run verification, copy extractions to fields, update account fields, tag; custom code and HTTPS calls only in Phase 8 workflows (sandbox and SSRF guard there); "inquiry-embedded workflow" = an action that starts a Phase 8 workflow and waits (bounded) for its output, which branches may read (K1, K2) | MATCH (closed list) / OURS (no code in flows) | [H29] [H4] [R8] |
| F15 | Typed template fields, ≤ 1,000, immutable keys, defaults, max length, HTML strip, redaction and write-once policies, references | Untyped `fields` record (string, number, boolean, null), snake_case keys, encrypted | A template field schema: types `string`, `integer`, `number`, `boolean`, `date`, `datetime`, `email-address`, `choices`, `multi-choices`, `array` (of scalars); immutable keys after first publish; `pii` flag (sealed); max length; write-once; a references list in the editor; cap 1,000 | MATCH | [H40] [O7] [R16] |
| F16 | Prefill through API `fields`, hosted `fields` query parameter, embedded `fields` | API `fields` | Prefill **only through the server API** and the JS client's server-signed session, never through URL query parameters (PII would land in logs, history and referrers); initial values kept sealed for the inquiry-comparison check | OURS (deviation) | [H23] [D12] [D18] [R16] |
| F17 | `redirect-uri` receives `inquiry-id`, `reference-id`, `status` and `fields`; custom schemes; allowlisted | No redirect | Redirect with `inquiry-id` and `status` only (status labelled non-authoritative); exact allowlist on scheme, host and port per environment, narrowed per template; custom schemes only from a per-template list | OURS (deviation) / MATCH (allowlist) | [D14] [O1] [W6] |
| F18 | Address autocomplete through a third-party maps service | None | An `address-autocomplete` adapter kind, off by default, with a deterministic sandbox provider returning fixture addresses | HONEST | [H34] [H36] [R4] |
| F19 | Per-template verification config: checks enabled/required, capture methods per device class, countries, ID types | Check map, allowed countries and classes, capture methods per step | Structured forms over the existing config; add capture methods per device class (desktop web, mobile web, native) | MATCH | [H9] [H38] [H48] [R16] |
| F20 | Expiry from creation, pending and resume; handoff link; session limit; per-inquiry overrides | Inquiry, session and one-time-link lifetimes; Phase 7 plans `max-sessions` | Forms for every setting; add the pending and resume windows if the settlement code lacks them | MATCH | [H18] [O10] [R16] [R9] |
| F21 | Canvas editor: flow tree, insert node offering valid kinds, copy and paste, undo, zoom, locale and size preview, panels, an errors panel (save drafts with errors; publish needs none) | JSON editor with validation pointers | @xyflow/react canvas shared with Phase 8; publish validation = zod contract + graph checks (reachability, every path ends terminally, connectors target screens, configs exist, conditions typed against F9's scope); errors carry JSON pointers and link to nodes; every drag has a keyboard alternative (WCAG 2.5.7) | MATCH / OURS (checks) | [H8] [R1] [W1] |
| F22 | Preview and Simulate: sandbox only; per-verification pass or fail; per-check overrides; presets; field edits; restart | Sandbox `perform-simulate-actions` on inquiries | Preview runs the real flow renderer on a sandbox inquiry with the simulate actions per verification and per check, synthetic presets from the fixtures, a field panel; refused in production; the Phase 8 canvas overlay reuses it (K4) | MATCH | [H7] [H15] [R1] |
| F23 | (Report templates are not a vendor editor feature) | JSON editors for inquiry and report templates | One schema-driven form engine for template versions (inquiry, report, signal and list configs), generated from the zod contracts (K14) | OURS | [R10] |
| F24 | Version history; compare with latest; older pairs only via restore-as-draft | Version list | Structural diff of any two versions; restore as a new draft, never auto-publish | MATCH / OURS (any pair) | [H2] [H44] |
| F25 | Copy a template; a connections view (verification templates and workflows used) | None | Copy into a new template with a draft; a "used by" panel listing Phase 8 workflows and report templates that reference it | MATCH | [H16] [H8] |
| F26 | Embedded and inline JS client (options, callbacks, error codes, iframe sandbox) | None (`sdk-js` not created) | A minimal `@openverify/js` embed with allowed domains (S2): template, version, or inquiry plus a one-time link or session token, language, theme set, style variant, iframe title, `onReady`, `onComplete`, `onCancel`, `onError`, `onEvent` with an allowlist; origin-checked messages; callbacks documented as non-authoritative | MATCH (subset) | [D18] [D20] [D22] [R1] |
| F27 | `initial-step-name` (beta) | None | Not built (it lets a caller skip screens) | DEFER | [O10] |
| F28 | Plan caps: 3 routes, 20 steps on the entry plan | None | No plans; engineering limits instead (ours, provisional): 200 steps, 20 routes per branch, 40 components per screen, 1,000 fields | OURS | [H6] [H30] |

### Themes and translations (T)

| ID | Public behaviour (Persona) | OpenVerify today | What Phase 9 should do | Verdict | Sources |
|---|---|---|---|---|---|
| T1 | `theme-set` (`theset_`): name, `active`/`archived`, styles; CRUD and archive; archiving detaches; the default set cannot be archived (409) | None | The same resource and lifecycle, id prefix `theset`, organisation-level (themes hold no PII or providers); scopes `theme-sets:read`/`write` | MATCH | [O8] [O9] [D26] |
| T2 | Styles: `settings` plus `light`/`dark` variants of chrome, a component grid and step assets; typed leaves; sparse with defaults; 400 for bad cells, 422 for contradictions; full cell list not public | None | Our closed token set (colours as hex, sizes in px, corner radius, font family from an allowlist, logo asset id, illustration asset ids), sparse with documented defaults, 400 with pointers, 422 for contradictions | MATCH (shape) / OURS (tokens) | [O8] [O9] |
| T3 | No contrast rule documented | No theming | Saving or publishing refuses text and control colours below WCAG 2.2 AA (4.5:1 text, 3:1 large text and non-text) in either variant, checked by our own luminance code | OURS | [W1] |
| T4 | `font-url`: a remote font | CSP `'self'` only | No remote fonts: operator-uploaded font files served from the flow origin, or a system stack; the operator confirms the font's licence | OURS (deviation) | [O2] [R24] |
| T5 | Logos and illustrations by URL or uploaded asset; dynamic images from a field | None | Uploaded PNG, JPEG or WebP only (no SVG: active content), magic-byte checked, size-capped, served same-origin; dynamic images later | OURS / DEFER (dynamic) | [O2] [H47] |
| T6 | Dark mode with a preferred variant; `style-variant` forces one | None | `prefers-color-scheme` with the preferred variant; `style-variant` parameter | MATCH | [O8] [D12] [H46] |
| T7 | A template links a set or holds its own; organisation default; per-inquiry `theme-set-id`; set edits apply live | None | The same attachment rules; a set edit applies to live flows only after it passes T3, and every edit is audit-logged | MATCH / OURS (gate) | [H14] [H46] [O10] |
| T8 | Per-component style overrides | None | Allowed within the token types; T3 applies | MATCH | [H4] [H34] |
| T9 | 46 locales, region-tagged (`en-US`, `es-MX`, `ar-EG`) | `en`, `es` | PLAN's five: `en`, `es`, `fr`, `de`, `ar`; BCP 47 base tags; RFC 4647 lookup with a fallback chain ending at the template default, then `en` | MATCH (mechanism) / OURS (set) | [D9] [W3] [W4] [R1] |
| T10 | Browser or device language; `language` parameter; selector on the first screen; template `enabled-locales` | `?lang=`, then `navigator.languages`; a selector | Add `enabled-locales` and a default locale to the version; accept `language` as an alias of `lang`; Android follows the device and the session's locale (Phase 10) | MATCH | [D9] [H39] [O2] [R23] |
| T11 | Per-component overrides; CSV export and import (partial merge; blanks never delete); `GET`/`POST` translations (draft only, never publishes) | Bundled strings only | String overrides keyed by step, component and attribute per locale, stored in the draft; the public JSON shape; CSV through Phase 7's formula-safe writer and reader; plain text with an allowlisted mark-up (bold, links to allowlisted URLs) | MATCH | [H12] [O5] [R9] |
| T12 | Machine translation of all strings (engine not documented) | None | Not built; a translation adapter kind could come later | HONEST / DEFER | [H12] [H39] |
| T13 | Arabic and Hebrew offered; RTL behaviour not documented | Logical CSS properties; no RTL locale | `<html dir>` from the locale; bidi isolation of every user-supplied value inside translated text; mirrored directional icons; RTL screenshots in Playwright; Android through Compose layout direction (Phase 10) | OURS | [D9] [W5] [W8] [R22] |
| T14 | Accessibility claims without a level or date | Phase 1–8 flows built for WCAG 2.2 AA | The PLAN audit of the flow and the console at WCAG 2.2 AA: automated checks plus manual screen-reader passes; publish an accessibility statement with known gaps and its date | OURS (honest statement) | [D10] [W1] [R1] |
| T15 | Native SDKs read server themes from v2 | Android strings in `composeResources` (`values`, `values-es`) | Put the resolved theme tokens and string overrides in the flow session response now, so Phase 10 renders them | MATCH (contract now) | [D8] [D43] [R32] |

### Analytics (A)

| ID | Public behaviour (Persona) | OpenVerify today | What Phase 9 should do | Verdict | Sources |
|---|---|---|---|---|---|
| A1 | Overview: created, started, interacted, finished, success, rejected, median time to finish; four charts with rates; filters by dates, templates, tags, country, platform, device group | None | The same metrics with written definitions (ours: started = the first step rendered, from the server's step record; finished = a terminal step reached); filters by environment, template, version, dates, tags, platform and device class; UTC buckets | MATCH / OURS (definitions) | [H26] |
| A2 | Funnel per screen: counts, overall or per-step percentages, per version, per path, over time | No step tracking | The server's step record (F8) gives counts per version and step and per transition; overall and per-step modes; version comparison | MATCH | [H26] |
| A3 | Verification created, processed, passed; grouped by capture method | Verification statuses stored | Pass rates per type and template; capture-method grouping where the capture records it | MATCH | [H25] [H38] |
| A4 | Check failure distribution: not documented | None | Per check: runs, failed, not applicable, share of failed verifications, split required and advisory, with the check's tier and stage shown, beta checks marked | OURS | [R1] [R4] |
| A5 | Client events can be forwarded to a tag manager | None | No third-party forwarding built in; `onEvent` lets the host do it; the docs warn that metadata can carry ids | OURS | [D44] [D20] |
| A6 | Cases analytics: resolution percentiles, assignment distribution, SLA, availability | Phase 8 cases (planned) | Resolution-time percentiles, SLA met or missed, assignment distribution; availability metrics only with S21 (K7) | MATCH / DEFER (availability) | [H78] [R8] |
| A7 | Signal distribution view | Phase 7 signals (planned) | A per-signal distribution and time series over a period, environment-scoped (K8) | MATCH | [H28] [R9] |
| A8 | Saved views on inquiries, API logs and webhook events | Filters only | Saved views per user (filters and columns), shareable within an environment by an explicit action (K10) | MATCH / OURS (sharing rule) | [H24] [H73] [H74] |
| A9 | CSV exports per object, per-type export permission, asynchronous, PII warning | None (Phase 7 has a formula-safe CSV writer) | Asynchronous exports for inquiries (plus a file per verification type), accounts, cases, reports and lists (K9); `exports:create` per type plus `pii:view` for PII columns (masked otherwise); sealed files, 5-minute links, 7-day expiry (ours, provisional), audit entries; CSV bulk report creation (K13) | MATCH / OURS (safeguards) | [H27] [R9] [R10] |
| A10 | (Session map) | — | Still blocked on permissive map tiles without network calls (K11) | DEFER | [R9] |
| A11 | A SQL explorer on a hosted warehouse with a privileged-access mode | None | Not built: self-hosters own their database; document a read-only replica role instead | DEFER (not planned) | [H75] [H76] |
| A12 | No analytics API | None | A read-only aggregates API (`analytics:read`), counts only, never PII | OURS | [O20] |
| A13 | Sandbox handling not documented | Environments separate | Analytics always per environment; sandbox never mixed into production | OURS | [D25] |

### Settings (S)

| ID | Public behaviour (Persona) | OpenVerify today | What Phase 9 should do | Verdict | Sources |
|---|---|---|---|---|---|
| S1 | Sandbox and production; templates and workflows organisation-level with per-environment deployment; per-environment keys and webhooks | Everything environment-scoped; session environment switcher | Keep; promote between environments (F3) | OURS | [D25] [H3] [D26] [R31] |
| S2 | Allowed domains per template or organisation; bare domains; subdomains separately; `localhost` sandbox only; drafts not embeddable; mechanism not documented | Install-wide `OPENVERIFY_FLOW_CORS_ORIGINS`; no `frame-ancestors` | Per-environment allowed origins (scheme, host, port; exact), narrowed per template; enforced by a per-request `Content-Security-Policy: frame-ancestors` header on the flow document (a small flow server or the API serving `index.html`, since a `<meta>` copy is ignored); `localhost` only in sandbox; drafts never embeddable | MATCH (behaviour) / OURS (mechanism) | [D15] [D22] [W2] [R24] [R25] |
| S3 | Redirect allowlist shared with embedding | None | Same list, exact match (F17) | MATCH | [D15] [W6] |
| S4 | API keys: permissions, IP allowlist, expiry, clone, expire (≤ 30 days), attribute blocklist, inflection, file token lifetime, payload filters | Scopes, `allowed-ips`, expiry, clone, expire, masked prefix, `pii-masked` | A rotation helper (clone, then expire the old key with an overlap); an attribute blocklist on keys like webhooks'; template-restricted keys later | MATCH / DEFER (template restriction) | [O14] [D26] [D27] [R28] |
| S5 | Scope names `resource.action` | `resource:action` | Keep ours (Phase 8 W34) | OURS | [D26] [R27] |
| S6 | Webhooks: failure alerts; attempts headers; vendor User-Agent; OAuth client credentials; included and relationship allowlists; 5 s timeout and 7 retries over ~51 h | Most fields, rotation with overlap, simulate, replay, 8 attempts over 24 h, a User-Agent | Failure alerts (threshold ≥ 1, window 5–1,440 min, first attempts only, opt-in in-console and email through the mail adapter); attempts headers on deliveries; keep our retry schedule and say so; OAuth client credentials later | MATCH / DEFER (OAuth) | [D37] [O18] [D35] [D29] [R29] |
| S7 | Delivery log: statuses, result code, attempts, search, 30-day retention, saved views | Delivery list and detail; retention setting | Search by status, webhook, event name and time; saved views (A8) | MATCH | [O17] [D29] [R30] |
| S8 | Invite (14 days), resend, deactivate, reactivate; SSO organisations provision through the IdP | Invitations (7 days, single use), deactivate | Resend and reactivate; keep 7 days | MATCH / OURS (lifetime) | [H57] [H58] [H59] [R21] |
| S9 | Roles: View/Edit grid, organisation-level versus environment-level grants (optionally covering environments created later), per-template and assigned-to-me constraints, Admin immutable, several roles per user | Flat permission list, organisation-wide; built-ins immutable; custom roles | Environment-scoped role assignments (a role granted in chosen environments or in all current and future ones); per-template constraints later | MATCH (environments) / DEFER (templates) | [H56] [H63] [H70] [R27] |
| S10 | Data permissions (full SSN, ID numbers) | `pii:view` | Keep one `pii:view` in Phase 9 | DEFER (finer split) | [H63] [R27] |
| S11 | Request-level audit log (path, method, params, IP, UA, status, impersonator), six months, explorer with filters | Action-level audit log (action, actor, resource, IP, UA, PII-free metadata) | Keep ours; add the explorer filters (actor, action prefix, resource, dates, exact IP) and a retention setting | OURS | [O13] [H60] [R33] |
| S12 | Posture: users, sessions, MFA status, unused permissions | Users page | MFA status and last sign-in columns; unused-permission inference later | MATCH / DEFER | [H69] |
| S13 | MFA by app, email or SMS; required by default for new organisations; admins pick methods | TOTP, WebAuthn, recovery codes; `require-mfa` off by default | Keep TOTP and WebAuthn only (no SMS or email factors); owner question on defaulting `require-mfa` to on for new organisations | OURS (owner question 6) | [H65] [R30] |
| S14 | Admin-issued recovery codes that never expire | `user:reset-mfa` CLI | A console "reset MFA" (admin, audited, forces re-enrolment at next sign-in) instead of never-expiring codes | OURS | [H61] [H65] |
| S15 | SAML SSO with JIT; SCIM 2.0 via Okta and Entra | None | Not in Phase 9; OIDC sign-in first, SAML and SCIM after, in Phase 11 hardening | DEFER (owner question 7) | [H67] [H68] [W7] [W9] |
| S16 | Enabling 2FA expires other sessions; session permissions | Sessions with revocation on deactivation | "My sessions" with revoke; MFA enrolment revokes other sessions | MATCH | [H65] [H63] |
| S17 | — | Console script CSP left open since Phase 2 (K16) | Nonce-based CSP for the console, `frame-ancestors 'none'` | OURS | [R8] [W2] |
| S18 | Notifications with per-user preferences | None | Minimal in-console notifications and opt-in email for webhook failures (and Phase 8 SLA expiry if not already there) | MATCH (subset) | [H80] [H81] [D37] |
| S19 | — | Trust-store flags are install settings (K18) | Show both flags read-only on the trust-store page | OURS | [R12] |
| S20 | Case layout editor, checklists, status-switcher rule, preset comments | Fixed default layout (Phase 8 decision 70) | Layout editor on the same drag-and-drop grid as F21 with keyboard alternatives; checklists; preset comments (K5) | MATCH | [H84] [R8] |
| S21 | Teams and availability | None | Owner question 9 (default: both in the next release; case analytics ships without availability metrics) | DEFER (owner) | [R8] |
| S22 | `print` routes for inquiries, reports and verifications returning PDFs | None; Phase 8 plans a browser print view for cases | Register the routes; server PDF rendering needs a font decision (owner question 8) | MATCH (routes) / owner | [R6] [R10] [R8] |
| S23 | — | Report sections on the inquiry page, run notes, `GET /verifications/:id` without files (K15, K17) | Finish them | OURS | [R10] [R12] |
| S24 | Sender email domains with DNS verification | Phase 5 mail adapter, install-level sender | An environment-level sender name and address on the existing SMTP adapter; DNS verification stays the operator's | OURS | [H79] |
| S25 | Key inflection; payload filters | None | Not built | DEFER | [O14] [D27] |

## Carried into this phase

Found by searching `docs/plans/*.md` at `91c83e02` for "Phase 9", "Phase 10", "Phase 11", "carried to" and "later phase" [R12].
Every item below falls in Phase 9 ("Dashboard completeness and flow builder"). Phase 10 and 11 hits about Android, NFC, iOS,
Connect or hardening are left to the sibling notes. Line numbers are those of the plan files at `91c83e02`. The column "Where
it lands here" points to this note's gap rows.

| # | Item handed to Phase 9 | Plan and line | Where it lands here |
|---|---|---|---|
| K1 | Inquiry-embedded workflows wait for the Phase 9 flow builder | `phase-8.plan.md:368`, `:791` | F14 |
| K2 | Flow-builder branching on workflows (a workflow result as a branch input) | `phase-8.plan.md:791` | F9, F14 |
| K3 | Flow-editor branching on signals | `phase-7.plan.md:1490` | F9, F10 |
| K4 | The canvas simulation overlay of the workflow editor | `phase-8.plan.md:413`, `:791`, `:1039` (decision 23) | F22 (the same preview/simulate engine) |
| K5 | Case layout editor, checklists, the status-switcher rule, preset comments; case-action placements other than the header and their visibility rules | `phase-8.plan.md:732`, `:789`, `:792`, `:1092` (decision 70) | S20 |
| K6 | Teams, availability and availability-driven assignment | `phase-8.plan.md:792`, `:1093` (decision 71) | S21 |
| K7 | Case analytics | `phase-8.plan.md:792`, `:1093` | A6 |
| K8 | Signal analytics (distribution, time series) | `phase-7.plan.md:1490` | A7 |
| K9 | List exports | `phase-7.plan.md:1490`, `:1969` (decision 33) | A9 |
| K10 | Saved views, filterable transaction fields, filtering inquiries by list match | `phase-7.plan.md:1490`, `:1503` | A8 |
| K11 | The console's session map (blocked on permissive map tiles without network calls) | `phase-7.plan.md:1503` | A10 (DEFER again) |
| K12 | `print` routes (reports, and with them inquiries and verifications) and a server-made PDF with its fonts | `phase-6.plan.md:181`, `:240`, `:577` (C88); `phase-8.plan.md:698`, `:794`, `:1094` (decision 72) | S22 |
| K13 | CSV bulk creation of reports (with the print and workflow items, row G7) | `phase-6.plan.md:181`, `:577` | A9 |
| K14 | Structured forms for report templates (the console has a JSON editor only) and a create-template form | `phase-6.plan.md:559`, `:1023` (decision 7), `:1283` (decision 25) | F23 (the same form engine as the inquiry-template editor) |
| K15 | Reports in the dashboard inquiry document, the latest run's notes on the report resource, and the `FormDialogButton` options | `phase-6.plan.md:1283` (decision 25); also `docs/PROGRESS.md:85` | S23 |
| K16 | The console's script CSP, "left for a later phase since Phase 2" (no phase named) | `phase-8.plan.md:88` | S17 |
| K17 | `GET /verifications/:id` without file resources or redaction state, "left for a later phase" (no phase named) | `phase-2.plan.md:849` | S23 |
| K18 | The console's trust-store flags, an open owner decision (no phase named) | `phase-5.plan.md:1252` (item 22) | S19 |

One stale record turned up: `phase-2.plan.md:921` still calls cases "Phase 9", from before the phases were renumbered;
cases are Phase 8 in PLAN §6 [R1]. PLAN §6 Phase 9 also lists the WCAG 2.2 AA audit, which lands in T14 [R1]. The sibling research notes record the same hand-offs: `phase6-behaviour.md` G7, G12 and X3,
`phase7-behaviour.md` T14 and PL3 [R13].

## Corrections to the repository's records

1. **`persona-surface.md` misses events that Phase 9 needs.** It already lists `deployments`, `deployments/{deployment-id}`,
   `theme-sets` and the `deployment.completed` webhook [R6], but not `inquiry-template-version.created` and
   `inquiry-template-version.published`, which the events page lists without webhook files [D47]. From the Deployment
   Manager's launch (announced for early November 2026) the second no longer means the version is in use [H3].
   OpenVerify's `ID_PREFIXES` has neither `theset` nor `dply`, and no `inquiry-template-translations` type [R34] [O8] [O21]
   [O5].
2. **PLAN §2, Platform row,** says "theme sets, translations"; the public product attaches theme sets to templates (or lets a
   template hold its own theme) and keeps translations inside template versions, imported only into drafts [O2] [O5] [H14]
   [R1]. The row should say so, and add the domain manager (allowed domains for embedding and redirects) and the Deployment
   Manager [D15] [H3].
3. **PLAN §2, Inquiries row,** lists "theming, i18n, a11y" but not the editor's own model (screens, components, branching,
   action and connector steps, modules); PLAN §6 Phase 9 says "screens, steps, branching / dynamic friction, check config",
   which matches [H4] [R1].
4. **PLAN §3, hardening,** says "iframe domain allowlist; `localhost` embedding is allowed in sandbox only". That is the
   public behaviour [D22]; the plan should add that the allowlist must be enforced with a `frame-ancestors` response header
   (not the flow's `<meta>` CSP, which browsers ignore for this directive) [W2] [R24].
5. **The flow condition context** (`flowConditionContext`, `{inquiry: {status}}`) and client-side branch evaluation are
   incompatible with dynamic friction: a client that evaluates a branch can choose the low-friction path. Phase 9 moves
   branch evaluation to the server (F8) [R17] [R18] [R19].
6. **Stale phase number:** `phase-2.plan.md:921` calls cases "Phase 9"; they are Phase 8 [R12] [R1].

## Sources and pins

**Read date.** Every source below was read on **2026-10-29**, between 13:31 and 14:03 UTC, after reading each host's robots
file (RFC 9309), with at least 1.5 s (GitHub) or 2 s (every other host) between requests to one host, no redirect followed
automatically, a User-Agent `OpenVerify-research/1.0 (clean-room documentation reading; no contact)`, and no personal data
sent. Robots files: `docs.withpersona.com` disallows only `/api/fern-docs/`; `help.withpersona.com` disallows only
`/gated/` (with a content-signals preamble that sets no signal); `api.github.com` answered 404 (no restriction);
`raw.githubusercontent.com`, `www.rfc-editor.org`, `www.unicode.org`, `cheatsheetseries.owasp.org` and `openid.net` allow the
paths read. `www.w3.org` has `Disallow: /TR/?`; Python's `robotparser` drops the trailing `?` and so refused `/TR/` pages,
but under RFC 9309 the rule matches only paths beginning with a literal `/TR/?`, so the three `/TR/` pages were fetched after
an RFC 9309 check (`scripts/p9_robots9309.py`). Vendor examples' names, emails and ids are not reproduced except as id
prefixes; this note uses `example.com` and fictional values. Help-centre labels below are ours, not the article titles.

**OpenAPI (O).** Repository `github.com/persona-id/persona-openapi`, licence Apache-2.0 [G1], pinned at commit
**`e924fe7f92ae3a0696d9fd194370afe6cf8faf57`** (HEAD on 2026-10-29, committed 2026-10-29T08:06:59Z, pushed 08:07:03Z) [G2],
root tree `060b41e3a93529c59242f1f172eea0e65f46e870` [G3], directory `2026-09-29/` (tree
`b665d27249a0e1d072e4d1650c9152a0b761b728`, 914 entries, not truncated) [G4]. This is two daily commits after the Phase 7
and 8 pin (`e64dbfb`) [R7]. 73 files were downloaded from `raw.githubusercontent.com` at the commit (72 under `2026-09-29/`
plus the root `LICENSE`); all 73 match the git blob hashes of the trees (`scripts/p9_verify_blobs.py`). Licence verdict: ✅
Apache-2.0 for reading; the spec is used for identifiers only and nothing from it is copied into or shipped with OpenVerify
(CLAUDE.md rule 4) [G1] [R2]. Every `O` link is
`https://github.com/persona-id/persona-openapi/blob/e924fe7f92ae3a0696d9fd194370afe6cf8faf57/2026-09-29/` followed by the
path shown (`{`/`}` written `%7B`/`%7D`).

| Key | What | Path |
|---|---|---|
| O1 | Inquiry template schema | `components/schemas/inquiry-template.yaml`, `components/schemas/inquiry-template-included-objects.yaml` |
| O2 | Inquiry template version schema (theme, locales, deployments, version tag) | `components/schemas/inquiry-template-version.yaml` |
| O3 | Deployment route criteria | `components/schemas/deployment-route-criteria.yaml` |
| O4 | List and retrieve templates; example | `paths/inquiry-templates.yaml`, `paths/inquiry-templates_{inquiry-template-id}.yaml`, `components/examples/inquiry-template.yaml`, `components/examples/inquiry-template-list.yaml` |
| O5 | Template translations (get and import) | `paths/inquiry-templates_{inquiry-template-id}_translations.yaml` |
| O6 | List template versions; example | `paths/inquiry-template-versions.yaml`, `components/examples/inquiry-template-version-list.yaml` |
| O7 | Field schemas and default fields | `components/schemas/field-schema.yaml`, `components/schemas/default-fields.yaml`, `components/schemas/inquiry-fields.yaml` |
| O8 | Theme set schemas | `components/schemas/theme-set.yaml`, `components/schemas/theme-set-styles.yaml`, `components/schemas/theme-set-variant.yaml` |
| O9 | Theme set paths | `paths/theme-sets.yaml`, `paths/theme-sets_{theme-set-id}.yaml` |
| O10 | Create an inquiry (body and meta) | `paths/inquiries.yaml` |
| O11 | Inquiry schema (`fields`, step names) | `components/schemas/inquiry.yaml` |
| O12 | Inquiry sessions and one-time links | `components/schemas/inquiry-session.yaml`, `paths/inquiries_{inquiry-id}_generate-one-time-link.yaml`, `paths/inquiry-sessions_{inquiry-session-id}_generate-one-time-link.yaml`, `components/examples/inquiry-one-time-link.yaml` |
| O13 | User audit logs and the user object | `components/schemas/user-audit-log.yaml`, `components/schemas/user.yaml`, `paths/user-audit-logs.yaml`, `paths/user-audit-logs_{user-audit-log-id}.yaml` |
| O14 | API keys | `components/schemas/api-key{,-shared-attributes,-with-value}.yaml`, `components/requestBodies/{create,update}-api-key-request.yaml`, `paths/api-keys.yaml`, `paths/api-keys_{api-key-id}{,_clone,_expire}.yaml`, `components/examples/{api-key,create-api-key}.yaml` |
| O15 | Webhooks | `components/schemas/webhook{,-with-secret,-request-attributes}.yaml`, `paths/webhooks.yaml`, `paths/webhooks_{webhook-id}{,_archive,_clone,_disable,_enable}.yaml`, `components/examples/{create-webhook,webhook-archived,webhook-enabled,webhook-disabled}.yaml` |
| O16 | Rotate a webhook secret | `paths/webhooks_{webhook-id}_rotate-secret.yaml`, `components/examples/rotate-webhook-secret.yaml` |
| O17 | Webhook events (the delivery log) and search | `components/schemas/webhook-event.yaml`, `paths/webhook-events_search.yaml`, `components/examples/webhook-event-list-search.yaml` |
| O18 | Delivery headers and signature | `components/parameters/persona-webhook-attempts-{left,made}.yaml`, `components/parameters/persona-webhook-first-attempted-at.yaml`, `components/parameters/persona-signature-header.yaml` |
| O19 | Organisation and environment headers; key inflection | `components/headers/persona-{organization,environment}-id.yaml`, `components/parameters/key-inflection-header.yaml`, `components/parameters/pagination-query-params.yaml` |
| O20 | Root document (183 paths; none for analytics, users, roles, organisations or domains) | `openapi.yaml` |
| O21 | Deployments | `components/schemas/deployment.yaml`, `paths/deployments.yaml`, `paths/deployments_{deployment-id}.yaml`, `webhooks/deployment.completed.yaml`, `components/examples/deployment.yaml` |

| Key | GitHub API (`https://api.github.com/repos/persona-id/persona-openapi` + suffix) |
|---|---|
| G1 | (none): `license.spdx_id: Apache-2.0`, default branch `main`, pushed 2026-10-29T08:07:03Z; and `LICENSE` at the commit (Apache License 2.0 text, blob `261eeb9e`) |
| G2 | `/commits?per_page=5`: HEAD `e924fe7`, 2026-10-29T08:06:59Z, root tree `060b41e` |
| G3 | `/git/trees/060b41e3a93529c59242f1f172eea0e65f46e870`: version directories `2020-05-18` … `2026-09-29`, `LICENSE`, `README.md` |
| G4 | `/git/trees/b665d27249a0e1d072e4d1650c9152a0b761b728?recursive=1`: 914 entries, `truncated: false` |

**Developer docs (D).** `docs.withpersona.com`, version 2026-09-29 (the default), read as Markdown (`.md` suffix), found
through `https://docs.withpersona.com/llms.txt` (lists eight versions) and `https://docs.withpersona.com/2026-09-29/llms.txt`
(579 lines) [D46]. Every `D` link is `https://docs.withpersona.com/2026-09-29/` followed by the path shown.

| Key | Path | Key | Path |
|---|---|---|---|
| D1 | `inquiry-templates.md` | D25 | `environments.md` |
| D5 | `inquiry-one-time-links.md` | D26 | `api-keys.md` |
| D6 | `inquiry-sessions.md` | D27 | `api-key-payload-filters.md` |
| D8 | `inquiry-theming.md` | D29 | `webhooks.md` |
| D9 | `languages.md` | D30 | `webhooks-best-practices.md` |
| D10 | `accessibility.md` | D31 | `webhook-event-filters.md` |
| D12 | `hosted-flow-parameters.md` | D32 | `webhook-allowlists.md` |
| D14 | `hosted-flow-redirecting-on-complete.md` | D35 | `webhook-oauth-authentication.md` |
| D15 | `hosted-flow-security.md` | D36 | `webhook-event-simulation.md` |
| D16 | `hosted-flow-subdomains.md` | D37 | `webhook-failure-alerts.md` |
| D18 | `embedded-flow-parameters.md` | D43 | `migrating-android-theming-from-client-to-server.md` |
| D20 | `embedded-flow-client-callbacks.md` | D44 | `embedded-flow-google-tag-manager.md` |
| D22 | `embedded-flow-security.md` | D47 | `events.md` |
| D46 | `llms.txt` (and the root `https://docs.withpersona.com/llms.txt`) | | |

Also downloaded, not cited: `inquiries.md`, `creating-inquiries.md`, `inquiry-fields.md`,
`resuming-inquiries.md`, `hosted-flow.md`, `hosted-flow-fields.md`, `embedded-flow.md`, `embedded-flow-fields.md`,
`embedded-flow-client-methods.md`, `inlined-flow.md`, `inlined-react-flow.md`, `choosing-an-integration-method.md`,
`authentication.md`, `webhook-attribute-blocklists.md`, `webhook-custom-http-headers.md`, `security.md`,
`integration-testing.md`, `verification-checks.md`, `inquiry-signals.md`, `browser-device-support.md`,
`ensuring-user-access-to-inquiries.md`.

**Changelog (C).** All 97 entries listed in `https://docs.withpersona.com/2026-09-29/updates/changelog/llms.txt` were
downloaded and searched for template, theme, translation, deployment, locale, domain, webhook, API key, audit and session
changes. Links are `https://docs.withpersona.com/2026-09-29/updates/changelog/` + date + `.md`.

| Key | Entry | Subject | Key | Entry | Subject |
|---|---|---|---|---|---|
| C1 | `2023/10/16` | `theme-set-id` refused as `theme-id` | C9 | `2026/8/18` | a vendor User-Agent on webhook deliveries |
| C2 | `2025/4/1` | list and retrieve templates; webhook name and description | C10 | `2025/6/23` | audit log `response-status` |
| C3 | `2024/4/29` | fully custom webhook headers; 204 accepted | C11 | `2025/10/20` | audit log `context.inquiry_id` |
| C4 | `2025/4/28` | clone a webhook or an API key | C12 | `2026/8/24` | list template versions |
| C5 | `2023/10/23` | attribute blocklist exceptions | C13 | `2026/1/18` | creation can return a session token or one-time link |
| C6 | `2025/6/30` | file access tokens up to 3 days | C14 | `2023/11/13` | webhooks API; secret rotation |
| C7 | `2026/9/29` | webhook `name` required | C15 | `2025/10/27` | field keys no longer inflected |
| C8 | `2026/1/28` | webhook payloads include no related objects by default |  |  |  |

**Help Center (H).** Article ids under `https://help.withpersona.com/articles/<id>/`, each read as Markdown
(`https://help.withpersona.com/articles/<id>.md`, which the robots file points agents to), found through
`https://help.withpersona.com/llms.txt` (935 article links) [H89]. 119 articles were requested; 118 answered 200 (one id was
mistyped and answered 404, and is not cited). Labels are ours.

| Key | Subject (id) | Key | Subject (id) |
|---|---|---|---|
| H1 | Inquiries and dynamic flow overview (`2BerKqpgNIRG81jX0goCMU`) | H44 | Reverting a version FAQ (`76CYw82fZWU0i6YUeTcUPq`) |
| H2 | Template versions and change management (`2Luxrdu3Cdg6pcecKBJxvs`) | H45 | Adding a fail screen FAQ (`Vz8S4nniRDbKl0yktISuWV`) |
| H3 | Deployment Manager (`3UXQOXp87ySib6VB1DFWCO`) | H46 | Styling FAQ: colours, fonts, dark mode (`1rd7JdmVeDhakxCihYUrVl`) |
| H4 | Template step kinds (`1z8F1l9Q28qNxQFtKoMfY3`) | H47 | Logo FAQ (`7nJQ9Rzu0e8DpTOFH5bDKr`) |
| H5 | The inquiry flow and its building blocks (`6CiQpUM6lROr10QmRXAqrP`) | H48 | Enabled and required checks (`MBqBUj2HlXY34i5SJIRaz`) |
| H6 | Basic and enhanced tiers (`7MxcjmVedDlKwbp42qoGT5`) | H49 | Allowed redirect domains FAQ (`7fhhIrBgdgKWTPyWPvGfBH`) |
| H7 | Simulate (`5NB4eGgy0k8oRs5O5sDOR1`) | H53 | Configuration CLI (`fJLSH8QyeYGVh5ShDDI850`) |
| H8 | Flow editor tour (`3oD3G7MYVMVOvWZWXRvXtR`) | H55 | Managing users and sign-in (`5isJzuUdTmFWiLehSDugUI`) |
| H9 | Configuring a template (`ETA0GIS8K60DSoiFRpA9z`) | H56 | Roles and permissions concepts (`Ge16TE6VaYZGWVNe2b9cx`) |
| H10 | Testing a template (`1az3sGqpcW5Zrne9I7lm49`) | H57 | Inviting a user (`745gNyiVwR8ZWm3qTjLngm`) |
| H11 | Editing screen text (`1xNs6ssGDriSrNPtuo36ET`) | H58 | Reactivating a user (`1FRAN4cyJwwKyvSZ7wWvSR`) |
| H12 | Editing translations, CSV export and import (`1vMFCXQxDsdpZ2YI4eguFd`) | H59 | Deactivating a user (`eaAHaSzMgxBkmP8PcLyZL`) |
| H14 | Theme editor and theme sets (`6SIHupp847yaEuVMucKAff`) | H60 | Audit log explorer (`21FgR56p7qTpp1K5RY3Du8`) |
| H15 | Preview (`4Bc5EGnIOwAiXZaijGISsx`) | H61 | Admin-issued recovery codes (`7y6JQx11FvY09pukiyYXQb`) |
| H16 | Copying a template (`54w7xE0iPuPHDbX9L1ar2C`) | H62 | Creating, editing, deactivating roles (`1tDmKHklmmR6olOhaWAPNI`) |
| H18 | Expiry windows (`5TKUNJRjtKqtwU02Z5Ka1X`) | H63 | Permissions reference (`6IQlWEmAy2E4emOYjzeLD8`) |
| H19 | Branch logic and condition paths (`4eWPpGh3FSofhzSnhWXNWg`) | H65 | Dashboard 2FA (`2FtrbknhJ3rDsMlWaEag8e`) |
| H20 | Removing a verification (`4mLfLGyAYiythYx4iGguo0`) | H66 | Signing in with SSO (`2cCU9mgVMO2mQbKv2JJShg`) |
| H23 | Prefill (`79Y8gi2c0QnOzDax63LfDF`) | H67 | SAML SSO with Okta (`3A0ZoW5ozu1k17n7bOrVuE`) |
| H24 | Inquiry list filters and saved views (`3qMv2kvEWubt0HMmzG1GXD`) | H68 | SCIM with Okta (`SJ40Iy2cK2nuY40JthHqS`) |
| H25 | Capture-method analytics (`3c2XDYIxmf9PjivgeJtx3i`) | H69 | Security monitoring and Posture (`4ZtCpDTb2FkmFTExpfpOr0`) |
| H26 | Inquiry analytics and funnel (`6wdZdwn9m4T8eY7EfqWRmB`) | H70 | July 2023 permissions model (`g8n0BjVSmFAkmvXjbuOGB`) |
| H27 | Dashboard exports (`7Cd77Z8CdwuxCYNTgeZhtK`) | H71 | Switching environments (`1IKpaNpGCG2E8ksAjZQYLx`) |
| H28 | Using signals (`O9RVEgZvOTj2D47FGJJSb`) | H72 | Sandbox and production (`6I2kGhfPvSuUjYq4z6tpmB`) |
| H29 | Action steps (`aBe34oNwaa0YskUd5U5HZ`) | H73 | API log saved views (`4Yoa8Q4baIxToi171LO7Di`) |
| H30 | Branching steps (`6NyDb8wHpzSCVW5fnV3iHi`) | H74 | Webhook event saved views (`50sQo3dkOvVmIA1rG9d7aw`) |
| H31 | Connector steps (`1aLUyDUK4ZGuupSgscqd6P`) | H75 | SQL data explorer (`5R9LyakxS8S5xmVcbkkCWN`) |
| H32 | Screen steps (`2WWzr0d6rEOIlyXjtHSCgC`) | H76 | Data explorer permissions (`ik1yDrIr03tpyMOY2Keh6w`) |
| H33 | Modules (`tdHGWIcHzLEnvUHe05nH1`) | H77 | Data explorer dashboards (`f5f5ac84db324eb6958b15f`) |
| H34 | Screen components reference (`6bdXdAJjp5OE93u7L6AgNT`) | H78 | Cases analytics (`7BOHplbhL1eCKfX45iJgva`) |
| H35 | Button component (`768ADrRjWEBHLaUY7S3JPZ`) | H79 | Email sender domains (`OD3KwUVIk1MvJkHP4EOIqx`) |
| H36 | Component articles: text, container, image, date, text input, country select, phone, address (maps autocomplete), masked text, file upload, stepper, home, device handoff, checkbox, select, multi select, radio, checkbox group, number, text area, URL, footer, spacer, ID type select, country multi select (`2pgIrox8asRX8Go8gd6u4y`, `2lZwkkFcrnXokCilYFSwMZ`, `3cf7luJYDmNMcAtJhkhvQL`, `1TPl6AZw8vK8Zt1ACVfqyG`, `4pbs3ts4wXW8hRRyDlMa9l`, `1m63dKFyhIC03NpraApqZY`, `4XDEOs7SsAvMw8v6fhIGxY`, `4g00EKwkY9HGPv7Dr2KlX9`, `7xmjUKC1mzhy1oFapPzwei`, `LmDReT8NDEDzOkf4ZzzY48`, `KDG0UJzNhJfivlaWdTBkug`, `mKyMzTs4P9aMrlkiTyEoa4`, `r9sOQvL9uRALxnHxKbTsfO`, `5DMsxCdKVryx13GympSIwM`, `1NBBKv7v8c8vb36NPWDN6E`, `6BAJPKfGRdYWiOYSwA7nmw`, `1Psq15wbUj2vxcXZheYE3y`, `4KqyqoaHy8K4esbSispAHw`, `49Jaw49xDJKcRXPLsNksoy`, `5omG1rayVDD7qBGg0Vr1Ag`, `5LI7HUx9b7ehuKv6Qk8DmE`, `SarzwhzbJWO9MuiUD9CJY`, `1AMuBPtHFStzaNQ0s75hgA`, `6pfVRqv2FVw4KeMCndrKQQ`, `YFRYKQpDnDqzBLG8pSyNwX`) | H80 | Notifications overview (`UP6zK0duN7x1defsCI4JP`) |
| H38 | Capture methods (`7JQ78WDWLj5L63qXEu7AqJ`) | H81 | Notification preferences (`1seqfHgltPAwGi5uiCO502`) |
| H39 | Translations and locales (`hoxMwpVc5bnYFbiNDen7R`) | H84 | Case layout editor (`2f3VkwOHqq202m9kjOYyGk`) |
| H40 | Field editor (`5rT2Llik2kUvJTXKapZb8c`) | H86 | Dynamic-flow versus legacy ids (`5eSP157FWXwBSTtOJlNwZe`) |
| H41 | Screen sizes (`GqmoeG6Gg136UxWGk9Eqk`) | H89 | The index `https://help.withpersona.com/llms.txt` |

Seventeen further articles were downloaded but are not cited (hosted and embedded overviews, inquiry links, test inquiries,
screen design, confirmation screens, role editing, display names, connector reordering, module articles, device handoff,
the account layout editor, inquiry review, the legacy theme, link expiry, the glossary and the quick start).

**Standards and guidance (W).** Each read on 2026-10-29 on the issuing body's own site.

| Key | Document | URL |
|---|---|---|
| W1 | WCAG 2.2, W3C Recommendation of 12 December 2024 (success-criterion levels read from the document) | `https://www.w3.org/TR/WCAG22/` |
| W2 | Content Security Policy Level 3, W3C Working Draft of 27 October 2026 (§6.4.2 `frame-ancestors`: ignored in a `<meta>` policy; overrides `X-Frame-Options`) | `https://www.w3.org/TR/CSP3/` |
| W3 | RFC 5646 (BCP 47), Tags for Identifying Languages, September 2009 | `https://www.rfc-editor.org/rfc/rfc5646.txt` |
| W4 | RFC 4647, Matching of Language Tags (§3.4 Lookup) | `https://www.rfc-editor.org/rfc/rfc4647.txt` |
| W5 | Unicode Standard Annex #9, the Bidirectional Algorithm, version 6.3.0 page, revision 52, dated 2026-09-01 | `https://www.unicode.org/reports/tr9/` |
| W6 | OWASP Unvalidated Redirects and Forwards Cheat Sheet (compare the parsed scheme, host and port with an explicit allowlist) | `https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html` |
| W7 | RFC 7644, SCIM Protocol, September 2015 | `https://www.rfc-editor.org/rfc/rfc7644.txt` |
| W8 | CSS Writing Modes Level 4, W3C (HTML authors are advised to set direction with the `dir` attribute and `<bdo>`, since CSS can be off) | `https://www.w3.org/TR/css-writing-modes-4/` |
| W9 | OpenID Connect Core 1.0 | `https://openid.net/specs/openid-connect-core-1_0.html` |

**Repository (R).** Read-only, at `91c83e02` (2026-10-29), with Phase 6 being closed by other agents in the same tree.

| Key | Path |
|---|---|
| R1 | `docs/PLAN.md` §1, §2 (Inquiries and Platform rows), §3 (technology table, hardening), §5, §6 (Phases 8–11) |
| R2 | `CLAUDE.md` rules 4 and 5 |
| R3 | `docs/adr/0003-web-routing.md` |
| R4 | `docs/adr/0002-check-tiers.md` |
| R5 | `docs/adr/0004-mobile-kotlin-multiplatform.md` |
| R6 | `docs/research/persona-surface.md` |
| R7 | `docs/research/phase8-behaviour.md` (format, the `e64dbfb` pin, W2, W34, the revert disagreement) |
| R8 | `docs/plans/phase-8.plan.md` (environment-scoped workflows and promote, C114 condition dialect, C145, decisions 23, 70–72) |
| R9 | `docs/plans/phase-7.plan.md` (`signal-config` C90.6, the `on-signal` rule, C110, decision 33, the CSV writer) |
| R10 | `docs/plans/phase-6.plan.md` (C88, decisions 7 and 25, line 240) |
| R12 | `git grep` of `docs/plans/*.md` for the carried items; `docs/plans/phase-2.plan.md:849`, `:921`; `docs/plans/phase-5.plan.md:1252`; `docs/PROGRESS.md:85` |
| R13 | `docs/research/phase6-behaviour.md` (G7, G12, X3), `docs/research/phase7-behaviour.md` (T14, PL3) |
| R14 | `ls apps packages` (no `sdk-js`, `sdk-react`, `signals`, `workflow-engine`, `demo-web`) |
| R15 | `packages/flow-spec/src/flow.ts` |
| R16 | `packages/contracts/src/inquiry-templates.ts`, `inquiry-template-versions.ts`, `template-settings.ts`, `inquiries.ts` (`fields`) |
| R17 | `apps/flow/src/flow/json-logic.ts`, `apps/flow/src/flow/flow-position.ts`, `packages/contracts/src/flow-api.ts` (`flowConditionContext`) |
| R18 | `android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/flow/FlowNavigator.kt` |
| R19 | `apps/api/src/jobs/inquiry-outcome.ts` (`requiredVerifications`), `apps/api/src/services/inquiry-settlement.ts` |
| R20 | `apps/api/src/routes/server/inquiry-templates.ts`, `inquiry-template-versions.ts` |
| R21 | `apps/dashboard/src/app/**/page.tsx`, `apps/dashboard/src/components/nav-items.ts`, the template version page, `apps/api/src/services/users.ts` (invitations) |
| R22 | `apps/flow/src/main.tsx`, `routes.tsx`, `components/flow-layout.tsx` |
| R23 | `apps/flow/src/i18n/` (`languages.ts`, `create-i18n.ts`, `locales/`) |
| R24 | `apps/flow/src/security/security-meta.ts` |
| R25 | `apps/api/src/config.ts` (`OPENVERIFY_FLOW_CORS_ORIGINS`) |
| R26 | `apps/api/src/routes/server/inquiries.ts` (`generate-one-time-link`, `perform-simulate-actions`), `packages/contracts/src/flow-api.ts` (redeem) |
| R27 | `packages/core/src/permissions.ts` |
| R28 | `packages/contracts/src/api-keys.ts` |
| R29 | `packages/contracts/src/webhooks.ts`, `apps/api/src/webhooks/dispatcher.ts` |
| R30 | `packages/contracts/src/dashboard-api.ts` (settings), `packages/contracts/src/recovery-codes.ts` |
| R31 | `packages/contracts/src/environments.ts`, `apps/api/src/routes/dashboard/environment.ts` |
| R32 | `android/openverify-sdk/src/commonMain/composeResources/` |
| R33 | `packages/contracts/src/user-audit-logs.ts` |
| R34 | `packages/contracts/src/ids.ts`, `packages/contracts/src/event-names.ts` |

**Downloads.** Everything fetched sits under the research downloads (outside git) in `p9-index/`, `p9-gh/`, `p9-openapi/`,
`p9-pages/` (`docs/`, `help/`), `p9-changelog/` and `p9-standards/` (about 6 MB together, well under the 30 MB budget); the fetcher is
`scripts/p9_fetch.py`, the blob checker `scripts/p9_verify_blobs.py`, the reader `scripts/p9_read.py` and the robots matcher
`scripts/p9_robots9309.py`, all run with `python3 -I`. Nothing downloaded was executed.

## 1. Inquiry templates and the flow editor

### 1.1 The objects, their ids and the API surface

- **Ids.** Templates are `itmpl_`, versions `itmplv_`; the legacy `tmpl_` templates are deprecated since 2022-12-31 and
  cannot branch [D1] [H2] [H86]. Environments carry `env_` tokens inside deployment records [O2].
- **Template attributes** in the spec: `name`; `status` (`active`, `inactive`; the vendor warns the set is open);
  `embedded-flow-domain-allowlist` (domains); `hosted-flow-subdomains`; `hosted-flow-redirect-uri-schemes` (an empty list
  means only `http` and `https`); `field-schemas` (typed field definitions); and the relationship
  `latest-published-version` [O1].
- **Field schema types** (the `type` discriminator): `array`, `boolean`, `choices`, `date`, `datetime`, `email-address`,
  `file`, `hash`, `integer`, `json`, `multi-choices`, `number`, `platform-file`, `string`, `relation-schema` [O7]. The
  default inquiry fields include `name-first`, `name-middle`, `name-last`, `birthdate`, `phone-number` and an
  `address-country-code` [O7]; keys inside `fields` are never key-inflected (since 2025-10-27) [O11] [C15].
- **Version attributes:** `name-display`, `description` (what changed), `status` (`published`, `draft`; open), `live`,
  `version-tag` (`name`, `description`, `created-at`), `deployments[]`, `last-updater` (an email), `enabled-locales`
  (BCP 47 tags such as `ar-EG`, `ja`, `fr`, `en-US`), `created-at`, `updated-at`, `published-at`, and a flat `theme` object
  of 88 nullable string properties (corrected in fact-check: "about 100" before) (section 2.2) [O2].
- **Deployments** on a version: one record per environment with `resource-type` (`inquiry-template`, `workflow` or
  `scheduled-run-config`), `template-id`, `environment {token, name}` and `rules[]`. A rule has an optional `criteria` tree
  (`and`, `or`, `!`) whose leaves are `origin` objects, either a request `context` (the example is `mobile`) or a reference to
  a resource version, and a `strategy`: `constant` (one version) or `weighted-random` (version references with integer
  weights 0–100 that sum to 100) [O2] [O3]. The same shape serves workflows, which the Phase 8 note records [R7].
- **The API is read-mostly.** Documented paths: list templates, retrieve a template, list versions (with a required
  `filter[inquiry-template-id]`), and get or import translations; all need a production key, because templates are
  organisation-level and the vendor does not serve them to sandbox keys [O4] [O5] [O6]. The list and retrieve paths arrived
  on 2025-04-01 and the version list on 2026-08-24 [C2] [C12]. There is **no public path to create,
  edit, publish or deploy a template**, even though the permissions page lists `inquiry_template.write` [D26]. The only
  write the spec shows is the translations import [O5].
- **The flow itself is not public.** Neither the version schema nor any path carries the screens, steps, components or
  branch conditions; the vendor's CLI serialises them to YAML in a vendor-hosted Git repository behind a login [O2] [H53].
  The serialisation is **not documented**.
- **On the inquiry:** `previous-step-name` and `next-step-name` name flow steps (examples such as `start`,
  `verification_government_id`, `retry_verification_government_id`) [O11]. Creation takes `inquiry-template-id`,
  `inquiry-template-version-id` or the legacy `template-id`, plus `fields`, `theme-set-id`, `redirect-uri`, `tags`, `note`,
  a beta `initial-step-name`, and `meta` keys `auto-create-account`, `auto-create-account-type-id`,
  `auto-create-account-reference-id`, `auto-create-inquiry-session`, `auto-create-one-time-link`,
  `expiration-after-create-interval-seconds`, `expiration-after-start-interval-seconds`,
  `expiration-after-resume-interval-seconds` and `one-time-link-expiration-seconds` [O10]. There is **no locale attribute**
  on inquiry creation [O10].

### 1.2 Versions: draft, publish, deploy, revert, archive

- **Draft and publish.** Saving a change to a published template creates one draft; the draft can be saved many times,
  even with errors; publishing it creates a locked version. There is at most one draft and, before deployments, one live
  version per template. Embedded verification-template changes are captured in the template's draft [H2] [H8] [H9].
- **Pinning.** Each inquiry stays on the version it was created with for its whole life; creating with an `itmplv_` id pins
  that exact version [D1] [H2] [H3].
- **History.** Every published version is listed; one can be compared with the latest; two older versions can be compared
  only by restoring one as a draft first [H2]. One article says reverting publishes the chosen version [H2]; another describes restoring it and then publishing
  [H44] (the Phase 8 note found the same disagreement for workflows [R7]).
- **The Deployment Manager** (help article dated 2026-10-14; the vendor says it reaches customers in early November 2026)
  splits publishing from going live [H3]:
  - a published version is used only once it is **deployed** to an environment; one deploy can cover several environments;
  - a publish note of at most 255 characters is locked at publish; the version's description starts as the note and stays
    editable;
  - each environment keeps a deployment history (version, who, when); rolling back is deploying an older version again;
  - choosing no deployment removes the version from an environment; creating an inquiry from the template id there then fails
    rather than falling back; new environments start with nothing deployed;
  - deploying needs both edit and publish rights on templates; viewers can read the history;
  - a deploy made by anyone in the organisation while the dialog is open makes the next deploy fail with a stale-state
    message (optimistic concurrency);
  - new API: `GET /api/v1/deployments`, `GET /api/v1/deployments/{id}`, scope `deployment.read`, and the event
    `deployment.completed`, sent once per deploy and delivered to every environment's webhooks;
    `inquiry-template-version.published` no longer means the version is in use, and `live` becomes true when any
    environment uses the version [H3] [O2].
  - the spec already holds the resource: a `deployment` (`dply_`) is one immutable, atomic write of routes, each binding a
    (template, environment) key to a rules list, where an empty list undeploys; `inquiry-template` is the only resource type
    served today (the spec announces workflows and scheduled runs for a later release); the list filters by `environment-id` and `template-id`, and
    `filter[changes-only]` shows only the rows each deployment wrote, as a change history; a route written earlier carries
    a `source-deployment-id` [O21].
- **Archive.** The template status is `active` or `inactive` in the spec [O1]; the embedded client's `inactive_template`
  error (422) is what creation from such a template returns [D20]; the analytics filter groups deactivated templates
  separately [H24]. Copying a template creates an independent draft [H16].

### 1.3 The flow model: screens and steps

- **Dynamic friction** is the vendor's name for flows that ask riskier users for more [H1].
- **Four step kinds** in the key-concepts article: screen steps (one page the user sees), branching steps (conditional
  routes), action steps (a sequence of actions) and connector steps (a jump to any screen of the same flow) [H4] [H31]. The
  flow overview also names **parallel** steps that run several action branches at once [H5]; no other source describes
  them, so their semantics are **not documented**.
- **Action sequences** run between two screens and work like small workflows [H8]: run a verification with a given verification
  template, copy its extractions onto the inquiry fields, update account fields, run custom JavaScript, or make an HTTPS
  request [H4] [H29] [H8]. A button whose transition is an action sequence must name an error screen for when the sequence
  fails [H35]. Their runtime, time limits and failure semantics are **not documented**.
- **Modules** are pre-built groups of screens and steps: one per verification type (AAMVA, government ID with and without
  auto-classification and with video, selfie with and without video, database, an Aadhaar database variant, email, phone,
  document), a document home collection screen, standard success and failed screens, and country select with or without
  branching [H33]. A verification module inserts its intro, country and type selection, capture screens, the verification
  action and a pass/retry/fail branch; the database module has no retry route [H20]. The editor refuses a module where it
  cannot go and says why [H33]. Verification modules appear as one combined-screens step whose screens can be customised
  only partly [H8] [H9].
- **Retries are flow logic, not a setting.** The retry route of a verification's branch compares an internal counter,
  `trigger.flow_state.run_<verification>_attempts`, with a limit (5 by default) and loops back through a connector [H9]
  [H19] [H31].
- **Ending a flow** is done by buttons of type Complete (ends the path successfully) or Cancel (asks for confirmation and
  ends the session), or by a success or failed screen [H35] [H9] [H45].
- **Limits by plan.** On the vendor's entry plan a branching step has at most 3 routes and a template at most 20 steps
  (screens, actions, branches and connectors together); paid tiers lift both caps; using any "enhanced" feature changes how
  the template is billed [H6] [H30] [H32]. OpenVerify has no plans; the caps are irrelevant except as a hint for sane
  defaults.

### 1.4 Screens and components

- **Screens hold components** dragged from a library; each component has a Design tab (properties, appearance, layout,
  typography, and icons for the stepper and home components), a Data tab for form components (field binding, validations,
  address autocomplete, date format and time zone, masked-text prefill, international database form settings) and a Logic
  tab (show, hide, enable or disable, evaluated when the screen loads or when it updates) [H34] [H9].
- **Elements:** Button, Container, Device Handoff Button, Footer, Home, Image, List Container, Spacer, Stepper, Text [H34].
- **Forms:** Address input, Checkbox, Checkbox group, Date, File upload, Masked text, Multi select, Number input, Phone
  number, Radio group, Select, Text area, Text input, URL input [H34].
- **Advanced forms:** Country multi select, Country select, Government ID Type Select, International database inputs, and a
  bank-connection component bound to one vendor's service [H34].
- **Buttons** are of type Action, Cancel, Complete, Link or Submit; Action and Submit need a transition to a screen or an
  action sequence; the transition target cannot be changed once the template is saved [H35]. A field key cannot be renamed
  once saved either [H34].
- **Address autocomplete** is backed by a third-party maps service [H36]; see F18 for why OpenVerify cannot ship that.
- **Validation rules** cover required, custom validation logic, date ranges, restricted characters, strict URL format, file
  type allowlist, file size and upload count [H34]; the language in which custom validation rules are written is **not
  documented**.

### 1.5 Fields and prefill

- **Fields** are typed (array, boolean, date, datetime, email address, file, hash, integer, choices, multiple choices,
  float, string, and relations to a government ID, selfie or document), at most **1,000 per template**, each with a label,
  an immutable key, a default value, a maximum length, optional HTML stripping, a minimum file size, a redaction policy
  (none, or never redact for non-PII fields) and a write policy (none, or write once); the editor lists every reference to a
  field [H40]. Most fields are created by form components or by verifications (extractions) [H9].
- **Prefill** sets initial field values when the inquiry is created (the dashboard's create dialog, the API `fields`, the
  hosted `fields` parameter, the embedded `fields` option); the user can change a prefilled value only where a screen shows
  it, and the initial values are kept for reference; uses include routing on a passed-in risk value, KYB context, skipping
  questions, and the government ID's inquiry-comparison check [H23] [D12] [D18] [O10]. The older `prefill` parameter is
  deprecated [D12].

### 1.6 Branching and dynamic friction: what a branch can read

- **Semantics.** Routes are tried in order; the first whose conditions hold is taken; a route without conditions catches
  everything, so it goes last [H19] [H4].
- **Inputs the docs name:** the inquiry (status, collected fields, timestamps), each earlier verification (status,
  extracted attributes such as name, birthdate, issuing country and ID class, and per-check results), and the linked account
  [H19]. Example paths: `trigger > fields > selected_id_class` (what the user chose) versus
  `trigger > verification_government_id > identification_class` (what was detected), `... > country_code`,
  `... > birthdate`, `trigger > verification_document > document > document_type`, `trigger > status` [H19]. ID classes seen:
  `dl`, `pp`, `ppc`, `id`, `rp`, `pr`, `wp` [H19].
- **Signals and verification reasons** are listed as branch inputs on the paid tier [H30]. The signals article itself says
  the template selects which signals are collected, that signals never pass or fail, and that acting on them belongs in a
  workflow, preferably as a review rather than an automatic decline [H28].
- **Device** as a branch input is **not documented** for flows; device appears as a deployment criterion (`context:
  mobile`) and as an analytics filter [O3] [H26].
- **Workflow results** inside a flow come from action sequences, which work like small workflows [H29]; branching on a separate
  workflow run is **not documented**.
- **The condition picker can show paths that the route never fills**, for example a document type when no document
  verification precedes the branch; such a condition simply never holds, so authors must check the path exists earlier
  [H19]. How conditions are serialised is **not documented** (as for workflows
  [R7]).

### 1.7 Verifications and checks configured per template

- The editor's Verifications panel holds each verification template in the flow: the checks (enabled or disabled, required
  or not), capture methods, allowed countries and ID types, and per-type options [H9] [H48].
- A check must be enabled to be required; every enabled check runs; an attempt passes only when every required check passes;
  results are `passed`, `failed` or `not_applicable` [H48] [H9].
- **Capture methods** decide camera versus upload per device class (desktop web, mobile web, native) for government ID,
  selfie and document verifications [H38]; auto-classification of country and ID type is a per-verification option [H9].

### 1.8 Template settings: expiry, sessions, links, redirect, security

- **Settings panel:** General (name, ids, the supported-language list), reusable personas, device handoff, session
  management, redirect, security (allowed domains for embedding and for redirects, and a switch that blocks inquiry creation
  from the client), signals, and screen sizes [H9] [H28] [H41].
- **Expiry windows:** from creation (24 h), from pending (defaults to the creation window), from resume (24 h), device
  handoff links (1 h) and a session limit (25 sessions, optionally expiring the inquiry); per-inquiry overrides through the
  `meta` keys of 1.1 [H18] [D6] [O10]. Expiring an inquiry expires its sessions and one-time links [H18].
- **Session tokens** are JWTs kept in the browser's session storage; a new browser window loses them [D6] [H18].
- **One-time links** (`.../verify?code=...`) come from the dashboard's Resume action or the API, default to 24 h, and are
  preferred over links that carry an inquiry id and session token, which the vendor advises against [D5] [O12]. Since
  2026-01-18 the creation response can return a session token or a one-time link directly (`auto-create-inquiry-session`,
  `auto-create-one-time-link`) [C13] [O10].
- **Redirect on completion:** `redirect-uri` (per inquiry, per link, or set on the template) receives `inquiry-id`,
  `reference-id`, `status` and **`fields`** as query parameters when the inquiry completes or fails; custom URI schemes (for
  mobile deep links) are allowed; with allowed domains configured, the redirect's domain must match [D14] [D12] [O1].
- **Allowed domains** are set per template or globally in a domain manager, written without a scheme; subdomains must be
  listed separately; with none configured, any page may embed the flow **(inference)** [D15]
  [D22]. Drafts cannot be embedded, and `localhost` embedding works only in sandbox [D22].

### 1.9 Integration modes

- **Hosted:** a vendor URL with query parameters `inquiry-template-id` (or `inquiry-template-version-id`), `environment-id`,
  `reference-id` or `account-id`, `account-type-id`, `fields`, or `inquiry-id` with `session-token` to resume; plus
  `language`, `redirect-uri`, `theme-set-id` (beta) and `style-variant` (`dark` or `light`) [D12]. One custom subdomain per
  organisation [D16].
- **Embedded and inline:** a JavaScript client with the same options in camelCase plus `onLoad`, `onReady`, `onCancel`,
  `onComplete`, `onError`, `onEvent`, `frameAncestors` and `messageTargetOrigin` (for nested iframes), `frameHeight`,
  `frameWidth` (at most 768 px), `iframeTitle`, `parent`, `sandboxAttributes`, `customHost`, `eventsAllowlist` and
  `fieldMappings` [D18]. The vendor states that `onComplete` may never fire and that statuses passed to callbacks are not
  authoritative; business logic belongs on webhooks or the API [D20]. Error codes: `application_error`, `camera_error`,
  `invalid_config`, `unauthenticated`, `inactive_template`, `unknown` [D20].
- **Iframe permissions:** the iframe asks for `camera;microphone`; `allow-same-origin`, `allow-scripts` and `allow-popups`
  cannot be removed; `allow-forms`, `allow-modals` and `allow-top-navigation-by-user-activation` are defaults that can be;
  `allow-popups-to-escape-sandbox` and geolocation are opt-in [D22].
- **Mobile SDKs** render server-managed themes only from their v2 onwards [D8] [D43]; Android is Phase 10's subject.

### 1.10 What the editor itself offers

- **Canvas:** the flow tree shows every path; combined screens, action sequences, branches and connectors are distinct
  nodes; the insert node offers only the step kinds valid at that point; screens can be copied and pasted; undo, redo, zoom,
  a locale switch and preview dimensions sit in the toolbar [H8].
- **Panels:** navigation and search, the theme editor, the component library, fields (bulk editing), verifications and
  settings on the left; the component's Design, Data and Logic tabs on the right [H8] [H34].
- **Errors panel:** drafts save with errors; publishing needs none; each error links to its step or component [H8].
- **Preview and Simulate** (sandbox only; real verifications never run): simple mode toggles pass or fail per
  verification; advanced mode sets each check, edits a preset of fictional extracted data (each type ships a passing and a
  failing preset; custom presets can be saved), edits inquiry fields, and can restart or prefill; a read-only step list jumps
  between steps [H7] [H15] [H10].
- **Elsewhere:** version history and compare, connections (which verification templates and workflows a template uses), a
  deployment manager, copy template, and keyboard shortcuts [H8] [H2] [H3] [H16].

### 1.11 What the public sources leave open

The flow serialisation; the condition and validation expression languages; parallel step semantics; action-sequence
limits and failure handling; whether branch conditions run on the client or the server; how a published flow is
validated (the sources say only that errors block publishing); which device facts a branch can read; and what custom code inside an
action sequence may access [H8] [H5] [H29] [H34].

## 2. Theme sets and translations

### 2.1 Theme sets (the reusable resource)

- **Resource:** `theme-set`, ids `theset_`, attributes `name`, `status` (`active` or `archived`; archived sets stay
  readable but can no longer be edited or assigned), `styles`, `created-at`, `updated-at`, `archived-at` [O8].
- **API:** list (newest first, `filter[status]`), create, retrieve, update (`PATCH`: an omitted attribute is unchanged, but
  `styles`, when sent, replaces the whole stored tree), and archive (`DELETE`). Archiving detaches the set from every
  template that uses it, and those live flows fall back to the default styling; the organisation's default set cannot be
  archived (409). Scopes `theme_set.read` and `theme_set.write` [O9] [D26].
- **`styles` tree:** `settings` (`use-dark-theme`, a boolean, and `preferred-theme-variant`, `light` or `dark`, served when
  the device states no preference), then a `light` variant and an optional `dark` variant with the same shape. A variant
  holds `inquiry` (the flow chrome: navigation bar, modal, hosted page), `components` (a grid of component → variant →
  state → properties, for example a primary button's fill and text colours) and `step-assets` [O8].
- **Typed leaves:** colours `{unit: hex, value}`, sizes `{unit: px, value}`, dimensions `{x, y}`, and corner masks
  `{bitmask}`. The tree is sparse: any missing cell falls back to the vendor's default cascade. Unknown or mistyped cells
  anywhere answer 400 naming each offending path; structurally valid values that cannot be reconciled (for example button
  properties that the primary, secondary and tertiary variants must share but do not) answer 422 [O8] [O9].
- **The accepted cells** are those of the vendor's code-first YAML shape, which is not public; the variant schema leaves
  `inquiry`, `components` and `step-assets` open (`additionalProperties: true`) [O8]. The full cell list is therefore **not
  documented**.

### 2.2 The theme on a template version

- Each version carries a flat `theme` object of 88 nullable strings (corrected in fact-check: "about 100" before) [O2], grouped here by our reading:
  - **colours:** primary, buttons (primary, secondary, secondary fill, disabled fills), fonts (body, small, title, button
    text), error, success, warning, link, divider, inputs (background, border), modal background, progress bar, dropdowns,
    header icon;
  - **typography:** `font-family`, `font-family-title`, `font-url`, body, header and small sizes and line heights,
    `header-font-weight`, `button-font-weight`, `button-text-transform`, `text-align`, link underline;
  - **shape and layout:** `border-radius` (general, input, modal), `border-width` (general, input), `button-position`,
    `button-shadow-strength`, `button-background-image`, `header-margin-bottom`, `page-transition`, `input-style`,
    `vertical-options-style`, `us-state-input-method`;
  - **icons and pictographs:** icon colours and `icon-style`; an image URL and height per illustration (ID front and back,
    passport front and signature, ID type select, selfie centre, left and right, document, camera support, loading) and
    their positions;
  - **branding:** `logo-url`, `logo`, `logo-data`, `logo-filename`, `navbar-logo-display` [O2].
- **How a theme reaches a flow:** a template either links a theme set or holds its own theme; a linked set can be
  detached to customise it for one template, and customised styles can be saved as a new set; an organisation-wide default
  set applies to templates with none [H14] [H46] [H9]. A single inquiry can name a `theme-set-id` at creation, and hosted
  and embedded flows take `theme-set-id` (beta) and `style-variant` [O10] [D12] [D18]. Since 2023-10-16 the API refuses a
  theme set id passed as the legacy `theme-id` [C1].
- **Component overrides:** a screen's component can override the theme (colour, font, alignment); the override affects only
  that component [H4] [H9] [H34].
- **Logos** are placed with an Image component (an uploaded asset or an image read from a field), with alt text and fit
  [H47]. The vendor's own branding badge is shown by default and removed only by contract [H47]; OpenVerify has no such
  badge.
- **Dark mode:** turning it on reveals a second set of styles and a default mode; it follows the device setting; hosted and
  embedded flows can force it with `style-variant` [H46] [D12] [O8].
- **Editing:** the theme editor previews every screen; the language picker in it only changes the preview, since styles
  apply to every language [H14].
- **Mobile:** server-managed themes reach the native SDKs only from their v2 onwards; the Android migration table maps the
  old client-side attributes to theme-editor properties and lists some as not available yet [D8] [D43].

### 2.3 Locales: which ones, and how one is chosen

- **Supported locales:** 46 tags on the developer page, from `ar-EG` to `zh-TW`, including `he` and `ar-EG`, both written
  right to left, and `ur` explicitly in Roman script [D9]. The help centre says "35+" and that more are available on request
  [H39]. The list is **not versioned**: no date or change log accompanies it.
- **Tag format:** BCP 47, a two-letter ISO 639 language optionally with a two-letter ISO 3166 region [D9] [W3].
- **Choice of locale:** the device or browser language by default; the `language` query parameter (hosted) or option
  (embedded and inline) pre-selects one; the user can switch in a footer selector on the first screen [D9] [H39] [D12]
  [D18]. The template's General settings list which locales the selector offers (all by default) and the version stores
  them as `enabled-locales` [H9] [O2]. There is no account-level or inquiry-level stored locale in the API [O10] [O11].
- **Matching rules** (for example whether `es-AR` falls back to `es-MX`) are **not documented**. RFC 4647's "lookup"
  scheme is the standard way to pick one tag from a priority list [W4].

### 2.4 Custom copy per locale

- **Default translations** exist for all default text of every screen [H39].
- **Editing:** per component in a translations dialog, per screen, or for the whole template as a
  CSV export and import; the CSV has one row per translatable string (screens, components, built-in pages and platform
  dialogs), the first columns name the step, the component and the attribute, and one column per enabled locale follows,
  with `en-US` as the source; an import replaces only the cells it fills, so blank cells never delete a translation [H12]
  [H11]. A machine-translation button for all locales exists [H12] [H39]; which engine it uses is **not documented**.
- **API:** `GET /inquiry-templates/{id}/translations` returns the rows of the latest draft, or of the latest published
  version when there is no draft, as `inquiry-template-translations` with `translations[] {step, step-display-name,
  component, attribute-name, locale-values[] {locale, value}}`; `POST` imports rows partially into the draft (creating one
  from the latest published version when none exists) and never publishes [O5].
- **Publishing applies translations:** like any change, edited copy reaches users only after the version is published (and,
  from November 2026, deployed) [H12] [H3].

### 2.5 Right-to-left support

- Arabic and Hebrew are in the locale list [D9]. **Nothing public describes right-to-left behaviour**: mirroring of the
  layout, the direction of progress indicators and back arrows, bidirectional isolation of user input (names, numbers) or
  the rendering of mixed-direction text are **not documented**.
- The standards are clear on the mechanism: direction is set with the HTML `dir` attribute rather than only with CSS, which
  can be switched off [W8], and user-supplied strings inside translated text need bidirectional isolation so that a name in
  one script does not reorder the surrounding sentence (the Unicode Bidirectional Algorithm, UAX #9) [W5].

### 2.6 Accessibility

- The vendor claims to follow WCAG for colour, text size, keyboard navigation and screen readers, and to support the
  built-in readers of its supported platforms plus NVDA and JAWS; no conformance level, audit or statement date is given
  [D10]. Embedded flows take an `iframeTitle` for assistive technology [D18].
- WCAG 2.2 (W3C Recommendation of 12 December 2024) puts the criteria that a themeable flow can break at level AA: text
  contrast at least 4.5:1, non-text contrast at least 3:1, reflow, focus visible and not obscured, target size (minimum),
  dragging movements, accessible authentication (minimum), text spacing, resize text and status messages; language of page
  and of parts, timing adjustable and redundant entry sit at A or AA [W1].

## 3. Analytics

### 3.1 Inquiry analytics

- **Where:** one page with two tabs, Overview and Funnel [H26].
- **Overview filters:** a date range, and optionally templates, tags, country codes, platform integrations and device
  groups; the page computes on demand, not live [H26].
- **Highlights** (definitions in our words) [H26]:
  - created: the number of inquiries created;
  - started rate: the share of created inquiries whose first screen was viewed;
  - interacted rate: the share of started inquiries that went past the first screen (flow-editor templates only);
  - finished rate: the share of started inquiries that reached the end of the flow;
  - success rate: the share of finished inquiries that ended `completed` or `approved`;
  - rejected rate: the share of finished inquiries that ended `failed` or `declined`;
  - time to finish: the median time the user spent from start to finish.
- **Four charts** (created, started, finished, marked for review), each with volume plus overlaid rates (expiration rate;
  needs-review rate; ever-marked-for-review rate; auto-decisioned versus manually decisioned rate; for the review chart, the
  decisioned and approved rates), bucketed by hour, day, week or month to fit the range [H26]. The article says that after a
  start an inquiry must finish or expire, so the two rates add up to 100% [H26]. That holds only once every started
  inquiry has settled **(inference)**.
- **Funnel tab** (flow-editor templates only): choose dates, a template and one of its published versions (to compare
  versions), and a reference point, overall (share of starts) or per step (share of the previous screen). Each node is a
  screen showing how many inquiries viewed it; edge thickness is the volume moving between two screens; a final node opens a
  per-path page with per-screen bars and per-screen lines by day or week [H26]. Drop-off per step is exactly this view.
- **Billing caveat:** the analytics are not the billing source of truth (they count unique inquiries holding a
  verification, for example) [H26] [H78].

### 3.2 Verification and capture-method analytics

- A verification analytics page shows, per type, created, processed (passed, failed or retry) and passed counts, filtered
  by date, verification type and template; it can be filtered and grouped by capture method (auto, manual, upload, combo),
  which is how the vendor suggests judging whether to forbid uploads [H25] [H38].
- **Check failure distribution** (which checks fail how often) is **not documented** as an analytics view; the inquiry list
  can filter by a check's outcome, and exports include check results per verification [H24] [H27].

### 3.3 Case, signal and review analytics

- **Cases analytics:** productivity and resolution tabs; filters for dates, case template, assignee and resolution type;
  totals by status; resolution-time percentiles (50th, 75th, 95th) in hours; assignment distribution per reviewer; and
  availability metrics (time available, busy, online), computed per UTC day and trailing real time by about six hours; a
  separate "case analytics" permission exists [H78] [H63]. Phase 8 handed this view to Phase 9 (K7).
- **Signals:** an inquiry's signals tab offers a distribution view placing one inquiry's value within the population [H28];
  its bins, period and privacy controls are **not documented**. Phase 7 handed signal analytics to Phase 9 (K8).

### 3.4 Saved views, exports and the SQL explorer

- **Saved views:** the inquiry list's default view filters only by creation date; filters add status, template (inactive
  templates grouped apart), tags, whether a reusable profile was used, and a verification check with its status; a view saves
  the filters and the column order under a name; the same feature exists for API logs and webhook events [H24] [H73] [H74].
  Whether a saved view is personal or shared is **not documented**.
- **Exports:** CSV from the accounts, inquiries, cases and reports lists, each gated by its own export permission, bundled
  as `tar.gz` or ZIP; an inquiry export holds one inquiry file plus one file per verification type with check results; the
  vendor warns that exports contain PII and covers all data unless filtered first; exports run asynchronously, notify by
  email, and are collected from an exports page [H27] [H12]. Retention of export files is **not documented**.
- **Data Explorer:** a SQL editor on a hosted warehouse dialect, with saved queries, templated variables (`{{name}}`, typed
  string, integer, number or list of at most 1,000 items), charts and shared dashboards (beta); it queries the selected
  environment; its permissions are per environment (view already allows running new SQL and exporting results; edit allows
  saving); a separate, time-boxed and audited "privileged access" session is needed to read decrypted personal data [H75]
  [H76] [H77].
- **Client-side events** can be forwarded from the embedded client to a tag manager's data layer (`onEvent`, an
  `eventsAllowlist`, events such as `start`, `complete`, `step-transitioning`) [D44] [D20]. This sends flow progress to a
  third-party analytics service, which OpenVerify should not do by default (A5).

### 3.5 What is not documented

How "started", "interacted" and "finished" are measured (which client event marks them; how a resumed inquiry or a device
handoff is counted); whether the funnel follows sessions or inquiries; how sandbox data is treated; the data freshness of
the inquiry and verification pages; a check-failure view; any small-number suppression or privacy threshold on breakdowns;
an analytics API (none exists in the spec) [H26] [H25] [O20].

## 4. Dashboard settings

### 4.1 The organisation and environment model

- **Two kinds of environment:** sandbox (no real verifications, forced pass or fail, no charges, sample data) and
  production (enabled by contract); a switcher sits in the dashboard header [D25] [H72] [H71]. Every response carries
  `Persona-Organization-Id` and `Persona-Environment-Id` headers [O19].
- **Keys are per environment** (`persona_sandbox_...`, `persona_production_...`; a key never works in the other environment)
  [D26]. Webhooks are configured per environment [D29].
- **Organisation-level objects:** inquiry templates (with per-environment deployments from November 2026), workflows and
  user audit logs; the API serves them only to production keys [O4] [O6] [O13] [H3] [R7].
- **Organisation settings** named in the help centre: general information and the organisation slug, billing,
  authentication (SSO, 2FA), email sender domains (custom, with DNS verification, or vendor-hosted subdomains, which also
  receive replies), the domain manager (allowed domains, subdomain) and notifications [H55] [H67] [H79] [D15] [D16] [H80].

### 4.2 Allowed domains and embedding

- Per template (`embedded-flow-domain-allowlist`, `hosted-flow-redirect-uri-schemes`) or organisation-wide in the domain
  manager; entries are bare domains, subdomains listed one by one; the same list governs where the embedded flow may run
  and where a hosted flow may redirect; `localhost` only in sandbox; drafts never embed [O1] [D15] [D22] [H9] [H49].
- How the restriction is enforced (a `frame-ancestors` policy, a referrer check, or both) is **not documented**; the
  security page's title mentions referrer policies [D22]. A `frame-ancestors` policy is the browser-enforced mechanism; it
  must be sent as an HTTP header because a `<meta>` copy is ignored, and it overrides `X-Frame-Options` [W2].
- Redirect allowlists match OWASP's advice to compare the parsed scheme, host and port against an explicit list [W6].

### 4.3 API keys

- **Attributes:** `name`, `note`, `api-version`, `api-key-inflection`, `api-attributes-blocklist` (patterns such as
  `address-*` or JSON pointers), `permissions` (`resource.action`), `ip-address-allowlist` (`*` or addresses),
  `file-access-token-expires-in` (seconds; at most 3 days since 2025-06-30), `last-used-at`, `expires-at`, `created-at`;
  the `value` appears only in the creation response [O14] [C6].
- **Paths:** list, create, retrieve, update, `clone` (copies everything except the value; since 2025-04-28) and `expire`
  (`meta.expires-in-seconds`, at most 30 days ahead) [O14] [C4].
- **Permissions** (49 listed; the vendor calls the list incomplete): `account.read`/`write`, `inquiry.read`/`write`,
  `inquiry_template.read`/`write`, `theme_set.read`/`write`, `user_audit_log.read`, `webhook.read`/`write`,
  `workflow.read`, `workflow.trigger`, and others; `api_key.read`, `api_key.write` and `api_key.scim` are off by default and
  need administrative enablement [D26]. Payload filters (enterprise) restrict which records a key sees, since template-level
  restriction of `inquiry.*` scopes is otherwise impossible [D26] [D27].
- **Rotation** is a procedure, not an endpoint: create a replacement with the same permissions, deploy it, confirm traffic in
  the API logs, expire the old key [D26].
- **Masking:** the dashboard's display of an existing key is **not documented**; the value is returned only once [O14].

### 4.4 Webhooks

- **Attributes:** `status` (`enabled`, `disabled`, `archived`), `url`, `name` (required on create since 2026-09-29),
  `description`, `enabled-events` (names or `*`), `api-version`, `api-key-inflection`, `api-attributes-blocklist` (with
  exceptions since 2023-10-23), `file-access-token-expires-in`, `payload-filter`, `included-allowlist` (new webhooks include
  no related objects since 2026-01-28), `relationship-allowlist`, `custom-http-headers` (fully custom since 2024-04-29)
  [O15] [C7] [C5] [C8] [C3].
- **Paths:** list, create, retrieve, update, archive, enable, disable, clone, rotate secret (the management API and rotation
  since 2023-11-13); webhook events search [O15] [O16] [O17] [C14].
- **Secrets:** rotation keeps the old secret for `meta.expires-in-seconds` (default 0, no overlap); while both are live,
  every delivery is signed once per secret in one `Persona-Signature` header (`t=...,v1=...` sets separated by a space);
  only one expiring secret at a time, and a second call moves its expiry [O16] [D30].
- **Delivery:** success is 200, 201, 202 or 204 within 5 s; up to 7 retries with growing gaps of roughly 3 s, 64 s, 729 s,
  4,096 s, 15,625 s, 46,656 s and 117,649 s (about 51 hours in all); disabling a webhook cancels pending retries; order is
  not guaranteed and duplicates happen [D29] [D30]. Each delivery carries `Persona-Webhook-Attempts-Made`,
  `Persona-Webhook-Attempts-Left` and `Persona-Webhook-First-Attempted-At` headers and, since 2026-08-18, a vendor
  User-Agent; source IP addresses are published per region [O18] [D29] [C9].
- **Delivery log:** `webhook-event` records (`wbhe_`) with `status` (`pending`, `completed`, `failed`, `skipped`),
  `event-name`, `webhook-id`, `event-id`, `result-code`, `attempts-made`, `last-attempted-at`; searched with `and`, `or`,
  `not` over `updated_at`, `status`, `webhook_id`, `event_name`; kept 30 days; the dashboard offers saved views over it
  [O17] [D29] [H74].
- **Also documented:** event simulation (shows the payload and whether it would deliver or skip; sends nothing), failure
  alerts (a threshold of at least 1 failed first attempt within a window of 5 to 1,440 minutes, sent to opted-in team
  members who can see the webhook, in the dashboard or by email), OAuth 2.0 client-credentials tokens on deliveries
  (enterprise; `client_secret_basic` or `client_secret_post`; secrets stored encrypted and never returned), event filters
  and attribute allowlists [D36] [D37] [D35] [D31] [D32].

### 4.5 Team members

- Invite by email with one or more roles; invitations last **14 days** and can be resent; organisations on SSO must provision
  through the identity provider instead [H57].
- Deactivate (the user loses access; a status filter shows deactivated users) and reactivate (a new invitation and a fresh
  account setup, keeping history) [H59] [H58].
- An admin can issue a one-time recovery code to a user who lost their second factor; users can make their own; the codes
  **do not expire** [H61] [H65].
- The spec's `user` resource holds only `email-address`, `name-first` and `name-last`, and appears only as an audit-log
  relationship; there is no users or roles API [O13] [O20].

### 4.6 Roles and permissions

- A role is a set of permissions; a user can hold several roles; roles can be created, edited and deactivated [H62] [H56].
- A permission says what may be done (mostly **View** or **Edit**, sometimes Create or List), to what, where (organisation
  level, or chosen environments, with an option that also covers environments created later) and under which constraint (only
  some templates, or only the cases assigned to the user) [H56] [H70].
- **Organisation-level permissions:** users, roles, teams, organisation information, billing, user sessions, user audit
  logs, security settings, marketplace integrations [H63].
- **Environment-level permissions:** per product (inquiries and templates; verifications and verification templates;
  accounts, types and actions; transactions; reports with re-run, dismiss, pause or resume, and templates; cases with
  templates, actions, assign, bulk assign, bulk resolve, analytics, SAR items and the case list table; workflows and runs;
  graph queries, templates and configuration; lists and items), data (view full SSNs, view ID numbers) and development (API
  keys, API logs, webhook details, webhook events) [H63]. Export permissions per object type exist as well [H27].
- The built-in Admin role always holds every permission and cannot be edited [H70].

### 4.7 Audit logs and monitoring

- **User audit logs** (`ual_`): request `path`, `method`, `get-params` and `post-params` (possibly `[FILTERED]`),
  `ip-address`, `user-agent`, `response-status` (since 2025-06-23), `created-at`, `impersonator-email-address`, and a
  `context` holding `inquiry-id` only for dashboard inquiry creation (since 2025-10-20); relationships `user` and
  `user-session` (`uses_`) [O13] [C10] [C11].
- **Retention and access:** six months, production keys only; the dashboard explorer defaults to 14 days, filters by method,
  response status and user, searches an exact path or IP, and shows 10 to 200 rows a page; much of each entry is redacted;
  bring-your-own-storage delivery is offered [O13] [H60] [H69].
- **Other logs:** API logs are kept two weeks and webhook events 90 days per the monitoring article, against 30 days on the
  webhooks page (a vendor inconsistency) [H69] [D29].
- **Posture:** an admin-only review of dashboard users, sessions, seven-day activity, MFA status and permissions marked
  unused (inferred from successful audit entries) [H69].

### 4.8 SSO and MFA

- **MFA methods:** authenticator app, email codes, SMS codes; admins choose which are allowed; 2FA is required by default
  for new organisations; enforcing it locks out users without a factor; enabling it expires a user's other sessions [H65]
  [H55].
- **SSO:** SAML 2.0 with just-in-time provisioning through Okta, Google Workspace or Microsoft Entra; first sign-in by
  organisation slug; password sign-in stays possible unless SAML is enforced; the service provider URLs follow
  `/saml/<slug>/acs` and `/saml/<slug>/metadata`; attributes `user_email`, `name_first`, `name_last`; a metadata URL (not a
  static file) lets certificate rotation flow through, and expiring certificates trigger reminders [H66] [H67] [H55].
- **SCIM 2.0** for Okta and Entra: a dedicated API key with `api_key.scim`, base path `/scim/v2`, groups mapped to roles,
  create, update and deactivate pushed from the identity provider [H68] [W7].
- OIDC for dashboard sign-in is **not documented** (the OIDC article concerns end-user authentications, a different
  product) [H89].

### 4.9 What is not documented

Key masking in the dashboard; whether allowed domains are enforced by `frame-ancestors`, by referrer, or both; the exact
invitation and recovery-code formats; session lifetime and idle timeout for dashboard users; audit-log entries for reads
versus writes (the schema logs requests, not semantic actions); whether custom roles can be scoped to one environment and
one template at once through the API (no API exists); SSO for more than one identity provider per organisation [O13]
[O20] [H56] [H67].

## 5. OpenVerify today

Read-only, at `91c83e02` (2026-10-29), while other agents close Phase 6 in the same tree [R12]. Phases 7 and 8 are planned and
not built: no `packages/signals`, `packages/workflow-engine`, `packages/sdk-js` or `packages/sdk-react` exists, and no
`apps/demo-web` [R14].

### 5.1 The flow definition (`packages/flow-spec`)

- One zod schema (`flowSchema`, `FLOW_SPEC_VERSION = 1`) with `metadata` (`specVersion`, `id`, `version`, `name`,
  `description`), `steps[]` and `transitions[]`; JSON Schema is generated from it [R15].
- **Fifteen step types**: `consent`, `form`, `government_id`, `selfie`, `document`, `phone_otp`, `email_otp`, `database`,
  `aamva`, `nfc`, `crypto_wallet`, `database_business`, `business_website`, `completion`, `failure` [R15].
- **A step is a whole screen.** There is no screen/component model: each step type has a fixed UI in both clients. Text is
  referenced by dotted i18n keys (`textKeys`, `labelKey`, `messageKey`), never stored as copy [R15].
- **Form fields** (`form` step only): `text` (min/max length, a unicode regex), `date` (min/max), `email`, `phone` (allowed
  countries), `select` (options with label keys), `country` (allowed countries). The template contract still rejects `form`
  steps ("not supported yet") [R15] [R16].
- **Transitions**: `{from, to, condition?}` where `condition` is an opaque JSONLogic object. Steps run in list order; after a
  step, the first transition whose condition is absent or true wins, otherwise the next step in the list; terminal steps
  cannot have outgoing transitions [R15].
- **Where conditions run:** on the client. The web flow (`apps/flow/src/flow/json-logic.ts`) and Android
  (`FlowNavigator.kt`) each evaluate a small JSONLogic subset (`var`, `==`, `!=`, `===`, `!==`, `!`, `!!`, `and`, `or`, `in`)
  over a context that holds only `{ inquiry: { status } }`; an unknown operator throws rather than guessing [R17] [R18].
- **What the server requires:** every verification step in the flow, whatever the branch (`requiredVerifications` maps every
  verification step to a required type), with at most one step per verification type (`checkFlowMatchesConfig`) [R16] [R19].

### 5.2 Templates and versions (API and console)

- `inquiry-template` (`itmpl`): `name`, `status` (`active`/`archived`), `current-version` embedded; list (cursor pages),
  retrieve, create (version 1 published at once), `PATCH` name or status [R16] [R20].
- `inquiry-template-version` (`itmplv`): statuses `draft`, `published`, `superseded`; `flow`, `verification-config`,
  `settings` (`inquiry-expiration-seconds`, `session-expiration-seconds`, `one-time-link-expiration-seconds`,
  `retention-days`), `report-config`; create a draft, list, retrieve, `PATCH` a draft (409 otherwise, 422 when invalid),
  `POST .../publish` (scope `inquiry-templates:publish`); inquiries pin their version [R16] [R20].
- **Verification config** per API type: a complete check map (`enabled`, `required`, optional per-check `config` validated
  by the registry), `allowed-countries`, `allowed-id-classes`, `allowed-chains`, `accept-review-without-provider`; at least
  one enabled and required check per type [R16].
- **Console:** `/templates`, `/templates/[id]`, `/templates/[id]/versions/[versionId]`. A draft is edited as JSON
  (`VersionEditor`), other versions render as JSON blocks; publish asks for confirmation [R21].

### 5.3 The end-user flow (`apps/flow`)

- Vite + React, React Router declarative mode; one hosted page; embedded and inline modes are "later" in the router comment
  (ADR 0003) [R22] [R3].
- **Languages:** `en` and `es`, bundled i18next resources (no network); the language is the first supported base tag of
  `?lang=` then `navigator.languages`, else `en`; `<html lang>` follows it; a language select exists; layout uses logical
  properties so it mirrors under `dir="rtl"`, but no RTL locale ships [R23].
- **Security:** a CSP `<meta>` in production builds (`frame-ancestors` is noted as the serving layer's job, and no layer sets
  it); credentials are taken out of the URL fragment at start-up; the API allows flow origins through
  `OPENVERIFY_FLOW_CORS_ORIGINS` (install-wide) [R24] [R25].
- **No theming**: colours come from the flow's own CSS; there is no theme resource [R22].
- One-time links: `POST /inquiries/:id/generate-one-time-link`, redeemed at `POST /flow/one-time-links/redeem` (rate-limited,
  generic 401) [R26].

### 5.4 The console's settings surface (`apps/dashboard`, `apps/api/src/routes/dashboard`)

- **Pages:** inquiries, accounts, account types, templates, reports, report templates, watchlist sources, webhooks (with
  delivery detail), API keys, API logs, events, users (invitations), roles (custom), audit logs, settings, chip trust store,
  my security (TOTP, WebAuthn, recovery codes) [R21].
- **Permissions:** 28 API scopes and 8 operator permissions; built-in roles `admin`, `developer`, `reviewer`, `viewer`
  (immutable), custom roles through `/dashboard/roles` [R27].
- **API keys:** scopes, `allowed-ips`, `api-version`, `token-prefix` (masked), `expires-at`, `last-used-at`, `pii-masked`;
  create, list, retrieve, update, clone, expire (`expires-in-seconds`) [R28].
- **Webhooks:** statuses `enabled`, `disabled`, `archived`; `enabled-events`, filters by template and account type,
  `api-version`, `custom-headers`, `attribute-blocklist`; clone, rotate secret with `previous-secret-expires-in-seconds`,
  simulate, replay; eight attempts over 24 hours with ±10% jitter; a delivery log [R29].
- **Settings:** organisation `require-mfa`; per-environment retention windows (inquiries, API logs, webhook deliveries,
  events, face templates, reports) and the OTP SMS budget [R30].
- **Environments:** `sandbox` and `production`, switched per session (`environments:production`) [R31].
- **Not present:** analytics of any kind, theme sets, translations, allowed domains for embedding, SSO/SAML/SCIM, saved views,
  exports, notifications [R21].

## What the phase plan should take from this (proposed)

Recommendations for the Phase 9 plan, not decisions; owner questions follow. Library and engineering choices (canvas,
charts, PDF rendering) belong to the sibling engineering note; this list fixes the public contract and its honest limits.
No new runtime dependency is named here, so no licence verdict is needed beyond the OpenAPI repository's (✅ Apache-2.0,
read only).

### Must match (parity)

1. **Template and version contract** (F1, F2, F15, F19, F20): publish notes and editable descriptions; typed template
   fields with immutable keys, PII flags, write-once and a 1,000 cap; capture methods per device class; forms for every
   expiry and session setting.
2. **The flow model** (F6, F9, F11, F12, F13): `flow-spec` v2 with screen steps holding components, ordered branch routes
   with a catch-all, connectors to screens, server action steps from a closed list, modules as editor macros; the component
   catalogue v1 of F12; client-side visibility rules over a screen's own fields; retries bounded by `maxAttempts` and
   readable as `attempts` and `attempts-remaining`.
3. **The editor** (F21, F22, F24, F25): a canvas shared with the Phase 8 workflow editor; an errors panel that lets drafts save
   and blocks publishing; JSON pointers on every error; sandbox-only preview and simulate with per-verification and per-check
   overrides and synthetic presets; version diff of any two versions; restore as draft; copy; "used by".
4. **Themes** (T1, T2, T6–T8, T15): the `theme-set` resource with light and dark variants, an organisation default,
   per-template attachment and per-component overrides, `style-variant`; the resolved tokens in the flow session response.
5. **Locales and copy** (T9–T11): `enabled-locales` and a default locale per version; RFC 4647 lookup; string overrides per
   step, component, attribute and locale; `GET`/`POST` translations in the public shape (draft-only import, partial merge,
   blanks never delete); CSV export and import through the Phase 7 formula-safe CSV code.
6. **Analytics** (A1–A3, A6–A9): the overview metrics, the per-screen funnel by version, verification pass rates by type and
   capture method, case analytics without availability, signal distributions, saved views, and asynchronous exports.
7. **Settings** (S2–S4, S6–S9, S16, S18, S20, S22): per-environment allowed origins narrowed per template; redirect
   allowlist; key rotation helper; webhook failure alerts and attempts headers; delivery-log search; invitation resend and
   reactivation; environment-scoped role grants; my sessions; minimal notifications; the case layout editor, checklists and
   preset comments; the `print` routes.

### Ours, keep and label

1. **Server-side branching** (F8): the server decides the next step after each submission, evaluating the Phase 8 condition
   dialect over F9's typed scope; clients only render; the required verifications are those on the path taken. State what it
   does not cover: client-side visibility rules (F13) remain bypassable by a modified client, so nothing that decides an
   outcome may depend on them; a branch on a beta heuristic inherits that heuristic's error rate.
2. **No code in flows** (F14): flow action steps are a closed list; custom code and HTTPS calls stay in Phase 8 workflows with
   their sandbox and guard; an inquiry-embedded workflow is a bounded wait on a workflow run's output.
3. **No PII in URLs** (F16, F17): prefill only through the API; redirects carry only `inquiry-id` and `status`, with the
   status documented as non-authoritative.
4. **Automated-decline acknowledgement** (F10): publishing a flow in which a failure step is reachable on signals, list
   matches or other non-verification inputs requires the Phase 8 acknowledgement, recorded in the audit log.
5. **Theme safety** (T3–T5): a closed token set; WCAG 2.2 AA contrast enforced on save in both variants; no remote fonts or
   images; no SVG uploads; every theme change audit-logged.
6. **Right-to-left** (T13): `dir` from the locale, bidi isolation of user values, mirrored directional icons, RTL screenshot
   tests; Arabic ships as the RTL proof.
7. **Analytics definitions** (A1, A4, A12, A13): written metric definitions; check failure distribution with tier and stage
   shown; a read-only aggregates API; per-environment only; no third-party event forwarding (A5).
8. **Export safeguards** (A9): per-type export permission, PII columns only with `pii:view`, sealed files, short links,
   expiry, audit.
9. **Embedding enforcement** (S2, S17): `frame-ancestors` sent as a header per request for the flow document; the console
   gets a nonce-based CSP and `frame-ancestors 'none'`. State what it does not cover: an allowed origin that is itself
   compromised can still frame the flow; `frame-ancestors` does not stop a phishing page from linking to the hosted flow.
10. **Audit and MFA posture** (S11, S13, S14): the action-level audit log; TOTP and WebAuthn only; console MFA reset instead
    of never-expiring recovery codes.
11. **Environment-scoped templates with promote** (F3, S1), as Phase 8 did for workflows.

### Build order (proposed slices)

1. **Contracts first:** `flow-spec` v2 (screens, components, branches, connectors, action steps, the typed scope), template
   field schemas, theme sets, translations, locales, deployments-as-history, analytics aggregates, export jobs, new ids
   (`theset`, and ours for exports and saved views), new events (`inquiry-template-version.published` and ours for promote
   and theme changes), new scopes; golden fixtures; RED tests.
2. **Server flow engine:** next-step evaluation, the per-inquiry path record, required verifications from the path, v1
   compatibility; the session API returns the current step and its resolved components, tokens and strings.
3. **Web flow renderer v2:** components, visibility rules, themes, locales with RTL, the minimal `@openverify/js` embed.
4. **Editor:** canvas, screen editor, panels, validation, preview and simulate, diff, copy, structured forms (K14).
5. **Themes and translations:** theme set CRUD, contrast gate, assets, translation API and CSV.
6. **Settings:** allowed origins with `frame-ancestors`, redirect allowlist, role environment grants, key rotation helper,
   webhook failure alerts and headers, invitations, sessions, notifications, console CSP, trust-store flags.
7. **Analytics and exports:** step records and daily aggregates, overview, funnel, verification and case analytics, signal
   distributions, saved views, exports, the aggregates API.
8. **Carried items:** case layout editor, checklists and preset comments (K5), print routes (K12), report sections and run
   notes (K15), verification files include (K17).
9. **Audit and end to end:** the WCAG 2.2 AA audit (T14); full-stack specs for a branching flow (an under-age route, a retry
   route, a signal route to review), an embedded flow refused on a non-allowed origin, an Arabic flow in RTL, a theme failing
   the contrast gate, a CSV translation round trip, and an export with masked PII.

### Nice to have / later

Weighted rollouts of template versions (F4); parallel flow steps (F7); File upload, Home, List Container and Device Handoff
components; dynamic images; address autocomplete adapter (F18); machine translation adapter (T12); per-template role
constraints and finer PII permissions (S9, S10); OAuth client credentials on webhooks; template-restricted API keys;
unused-permission review; SSO and SCIM (S15); teams and availability (S21); the session map (A10); a SQL explorer (A11).

### Open questions (no public answer)

- How the vendor serialises flows, conditions and validation rules; what parallel steps do; action-sequence limits.
- Where branches are evaluated; which device facts a branch can read.
- How "started", "interacted" and "finished" are measured; whether funnels count sessions or inquiries.
- How allowed domains are enforced; whether locale matching falls back across regions.
- What right-to-left support covers.

## Needs the owner

Each item gives the decision, the default we recommend, and why. Phase 9 can proceed on the defaults; record the answers in
the Phase 9 plan and `docs/PROGRESS.md`.

1. **Template scope.** The vendor's templates become organisation-level with per-environment deployments in November 2026
   [H3] [O21].
   - **Default:** keep environment-scoped templates and add a promote action that copies a published version into another
     environment, as Phase 8 decided for workflows [R8]. Reason: templates bind environment-scoped providers, lists and
     reports, and ADR 0002 forbids sandbox providers in production [R4].
2. **Server-side branching.** Today clients evaluate transitions; dynamic friction needs the server to decide [R17] [R19].
   - **Default:** `flow-spec` v2 evaluated on the server; v1 flows unchanged; the Android SDK follows the server's step
     from Phase 10 (until then Android runs v1 flows only and shows the unsupported screen for v2 steps it cannot render); the
     v2 step model goes to `commonMain`, so the iOS release reuses it [R5].
3. **Prefill and redirect payloads.** The vendor accepts prefill in URLs and appends fields to redirect URLs [D12] [D14].
   - **Default:** prefill only through the API; redirects carry `inquiry-id` and `status` only.
4. **Locales and who translates.** PLAN names en, es, fr, de and ar [R1]; machine translation is not allowed as a shipped
   default (T12), and consent and biometric notices carry legal weight.
   - **Default:** ship all five; each locale's strings carry a review status in the docs; a template that enables a locale
     whose consent texts are unreviewed needs a publish-time acknowledgement by the operator **(not legal advice)**.
5. **Theme sets: organisation or environment.** The vendor's sets are organisation-level [O9].
   - **Default:** organisation-level (they hold no PII and no providers); promote keeps the theme set id.
6. **MFA by default.** OpenVerify's `require-mfa` defaults to off; the vendor requires 2FA for new organisations [R30] [H65].
   - **Default:** on for organisations created from Phase 9 (the first admin enrols at first sign-in); existing installs
     unchanged; TOTP and WebAuthn only.
7. **SSO.** SAML with JIT and SCIM are documented; OIDC is not [H67] [H68].
   - **Default:** not in Phase 9; OIDC sign-in in Phase 11 hardening, SAML and SCIM after; the library choice and its licence
     check happen then.
8. **Fonts for server-made PDFs and RTL text.** Phase 8 decision 72 left the font to Phase 9 [R8]. The SIL OFL-1.1, the
   licence of most open font families (inference), is not on rule 4's list [R2].
   - **Default:** no bundled font in Phase 9; the flow uses system font stacks; `print` serves browser print views; ask for a
     rule 4 exception for unmodified OFL-1.1 font files (listed in `THIRD_PARTY_LICENSES.md`) before any server PDF with
     Arabic text.
9. **Teams and availability.** Phase 8 decision 71 deferred them with case analytics [R8].
   - **Default:** case analytics in Phase 9 without availability metrics; teams and availability in the next release.
10. **Analytics storage and retention.** Step records (A2) are per inquiry and so carry inquiry ids.
    - **Default:** raw step records follow the inquiry's retention and redaction; daily aggregates (counts only, per
      environment, template version and step) are kept for 13 months (ours, provisional) and survive redaction because they
      hold no personal data.
11. **The embed client.** PLAN lists `sdk-js` and `sdk-react` but no phase builds them [R1] [R14].
    - **Default:** a minimal `@openverify/js` in Phase 9 (allowed domains are meaningless without it); `sdk-react` later.
12. **Theme changes on live flows.** The vendor applies set edits live [O9].
    - **Default:** live, after the contrast gate, with an audit entry; no per-version theme snapshot.
13. **Correct the records.**
    - **Default:** in the Phase 9 contracts slice, add the events and prefixes of "Corrections" item 1 to `persona-surface.md`
      and the contracts, amend PLAN §2 (Inquiries and Platform rows) and §3 (the `frame-ancestors` header), and fix the stale
      phase number in `phase-2.plan.md:921`.

## Fact-check (2026-10-29)

Independent re-check of the load-bearing facts against their primary sources, read on 2026-10-29 between 14:24 and 15:16 UTC
by a separate agent. Fetcher `scripts/fc/fc_fetch.py` (robots.txt read and matched as RFC 9309 says before any other request
to a host, at least 1.25 s between requests to one host, redirects never followed automatically, User-Agent
`OpenVerify-factcheck/0.1 (licence and documentation review; no contact)`, GitHub API unauthenticated, no personal data
sent); downloads under `downloads/fc-*/`, each batch in its own new directory; Python run with `-I`; nothing downloaded was
executed. The repository was read with `git show 91c83e02:<path>` only. Summary: **24 confirmed, 1 corrected, 0 could not
verify.**

| # | Fact | Verdict | Primary source and what it shows |
|---|---|---|---|
| 1 | OpenAPI pin `e924fe7f…`, 2026-10-29T08:06:59Z, Apache-2.0, tree `b665d272…` (914 entries), 73 files match the blobs | confirmed | `api.github.com/repos/persona-id/persona-openapi` (licence Apache-2.0, pushed 08:07:03Z), `/commits` (HEAD `e924fe7f…`, root tree `060b41e3…`), `/git/trees/b665d272…?recursive=1` (914 entries, 905 blobs, not truncated); `LICENSE` at the commit is the Apache 2.0 text (blob `261eeb9e`). The 35 spec files this check fetched all match the tree's blob hashes, and the note's own 72 + `LICENSE` in `downloads/p9-openapi/` match too |
| 2 | Template API: list, retrieve, list versions (`filter[inquiry-template-id]` required), translations GET/POST, production keys only; no create, edit, publish or deploy | confirmed | `openapi.yaml` path list (no other template path), `paths/inquiry-templates*.yaml` ("You must use a production API key"), `paths/inquiry-template-versions.yaml` (`filter` `required: true`, `inquiry-template-id` required; "not available in Sandbox") |
| 3 | Version theme "about 100 nullable strings", `font-url`, `logo-url`, `enabled-locales`, `version-tag`, `deployments` with constant or weighted-random | **corrected**: the flat `theme` has **88** properties, each typed `[string, null]`; the rest confirmed | `components/schemas/inquiry-template-version.yaml` at the pin: 88 keys under `theme` (88 `string` + 88 `'null'` type entries), including `font-url` and `logo-url`; `enabled-locales` (examples `ar-EG`, `ja`, `fr`, `en-US`); `deployments` rules with `const: constant` and `const: weighted-random`; no flow, step or screen definition. Corrected in place in the Summary (item 7), section 1.1 and section 2.2 |
| 4 | Deployment Manager article dated 2026-10-14, launch early November 2026; publish ≠ live; per-environment deploys, rollback, removal; `dply_`; `GET /api/v1/deployments`; `deployment.read`; `deployment.completed` | confirmed | `help.withpersona.com/articles/3UXQOXp87ySib6VB1DFWCO.md` ("Last updated on October 14, 2026", "goes live in early November 2026", all the listed items; removal is "remove a deployed version from an environment"); `components/schemas/deployment.yaml` example `dply_…` |
| 5 | Branches: routes in order, first match wins, unconditioned route is the catch-all; inputs; retry compares `trigger.flow_state.run_<verification>_attempts` with 5 | confirmed | H19 `4eWPpGh3FSofhzSnhWXNWg.md` (order, first match, catch-all; inquiry data, verification results with extracted attributes and check outcomes, account data); H9 `ETA0GIS8K60DSoiFRpA9z.md` (`… _attempts < 5` by default) |
| 6 | 29 components: 10 elements, 14 form inputs, 5 advanced; Design, Data and Logic tabs; field keys and button transition targets immutable once saved | confirmed | H34 `6bdXdAJjp5OE93u7L6AgNT.md` (tables of 10, 14 and 5; the three tabs; "Once you save a template, you can not edit a key name for a field"); H35 `768ADrRjWEBHLaUY7S3JPZ.md` ("The transition target cannot be changed after the template has been saved") |
| 7 | Template fields: at most 1,000, typed, key, default, max length, HTML stripping, redaction and write-once policies | confirmed | H40 `5rT2Llik2kUvJTXKapZb8c.md` ("a maximum of 1,000 fields", types table, default value, max length, HTML sanitisation, redaction policy, write policy "Write Once") |
| 8 | Theme sets: `theset_`, active/archived; settings + light + optional dark; 400 per bad path, 422 contradictions; PATCH replaces styles; archiving detaches; org default not archivable (409) | confirmed | `components/schemas/theme-set.yaml`, `theme-set-styles.yaml`, `paths/theme-sets_{theme-set-id}.yaml` (all items stated verbatim in substance) |
| 9 | 46 BCP 47 tags incl. `ar-EG` and `he`; device or browser language, `language` parameter or client option, footer selector; no locale on inquiry creation | confirmed | `docs.withpersona.com/2026-09-29/languages.md` (46 list items); `paths/inquiries.yaml` has no `language` or `locale` member |
| 10 | Translations GET reads the latest draft else latest published; POST imports a partial set into the draft (creating one) and never publishes | confirmed | `paths/inquiry-templates_{inquiry-template-id}_translations.yaml` (both descriptions) |
| 11 | Hosted redirect appends `inquiry-id`, `reference-id`, `status`, `fields`; custom schemes allowed | confirmed | `hosted-flow-redirecting-on-complete.md` ("Redirect query parameters" table; "`redirect-uri` supports custom schemes such as mobile intents") |
| 12 | Allowed domains per template or org-wide (`embedded-flow-domain-allowlist`, `hosted-flow-redirect-uri-schemes`); `localhost` sandbox only; drafts not embeddable; mechanism not documented | confirmed | `embedded-flow-security.md` (three listed limitations; no `frame-ancestors`, CSP or `X-Frame-Options` mention), `hosted-flow-security.md`, `components/schemas/inquiry-template.yaml` (both attributes) |
| 13 | CSP Level 3, W3C Working Draft 27 October 2026: `frame-ancestors` ignored in `<meta>`; overrides `X-Frame-Options` | confirmed | `www.w3.org/TR/CSP3/` ("W3C Working Draft, 27 October 2026"; "MUST be ignored when contained in a policy declared via a meta element"; §6.4.2.2) |
| 14 | Webhooks: 200/201/202/204 within 5 s; 7 retries at about 3 … 117,649 s (about 51 h); rotation overlap via `meta.expires-in-seconds` (default 0); one signature set per live secret | confirmed | `webhooks.md` (the list and the delays; they sum to 184,822 s = 51.3 h); `paths/webhooks_{webhook-id}_rotate-secret.yaml` (default `0`, "one `t=…,v1=…` set per active secret") |
| 15 | Failure alerts: threshold ≥ 1, window 5–1,440 min, first attempts only, opted-in members | confirmed | `webhook-failure-alerts.md` |
| 16 | API keys: 49 listed permissions, list not exhaustive, `api_key.read/write/scim` off by default; expiry ≤ 30 days; clone copies all but the value; manual rotation | confirmed | `api-keys.md` (49 table rows; "should not be considered to be exhaustive"; three "Disabled by default"; rotation is a four-step manual procedure); `paths/api-keys_{api-key-id}_expire.yaml` ("max of 30 days"); `_clone.yaml` ("All attributes except the value"). Note: `deployment.read` (fact 4) is named by H3 but is not in this permission list |
| 17 | User audit logs request-level, 6 months, production keys only | confirmed | `paths/user-audit-logs.yaml` ("up to the most recent 6 months", production key); `components/schemas/user-audit-log.yaml` (`path`, `method`, `get-params`, `post-params`, `ip-address`, `user-agent`, `response-status`, `impersonator-email-address`) |
| 18 | Roles: View/Edit, org- or environment-level (optionally all current and new environments), per-template and assigned-to-me constraints, Admin immutable, 14-day invitations | confirmed | H56 `Ge16TE6VaYZGWVNe2b9cx.md` ("Enable all current and new environments for role"; "Cases assigned to that user"); H70 `g8n0BjVSmFAkmvXjbuOGB.md` ("The default Admin role will always have all possible permissions"); H57 `745gNyiVwR8ZWm3qTjLngm.md` ("valid for 14 days") |
| 19 | Analytics: created, started, interacted, finished, success, rejected, median time to finish; per-screen funnel per version, overall or per step | confirmed | H26 `6wdZdwn9m4T8eY7EfqWRmB.md` (the overview metrics; the charts add expiration, needs-review, decisioned and approved rates) |
| 20 | 183 paths; none for analytics, users, roles, organisations or domains | confirmed | `openapi.yaml` at the pin: 183 path keys; only `user-audit-logs` mentions users |
| 21 | WCAG 2.2 Recommendation 12 December 2024; AA 4.5:1, 3:1 non-text, Target Size (Minimum), Dragging Movements | confirmed | `www.w3.org/TR/WCAG22/` (status line; SC 1.4.3, 1.4.11, 2.5.7 and 2.5.8 at Level AA) |
| 22 | RFC 4647 §3.4 Lookup | confirmed | `rfc-editor.org/rfc/rfc4647.txt` §3.4 ("select the single language tag that best matches") |
| 23 | Clients evaluate JSONLogic over `{inquiry:{status}}`; the server requires every verification step, one step per type | confirmed | `packages/contracts/src/flow-api.ts` (`FlowConditionContext`), `apps/api/src/jobs/inquiry-outcome.ts` (`requiredVerifications` maps every verification step), `packages/contracts/src/inquiry-templates.ts` (`only one "<type>" step is supported`) |
| 24 | Flow `en`/`es` (`?lang=` then `navigator.languages`), no theming; CSP `<meta>`; `frame-ancestors` set by nobody for the flow; install-wide CORS origins | confirmed | `apps/flow/src/i18n/languages.ts`, `apps/flow/src/security/security-meta.ts` (its own comment says the header must come from the serving layer), `apps/api/src/config.ts` (`OPENVERIFY_FLOW_CORS_ORIGINS`); the only `frame-ancestors` header in the tree is the console's own `'none'` |
| 25 | Rule 4's list omits SIL OFL-1.1 (inference) | confirmed | `CLAUDE.md` rule 4 list; `openfontlicense.org` official text (fonts may be bundled with software but must stay under the OFL) |
