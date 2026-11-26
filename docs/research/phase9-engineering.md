# Phase 9 research: building the flow builder, themes, translations, analytics and the WCAG 2.2 AA audit (engineering)

Status: complete, 2026-10-29. Every section below was written as it was finished.

## Summary

- **Flow builder.** The flow-spec is a step list with prioritised conditional transitions, not a free graph; reuse Phase 8's `@xyflow/react` editor (outline view first) through a graph adapter, add `layout`, transition ids and copy references additively (the Android SDK ignores unknown keys), report JSON Pointers, and add graph rules (reachability, no cycles). Versioning exists (C11); add `If-Match`/412 (drafts are last-write-wins today), a server diff keyed by ids, and a `migrateFlow` pipeline with client-declared spec versions.
- **Dynamic friction is a correctness problem**: the web evaluator turns an unknown variable into `null`, so a condition over a server-only fact (a signal, a list match) silently takes the wrong branch. Resolve such conditions on the server and make evaluators strict.
- **Preview** without a credential: the console resolves the draft and posts it to a `/preview` entry that has `connect-src 'none'` and `frame-ancestors` set to the console origin; this, the embed allowlist and the hosted page all need a small flow server, because `frame-ancestors` is header-only and `vite preview` is static.
- **Themes**: hex-only palettes (light and dark) over the existing Tailwind tokens, applied with `setProperty` and tested for CSP violations; contrast computed at save with WCAG's own formulas, never rounded (our vectors: 21.000, 4.542, 3.033); fonts are a licence decision (OFL-1.1 is not on rule 4's list); logos raster by default, SVG only sanitised and shown as an image.
- **Translations**: keep i18next 26 and react-i18next 17 with typed catalogs; add `fr`, `de`, `ar`; test plural completeness against `Intl.PluralRules` (Arabic needs six forms, French and Spanish have `many`); normalise Arabic-Indic digits in inputs; logical CSS only; mirror directional icons but never the pose prompts; `en-XA`/`ar-XB` pseudo-locales; operator copy as plain text with declared keys and placeholders, pinned in the template version.
- **Analytics**: measured on the pinned Postgres 17 image with 1 M inquiries and 12 M checks on one CPU, check analytics take 2–4 s on the fly but about 0.1 s from rollups; materialised views recompute the whole history each refresh (10.6–13.6 s); use daily rollups in an environment reporting time zone (16 zones have non-whole-hour offsets), refreshed every 5 minutes by dirty day; suppress counts 1–10 with complementary suppression; visx charts, each with a table.
- **WCAG 2.2 AA**: axe-core finds by its own account about 57% of issues and covers only 2.5.8 of the new criteria, disabled by default; GDS found 29% of barriers missed by every tool. Use `@axe-core/playwright` (MPL-2.0, tooling exception) in the fast mocked specs; pa11y is LGPL and excluded; add own tests for 2.4.11, 2.5.7, 3.2.6, 3.3.7, 3.3.8; run a WCAG-EM manual audit with NVDA, TalkBack and (with an Apple device) VoiceOver.
- **Settings**: the allowlist enforced by `frame-ancestors` plus exact-origin `postMessage`; key rotation over the existing `clone` and `expire`; webhook rotation exists; the console's nonce CSP from `proxy.ts`, report-only first; new permissions over the unchanged role model. **Gap**: no phase owns the web SDK, so no embedded mode exists yet.

## 0. Scope, method and conventions

Prepared 2026-10-29 for OpenVerify Phase 9 ("Dashboard completeness and flow builder", `docs/PLAN.md` §6 [R1]): the inquiry-template flow builder (screens, steps, branching and dynamic friction, check configuration), theme sets and translations (en, es, fr, de and right-to-left Arabic), analytics (funnel, pass rates, check failure distribution), settings (domains allowlist, keys, webhooks, team, roles) and the WCAG 2.2 AA audit. This note is the **engineering** half: how to build those well on the stack the repository already runs (zod 4, Fastify 5, Drizzle on Postgres 17 in `pgvector/pgvector:pg17`, the Vite 8 and React 19.3 flow, the Next.js 16.4 App Router console, Tailwind 4). What Persona's public documentation says each feature does belongs to the behaviour notes; this note takes public identifiers only from the repository's surface index [R6] (`theme-sets`, `inquiry-templates/{inquiry-template-id}/translations`, `inquiry-template-versions`, `api-keys/{api-key-id}/expire`, `webhooks/{webhook-id}/rotate-secret`).

**Conventions.** Everything is in our own words; identifiers (field names, enum values, configuration keys, URL paths, API and library method names) are reproduced only for functional parity. Anything the sources do not state is marked **not documented**; a statement we infer and that no source makes is marked **(inference)**. Every claim carries a citation key defined in section 9, with its URL and the read date (all 2026-10-29). Licence verdicts use repository rule 4 [R2]: ✅ passes, ⚠️ passes with a caveat or needs an owner decision, ❌ fails. Tiers R / H / A are those of ADR 0002 [R3]. Fictional examples only: people are invented, email addresses are at `example.com`, IP addresses are in 192.0.2.0/24 and 2001:db8::/32, ids are made up.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-15**; Gradle follows the same rule by convention. Each package row gives the latest version and the newest one that passes. Phase 9 starts after Phases 7 and 8, so every pin below must be re-taken at its base: a version that fails today may pass by then.

**Method.**
- The repository was read, never changed (no build, test, pnpm or Gradle run), at `main` between `91c83e02` and `5177b275` (other agents were committing Phase 6 work meanwhile): `docs/PLAN.md` §2, §3, §5, §6; `CLAUDE.md`; ADRs 0001–0005; the surface index; the Phase 2, 4, 5, 6, 7 and 8 plans (for hand-offs); `docs/PROGRESS.md`; `THIRD_PARTY_LICENSES.md`; `packages/flow-spec`; `packages/contracts/src/{flow-api,inquiry-templates,inquiry-template-versions,template-settings,api-keys,dashboard-api}.ts`; `packages/core/src/{permissions,enums}.ts`; `packages/db/src/tables/{inquiry-templates,inquiries,verifications}.ts`; `packages/ui/src/styles.css`; `apps/flow` (`vite.config.ts`, `index.html`, `src/security/`, `src/i18n/`, `src/flow/`); `apps/dashboard` (`next.config.ts`, `src/proxy.ts`, `README.md`, `src/app/layout.tsx`); `apps/api/src/routes/server/inquiry-template-versions.ts` and `services/inquiry-templates.ts`; `pnpm-workspace.yaml`, `pnpm-lock.yaml`; `infra/docker-compose.yml`; `.github/workflows/ci.yml`; the Phase 8 editor research `docs/research/phase8-editor-cases.md` [R1]–[R31].
- Package facts come from each registry's metadata document and the LICENSE file at the release commit or tag; documentation from the issuing body's own pages. Every host's `robots.txt` was read before any other request to it and matched with RFC 9309 rules (longest match, `*` and `$`); requests to one host were at least 1.2 s apart; the User-Agent was descriptive with no contact details; no personal data was sent. `registry.npmjs.org/robots.txt` answers the registry document of a package named `robots.txt` (no crawl rules), and `raw.githubusercontent.com/robots.txt` answers 404, so neither restricts these reads. Downloads went into new, empty directories under `downloads/p9e-*/`; scripts are in `scripts/p9e_*.py`; Python ran with `-I`; nothing downloaded was executed. Measurements ([B1]) ran in a throwaway container of the pinned Postgres image, outside the repository, capped at one CPU so the agents building in the same machine were not starved.

## 1. What the code does today

| Area | What exists | What it means for Phase 9 | Source |
|---|---|---|---|
| Flow definition | `@openverify/flow-spec`: a zod `flowSchema` (the JSON Schema in `schema/flow.schema.json` is generated from it) with `metadata` (`specVersion: z.literal(1)`, `id`, `version`, `name`, `description`), `steps` (15 types in a discriminated union: `consent`, `form`, `government_id`, `selfie`, `document`, `phone_otp`, `email_otp`, `database`, `aamva`, `nfc`, `crypto_wallet`, `database_business`, `business_website`, `completion`, `failure`) and `transitions` (`from`, `to`, an optional JSONLogic `condition` kept opaque). Steps run in list order; after a step, the first transition whose condition is absent or true picks the next step, else the next step in the list runs. `superRefine` checks unique step ids, known transition ends and no transition out of a terminal step. `safeParseFlow` reports issues as **dotted paths** (`transitions.2.to`) | The builder edits a list plus edges, not a free graph: the list order is itself an edge ("fall through"). There is no layout member, no theme, no locale list and no text: every visible string is a message key (`i18nKeySchema`). `specVersion` is a literal, so a version 2 needs a migration function (section 3.6). The dotted paths differ from the JSON Pointers the API and the console's `JsonEditor` use | [R7] |
| Conditions | The flow's own JSONLogic evaluator supports `var`, `==`, `!=`, `===`, `!==`, `!`, `!!`, `and`, `or`, `in`, and throws on any other operator; the condition context is only `{ inquiry: { status } }` | Branching and "dynamic friction" need more facts in the context (signals, list matches, a check outcome) and a dialect shared with the Phase 8 engine (its JSONLogic dialect, C114) and the Android `JsonLogic` (ADR 0004) | [R12][R18][R5] |
| Template versions | Contract C11: `draft` → `published` → `superseded`; one published version per template (a partial unique index); a draft is edited with `PATCH` (drafts only, 409 otherwise) and published with `inquiry-templates:publish`; inquiries pin the version current at their creation. Content: `flow`, `verification-config`, `settings`, `report-config` (jsonb columns). Publish runs `checkFlowMatchesConfig` (one step per verification type, configuration for each and only those), `checkFlowPublishable`, `templatePublishProblems` (step order rules) and async publish hooks, each refusal a 422 with JSON Pointers | Versioning, publishing and pinning already exist; the builder is a better editor over the same resource, plus a diff and a migration. The flow's `metadata.version` is a second counter beside `version-number` (inference: the builder should set one from the other at publish) | [R9][R10][R11] |
| Step support | `SUPPORTED_FLOW_STEP_TYPES` excludes `form`; a client that cannot run a step shows an unsupported screen and never skips it | The builder's palette must offer only supported steps and say why `form` is absent | [R9] |
| Web flow | Vite 8, React 19.3, React Router 8 in declarative mode with one server-driven route (ADR 0003); the session token travels in the URL fragment; i18next 26.5.2 and react-i18next 17.1.0 with bundled `en` and `es` catalogs typed against `Messages`; `translateKey` returns `null` for an unknown server key; `fillPlaceholders` fills `{{name}}`; `escapeValue: false` (React escapes); `syncDocumentLanguage` sets `lang` and `dir` from `i18n.dir()`; layouts already use logical utilities (`ps-4`, `text-start`); plurals use `_one` and `_other`; `Intl.NumberFormat`, `DateTimeFormat`, `DisplayNames`, `ListFormat` and `Collator` are used | The i18n foundation is right for adding `fr`, `de` and `ar`: only catalogs, plural completeness, RTL review and operator copy are new | [R12][R4] |
| Flow CSP | A `<meta>` policy injected at build: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' <api>; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`; zod runs `jitless`. The file says `frame-ancestors`, `Permissions-Policy` and `Referrer-Policy` need a serving layer. Compose serves the build with `vite preview`; Phase 7 C107.9 adds `preview.headers` with `frame-ancestors 'none'`, `camera=(self)`, `no-referrer` and `nosniff` ("only the hosted mode exists") | Embedding and an in-console preview both need `frame-ancestors` to name origins, which a `<meta>` cannot carry and a static `vite preview` cannot compute per environment (section 3.4, 8.1) | [R12][R20][R26] |
| Console | Next.js 16.4 App Router as a backend for frontend: server components and server actions only, an httpOnly session cookie, `proxy.ts` (the Next 16 interception convention) for the optimistic session check; headers `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`; **no script CSP** ("needs per-request nonces and is left for a later phase"); English only (`<html lang="en">`, no i18n library); shared components `DataTable`, `Dialog`, `JsonEditor` (errors by JSON Pointer), `FormField`, `ConfirmActionButton`, `OneTimeSecretDialog`; tests with Vitest, Testing Library and a scripted `mockApi`; full-stack Playwright in `e2e/` | The flow builder, theme editor, translation editor and analytics are new console sections that follow the README's page, action and test patterns. The script CSP is due before the builder ships, because the builder renders operator-authored content | [R13] |
| Design tokens | `packages/ui/src/styles.css` defines semantic tokens in a Tailwind 4 `@theme static` block as `oklch()` values (`primary`, `primary-hover`, `on-primary`, `danger`, `danger-hover`, `surface`, `canvas`, `ink`, `ink-muted`, `line`, `control`, `focus`), with their contrast against white noted in a comment; `color-scheme: light`; no dark mode; the system `font-sans` stack, no web font | Themes override these variables; the contrast notes become computed checks; dark mode is new | [R14] |
| Permissions | 28 API scopes and 8 operator permissions (`pii:view`, `users:*`, `roles:*`, `settings:*`, `environments:production`); built-in roles `admin`, `developer`, `reviewer`, `viewer`; custom roles hold a subset, a user's permissions are the union, unknown stored values grant nothing, and a principal can grant only what it holds (Phase 2 C15, Workflow 2D K002); Phases 7 and 8 add `settings:privacy` and the workflow and case scopes | Custom roles exist; Phase 9 adds the new permissions (themes, translations, analytics, domains) and a better role editor, not a new model | [R15][R30][R20][R18] |
| Keys and secrets | API key tokens `ov_sbx_` or `ov_prod_` plus 43 base64url characters, shown once; afterwards only `token-prefix` (prefix plus 4 characters); `clone` (same scopes, IPs, version) and `expire` (now, or up to 30 days) together rotate a key; webhook `rotate-secret` with 0–604,800 s of overlap and two signatures meanwhile | Rotation exists in the API; Phase 9 is the console flow around it (section 8.2) | [R16][R30] |
| Analytics data | `inquiries` keeps `status` and `created_at`, `started_at`, `completed_at`, `failed_at`, `expired_at`, `decisioned_at`, `redacted_at`, with indexes on (environment, created), (environment, status, created) and (environment, template, created); `verification_checks` keeps one row per check (`name`, `status`, `type`, `requirement`, `reasons[]`, `stage`, `confidence`); events are kept 90 days by default; no rollup table, no chart library | A funnel by inquiry milestone can be computed from columns that exist; a per-step funnel needs step-entry facts that are not stored (section 6.1) | [R17][R29] |
| Web SDK | `packages/sdk-js`, `packages/sdk-react` and `apps/demo-web`, which PLAN §3 lists, **do not exist**, and no phase plan owns them; there is no embedded or inline mode and no `postMessage` anywhere | A domains allowlist enforces nothing until an embedded mode exists. Phase 9 either builds the minimal embed (section 8.1) or ships the allowlist for the preview only (owner question 1) | [R1] |
| Dependency age | The flow's `i18next` 26.5.2 and `react-i18next` 17.1.0 were published on 2026-10-17 and added on 2026-10-20 (commit `86fa58f5`), three days old | Not a Phase 9 problem (both pass the rule from 2026-10-31), but the release-age check is evidently not enforced by configuration: `pnpm-workspace.yaml` and `.npmrc` set no `minimumReleaseAge` (inference: pnpm 12's own default applied) | [N1][N2][R25][R27] |

## 2. Carried into this phase

Items earlier plans hand to Phase 9, or leave open, that fall in this note's subject [R18][R20][R21][R22][R23][R30]. "Line" is the line in the file as read on 2026-10-29.

| # | Item | Plan and line | Note |
|---|---|---|---|
| 1 | Inquiry-embedded workflows wait for the flow builder | `phase-8.plan.md:368`, `:791` | A flow step that runs or waits for a workflow (section 3.1) |
| 2 | The canvas simulation overlay (Phase 8 ships API test runs and a console panel) | `phase-8.plan.md:413`, `:791`, decision 23 at `:1039` | Reuses the flow preview's step picker idea on the workflow canvas |
| 3 | Flow-builder branching on workflows | `phase-8.plan.md:791` | The condition context needs workflow outputs (section 3.1) |
| 4 | Flow-editor branching on signals | `phase-7.plan.md:1490` | Dynamic friction: the condition context needs signal tiers (section 3.1) |
| 5 | A server-made PDF and its fonts, with the `print` routes; the browser prints until then and no font ships | `phase-8.plan.md:698`, `:794`, decision 72 at `:1094`; `phase-6.plan.md:240`, `:577` | Shares the font licence decision with themes (section 4.4, owner question 4) |
| 6 | The case layout editor (drag and drop), checklists, the status-switcher rule, preset comments | `phase-8.plan.md:732`, `:792`, decision 70 at `:1092` | Drag and drop needs a single-pointer and keyboard path (2.5.7, 2.1.1), as the builder does |
| 7 | Case-action placements other than the header, and their visibility rules | `phase-8.plan.md:789` | With the layout editor |
| 8 | Teams, availability and availability-driven assignment, case analytics | `phase-8.plan.md:792`, decision 71 at `:1093` | Case analytics shares section 6's rollups and suppression |
| 9 | The console's script CSP (nonces), left since Phase 2; editors are tested under an injected policy | `phase-8.plan.md:88`; `apps/dashboard/next.config.ts` comment; `phase-7.plan.md:1463` (F33) | Due before the builder and the preview iframe (section 8.4) |
| 10 | List exports (CSV through the shared writer) | `phase-7.plan.md:1046`, decision 33 at `:1969` | Analytics exports reuse the same writer and its formula neutralising |
| 11 | Saved views, filterable transaction fields, signal analytics | `phase-7.plan.md:1490` | Signal analytics joins section 6 |
| 12 | The console's session map and filtering inquiries by list match (with saved views) | `phase-7.plan.md:1503` | The map has no permissive tile source without network calls (Phase 7's reason) |
| 13 | Structured forms for report templates and a create-template form (JSON editors until then) | `phase-6.plan.md:559`, `:1023`, decision 25 at `:1283`; `PROGRESS.md:85` | The builder's "check config" panel generalises to `verification-config`, `report-config`, `signal-config` and `list-config` (section 3.2) |
| 14 | The dashboard inquiry document's reports, the run notes on the report resource, `FormDialogButton` options | `phase-6.plan.md:1283`; `PROGRESS.md:85` | Console completeness |
| 15 | Template-version JSON editors for `signal-config` and `list-config` (`VersionEditor`) | `phase-7.plan.md:1455`, `:1767` | Same as 13: a form per config generated from its zod schema |
| 16 | CSV bulk creation and exports, and print (G6, G7, G12) | `phase-6.plan.md:181`, `:577` | Print is item 5; exports are item 10 |
| 17 | The axe-core accessibility check, open since Workflow 5A ("a follow-up for a stage that may add dependencies") | `phase-5.plan.md:1031`; `PROGRESS.md:321`, `:408`, `:459` | Section 7.3: `@axe-core/playwright` under rule 4's tooling exception |
| 18 | WCAG 2.2.1 and the 180 s selfie capture limit: an extend route, or restarts that do not count, plus a warning 20 s ahead, in both clients (owner decision; the web flow has no warning) | `phase-4.plan.md:814`; `PROGRESS.md:569` | The audit must record it as open or fixed (section 7.4) |
| 19 | The flow's response headers (`frame-ancestors 'none'` while only the hosted mode exists) | `PROGRESS.md:1279`; `phase-7.plan.md:1435` (C107.9) | Phase 9's allowlist and preview replace `'none'` with computed origins (section 8.1) |
| 20 | The library's built-in strings go through `ariaLabelConfig` into the console's i18n keys | `phase-8.plan.md:721` (C141.3) | The console has no i18n library today; Phase 8 introduces keys or Phase 9 does (owner question 6) |

Not carried, recorded only: `phase-2.plan.md:921` names "Phase 9 (cases)" as a scope boundary; cases moved to Phase 8, so the line is stale. No Phase 10 or Phase 11 item falls in this subject, but two touch it: Android carries only `en` and `es` strings today (ADR 0004 K5), so the new languages and operator copy must reach the SDK through the flow API (section 5.6), and Phase 11's hardening (ASVS L2, threat model) will review the preview and embed origin checks of section 8.

## 3. The flow builder

### 3.1 What the builder edits, and what it must add

The flow-spec is a **list with exceptions**, not a free graph: steps run in list order, and a transition only overrides "go to the next step" when its condition holds [R7]. A visual editor that pretends otherwise would let an operator draw graphs the format cannot express. The mapping we propose (inference):

| Flow-spec construct | Canvas | Outline view |
|---|---|---|
| A step | A node, named by its type and id, with an error count | A tree item in list order |
| List order | A plain "next" edge from each non-terminal step to the following one, drawn but not deletable except by reordering | "Then: the next step" under each item |
| A transition | A labelled conditional edge, numbered by priority (transitions are evaluated in order, first true wins) | A child group "When …, go to …" per transition, in order, with move up and move down |
| A terminal step (`completion`, `failure`) | A node with no outgoing handle | An item without "Then" |

**What to add to the format, additively.** The Android SDK decodes with `ignoreUnknownKeys = true` and maps any unknown step to `UnsupportedStep`, so optional members added to specVersion 1 do not break SDKs in the field; the web flow parses with strict zod objects but ships with the API, so it is upgraded in the same release [R5][R12] (inference: the API must therefore never serve a member the co-deployed web flow does not know). The members the builder needs:
- `layout`: `{ "<step id>": { x, y } }` at the root, ignored by clients, so version diffs and behaviour hashes can leave it out, as Phase 8 decided for workflows [R19].
- `id` on each transition (`^[a-z][a-z0-9_-]{0,63}$`, unique), so a diff can say which branch changed rather than "transition 2"; generated by the builder, optional for API callers.
- Per-step copy overrides by **key reference**, never by inline text: the flow stays text-free and translations live beside it (section 5.5).

**Branching and dynamic friction.** Today the only condition fact is `inquiry.status`, and a `var` naming a missing path silently evaluates to its fallback (`null`) in the web evaluator [R12]. A condition over a fact the client does not have therefore takes the "false" branch without any error. Dynamic friction is exactly that case: "add a selfie step when the network threat level is high" or "when a list matched" (carried items 3 and 4) depends on server-only facts that the flow API must never send to the end user, because the flow API exposes no fraud details [R8]. Recommendation (inference):
- Split the condition context into **client facts** (today `inquiry.status`; later the step's own retry state) and **server facts** (signal tiers, list-match booleans, a report's `has-match`, a workflow output, a verification's outcome), each typed with zod and published as a JSON Schema for the condition builder.
- A transition whose condition names any server fact is **server-resolved**: the flow session response carries the outcome (`transitions[].resolved: true | false`, or simply the next step id), and clients evaluate only client-fact conditions. Old clients keep working, because the server-resolved transitions can be pre-reduced to unconditional ones in what the server sends (inference).
- Publish refuses (422, JSON Pointer to the transition) a condition that names an unknown variable, an operator outside the dialect shared by the three evaluators (web `json-logic.ts`, Android `JsonLogic`, and Phase 8's engine dialect, C114), or a server fact on a transition whose source step has no server-side completion point to resolve it at.
- The evaluators must treat an unknown variable as an error, never as `null`, for conditions the builder produced (a strict mode; inference). This is the flow-builder form of ADR 0002's rule that nothing passes silently [R3].
- Workflow-embedded steps (carried item 1) are a step type `workflow` (ours) that waits, server side, for a Phase 8 run started from the inquiry and exposes the run's declared outputs as server facts; the client shows a "please wait" screen with a polling interval, as the silent AAMVA step already does (inference from [R12][R22]).

### 3.2 The editor: reuse Phase 8's

Phase 8 C141 already fixes the stack and the patterns: `@xyflow/react` 12.12.0 (MIT) rendered client-only so no server-rendered inline styles meet a nonce `style-src`; an APG tree **outline view built and tested keyboard-only before the canvas**, which is what makes the editor meet 2.1.1, 2.5.7 and 2.5.8; custom memoised nodes with a 3:1 focus ring and 24 px handle hit areas; `isValidConnection` running shared rules; `ariaLabelConfig` for the library's strings; our own bounded undo and redo; the condition builder; problems mapped by JSON Pointer to node badges and an errors panel announced politely; the raw definition always editable in `JsonEditor`; dagre 3.1.1 for "tidy up" on demand; `elkjs` excluded (EPL-2.0 or GPL) [R18][R19]. The flow builder should be a second document type in that editor, not a second editor (inference): the components take a "graph adapter" (node kinds, port rules, the condition context schema, the problem mapper) so the workflow and flow adapters share the outline, canvas, history and badges.

What the flow adapter adds:
- **Palette** from `SUPPORTED_FLOW_STEP_TYPES` (so `form` is absent, with the reason shown), each step's form generated from its zod schema through `z.toJSONSchema`, never hand-written [R9].
- **Check configuration panels** next to each verification step, generated from `verificationConfigSchema` (enabled and required per check, the per-check `config` validated by the check's registry `configSchema`, the type options such as `allowed-countries`), with each check's tier and `beta` stage shown from the registry, so an operator never mistakes a heuristic for an authoritative check (ADR 0002 §3c). The same generator replaces the JSON editors for `report-config`, `signal-config` and `list-config` (carried items 13 and 15) [R9][R20][R21].
- **Port rules**: a terminal step has no outgoing port; a transition may not target its own source; at most one unconditional transition per step and it must be last (anything after it is unreachable); a `nfc` step needs an earlier `selfie`, an `aamva` step with `source: government_id` needs an earlier `government_id` (the existing publish rules, run live) [R9].

### 3.3 Validation shown in place

Three layers already exist and all are pure functions in workspace packages, so the console can run them in the browser on every edit and the API runs the same code at save and publish (the authority) [R7][R9][R10]:

| Layer | Function | Where it runs | Output today | Change needed |
|---|---|---|---|---|
| Shape | `flowSchema` (zod) | console and API | dotted paths (`safeParseFlow`) | emit RFC 6901 JSON Pointers (`/transitions/2/to`) like the rest of the API, so one mapper serves both |
| Template coherence | `checkFlowMatchesConfig`, `checkFlowPublishable`, `templatePublishProblems` | console and API | JSON Pointers | none |
| Server state | the async publish hooks (an unbound provider, the OTP channel guard, the NFC trust store in production, report templates not published) | API only | 422 with pointers | the console calls a dry-run route (`POST /inquiry-template-versions/:id/validate`, ours) on demand and before publish |

New graph rules the builder makes possible, each with a golden fixture (inference): every step reachable from the first; no cycle (the flow format has no loop construct, and a cycle through a verification step would re-enter a verification the server allows only once per type); every path ends at a terminal step or the end of the list; no transition after an unconditional one. **Warnings** (shown, never blocking): a verification step whose required checks are all `beta`; a branch that skips every verification step; a consent step after a capture step.

### 3.4 Previewing a draft in the real renderer

**Recommended design (ours): a credential-free preview document fed by `postMessage`.**
1. The console's page for a draft version embeds `<iframe src="{flow origin}/preview" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer">`. Because the flow origin differs from the console origin, `allow-same-origin` only lets the preview keep its own origin; MDN's warning about combining it with `allow-scripts` applies when the framed document is same-origin with its embedder [D3].
2. A server action (permission `inquiry-templates:read`) asks the API to **resolve** the draft as the flow session would (flow, theme, the translations for the chosen locale, sample guidance values), so the preview shows what a real session would get, not what the console guesses. Unsaved edits are resolved from the posted draft body, not from the database (ours).
3. The console posts `{ type: "openverify:preview", version: 1, document }` with `targetOrigin` set to the flow origin, never `*` [D2]. The preview entry listens only while it is framed, accepts a message only when `event.origin` equals the configured console origin and `event.source === window.parent`, parses the document with the same zod schemas, and renders the chosen step with a fake client that makes **no network call**. It answers `openverify:preview-ready` and `openverify:preview-error` with JSON Pointers, again to the exact console origin.
4. The preview document gets its own policy, stricter than the flow's: `default-src 'none'; script-src 'self'; style-src 'self'; img-src blob: data:; font-src 'self'; connect-src 'none'; frame-ancestors {console origin}; base-uri 'none'; form-action 'none'`, plus `Permissions-Policy: camera=(), microphone=(), geolocation=()`. With `connect-src 'none'` a preview cannot leak what it was given even if a draft contained something hostile (inference). `frame-ancestors` must be a response header: browsers ignore it in a `<meta>` policy, and when present and enforced it overrides `X-Frame-Options` [W12][D1]. The console itself needs `frame-src {flow origin}` once its script CSP lands (carried item 9).
5. Capture steps render their screens with a still placeholder instead of the camera; a step picker and a "simulate outcome" control (passed, failed with a retry hint, needs review) walk the branches; viewport presets at 320, 375 and 768 CSS px exercise 1.4.10 reflow; a locale menu includes the pseudo-locales of section 5.7; a light, dark and auto switch sets `color-scheme` on the iframe element, which the framed document's `prefers-color-scheme` follows [D9].

**Why not a preview token in the iframe URL** (the obvious alternative). A token in the fragment (`#preview-token=…`, as the session token travels today [R4]) works: 128 random bits, stored as SHA-256, bound to one environment, one version and one operator, read-only, 10-minute expiry, revoked on publish. It costs a new credential type, a new flow API route, a save before every preview and a network path from the preview to the API, and buys only that the preview fetches what the server stored. The resolved-document design gets the same fidelity with none of those (inference). Keep the token design for a later **"test in sandbox"** mode that creates a real sandbox inquiry against a draft (so the camera, uploads and checks really run), which needs the API to accept draft-pinned inquiries in sandbox only and to label them; that is a separate decision (owner question 2).

### 3.5 Versioning, publishing and the diff

- **Keep C11.** Draft, published, superseded; one draft at a time per template is the console's convention (the API allows several, inference: the builder should open the newest draft or offer "start from the published version") [R9].
- **Concurrent edits.** `PATCH /inquiry-template-versions/:id` is last-write-wins today; no route reads `If-Match` [R10]. An autosaving builder with two operators would silently drop one's work. Add a strong `ETag` on the version (a hash of the stored content) and require `If-Match` on `PATCH` and `publish`; a mismatch answers **412 Precondition Failed**, which RFC 9110 defines for exactly a precondition that evaluated false [D10]. The console then offers "reload the latest draft" with the server diff of what changed.
- **The diff** (server-computed, `GET /inquiry-template-versions/:id/diff?against={id}`, ours), keyed by step id and transition id, in the shape Phase 8 chose for workflows [R19]: steps added, removed, moved and changed (each change a JSON Pointer with before and after), transitions added, removed and reordered, `verification-config` changes per check, `settings`, `report-config`, the theme version and the translation set; layout-only changes collapsed. It flags in words the changes with consequences: a required check disabled or made optional, a check moved from `ga` to a `beta` one, a verification step removed, a branch that now skips a verification, a consent text changed (which needs fresh consent, section 5.5). Shown as a list (the accessible form) and as canvas badges with an icon and a word, never colour alone (1.4.1).
- **Publishing** keeps the existing 422 refusals and the `inquiry-template-version.published` audit entry [R10]; the confirmation repeats the flagged changes. Inquiries keep their pinned version, so publishing never changes a session in progress.

### 3.6 Migrating older flow definitions

`specVersion` is a zod literal 1 today [R7], and published versions are immutable rows. When a change cannot be additive (a construct whose meaning old clients would misread), recommendation (inference, the usual "upcaster" pattern):
1. `@openverify/flow-spec` exports `FLOW_SPEC_VERSIONS = [1, 2]`, one strict schema per version, and `migrateFlow(input)`: read `metadata.specVersion`, apply the pure step functions v1→v2→… in order, parse the result with the latest schema. Each step function has golden fixtures (every v1 fixture in the repository becomes a migration test case) and is never edited after release.
2. Stored rows are **never rewritten**. The API migrates on read; a draft opened in the builder is migrated and saved in the new version with a notice; published versions stay as published, and the diff compares migrated forms.
3. **Clients declare what they can run.** The Android SDK in a customer's app may be older than the server; it decodes `specVersion` as a plain integer and ignores unknown keys [R5], so it would misread a v2 flow without noticing. The flow API should therefore learn the client's supported versions (a request header such as `OpenVerify-Flow-Spec: 1`, ours, defaulting to 1 when absent), serve the newest version the client supports by **down-converting** when a lossless down-conversion exists, and otherwise answer a problem (`flow_spec_unsupported`, ours) that the client turns into an "update the app" screen. Never serve a version the client did not declare.
4. The JSON Schema export (`schema:export`) keeps one file per version, so third-party tools can validate old documents.

## 4. Themes

### 4.1 Design tokens as CSS custom properties

The console and the flow already share one token set, defined as Tailwind 4 theme variables in `@theme static` so every variable is always emitted [R14][D11]. Tailwind generates ordinary CSS variables for theme variables and its utilities read them through `var()` [D11], so a theme is a set of overrides for those same names (`--color-primary`, `--color-on-primary`, `--color-surface`, `--color-canvas`, `--color-ink`, `--color-ink-muted`, `--color-control`, `--color-focus`, `--color-danger`, plus a radius and a font family token), applied on the flow's root element at start-up. No new class names, no per-theme stylesheet build (inference).

**Applying it under the flow's CSP.** The flow's policy has no `style-src`, so `default-src 'self'` governs styles and inline `<style>` and `style=""` attributes are blocked [R12][W12]. Setting properties through the CSSOM (`document.documentElement.style.setProperty("--color-primary", value)`) is the natural route, but CSP Level 3's current draft lists "insert a CSS rule", "parse a CSS declaration block" and the CSSOM `cssText` setters among algorithms gated on `'unsafe-eval'` for `style-src`, with an open note that this needs better explanation [W12]. Whether `setProperty` of one custom property is gated, and what browsers do, is **not documented** in the sources read. Recommendation: apply each token with `setProperty` (never `cssText`), and pin the behaviour with a Playwright test in Chromium, Firefox and WebKit that fails on any `securitypolicyviolation` event, as the `flow-bundle` spec already does for scripts [R22]. Fallback if a browser blocks it: a same-origin stylesheet built from the theme by the flow server (section 8.1), so no `'unsafe-*'` source is ever added (inference).

### 4.2 A theme schema validated with zod

Public identifier: the `theme-sets` resource [R6]. Its behaviour is the behaviour note's subject; the engineering shape we propose (ours):

```ts
// Illustrative; names ours except `theme-sets`. Strict objects throughout.
const hex = z.string().regex(/^#[0-9a-f]{6}$/);           // sRGB only, lower case
const palette = z.strictObject({
  primary: hex, 'on-primary': hex, surface: hex, canvas: hex, ink: hex,
  'ink-muted': hex, control: hex, focus: hex, danger: hex, 'on-danger': hex,
});
const themeVersion = z.strictObject({
  mode: z.enum(['auto', 'light', 'dark']),                 // auto follows prefers-color-scheme
  light: palette, dark: palette,
  radius: z.int().min(0).max(24),                          // CSS px
  font: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('system') }),
    z.strictObject({ kind: z.literal('uploaded'), 'font-file-id': idSchema('file') }),
  ]),
  logo: z.strictObject({ 'file-id': idSchema('file'), 'alt-key': i18nKeySchema }).nullable(),
});
```

- **Only `#rrggbb`.** No CSS strings, no `url()`, no `var()`, no named colours, no alpha. A value is copied into a custom property, so anything wider would be a style-injection channel (a `url()` in a property that is later used as a background would make a request); with hex only, the injection surface is gone by construction (inference). It also makes the contrast check exact (4.3).
- **Versions, pinned.** A theme set has immutable versions; a template version pins a theme version at publish, as inquiries pin template versions, so a live session never changes appearance halfway (inference from [R9]).
- **Environment scope and permissions.** Themes belong to an environment, like templates; reading needs `inquiry-templates:read`, writing a new `themes:write` (ours), so a reviewer cannot restyle a consent screen.

### 4.3 Contrast checks at save time

Computed in a pure function in `packages/core` (ours) that the console runs live and the API runs at save and publish, from WCAG 2.2's own definitions: relative luminance from 8-bit sRGB with the 0.04045 threshold and the 0.2126 / 0.7152 / 0.0722 weights, and contrast as (L1 + 0.05) / (L2 + 0.05) [W1]. The Understanding documents say the thresholds are exact: the computed value is never rounded, so 4.499:1 fails 4.5:1 and 2.999:1 fails 3:1 [W3][W4]. Our implementation reproduces the published examples: #000000 on #ffffff is 21.000:1, #767676 on white 4.542:1 and #949494 on white 3.033:1 (the grey the 1.4.11 page uses as a passing focus indicator) [B2][W4].

| Pair (each palette, light and dark) | Criterion | Threshold | On failure |
|---|---|---|---|
| `ink` on `surface` and on `canvas`; `ink-muted` on both; `danger` on both | 1.4.3 | 4.5:1 (body text) | refuse publish |
| `on-primary` on `primary`; `on-danger` on `danger` (button text) | 1.4.3 | 4.5:1 | refuse publish |
| `control` on `surface` and on `canvas` (input borders, checkbox outlines) | 1.4.11 | 3:1 against adjacent colours | refuse publish |
| `focus` on `surface`, on `canvas` and on `primary` (a ring may sit on a button) | 1.4.11; 2.4.13 (AAA) informative | 3:1 | refuse publish |
| `primary` on `surface` (links, outline buttons) | 1.4.3 | 4.5:1 | refuse publish |
| any text pair at 7:1 | 1.4.6 (AAA) | 7:1 | warning only |

The table assumes every link is underlined, so 1.4.1 never depends on a link-to-text contrast (inference; the console's links are underlined today [R13]). **What the check does not cover**, and the editor should say so: text over the logo or any image; the logo's own contrast (1.4.11 graphical objects are the operator's); anti-aliasing and thin fonts (the WCAG notes); a user's own colour overrides and forced-colours mode; colours the operator's own embedding page draws around the iframe; copy the operator writes [W1][W3].

**One conversion, in one place.** The built-in tokens are `oklch()` values with contrast figures in a comment. Converting them with the OKLab matrices and clipping to sRGB, we get primary on white 6.83:1, danger 6.42:1, ink-muted 7.56:1, focus 5.25:1, control 4.84:1 and line 1.47:1, against the comment's 6.7, 6.5, 7.6, 5.2, 4.8 and 1.5 [B2][R14]. All still pass, but two figures differ in the first decimal, which shows that two conversions (clip versus gamut-map, or a different hex rounding) give different answers near a threshold. Hence hex-only operator palettes, and a unit test that computes the built-in tokens' pairs through the same function instead of a comment (inference); the OKLCH conversion needs either about twenty lines of our own, as in [B2], or `culori` 4.0.2 (2025-06-27, MIT [L14], no dependencies) as a dev dependency [N32].

### 4.4 Fonts: self-hosted only, and the licence problem

- **Default: the system stack, no font shipped.** That is the console's and the flow's state today; system fonts cover Arabic, Latin and the scripts of real names without a download (inference, as Phase 8 reasoned when it chose the same for printing) [R14][R19].
- **No font CDN.** A font fetched from a third-party host would add an origin to `font-src`, send every end user's IP address to it, and break the flow's same-origin policy (inference from [R12]).
- **Licence.** The widely used multi-script families are under the SIL Open Font License 1.1: Noto Sans Arabic and Inter both carry the OFL at their repositories [L18][L19]. The OFL allows bundling and redistributing the font with any software, forbids selling the font by itself, reserves font names for modified versions, and requires the font itself to stay under the OFL, while documents made with it are not affected [D12]. OFL-1.1 is not on rule 4's list [R2], so **shipping any web font needs an owner decision** (owner question 4); it also decides the server PDF's fonts (carried item 5).
- **Operator-uploaded fonts** (ours): a WOFF2 file (signature `wOF2`), at most 512 KiB, stored like any file and served through the flow API; the operator confirms they hold a licence that allows web embedding (recorded with the theme version); OpenVerify never redistributes it beyond that environment's flows. The flow loads it with `new FontFace(name, arrayBuffer)` from bytes fetched with the session token, since `FontFace` accepts binary data in an `ArrayBuffer` or typed array [D13]; whether a font created from bytes is checked against `font-src` is **not documented** in the sources read, so the same Playwright violation test applies. The family always falls back to the system stack, and the uploaded font should carry a `unicode-range` for the scripts it covers, so Arabic text never renders in a Latin-only font's fallback boxes (inference).

### 4.5 Logos: storage, limits, SVG sanitising

- **Storage**: the existing file storage (envelope-encrypted objects in the S3 API store, a `files` row with SHA-256, MIME type and size) [R17]. A logo is not personal data, but reusing the one storage path keeps one set of retention, rewrap and audit rules (inference).
- **Types and limits** (ours): PNG, JPEG and WebP up to 256 KiB and 2,048 × 2,048 px; SVG up to 64 KiB after sanitising. The type is sniffed from the bytes, as flow uploads already are (`detectImageMimeType`), never taken from the filename or the declared type [R8]. Raster logos are re-encoded through the vision service's rendition path (Phase 8) so EXIF metadata, GPS included, never reaches an end user's browser [R19].
- **SVG.** An SVG is a document that can carry scripts and external references. When SVG is used as an image (`<img>`, CSS backgrounds), MDN says some browsers restrict it and that script being disabled and external resources not loading "may apply" (corrected in fact-check: not a guarantee in every browser) [D4]; the flow shows the logo only that way, from a `blob:` URL it creates from bytes fetched with its session token (the CSP already allows `img-src blob:` for photo previews [R12]), so no new CSP source is needed. Defence in depth, because the same bytes could be opened directly: sanitise at upload with DOMPurify 3.4.17 (`MPL-2.0 OR Apache-2.0`, ✅ through Apache-2.0) with its SVG profile, run server-side on jsdom as its README requires (it warns that old jsdom versions and happy-dom are unsafe) [N19][L13][D14]; then refuse any remaining `<script>`, `<foreignObject>`, event-handler attribute, `href` outside `#fragment`, `<style>` with `@import` or `url(`, and `<image>`; and serve the stored logo with `Content-Type: image/svg+xml`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`. Rasterising SVG at upload would be safer still, but the renderers we know of (librsvg, resvg, CairoSVG) are LGPL or MPL, which rule 4 does not allow at runtime (**not checked** here; inference from their usual licences).
- **Alternative text**: the logo carries an alt-text message key per locale (1.1.1); a purely decorative logo has empty alt text and the organisation's name appears as text.
- **Whether to accept SVG at all** is owner question 5; the recommended default for Phase 9 is raster only, which removes the sanitiser and its DOM dependency from the API's runtime.

### 4.6 Dark mode

- Tailwind's `dark:` variant follows `prefers-color-scheme` by default and can be switched to a selector (`@custom-variant dark (...)`) for a forced mode [D11]. Recommended: the token-override approach of 4.1 (two palettes, swapped by a media query listener or by `mode`), not `dark:` classes sprinkled through components, so one theme value set drives both (inference).
- Set `color-scheme` to `light dark` (or the forced mode) on the root so native controls and scrollbars follow; the shared stylesheet sets `color-scheme: light` today [R14].
- **Embedded flows inherit the embedder's scheme**: for a cross-origin iframe, `prefers-color-scheme` follows the `color-scheme` of the embedding element in the parent page [D9]. An operator who forces light mode must set `mode: light`; the docs must say that an embedding page's own styles can otherwise switch the flow to dark (inference).
- Both palettes pass the 4.3 checks independently; the camera screens (an oval guide over live video) need their own contrast review in both modes, which the token check cannot do.

## 5. Translations

### 5.1 Libraries

Versions from each registry document, licences from the LICENSE file at the release commit (cutoff 2026-10-15).

| Package | Latest (date) | Newest passing (date) | Licence | Fit | Verdict |
|---|---|---|---|---|---|
| `i18next` | 26.5.11 (2026-10-25) | 26.4.6 (2026-10-15) | MIT [L1] ✅ | The flow's library today (26.5.2 locked); plurals follow `Intl.PluralRules` with CLDR suffixes; since v24 there is no fallback when `Intl.PluralRules` is missing [N1][D32] | ✅ **keep for the flow** |
| `react-i18next` | 17.1.9 (2026-10-25) | 17.0.18 (2026-10-15) | MIT [L2] ✅ | The flow's binding today (17.1.0 locked); deps `html-parse-stringify`, `use-sync-external-store`, `@babel/runtime` [N2] | ✅ keep |
| `next-intl` (+ `use-intl`) | 4.14.9 (2026-10-02) | 4.14.9 | MIT [L3] ✅ | The App Router library: a request-scoped config feeds server components [D16]. But 4.14.9's runtime dependencies now include `@swc/core` ~1.16.0 (a `postinstall` script), `@parcel/watcher` (an `install` script that can build from source), the 1.27 MB `next-intl-swc-plugin-extractor`, and three `@eloqnt/*` packages first published in August 2026 with no repository field; `use-intl` pins `intl-messageformat` ^11 while `react-intl` 12 uses 12 [N3][N4] | ⚠️ for the console only, after the owner decides to translate it: two new `allowBuilds` decisions and young, unattributed packages |
| `react-intl` (+ `intl-messageformat`, `@formatjs/icu-messageformat-parser`) | 12.1.6 (2026-10-27); 12.1.4; 3.5.22 | 12.1.4 (2026-10-05); 12.1.3; 3.5.21 | BSD-3-Clause, BSD-3-Clause, MIT ✅ | ICU MessageFormat with `plural`, `select` and rich-text tags; works in client components; major 12 is six weeks old [N5][N6][N7] | ✅ the alternative if ICU syntax is wanted |
| `@lingui/core`, `@lingui/react`, `@lingui/cli` | 6.11.0 (2026-10-29) | 6.9.1 (2026-10-09) | MIT [L4] ✅ | Compile-time extraction through a Babel or SWC macro; the CLI brings Babel, `pseudolocale` and peer `esbuild` ^0.28.1 and `rolldown` [N8][N9][N10] | ⚠️ a build-step change for no gain over the typed catalogs the flow has |
| `messageformat` (MessageFormat 2) / `@messageformat/core` (MessageFormat 1) | 4.1.0 / 3.4.1 (both 2026-10-12) | the same | registry: Apache-2.0 / MIT; the repository's root LICENSE at `439fb0ca` is MIT text, and the MessageFormat 2 package's own LICENSE was not read ✅ either way [L5] | Parsers and formatters only, no React binding [N11][N12] | ✅ only if operator copy ever needs ICU (5.5 says it should not) |
| `i18next-icu` | 2.6.1 (2026-10-17) | 2.5.0 (2026-10-06) | MIT ✅ | ICU syntax inside i18next, peer `intl-messageformat` >=10.3.3 <13 [N13] | not needed |
| `i18next-cli` | 1.80.5 (2026-10-26) | 1.75.3 (2026-10-12) | MIT ✅ | Extraction and linting from the i18next authors; pulls `@swc/core` (postinstall), `inquirer`, `execa` [N14] | ⚠️ dev tooling, optional; the typed catalogs already catch missing keys |
| `i18next-parser` | 9.4.0 (2026-02-22) | 9.4.0 | MIT ✅ | Depends on `i18next` ^23 or ^24 and `typescript` ^5 [N15] | ❌ in practice: behind the workspace's i18next 26 and TypeScript 6 |
| `@formatjs/cli` | 6.16.36 (2026-10-27) | 6.16.34 (2026-10-09) | MIT ✅ | Extraction and compilation for react-intl [N16] | only with react-intl |
| `pseudo-localization` / `pseudolocale` | 3.1.3 (2026-09-24) / 3.1.0 (2026-08-26) | the same | MIT [L16] ✅ / MIT ✅ | String transforms for pseudo-locales [N17][N18] | ✅ dev only; or our own forty lines (5.7) |

**Recommendation.** The flow keeps i18next and react-i18next: the catalogs are TypeScript objects typed against `Messages`, so a missing or misspelt key fails the type check and a locale missing a key fails to compile, which is more than an extraction tool gives [R12]. Add `fr.ts`, `de.ts` and `ar.ts` the same way, plus the per-step catalogs (`steps/*/locales`). No new runtime dependency. The console stays English in this release unless the owner decides otherwise (owner question 6); Phase 8's `ariaLabelConfig` strings (carried item 20) can sit in a typed English catalog with the same shape, so a later translation is a data change.

### 5.2 Pluralisation and gender

- **Plural categories differ by language** and come from CLDR; `Intl.PluralRules` exposes them in the browser [D5]. Arabic uses all six cardinal categories (zero, one, two, few, many, other); French and Spanish use one, many and other, where `many` covers exact millions and compact exponents; German and English use one and other [D21]. In Node 22.22.1 (ICU 78.2, CLDR 48.0), `Intl.PluralRules` reports exactly those sets, and `select(1000000)` is `many` in French and Spanish while `select(0)` is `one` in French [B4].
- **A completeness test per locale** (ours): for every plural message, the catalog of locale L must define each category in `new Intl.PluralRules(L).resolvedOptions().pluralCategories`, except that `fr` and `es` may omit `many` when the message's documented range cannot reach a million (attempts, days, pages), stated beside the key. i18next picks the suffix through `Intl.PluralRules` [D32]; what it shows when the chosen category is missing is **not documented** on the page read, so the test makes the question moot. `_zero` is an i18next extra for a count of 0 in any language [D32].
- **Gender.** i18next offers a `context` option and `_male` / `_female` suffixes [D33]; ICU offers `select`. The flow addresses the user and knows nothing reliable about their gender; inferring it from an ID document for grammar would be processing personal data for a cosmetic purpose (inference). Recommendation: no gendered messages; translators write neutral imperatives (and, in Arabic, the conventional address form the translator chooses, reviewed once), recorded in the catalog's translator notes.

### 5.3 Numbers, dates and digits with `Intl`

- The flow already formats with `Intl.NumberFormat`, `DateTimeFormat`, `ListFormat`, `DisplayNames` and `Collator` [R12]; new code follows that, passing `i18n.resolvedLanguage` and never building date strings by hand.
- **Digits depend on the region, not the language.** With CLDR 48, plain `ar`, `ar-AE`, `ar-MA` and `ar-DZ` format with Latin digits while `ar-EG` and `ar-SA` use Arabic-Indic digits (١٬٢٣٤٬٥٦٧٫٥) [B4]. So the flow must (a) pass the full detected tag (`ar-EG`), not only the base language, to `Intl` (it currently reduces `es-MX` to `es` for the catalog choice [R12]; keep the reduction for catalogs, not for formatting), and (b) **normalise digits typed into code, phone, date and ID fields**: Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic (U+06F0–U+06F9) digits to ASCII before validation, or a user typing on an Arabic keyboard can never enter their one-time code (inference).
- **Time zones.** End-user screens show times in the device's zone (the `Intl` default); the console shows the operator's zone with its name, and analytics show the environment's reporting zone (6.3).
- **Direction from the locale.** `Intl.Locale.prototype.getTextInfo()` is newly Baseline (2026) and Node 22 exposes only the older `textInfo` accessor [D6][B4]; keep i18next's `dir()`, which the flow already uses [R12].

### 5.4 Right-to-left layout

- **`dir` on the root**, not CSS `direction`: the W3C's guidance is to put `dir="rtl"` on the `html` element and let the layout follow [W14]. The flow already mirrors `lang` and `dir` from i18next on every language change [R12].
- **Logical properties everywhere.** CSS logical properties map margins, padding, borders, inset and alignment to the writing direction (`margin-inline-start` and so on) [D7]; Tailwind's `ms-`, `pe-`, `start-`, `text-start` utilities are those, and `rtl:` / `ltr:` variants exist for the rare physical case [D11]. A lint rule (ours) refuses `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right` in `apps/flow` and `packages/ui`.
- **Mirrored icons, chosen one by one** (inference): directional icons (back, next, progress chevrons, "continue" arrows) flip in RTL (`rtl:-scale-x-100`); icons of physical things never flip: the camera, check marks, the document outline, logos, and especially the **selfie pose prompts**, where "turn to your left" means the user's own left in every language, so the arrow must point the same way on screen in Arabic as in English.
- **Bidirectional values.** Interpolated values whose direction differs from the message (an email address, a phone number, a Latin brand name inside Arabic text) must be isolated, with `<bdi>` or `dir="auto"` on the element that holds them; without isolation, neutral characters around them reorder visibly [D8][W15]. Render each placeholder value inside `<bdi>` (inference: the OTP screens' destination masks are the main case).
- **The camera preview** may be mirrored for the user's comfort independently of text direction; uploads stay unmirrored (the Android SDK's `CAPTURE_MIRRORS_IMAGES = false` rule [R1][R5]), and RTL changes neither.

### 5.5 Operator-supplied custom copy: storage and escaping

The public surface has a translations sub-resource on inquiry templates (`inquiry-templates/{inquiry-template-id}/translations`) [R6]; its documented behaviour is the behaviour note's subject. The engineering design we propose (ours):

- **Where it lives.** In the template version, as a member beside `flow` (`copy: { locales: ["en", "es"], default: "en", messages: { "<locale>": { "<key>": "<text>" } } }`), so it is pinned with the version, diffed with it, and immutable once published. A session therefore always shows the copy of the version it pinned, and a consent record (which already names the session, hence the version, plus `text-keys` and `locale` [R8]) identifies the exact words shown without storing them again (inference).
- **Only declared keys are customisable.** A registry in `@openverify/flow-spec` lists each customisable key with its maximum length, its allowed placeholders (a closed list such as `{organization}`, `{days}`), whether it is a consent text, and whether it may contain line breaks. Unknown keys, unknown placeholders, empty strings and over-long strings are 422 with JSON Pointers.
- **Plain text only.** No HTML, no Markdown, no links, no ICU `plural` or `select`. One placeholder syntax, `{name}`, that the web flow and the Kotlin SDK can both fill with a few lines and that stays iOS-ready in `commonMain` (inference: Compose resources use `%1$s`, i18next uses `{{name}}`, so both clients convert at render time). Links (a help page, a privacy notice) are separate, typed `https:` URL fields, rendered as real links with their own text, which also gives 3.2.6 its consistent place.
- **Escaping.** Copy is rendered only as React text nodes (escaped by React; the flow sets i18next's `escapeValue: false` for that reason [R12]) and as Compose `Text` on Android; never through `dangerouslySetInnerHTML` or `Trans` with markup. `white-space: pre-line` keeps line breaks. On save: NFC normalisation; refuse control characters other than line feed; refuse the bidirectional embedding and override controls U+202A–U+202E, which can make text read differently from how it is stored; allow the isolates U+2066–U+2069 (inference).
- **Consent copy is special.** A custom consent text replaces the built-in text in **every** enabled locale or the version cannot be published, because a fallback to the built-in Spanish text under a custom English text would record consent to words the operator did not write (inference). Changing a consent text is flagged by the diff (3.5).
- **Fallbacks for other copy**: the user's locale's custom text, else the built-in message in the user's locale, else the template's default locale's custom text. Never a raw key: `translateKey` already returns `null` rather than echoing a key [R12].
- **Delivery.** The flow session response carries the version's copy for its enabled locales (a few kilobytes), so switching language needs no request and the Android SDK, whose built-in strings are compiled resources, renders the same copy (inference; the SDK ignores unknown members, so this is additive [R5]).

### 5.6 Languages across clients

The web flow will carry `en`, `es`, `fr`, `de` and `ar`; the Android SDK carries `values` and `values-es` in Compose Multiplatform resources [R5]. The flow session should state the template's enabled locales, and each client offers only locales it has built-in catalogs for, so an Android SDK without `fr` falls back to the template's default rather than to an untranslated screen (inference). Phase 10 adds `values-fr`, `values-de` and `values-ar` (with RTL review of the Compose screens) from the same source texts; a shared source format (one JSON per locale exported from the TypeScript catalogs) keeps the two in step (ours).

### 5.7 Pseudo-localisation in tests

Android defines two pseudo-locales with BCP 47 ids that behave like real locales: `en-XA`, which accents the English text, lengthens it with extra unaccented text and brackets every message, and `ar-XB`, which switches the text to right-to-left by reversing the characters of each message [D22]. Use the same two ids on the web (ours), generated from `en` at test time (by `pseudo-localization` 3.1.3 or about forty lines of our own [N17]), never shipped in a production bundle, available in the console preview's locale menu. What they catch: hard-coded strings (unbracketed text), truncation and overlap from longer text at 320 CSS px (1.4.10, 1.4.12), messages built by concatenation (several bracketed pieces in one sentence), and layout that does not mirror. A Playwright pass renders every step in `en-XA` and `ar-XB` at 320 px and fails on horizontal scrolling, clipped text (`scrollWidth > clientWidth` on text containers) and any unbracketed visible text.

## 6. Analytics

### 6.1 What can be computed, and from what

| Metric | Source facts | Status today |
|---|---|---|
| Inquiry funnel by milestone: created, started, consent given, each verification created, submitted, passed or failed, inquiry completed, failed, expired, decided (approved, declined, needs review) | `inquiries` timestamps and status; consent rows; `verifications` per type with status and time [R17] | computable now |
| Funnel by flow **step** (screens) | the step a user is shown is computed by the client from the session (the server does not evaluate transitions) [R12][R31] | **not stored**; a server-observed proxy only (verification created means the step was reached and begun). Client-reported screen views would be unverifiable, so do not add them (inference) |
| Check outcome rates by check, verification type and template version | `verification_checks` (`status`, `type`, `requirement`, `stage`) [R17] | computable now |
| Check failure distribution by reason | `verification_checks.reasons[]` | computable now |
| Report, signal and list-match rates | Phase 6 and 7 tables | after those phases (carried item 11) |

**Honesty in the numbers** (ADR 0002 applied to analytics, ours): a "pass rate" is `passed / (passed + failed)` and is always shown beside the counts of `not_applicable` and `pending`, which are neither; `beta` checks carry the badge on every chart; sandbox and production are never mixed (environments are separate); a template-version filter is offered because a version change moves every rate.

### 6.2 Rollup tables, materialised views or on-the-fly queries

Measured [B1] in the pinned image (`pgvector/pgvector:pg17`, PostgreSQL 17.11) in a throwaway container limited to one CPU and 1 GiB, default `shared_buffers` (128 MB) and `work_mem` (4 MB), JIT off, on synthetic data shaped like the real tables: 1,000,000 inquiries over 365 days in 20 environments (environment 1 holds half), 1,798,000 verifications and 11,984,000 check rows (191 MB, 247 MB and 1,549 MB with indexes), with the repository's `(environment_id, created_at, id)` index on inquiries and an `(environment_id, created_at)` index on checks. Cold means just after loading; warm means a repeated run.

| Approach | Operation | Rows read or written | Time |
|---|---|---|---|
| On the fly | Funnel by local day, environment 1, 90 days (about 123,000 inquiries) | index scan | 571 ms cold, 89–106 ms warm |
| On the fly | The same over 365 days (500,000 inquiries) | index scan | 1.26 s cold |
| On the fly | Same funnel, a small environment (about 6,500 inquiries) | index scan | 6 ms warm |
| On the fly | Check outcomes by name, environment 1, 90 days (its slice of the 12 million checks) | 125,000 pages | 3.6 s cold, 2.1–3.0 s warm |
| On the fly | Failure reasons (unnest), same window | 125,000 pages | 2.7 s cold |
| Rollup (hourly UTC buckets) | Build the inquiry rollup, all environments, a year | 543,801 rows, 67 MB | 9.3 s |
| Rollup | Build the check rollup / reason rollup | 1,711,818 rows, 218 MB / 405,121 rows, 56 MB | 74 s / 21 s |
| Rollup | Funnel from the rollup, environment 1, 90 days / 365 days | 10,781 / 43,781 rows | 182 / 218 ms cold; 35 ms warm (90 days) |
| Rollup | Check outcomes from the rollup, 90 days | 28,037 rows | 147 ms cold, 119 ms warm |
| Rollup, incremental | Recompute the last 48 hours of inquiry buckets / check buckets for every environment (delete and insert in one transaction) | 2,981 / 9,437 rows | 2.7 s / 2.3 s (corrected in fact-check: the inquiry figure was the `COMMIT` alone, 1.7 s; the transaction took 0.2 + 0.8 + 1.7 s) |
| Materialised view | Create the inquiry view and its unique index | 543,801 rows | 4.8 s + 1.4 s |
| Materialised view | `REFRESH` / `REFRESH ... CONCURRENTLY` (the whole year every time) | all | 10.6 s / 13.6 s |

Reading the table (inference, beyond the measured figures): inquiry funnels are cheap enough on the fly for small environments and short windows, but check analytics are not (seconds per request on one CPU at 12 million rows, growing linearly); a materialised view recomputes everything on each refresh, needs a unique index for `CONCURRENTLY` and allows one refresh at a time [D17][D18], so its cost grows with history while the rollup's incremental cost grows only with recent activity. **Recommendation: rollup tables refreshed by a job.**
- Tables (ours): `analytics_inquiry_daily (environment_id, inquiry_template_id, inquiry_template_version_id, day, created, started, consented, completed, failed, expired, approved, declined, needs_review)`, `analytics_verification_daily (… type, created, submitted, passed, failed, needs_review)`, `analytics_check_daily (… check name, status, count)` and `analytics_check_reason_daily (… check name, reason, count)`; counts only, no ids, no values, no PII.
- **Cohort by creation day**: an inquiry counts on the day it was created, so its later decision updates an old day. The job therefore recomputes whole days that are **dirty**: the local days of inquiries (and their checks) updated since the last watermark, found through an `updated_at` index, each day recomputed with a delete and insert in one transaction, so a rerun is harmless. The watermark lags commit time by a safety margin, because timestamps and ULIDs are not commit-ordered (the Phase 8 engine note's point) [R18].
- A repeatable BullMQ job (the existing scheduler pattern) every 5 minutes; a "today" view reads the base tables for the current day only, which the index keeps in milliseconds.
- Rollups survive inquiry redaction (they hold no personal data, 6.4 keeps them non-identifying), are deleted with their environment, and have a retention of their own (ours: 25 months).

### 6.3 Time zones

PostgreSQL 17 truncates a `timestamptz` to a day **in a named zone** with `date_trunc('day', ts, zone)` and generates zone-aware series with `generate_series(start, stop, step, zone)`, both applying daylight-saving rules, so a local day of 23 or 25 hours is handled by the database [D19][D20]; never compute local days by adding 24 hours. Of the 497 zones in the tz database 2024a sampled monthly through 2026, every offset is a multiple of 15 minutes, and 16 zones use offsets that are not whole hours (from −09:30 to +13:45, India's +05:30 among them) [B3], so hourly UTC buckets cannot give exact local days everywhere. Recommendation (ours): each environment has a **reporting time zone** (a setting, IANA name, default UTC); daily rollups are computed in it; changing it queues a rebuild of the retained history (9 s and 74 s at the measured scale on one CPU); every chart names its zone. UTC buckets would be the choice only if operators in several zones must each see their own local days: hourly buckets cost 24 times the rows of daily ones and still miss the 16 zones, and quarter-hour buckets, exact for every current offset, cost 96 times (S1: 8,761 hourly against 35,041 quarter-hour buckets for one environment-year [B1]).

### 6.4 Small-count suppression

- **Thresholds from public practice.** The CMS policy, as its research data contractor publishes it, forbids displaying any cell from 1 to 10 (zero may be shown), applies to excluded cases too, and warns that totals, percentages and other tables can be used to derive a suppressed cell [D23]. The CDC's cancer statistics do not show statistics based on fewer than 16 cases, for reliability and for confidentiality [D24].
- **Rules** (ours, from those): a displayed count from 1 to 10 shows as "fewer than 11"; a rate is shown only when its denominator is at least 11 **and** both its numerator and the complement are at least 11 (a 98% pass rate on 50 inquiries reveals one failure), otherwise as a range ("over 95%"); **complementary suppression**: when a total and all but one of its parts would be visible, a second part is suppressed or the parts are coarsened, so a hidden cell cannot be computed by subtraction; suppression is applied after every filter, to charts, tables and CSV exports alike (the Phase 7 CSV writer, carried item 10); time windows are whole calendar days in the reporting zone, never arbitrary instants.
- **Configuration**: the threshold is an environment setting with a floor of 11, raisable, never lowered.
- **What it does not cover** (state in the console and docs): two overlapping windows (1 to 31 January, then 1 to 30 January) differ by one day whose count may be small, and fixed day boundaries reduce but do not remove that differencing risk; an operator who can also list inquiries sees individuals anyway (suppression protects viewers who hold only `analytics:read`, shared screens and exports); a published total combined with outside knowledge. Noise-based methods (differential privacy) would address differencing and are out of scope (inference).

### 6.5 Chart libraries for the console

| Library | Latest / newest passing | Licence | Rendering and accessibility | Verdict |
|---|---|---|---|---|
| `recharts` | 3.10.1 (2026-07-25) / 3.10.1 | MIT [L6] ✅ | SVG. In the 3.10.1 build, `accessibilityLayer` defaults to `true`, which gives the root SVG `role="application"` and `tabIndex=0` unless the caller passes its own, and arrow keys move the active tooltip, whose content has `role="status"`; the root also carries an inline `style` [B5]. Runtime dependencies include `@reduxjs/toolkit`, `react-redux`, `immer`, `reselect`, `es-toolkit` and `victory-vendor`; 7.45 MB unpacked [N20] | ⚠️ works, but override `role` (an `application` role takes screen readers out of their reading mode; inference) and render client-only for the nonce `style-src` |
| `@visx/*` (`scale`, `shape`, `axis`, `group`, `text`) | 4.0.0 (2026-06-11) / 4.0.0 | MIT [L7] ✅; `@visx/vendor` re-ships d3 modules, registry licence "MIT and ISC" ✅ | Low-level SVG primitives with no accessibility layer of their own: we write the roles, names, focus and table [N21] | ✅ **recommended**: small, d3-based like the Phase 8 editor's stack, nothing implicit |
| `chart.js` (+ `react-chartjs-2`) | 4.6.1 (2026-10-22) / **4.5.1** (2025-10-13); 5.3.1 (2025-10-27) | MIT [L8] ✅ | Canvas: its own docs say the content is not accessible to screen readers and must be given ARIA attributes or fallback content inside the `canvas` [D34][N22][N23] | ⚠️ needs a parallel table anyway; no gain |
| `echarts` (+ `echarts-for-react`) | 6.1.0 (2026-05-19) / 6.1.0; 3.0.6 tagged latest, 3.0.7 published | Apache-2.0, with d3-derived files under BSD-3-Clause listed in its LICENSE [L9] ✅ | Canvas or SVG; generated chart descriptions exist but are off by default and need the `AriaComponent` imported explicitly since 5 [D35]; 60.3 MB unpacked [N24][N25] | ⚠️ far larger than the console needs |

**Recommendation** (ours, building on Phase 7's table view for the graph explorer [R20]): visx primitives, client-only; every chart is a `figure` with a caption that states the finding in words ("pass rate 91% over 90 days, down 3 points"), a `role="img"` SVG with an accessible name, and an adjacent data table that is the default view for keyboard and screen-reader users; series distinguished by direct labels or patterns as well as colour (1.4.1); bars and lines at 3:1 against the background (1.4.11); no hover-only information (1.4.13); the suppression marks of 6.4 shown in both views.

## 7. The WCAG 2.2 AA audit

### 7.1 The target

WCAG 2.2 is a W3C Recommendation (first published 5 October 2023; the version read is dated 12 December 2024); content that conforms to 2.2 also conforms to 2.0 and 2.1, and 2.2 removes 4.1.1 Parsing as obsolete [W1][W2]. The end-user flow is a **process**: WCAG's conformance requirement 5.2.3 makes conformance impossible at a level if any page of a process fails it, so every step, error screen and final screen of every supported step type is in scope, in every shipped language and in RTL [W1]. The method should follow WCAG-EM 2.0 (a W3C Group Note of 23 July 2026): define the scope, explore the product, select a representative sample (structured plus random), evaluate the sample, report [W16].

### 7.2 What automated checks catch and what they miss

- **axe-core's own claim** is that it finds on average 57% of WCAG issues automatically, and it returns "incomplete" results where a person must decide [D25].
- **An independent measure**: the UK Government Digital Service built a page with 143 deliberate barriers and ran 10 free tools on it; 42 barriers (29%) were found by none, the best single tool found 37% (41% counting its prompts for manual checks), one popular tool 17%, and all tools together 71%. Among the misses were long passages in italics, empty table cells and links identified by colour alone [D28].
- **The W3C's position**: tools cannot check every aspect, can give false or misleading results, and cannot determine accessibility; human judgement is required [W11]. Playwright's documentation says the same and points to a guided manual assessment tool [D36].
- **For WCAG 2.2's new criteria, automation covers almost nothing**: axe-core 4.14's only WCAG 2.2 A/AA rule is `target-size` (2.5.8), it can end in "needs review", and the WCAG 2.2 rules are **disabled by default** until the `wcag22aa` tag is requested [D26]. 2.4.11, 2.5.7, 3.2.6, 3.3.7 and 3.3.8 need our own tests or a person.

### 7.3 Tools and their licences

| Tool | Latest / newest passing | Licence | Role | Verdict |
|---|---|---|---|---|
| `axe-core` | 4.14.0 (2026-10-05) / 4.14.0 | MPL-2.0 [L10] | The rule engine, injected into the page under test | ⚠️ allowed only as unmodified test tooling never shipped in a bundle (rule 4's exception); list it in `THIRD_PARTY_LICENSES.md` §5 [R2][R24][N26] |
| `@axe-core/playwright` | 4.14.0 (2026-10-15) / 4.14.0 (on the cutoff day) | MPL-2.0 [L11] | Chainable `AxeBuilder` for Playwright; injects into **all frames**, so the preview iframe and an embedded flow are scanned too; depends on `axe-core` ~4.14.0, peer `playwright-core` >= 1.0.0; its versions track axe-core's major and minor [D27][N27] | ⚠️ same exception; closes carried item 17 |
| `lighthouse` | 13.6.0 (2026-10-27) / 13.5.0 (2026-09-18) | Apache-2.0 [L15] ✅ | Its accessibility category runs axe-core (13.5.0 depends on `axe-core` ^4.13.0); 19.4 MB unpacked, with `puppeteer-core` and `@sentry/node` among its dependencies [N30] | ✅ but redundant in CI; a one-off manual audit aid only |
| `pa11y` / `pa11y-ci` | 10.0.0 (2026-08-28) / 5.0.0 (2026-10-05) | **LGPL-3.0-only** (the LICENSE at `920ad865` is the LGPL v3 text) [L12][N28][N29] | A runner over axe-core and HTML_CodeSniffer | ❌ rule 4: LGPL fails even as tooling |
| `eslint-plugin-jsx-a11y` | 6.10.2 (2024-10-26) / 6.10.2 | MIT [L17] ✅ | Static JSX checks; depends on `axe-core` ^4.10.0; peer `eslint` up to ^9 [N31] | ⚠️ the workspace runs ESLint 10.13, outside its peer range; re-check at the Phase 9 base |
| Playwright `toMatchAriaSnapshot` | in the pinned `@playwright/test` | Apache-2.0 (existing) | Asserts a YAML form of the accessibility tree against a stored snapshot [D37] | ✅ regression guard for headings, landmarks, names |
| NVDA, VoiceOver, TalkBack | — | NVDA is GPL (inference, not read); the others are platform features | Screen readers run by a person during the manual audit, never installed in CI or the repository | ⚠️ owner to confirm that rule 4 does not reach an assistive technology used by an auditor (owner question 8) |

### 7.4 The success criteria new in 2.2, applied

| Criterion (level) | What it asks, in our words [W1][W2] | Where it bites in OpenVerify | How we test it |
|---|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum) (AA) | A focused component is not entirely hidden by content the author added [W5] | The flow's sandbox banner, toasts, the console's sticky header, the editor's side panels, the camera overlay [R12][R19] | A Playwright helper tabs through each page and fails when `elementsFromPoint` at the focused element's centre and corners returns a covering element (ours); manual check at 200% zoom |
| 2.4.12 Focus Not Obscured (Enhanced) (AAA) | No part of it is hidden | the same | aim, not gate |
| 2.4.13 Focus Appearance (AAA) | An indicator at least as large as a 2 CSS px perimeter, at 3:1 between focused and unfocused states | The shared `outline-2` focus ring and the theme's `focus` colour [R13] | the 4.3 contrast check gives 3:1; aim, not gate |
| 2.5.7 Dragging Movements (AA) | Anything done by dragging can be done by a single pointer without dragging, unless essential [W6] | The flow builder and workflow canvas, the case layout editor (carried item 6), list reordering, any chart brush (Recharts' `Brush` is a keyboard slider, but a pointer user still drags) [B5] | The outline view's move up and move down and "connect to" menu; Playwright performs every editing operation without `mouse.down`/`move` |
| 2.5.8 Target Size (Minimum) (AA) | Pointer targets at least 24 × 24 CSS px, or spaced so 24 px circles do not overlap, or an equivalent control, inline, or user-agent defaults [W7] | Canvas handles (6 × 6 px by default in `@xyflow/react`, which Phase 8 enlarges to 24 px hit areas), table row actions, the language select, chart legends [R19] | axe `target-size` with `wcag22aa` on; the flow's mocked specs already measure target sizes (Phase 5) [R22] |
| 3.2.6 Consistent Help (A) | Help mechanisms repeated across pages of a set stay in the same relative order [W8] | The operator's help link or contact on every flow step; the console's help link | The flow renders operator help in one fixed slot of the layout on every step (5.5's typed URL fields); a test asserts its DOM position across all step screens |
| 3.3.7 Redundant Entry (A) | Information already entered in the same process is filled in or selectable, unless re-entry is essential, for security, or no longer valid [W9] | A phone number entered in a database step and asked again by the phone OTP step; a name read from the ID asked again by a form; prefilled inquiry `fields` | The builder warns when two steps collect the same field; the later step prefills from the earlier one (editable); a test per pair |
| 3.3.8 Accessible Authentication (Minimum) (AA) | No cognitive test (remembering, transcribing, solving) in authentication unless an alternative or a helping mechanism exists; password managers and copy and paste count as mechanisms, and a code that must be retyped digit by digit across separate boxes fails | The console's password and TOTP sign-in; the flow's one-time code steps (contact verification rather than login, but the same remedy applies) [W10] | The code fields are single inputs with `autocomplete="one-time-code"` and `inputmode="numeric"`, the password field `autocomplete="current-password"`, paste never blocked (all true today [R12][R13]); a test pastes a full code; WebAuthn stays the no-cognitive-test alternative for operators |
| 3.3.9 Accessible Authentication (Enhanced) (AAA) | The same without the object-recognition and personal-content exceptions | as above | aim |

**Older criteria the new features touch** (not new in 2.2, still in the audit): 2.2.1 Timing Adjustable for the 180 s capture limit (carried item 18: turn off, adjust to ten times, or warn at least 20 s ahead and allow extension at least ten times, unless essential or longer than 20 hours) and for any template whose session expiry is set below 20 hours, which the builder should flag [W17][R9]; 1.4.10 Reflow at 320 px and 1.4.12 Text Spacing for every locale; 3.1.2 Language of Parts for operator copy in another language; 4.1.2 a `title` on the preview iframe; 1.1.1 for logos and charts; 1.4.1 and 1.4.11 for charts and the canvas.

### 7.5 The manual checklist

Run per release on the WCAG-EM sample [W16], in English and Arabic, with results in `docs/accessibility/audit-<date>.md` (ours):
- **Keyboard only** (no mouse), Chrome and Firefox: every flow step type and its error and retry states; the console pages including the builder, the preview, theme and translation editors, analytics and settings. Check reachability and order (2.1.1, 2.4.3), no trap (2.1.2), visible focus at 3:1 (2.4.7, 1.4.11), focus not covered (2.4.11), dialogs keep focus inside and return it on close, Escape closes, shortcuts only with modifiers and only inside their region (2.1.4), a skip link in the console (2.4.1).
- **NVDA with Firefox and Chrome on Windows**: each step's heading announced on arrival (the flow moves focus to it today [R12]), errors read with their field (`aria-describedby`), status messages announced once (4.1.3), the language switch changes the voice (3.1.1, 3.1.2), Arabic read in the right order, charts read through their tables, the outline view's tree semantics.
- **TalkBack with Chrome on Android**: the hosted flow on a phone (the main real-world case) at 200% font scale, including the camera permission prompt and capture; the Android SDK's screens are Phase 10's audit.
- **VoiceOver with Safari on iOS and macOS**: the hosted flow on an iPhone is a web case even while the iOS SDK waits; it needs an Apple device (owner question 7).
- **Zoom and spacing**: 200% text (1.4.4), 320 px reflow (1.4.10), the text-spacing override (1.4.12), both orientations (1.3.4), `prefers-reduced-motion` honoured.
- **Timing**: capture, code and session limits against 2.2.1.

### 7.6 Keeping it in CI

- One helper in `e2e/tests/support` and in `apps/flow/e2e/support` (ours): `expectAccessible(page, { include?, exclude? })` runs `AxeBuilder` with the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`, fails on any violation, and attaches "incomplete" results to the report for the manual pass instead of failing on them [D27][D26]. Exceptions live in one reviewed file with a reason and an expiry date.
- Call it at **each state** of each flow step (axe scans what is on screen when it runs [D36]) in the **mocked** flow specs, which run in seconds without the full stack, so most of the coverage costs no extra CI minutes; the full-stack suite calls it once per console page. The `e2e` job already has a 70-minute limit [R28], so the axe pass belongs in its own shard rather than in that job's critical path (inference).
- Our own checks for what axe does not cover: focus obscured (2.4.11), keyboard-only editing (2.5.7, 2.1.1), consistent help position (3.2.6), redundant entry (3.3.7), paste into code fields (3.3.8), the `en-XA` and `ar-XB` runs at 320 px (5.7), and the real-header CSP test with zero `securitypolicyviolation` events (8.4).
- `toMatchAriaSnapshot` on the flow's step screens and the console's main pages, so a lost heading or label shows as a diff [D37].
- The theme contrast function's unit tests (4.3) and the plural completeness test (5.2) run in `pnpm test`.

## 8. Settings

### 8.1 The allowed-domains list: `frame-ancestors` and the origin check

PLAN §3 asks for an iframe domain allowlist with `localhost` embedding allowed in sandbox only [R1]. Nothing embeds the flow today: there is no web SDK and no embedded mode, and the flow sends `frame-ancestors 'none'` from Phase 7 (section 1, carried item 19). The design below assumes Phase 9 builds the minimal embed (owner question 1).

- **The setting** (ours): `allowed-embed-origins` per environment, under `settings:write`, audit-logged, at most 50 entries. Each entry is `https://host[:port]` or `https://*.host` (CSP's host-source grammar allows a leading `*.` label and a `*` port [W12]); no paths, queries or IP literals; IDNs in their `xn--` form; production refuses `http:` and `localhost`; sandbox also accepts `http://localhost:*` and `http://127.0.0.1:*`.
- **Enforcement is the response header.** `frame-ancestors` is ignored in a `<meta>` policy, does not fall back to `default-src`, and when enforced makes browsers ignore `X-Frame-Options` [W12][D1]. So the page an iframe loads must be served by something that computes the header per environment. `vite preview` sends fixed headers (Phase 7), so Phase 9 needs a **flow server** (ours): a small Node server, like the console's `server.ts`, that serves `dist/` with the static security headers and, for the embed entry (`/embed/{inquiry template id}`, a public identifier in the path because the session token stays in the fragment and never reaches the server [R4]), looks up that template's environment allowlist through an internal API route (cached at most 60 s) and sends `frame-ancestors` with those origins, or `'none'` when the list is empty or the lookup fails (fail closed). The hosted entry keeps `frame-ancestors 'none'`; the preview entry sends the console origin only (3.4).
- **Camera in an iframe.** The camera feature's default allowlist is `self`, so a cross-origin frame gets the camera only when the embedder delegates it with `<iframe allow="camera">`; the SDK sets that attribute [D30][W13][D3].
- **The `postMessage` channel** between the SDK and the flow: the flow accepts messages only from `window.parent` and only when `event.origin` is in the allowlist the flow session returns; it sends to the parent with an exact `targetOrigin`, never `*`, because a page can be navigated away under a frame and `*` would hand messages to whoever is there [D2]. `location.ancestorOrigins` (newly Baseline in 2026) gives the flow the embedders' origins unless the iframe's `referrerpolicy` redacts them [D29]; use it as a cross-check, never as the gate.
- **What the allowlist does not cover**: a compromised or malicious allowed site (it can frame, overlay and observe its own frame's geometry); a top-level copy of the hosted page on a phishing domain (`frame-ancestors` only governs framing); a session token the embedder already holds (it created the iframe URL); browsers that ignore CSP. The API never treats an origin claimed in a request body as proof.

### 8.2 API key rotation and masking

The API already has the pieces: tokens shown once, `token-prefix` afterwards, `clone` to mint a key with the same scopes, IPs and version, and `expire` to end the old one now or within 30 days [R16]. Phase 9's console flow (ours): "Rotate" on a key calls `clone`, shows the new token once in `OneTimeSecretDialog`, then asks how long the old key stays valid (now, 1 hour, 1 day, 7 days, up to the 30-day cap) and calls `expire`; one audit entry links the two keys. Lists show `token-prefix` followed by an ellipsis, `last-used-at` and the age, with a warning past a configurable age (90 days by default, ours). The token format (`ov_sbx_` / `ov_prod_` and 43 base64url characters) is distinctive, so a gitleaks rule for it belongs in the repository's own scan (inference).

### 8.3 Webhook secret rotation

`POST /webhooks/:id/rotate-secret` takes an overlap of 0 to 604,800 s (default 86,400), returns the new secret once, and signs with both secrets until the old one expires [R30]. The console's dialog (exists since Phase 2 C14) gains the old secret's end time on the webhook page and a reminder that receivers must accept either `v1` signature during the overlap (the node SDK's verifier should be checked for that, **not checked** here).

### 8.4 The console's script CSP (carried item 9)

Next.js 16's guide generates a fresh nonce per request in `proxy.ts`, sends it in the `Content-Security-Policy` header and in a request header, and Next.js then applies it to its framework scripts, page bundles and the inline styles and scripts it generates; this requires dynamic rendering, and only development needs `'unsafe-eval'` [D15]. The console already has `proxy.ts`, and its pages read the session cookie through `renderPage`, so they already render per request (inference from [R13]). Proposed policy (ours, from the guide's example): `default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'nonce-{n}'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src {flow origin}; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`. Ship it first as `Content-Security-Policy-Report-Only` for one release with the existing injected-policy tests turned into real-header tests on every page (Phases 7 and 8 already test the explorer and editor this way [R20][R18]), then enforce. Components that set inline styles during server rendering (Recharts' root `style`, React Flow's node sizes) render client-only, as Phase 8 decided [R18][B5].

### 8.5 Custom roles over the existing permission model

The model needs no change: roles hold subsets of `PERMISSIONS`, users hold the union of their roles, unknown values grant nothing, and a principal may grant only what it holds [R15][R30]. Phase 9 adds permissions and a better editor (ours):
- **New permissions**: `themes:read`, `themes:write` (4.2); `analytics:read` (6.4: a viewer of counts, not of inquiries); translations under `inquiry-templates:write`; `allowed-embed-origins` under `settings:write`. Each new permission is added to the built-in roles deliberately (admin all; developer themes and analytics; reviewer analytics; viewer reads) with a registry test, as earlier phases did.
- **The role editor**: permissions grouped by area with a line each on what they allow; the ones the editing operator does not hold shown disabled with the reason (the no-escalation rule, Workflow 2D K002); `pii:view`, `settings:privacy`, the redaction and production permissions marked as sensitive; a confirmation listing what a change removes and from how many users; every change audit-logged.
- **Team** (PLAN's "team"): users and invitations exist since Phase 2; Phase 8 deferred **teams** for case routing, with availability, to Phase 9 (carried item 8). Teams are groups of users for queues, not a second permission system (inference).

## 9. Sources and pins

All read on **2026-10-29**. Repository paths are relative to the repository root at `main` (`91c83e02` to `5177b275`). Registry facts are from `https://registry.npmjs.org/<name>` (the full document: `dist-tags`, `time`, `versions[v].license`, `dependencies`, `scripts`); "passing" means released on or before 2026-10-15.

**Repository**
- [R1] `docs/PLAN.md` §2 (feature map), §3 (technology table, hardening: CSP, iframe allowlist, sandbox-only `localhost`), §6 (Phases 9–11, next release iOS).
- [R2] `CLAUDE.md` rules 4 (licences, the build/test exception) and 5 (honesty).
- [R3] `docs/adr/0002-check-tiers.md` (tiers, never fake `passed`, heuristics labelled).
- [R4] `docs/adr/0003-web-routing.md` and its Phase 1 amendment (one route; the session token in the fragment).
- [R5] `docs/adr/0004-mobile-kotlin-multiplatform.md`; `android/openverify-sdk/src/commonMain/kotlin/dev/openverify/sdk/model/OpenVerifyJson.kt` (`ignoreUnknownKeys = true`) and `Flow.kt` (`specVersion: Int`, `UnsupportedStep`).
- [R6] `docs/research/persona-surface.md` (API resources: `theme-sets`, `inquiry-templates/{inquiry-template-id}/translations`, `inquiry-template-versions`, `api-keys/{api-key-id}/expire`, `webhooks/{webhook-id}/rotate-secret`).
- [R7] `packages/flow-spec/src/flow.ts`, `package.json`, `schema/flow.schema.json`.
- [R8] `packages/contracts/src/flow-api.ts`.
- [R9] `packages/contracts/src/inquiry-templates.ts`, `inquiry-template-versions.ts`, `template-settings.ts`.
- [R10] `apps/api/src/routes/server/inquiry-template-versions.ts`, `apps/api/src/services/inquiry-templates.ts` (no `If-Match` anywhere in `apps/api/src`).
- [R11] `packages/db/src/tables/inquiry-templates.ts`.
- [R12] `apps/flow`: `package.json`, `vite.config.ts`, `index.html`, `src/security/security-meta.ts`, `src/security/csp-safe-zod.ts`, `src/i18n/*`, `src/flow/{flow-renderer.tsx,flow-position.ts,json-logic.ts}`, `src/steps/otp/code-entry.tsx`, `src/routes.tsx`.
- [R13] `apps/dashboard`: `package.json`, `next.config.ts`, `src/proxy.ts`, `README.md`, `src/app/layout.tsx`, `src/components/{link-styles.ts,login-form.tsx,mfa-login.tsx}`.
- [R14] `packages/ui/src/styles.css`.
- [R15] `packages/core/src/permissions.ts`, `enums.ts`.
- [R16] `packages/contracts/src/api-keys.ts`.
- [R17] `packages/db/src/tables/inquiries.ts`, `verifications.ts`.
- [R18] `docs/plans/phase-8.plan.md`: line 88, C141 (lines 717–727), C143, C145 (lines 785–794), decisions 23, 70, 71, 72, 73.
- [R19] `docs/research/phase8-editor-cases.md` §2 (editor, layout, accessibility, storage) and §6 (print and PDF).
- [R20] `docs/plans/phase-7.plan.md`: C107.9 (lines 1433–1440), C108 (lines 1442–1470), lines 1046, 1490, 1503, decision 33 (line 1969).
- [R21] `docs/plans/phase-6.plan.md`: lines 181, 240, 559, 577, 1023, 1283.
- [R22] `docs/plans/phase-4.plan.md` lines 645 (`flow-bundle`) and 814; `docs/plans/phase-5.plan.md` line 1031.
- [R23] `docs/PROGRESS.md` lines 85, 321, 408, 459, 569, 1279.
- [R24] `THIRD_PARTY_LICENSES.md` §5 and "Excluded components".
- [R25] `pnpm-workspace.yaml` (catalog, `allowBuilds`, no `minimumReleaseAge`), `pnpm-lock.yaml`; no `.npmrc`.
- [R26] `infra/docker-compose.yml` (the `flow` service runs `vite preview`).
- [R27] `git log` of `apps/flow/package.json`: commit `86fa58f5` (2026-10-20) adds `i18next` ^26.5.2.
- [R28] `.github/workflows/ci.yml` (the `e2e` job, 70-minute limit).
- [R29] `packages/contracts/src/dashboard-api.ts` (environment settings and retention defaults).
- [R30] `docs/plans/phase-2.plan.md`: C14 (rotate-secret, line 396), C15 custom roles (lines 424–426), the console pages (lines 703, 708), line 921.
- [R31] `apps/api/src/services/flow.ts` (the server enforces consent and one verification per type; it does not evaluate flow transitions).

**Standards and platform documentation**
- [W1] W3C, Web Content Accessibility Guidelines (WCAG) 2.2, W3C Recommendation 12 December 2024. https://www.w3.org/TR/WCAG22/ (success criteria 1.4.3, 1.4.11, 2.4.11–2.4.13, 2.5.7, 2.5.8, 3.2.6, 3.3.7–3.3.9; definitions of relative luminance, contrast ratio, large-scale text; conformance requirement 5.2.3).
- [W2] W3C WAI, What's New in WCAG 2.2 (published 5 October 2023). https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- [W3] W3C WAI, Understanding SC 1.4.3. https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- [W4] W3C WAI, Understanding SC 1.4.11. https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- [W5] W3C WAI, Understanding SC 2.4.11. https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- [W6] W3C WAI, Understanding SC 2.5.7. https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- [W7] W3C WAI, Understanding SC 2.5.8. https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- [W8] W3C WAI, Understanding SC 3.2.6. https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html
- [W9] W3C WAI, Understanding SC 3.3.7. https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html
- [W10] W3C WAI, Understanding SC 3.3.8. https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html
- [W11] W3C WAI, Selecting Web Accessibility Evaluation Tools. https://www.w3.org/WAI/test-evaluate/tools/selecting/
- [W12] W3C, Content Security Policy Level 3, Working Draft 27 October 2026. https://www.w3.org/TR/CSP3/ (§6.1.13 `style-src` and the CSSOM note; §6.4.2 `frame-ancestors`, its `<meta>` rule and the relation to `X-Frame-Options`; the host-source grammar).
- [W13] W3C, Permissions Policy, Working Draft 26 October 2026. https://www.w3.org/TR/permissions-policy/ (§6.2, the `allow` attribute).
- [W14] W3C Internationalization, Structural markup and right-to-left text in HTML. https://www.w3.org/International/questions/qa-html-dir
- [W15] W3C Internationalization, Inline markup and bidirectional text in HTML. https://www.w3.org/International/articles/inline-bidi-markup/
- [W16] W3C, WCAG Evaluation Methodology (WCAG-EM) 2.0, Group Note 23 July 2026. https://www.w3.org/TR/WCAG-EM/
- [W17] W3C WAI, Understanding SC 2.2.1. https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
- [D1] MDN, CSP `frame-ancestors`. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors
- [D2] MDN, `Window.postMessage()` (security concerns). https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- [D3] MDN, `<iframe>` (`allow`, `sandbox`, `referrerpolicy`). https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- [D4] MDN, SVG as an image (restrictions). https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image
- [D5] MDN, `Intl.PluralRules`. https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules
- [D6] MDN, `Intl.Locale.prototype.getTextInfo()` (Baseline 2026, newly available). https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale/getTextInfo
- [D7] MDN, CSS logical properties and values. https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Logical_properties_and_values
- [D8] MDN, `<bdi>`. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/bdi
- [D9] MDN, `prefers-color-scheme` (embedded elements). https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-color-scheme
- [D10] IETF, RFC 9110 HTTP Semantics, §13.1.1 `If-Match`, §15.5.13 412. https://www.rfc-editor.org/rfc/rfc9110.txt
- [D11] Tailwind CSS documentation: theme variables (`@theme`, `static`, `inline`) https://tailwindcss.com/docs/theme; dark mode https://tailwindcss.com/docs/dark-mode; RTL variants https://tailwindcss.com/docs/hover-focus-and-other-states
- [D12] SIL, Open Font License 1.1 official text. https://openfontlicense.org/open-font-license-official-text/
- [D13] MDN, `FontFace()` constructor (binary sources). https://developer.mozilla.org/en-US/docs/Web/API/FontFace/FontFace
- [D14] DOMPurify README at `a77a3e78` (3.4.17): profiles, server use with jsdom. https://raw.githubusercontent.com/cure53/DOMPurify/a77a3e78b59f72fa4d1c83f22e121ad9cc7d3575/README.md
- [D15] Next.js, How to set a Content Security Policy (lastUpdated 2026-03-20). https://nextjs.org/docs/app/guides/content-security-policy
- [D16] next-intl, App Router getting started. https://next-intl.dev/docs/getting-started/app-router
- [D17] PostgreSQL 17, `REFRESH MATERIALIZED VIEW`. https://www.postgresql.org/docs/17/sql-refreshmaterializedview.html
- [D18] PostgreSQL 17, Materialized Views. https://www.postgresql.org/docs/17/rules-materializedviews.html
- [D19] PostgreSQL 17, Date/Time Functions (`date_trunc` with a time zone). https://www.postgresql.org/docs/17/functions-datetime.html
- [D20] PostgreSQL 17, Set Returning Functions (`generate_series` with a time zone). https://www.postgresql.org/docs/17/functions-srf.html
- [D21] Unicode CLDR 49, Language Plural Rules. https://www.unicode.org/cldr/charts/49/supplemental/language_plural_rules.html
- [D22] Android Developers, Test your app with pseudolocales. https://developer.android.com/guide/topics/resources/pseudolocales
- [D23] ResDAC (CMS's research data assistance centre), CMS Cell Size Suppression Policy. https://resdac.org/articles/cms-cell-size-suppression-policy
- [D24] CDC, U.S. Cancer Statistics, Suppression of Rates and Counts. https://www.cdc.gov/united-states-cancer-statistics/technical-notes/suppression.html
- [D25] axe-core README at tag `v4.14.0`. https://raw.githubusercontent.com/dequelabs/axe-core/v4.14.0/README.md
- [D26] axe-core rule descriptions at tag `v4.14.0`. https://raw.githubusercontent.com/dequelabs/axe-core/v4.14.0/doc/rule-descriptions.md
- [D27] `@axe-core/playwright` README at `2375f7f5`. https://raw.githubusercontent.com/dequelabs/axe-core-npm/2375f7f5523a2accaeef91a3cb12e30a46e7fbea/packages/playwright/README.md
- [D28] GOV.UK Accessibility blog, What we found when we tested tools on the world's least-accessible webpage (2017-02-24). https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/
- [D29] MDN, `Location.ancestorOrigins` (Baseline 2026). https://developer.mozilla.org/en-US/docs/Web/API/Location/ancestorOrigins
- [D30] MDN, `Permissions-Policy: camera` (default allowlist `self`). https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/camera
- [D32] i18next documentation, Plurals. https://www.i18next.com/translation-function/plurals
- [D33] i18next documentation, Context. https://www.i18next.com/translation-function/context
- [D34] Chart.js documentation, Accessibility. https://www.chartjs.org/docs/latest/general/accessibility.html
- [D35] Apache ECharts handbook, Aria. https://echarts.apache.org/handbook/en/best-practices/aria/
- [D36] Playwright, Accessibility testing. https://playwright.dev/docs/accessibility-testing
- [D37] Playwright, Aria snapshots. https://playwright.dev/docs/aria-snapshots

**Packages** (registry document; latest; newest passing; licence as the registry states it)
- [N1] `i18next`: 26.5.11 (2026-10-25T18:34Z); 26.4.6 (2026-10-15T17:53Z); locked 26.5.2 (2026-10-17T21:24Z); MIT.
- [N2] `react-i18next`: 17.1.9 (2026-10-25T17:19Z); 17.0.18 (2026-10-15T18:30Z); locked 17.1.0 (2026-10-17T19:01Z); MIT.
- [N3] `next-intl`: 4.14.9 (2026-10-02T11:05Z); MIT; dependencies `use-intl`, `@swc/core` ~1.16.0 (Apache-2.0; latest 1.16.20 of 2026-10-22, passing 1.16.18 of 2026-10-11; `postinstall` script), `@parcel/watcher` (2.6.0, 2026-07-20, MIT; `install` script), `icu-minify` 4.14.9 (MIT), `next-intl-swc-plugin-extractor` 4.14.9 (MIT, 1,271,888 B unpacked), `@eloqnt/config` 0.1.1 and `@eloqnt/format-po` 0.1.1 (2026-09-29), `@eloqnt/format-json` 0.1.0 (2026-09-01) (MIT, first published 2026-08-26, no repository field), `negotiator`, `@formatjs/intl-localematcher`.
- [N4] `use-intl`: 4.14.9 (2026-10-02T11:05Z); MIT; depends on `intl-messageformat` ^11.1.0 and `@schummar/icu-type-parser` 1.21.5.
- [N5] `react-intl`: 12.1.6 (2026-10-27T14:04Z); 12.1.4 (2026-10-05T17:27Z); BSD-3-Clause; 12.0.0 of 2026-09-15.
- [N6] `intl-messageformat`: 12.1.4 (2026-10-19); 12.1.3 (2026-10-05); BSD-3-Clause.
- [N7] `@formatjs/icu-messageformat-parser`: 3.5.22 (2026-10-19); 3.5.21 (2026-10-05); MIT.
- [N8] `@lingui/core`: 6.11.0 (2026-10-29T12:06Z); 6.9.1 (2026-10-09T12:45Z); MIT.
- [N9] `@lingui/react`: 6.11.0; 6.9.1; MIT.
- [N10] `@lingui/cli`: 6.11.0; 6.9.1; MIT; peer `esbuild` ^0.28.1, `rolldown` ^1.0.0.
- [N11] `messageformat`: 4.1.0 (2026-10-12T11:05Z); Apache-2.0.
- [N12] `@messageformat/core`: 3.4.1 (2026-10-12T09:27Z); MIT.
- [N13] `i18next-icu`: 2.6.1 (2026-10-17); 2.5.0 (2026-10-06); MIT.
- [N14] `i18next-cli`: 1.80.5 (2026-10-26); 1.75.3 (2026-10-12); MIT.
- [N15] `i18next-parser`: 9.4.0 (2026-02-22); MIT; depends on `i18next` ^23.5.1 or ^24.2.0, `typescript` ^5.0.4.
- [N16] `@formatjs/cli`: 6.16.36 (2026-10-27); 6.16.34 (2026-10-09); MIT.
- [N17] `pseudo-localization`: 3.1.3 (2026-09-24); MIT.
- [N18] `pseudolocale`: 3.1.0 (2026-08-26); MIT.
- [N19] `dompurify`: 3.4.17 (2026-10-12T12:41Z); `(MPL-2.0 OR Apache-2.0)`.
- [N20] `recharts`: 3.10.1 (2026-07-25T15:23Z); MIT; 7,452,998 B unpacked.
- [N21] `@visx/xychart`, `@visx/shape`, `@visx/scale`, `@visx/axis`, `@visx/vendor`: 4.0.0 (2026-06-11); MIT (`@visx/vendor`: "MIT and ISC", re-shipping d3 modules).
- [N22] `chart.js`: 4.6.1 (2026-10-22T17:23Z); 4.5.1 (2025-10-13T08:54Z); MIT.
- [N23] `react-chartjs-2`: 5.3.1 (2025-10-27); MIT.
- [N24] `echarts`: 6.1.0 (2026-05-19T17:52Z); Apache-2.0; 60,297,703 B unpacked.
- [N25] `echarts-for-react`: 3.0.6 tagged latest (2026-01-21), 3.0.7 published 2026-05-19; MIT.
- [N26] `axe-core`: 4.14.0 (2026-10-05T17:43Z); MPL-2.0.
- [N27] `@axe-core/playwright`: 4.14.0 (2026-10-15T13:33Z); MPL-2.0.
- [N28] `pa11y`: 10.0.0 (2026-08-28); LGPL-3.0-only.
- [N29] `pa11y-ci`: 5.0.0 (2026-10-05); LGPL-3.0-only.
- [N30] `lighthouse`: 13.6.0 (2026-10-27T21:34Z); 13.5.0 (2026-09-18T14:13Z); Apache-2.0; 19,351,495 B unpacked.
- [N31] `eslint-plugin-jsx-a11y`: 6.10.2 (2024-10-26); MIT; peer `eslint` ^3 to ^9.
- [N32] `culori`: 4.0.2 (2025-06-27); MIT; no dependencies.

**Licence files** (at the release commit or tag named)
- [L1] i18next `LICENSE` at `bc951ab3` (26.4.6): MIT. https://raw.githubusercontent.com/i18next/i18next/bc951ab36e601d459e4afe7040c72cc7632d3b9e/LICENSE
- [L2] react-i18next `LICENSE` at `f17e7081` (17.0.18): MIT. https://raw.githubusercontent.com/i18next/react-i18next/f17e70812944aa767482799cfbbaaf4a3d6a5d72/LICENSE
- [L3] next-intl `LICENSE` at `b9fc98a8` (4.14.9): MIT. https://raw.githubusercontent.com/amannn/next-intl/b9fc98a814957b9c97894c7b57151215ac39afa6/LICENSE
- [L4] js-lingui `LICENSE` at `4d339034` (6.9.1): MIT. https://raw.githubusercontent.com/lingui/js-lingui/4d3390340b0e5700b2a18f60142f2ffa69e887a6/LICENSE
- [L5] messageformat `LICENSE` at `439fb0ca` (4.1.0): MIT text. https://raw.githubusercontent.com/messageformat/messageformat/439fb0cae45ba113bcbad4949e61e9c3e1c697ff/LICENSE
- [L6] recharts `LICENSE` at `ffb91879` (3.10.1): MIT. https://raw.githubusercontent.com/recharts/recharts/ffb918798051ef040bb7f9922d3850c9c189f39f/LICENSE
- [L7] visx `LICENSE` at `78839796` (4.0.0): MIT. https://raw.githubusercontent.com/airbnb/visx/78839796081beb0370fc928cc922b21908bbabaf/LICENSE
- [L8] Chart.js `LICENSE.md` at `9c5cf9fa` (4.5.1): MIT. https://raw.githubusercontent.com/chartjs/Chart.js/9c5cf9fac7ec04a71b516e2aff3f7d76876be369/LICENSE.md
- [L9] ECharts `LICENSE` at `c5a48f5f` (6.1.0): Apache-2.0, with d3-derived files under BSD-3-Clause. https://raw.githubusercontent.com/apache/echarts/c5a48f5f97d23e5379720870b8444cd05b50ffb4/LICENSE
- [L10] axe-core `LICENSE` at `v4.14.0`: MPL-2.0. https://raw.githubusercontent.com/dequelabs/axe-core/v4.14.0/LICENSE
- [L11] axe-core-npm `LICENSE` at `2375f7f5` (`@axe-core/playwright` 4.14.0): MPL-2.0. https://raw.githubusercontent.com/dequelabs/axe-core-npm/2375f7f5523a2accaeef91a3cb12e30a46e7fbea/LICENSE
- [L12] pa11y `LICENSE` at `920ad865` (10.0.0): GNU LGPL v3. https://raw.githubusercontent.com/pa11y/pa11y/920ad865270220336cee3186ff664aec8ddbc094/LICENSE
- [L13] DOMPurify `LICENSE` at `a77a3e78` (3.4.17): Apache-2.0 text (the registry states `MPL-2.0 OR Apache-2.0`). https://raw.githubusercontent.com/cure53/DOMPurify/a77a3e78b59f72fa4d1c83f22e121ad9cc7d3575/LICENSE
- [L14] culori `LICENSE` at `5e5bddb3` (4.0.2): MIT. https://raw.githubusercontent.com/Evercoder/culori/5e5bddb37b1dafeb88e4531bd19afeb1cc24ad29/LICENSE
- [L15] Lighthouse `LICENSE` at `cb853a38` (13.5.0): Apache-2.0. https://raw.githubusercontent.com/GoogleChrome/lighthouse/cb853a38a6410617518b363590c967b3fe211949/LICENSE
- [L16] pseudo-localization `LICENSE` at `5f87b7d1` (3.1.3): MIT. https://raw.githubusercontent.com/tryggvigy/pseudo-localization/5f87b7d10e2ca78eee20efe8a89807928910b187/LICENSE
- [L17] eslint-plugin-jsx-a11y `LICENSE.md` at `7f3d698f` (6.10.2): MIT. https://raw.githubusercontent.com/jsx-eslint/eslint-plugin-jsx-a11y/7f3d698f40d697471555e1dae74bfc7ee94d0b86/LICENSE.md
- [L18] Noto Sans Arabic `OFL.txt` on branch `main` (not a tag): SIL OFL 1.1. https://raw.githubusercontent.com/notofonts/arabic/main/OFL.txt
- [L19] Inter `LICENSE.txt` on branch `master` (not a tag): SIL OFL 1.1. https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt

**Our measurements and inspections** (scripts under `scripts/`, outputs under `downloads/`)
- [B1] PostgreSQL benchmark, 2026-10-29: `scripts/p9e-bench/01-schema-data.sql`, `02-queries.sql`; outputs `downloads/p9e-bench-out/01.txt`, `02.txt`, `03-warm.txt`. Image `pgvector/pgvector:pg17` (local id `ac08538c6f8b`), PostgreSQL 17.11, `--cpus=1 --memory=1g`, no published port, removed after the run; defaults `shared_buffers` 128 MB, `work_mem` 4 MB, `max_parallel_workers_per_gather` 2, JIT off for the queries. Synthetic data only. Load: inquiries 12.0 s, verifications 17.5 s, checks 3 min 41 s; on a 12-vCPU WSL2 host whose load average was 5 to 20 from other work, so absolute times are indicative and ratios matter more.
- [B2] `scripts/p9e_contrast.py` over `packages/ui/src/styles.css`: OKLCH → OKLab → linear sRGB (Ottosson's matrices), clipped, 8-bit, then the WCAG 2.2 formulas; vectors #000/#fff 21.000, #767676/#fff 4.542, #949494/#fff 3.033.
- [B3] Python `zoneinfo` over the system tz database (`tzdata.zi` version 2024a): 497 zones, one sample on the 15th of each month of 2026 at 12:00 UTC.
- [B4] Node v22.22.1 (ICU 78.2, CLDR 48.0, tz 2025c), built-in `Intl` only: plural categories, numbering systems per Arabic locale, `Intl.Locale` text info.
- [B5] The `recharts` 3.10.1 tarball (`downloads/p9e-tgz-recharts/`), read with `scripts/p9e_tgz_grep.py` without extracting or executing: `es6/chart/CartesianChart.js` and `es6/state/rootPropsSlice.js` (`accessibilityLayer: true`), `es6/container/RootSurface.js` (`role` `application` and `tabIndex` 0 by default, inline `style`), `es6/component/DefaultTooltipContent.js` (`role: 'status'`), `es6/cartesian/Brush.js` (`role: "slider"`); no `innerHTML`, `new Function`, `insertRule` or `cssText` in `es6/`.

**Robots and request discipline.** Hosts read: registry.npmjs.org, raw.githubusercontent.com, www.w3.org, developer.mozilla.org, nextjs.org, next-intl.dev, tailwindcss.com, www.postgresql.org, www.unicode.org, developer.android.com, resdac.org, www.cdc.gov, openfontlicense.org, accessibility.blog.gov.uk, www.rfc-editor.org, www.i18next.com, www.chartjs.org, echarts.apache.org, playwright.dev. Two fetcher defects were found and fixed during the work, and the affected requests re-checked: Python's `robotparser` read w3.org's `Disallow: /TR/?` as a ban on all of `/TR/` (RFC 9309 matching allows `/TR/WCAG22/`, which was then fetched), and developer.android.com's gzip-encoded `robots.txt` was first stored undecoded; re-read properly, it allows the page that had been fetched. `www.unicode.org` sets a 60 s crawl delay only for named crawlers, not for `*`. Downloads total about 12 MB.

## What the phase plan should take from this (proposed)

**Contracts first (one Stage 1a agent; everything else depends on these)**
1. `@openverify/flow-spec`: additive members `layout`, transition `id` and copy-key references; `safeParseFlow` reports RFC 6901 JSON Pointers; `FLOW_SPEC_VERSIONS = [1]` with an empty `migrateFlow` pipeline and golden fixtures, so version 2 later is a data change (3.1, 3.3, 3.6).
2. The condition context as two zod schemas, client facts and server facts, with their JSON Schemas for the condition builder; a strict-variable mode in the web evaluator and in the Android `JsonLogic` (an unknown variable is an error, never `null`); server-resolved outcomes for conditions over server facts in the flow session response; the `OpenVerify-Flow-Spec` request header (absent means 1) (3.1, 3.6).
3. Template versions gain `copy` (locales, default, messages for declared keys) and `theme-version-id`; a strong `ETag` and `If-Match` on `PATCH` and `publish` with 412; a dry-run validate route and a server diff route (3.3, 3.5, 5.5).
4. `theme-sets` with immutable versions (hex-only palettes for light and dark, radius, font, logo with an alt-text key); the contrast function in `packages/core` with the WCAG vectors of [B2]; publish refuses failing pairs (4.2, 4.3).
5. Permissions `themes:read`, `themes:write`, `analytics:read`; environment settings `allowed-embed-origins`, `analytics-time-zone`, `analytics-suppression-threshold` (floor 11); each added to the built-in roles with a registry test (6.4, 8.1, 8.5).

**Then, in parallel**
6. **Builder**: the flow as a second document type in Phase 8's editor through a graph adapter (outline first, canvas, history, badges), the palette from `SUPPORTED_FLOW_STEP_TYPES`, check-configuration panels generated from the zod schemas (also replacing the JSON editors for `report-config`, `signal-config`, `list-config`), the new graph rules with fixtures, the diff list and badges (3.2–3.5).
7. **Preview and the flow server**: a `/preview` entry in `apps/flow` that makes no network call and accepts only the console origin's `postMessage` documents, parsed by zod; a small Node flow server that sends per-entry headers (hosted `frame-ancestors 'none'`, preview the console origin, embed the environment's allowlist, fail closed); the console's resolve action (3.4, 8.1).
8. **Themes in the flow**: tokens applied with `setProperty` (never `cssText`), the dark palette and `color-scheme`, raster logos through the rendition path and a `blob:` URL; a cross-browser Playwright test with zero `securitypolicyviolation` events (4.1, 4.5, 4.6).
9. **Translations**: `fr`, `de`, `ar` catalogs typed against `Messages`; the plural completeness test; full-tag `Intl` formatting and digit normalisation in code, phone, date and ID fields; a lint rule against physical spacing utilities; `<bdi>` around interpolated values; directional-icon mirroring with the pose prompts excluded; `en-XA` and `ar-XB` runs at 320 px; operator copy delivered in the session response (5.1–5.7).
10. **Analytics**: the four daily rollup tables in the environment's reporting time zone, a 5-minute repeatable job recomputing dirty days by `updated_at` with a commit lag, the suppression rules including complementary suppression, visx charts each paired with a table and a caption; exports through the Phase 7 CSV writer (6.2–6.5).
11. **Settings**: the API-key rotate flow over `clone` and `expire`, the webhook rotation end time, the role editor; the console's nonce CSP from `proxy.ts`, report-only for one release then enforced, with real-header tests on every page (8.2–8.5).
12. **Accessibility**: `axe-core` 4.14.0 and `@axe-core/playwright` 4.14.0 as dev dependencies under rule 4's tooling exception (rows in `THIRD_PARTY_LICENSES.md` §5), one `expectAccessible` helper with the `wcag22aa` tag, called in the mocked flow specs per step state and in the full-stack suite per console page, in its own shard; our own checks for 2.4.11, 2.5.7, 3.2.6, 3.3.7, 3.3.8; aria snapshots; the WCAG-EM manual audit with its report in `docs/accessibility/` (7.5, 7.6).

**Records**: `THIRD_PARTY_LICENSES.md` rows for the visx packages and `@visx/vendor`'s d3 modules, `culori` (dev, if used), the axe packages in §5; Excluded rows for `pa11y` and `pa11y-ci` (LGPL-3.0-only); `elkjs` stays excluded; PLAN §3 rows for charts (visx) and for the flow server; an ADR for embedding, preview and their origins (who frames whom, the headers, the `postMessage` protocol, what the allowlist does not cover); docs for themes, translations (the customisable keys, the consent-copy rule), analytics (the honesty rules and suppression) and the accessibility statement.

**Not in Phase 9** (proposed): "test in sandbox" with draft-pinned inquiries; ICU `plural`/`select` in operator copy; SVG logos (unless the owner chooses them); client-reported screen-view analytics; noise-based privacy for analytics; translating the console.

## Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | No phase owns `@openverify/js`, `sdk-react` or `apps/demo-web`, so nothing embeds the flow and an allowlist enforces nothing. Build the minimal embed (an iframe with `allow="camera"`, the handshake, the flow server's per-environment `frame-ancestors`) in Phase 9? | **Yes**, the minimal embed in Phase 9; the React wrapper and the demo site with it if time allows, else Phase 11 |
| 2 | Draft previews: the credential-free `postMessage` preview, or also a "test in sandbox" mode that creates real sandbox inquiries pinned to a draft? | **Preview only** in Phase 9; sandbox draft runs later, behind a flag |
| 3 | Dynamic friction: resolve conditions over server facts on the server and send outcomes, with SDKs declaring their spec versions (`OpenVerify-Flow-Spec`)? | **Yes**; publish refuses conditions an older client would misread |
| 4 | Fonts: the multi-script web fonts we checked are OFL-1.1, which rule 4 does not list. Allow OFL-1.1 for fonts (also for the server PDF, carried item 5)? | **No shipped font**: the system stack, plus operator-uploaded WOFF2 under the operator's own licence attestation; revisit with the PDF |
| 5 | Logos: accept SVG (sanitised with DOMPurify on jsdom in the API runtime, served only as an image) or raster only? | **Raster only** (PNG, JPEG, WebP) in Phase 9; SVG later if asked |
| 6 | Translate the operator console in this release (next-intl now pulls `@swc/core` and `@parcel/watcher` install scripts and young `@eloqnt/*` packages)? | **English console**, strings in a typed catalog so translation is a data change later |
| 7 | VoiceOver testing of the web flow needs an iPhone or a Mac. Arrange one for the release audit? | **Yes**, an iPhone with Safari for the manual audit; otherwise record VoiceOver as untested in the accessibility statement |
| 8 | Does rule 4 reach assistive technologies used by a person during the audit (NVDA is GPL)? | **No**: external products used manually, never in the repository or CI |
| 9 | Confirm `axe-core` and `@axe-core/playwright` (MPL-2.0) under the tooling exception | **Yes**, dev dependencies only, rows in §5 |
| 10 | Analytics: a reporting time zone per environment, and a suppression floor of 11 that operators may raise but not lower? | **Yes** to both |
| 11 | A separate `themes:write` permission rather than reusing `inquiry-templates:write` | **Yes** |
| 12 | The release-age rule is a convention, not configuration (`i18next` 26.5.2 entered the lockfile three days after release). Set `minimumReleaseAge` (20,160 minutes) in `pnpm-workspace.yaml`? | **Yes**, with the existing "no exclusions" rule |
| 13 | The flow server: a new Node process in compose's `app` profile and in the apps image | **Yes**; `vite preview` stays for development only |
| 14 | WCAG 2.2.1 and the 180 s capture limit (open since Phase 4): implement the warning and the extension? | **Yes**: a warning 20 s before the limit and an extension that does not count toward the cap of 10, in both clients |

## Fact-check (2026-10-29)

Independent re-check of the load-bearing facts against their primary sources, read on 2026-10-29 by a separate agent with
`scripts/fc/fc_fetch.py` (RFC 9309 robots matching before any other request to a host, at least 1.25 s between requests to
one host, no redirect followed automatically, no personal data sent; downloads under `downloads/fc-*/`, Python with `-I`,
nothing downloaded executed). npm facts come from the full packuments at `https://registry.npmjs.org/<name>` (`time`,
`versions[v].license`, `gitHead`, `dependencies`, `scripts`); licence files from `raw.githubusercontent.com` at the
`gitHead` or tag; the repository from `git show 91c83e02:<path>`. "Passing" keeps the note's meaning (released on or before
2026-10-15). Summary: **32 confirmed, 2 corrected, 0 could not verify.**

| # | Fact | Verdict | Primary source and what it shows |
|---|---|---|---|
| 1 | `metadata.specVersion` is `z.literal(1)`; `safeParseFlow` reports dotted paths | confirmed | `packages/flow-spec/src/flow.ts` (`FLOW_SPEC_VERSION = 1`, `z.literal(FLOW_SPEC_VERSION)`, `issue.path.map(String).join('.')`) |
| 2 | JSONLogic `var` returns its fallback (`null`) for a missing path; only unknown operators throw | confirmed, with a nuance | `apps/flow/src/flow/json-logic.ts`: `readVar` returns `fallback = null` on a missing key; besides unknown operators, a `var` whose path is neither a string nor a number also throws `UnsupportedConditionError('var')` |
| 3 | The API does not evaluate transitions; the client computes position | confirmed | `apps/api/src/services/flow.ts` has no condition evaluation; `apps/flow/src/flow/flow-position.ts` evaluates transitions over `flowConditionContext` |
| 4 | No `If-Match`/ETag handling; template-version PATCH last-write-wins | confirmed | No `If-Match` in `apps/api/src`; the only `etag` mentions are response headers of the outbound HTTP client (`apps/api/src/http/`); the PATCH route replaces members with no precondition |
| 5 | Android: `ignoreUnknownKeys = true`, `specVersion: Int`, unknown steps become `UnsupportedStep` | confirmed | `OpenVerifyJson.kt:11`, `Flow.kt:36`, `Flow.kt:449` |
| 6 | No `sdk-js`, `sdk-react`, `demo-web`, no plan owns them, no `postMessage` | confirmed | `git ls-tree` of `apps/` and `packages/`; no hit in `docs/plans/` or for `postMessage` in `apps`, `packages`, `android` |
| 7 | Console: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, no script CSP; flow CSP `<meta>` with the three directives quoted | confirmed | `apps/dashboard/next.config.ts`; `apps/flow/src/security/security-meta.ts` |
| 8 | `i18next` 26.5.2 (2026-10-17) added 2026-10-20 in `86fa58f5`; no `minimumReleaseAge` | confirmed; addendum | Packument: 26.5.2 `2026-10-17T21:24:19Z`; `86fa58f5` (2026-10-20 00:52 −0400) adds `"i18next": "^26.5.2"`; `pnpm-workspace.yaml` has no `minimumReleaseAge`. Addendum: the same commit adds `react-i18next` ^17.1.0 (published 2026-10-17T19:01Z), and `eslint` ^10.13.0 (published 2026-10-16T14:24Z) entered `pnpm-workspace.yaml` in `28fce4eb` the same day, so three adoptions, not one, were 3–4 days old |
| 9 | `i18next` latest 26.5.11 (2026-10-25), passing 26.4.6 (2026-10-15), MIT; LICENSE at `bc951ab3` | confirmed | Packument; 26.4.6 `gitHead` `bc951ab3…`; `LICENSE` there is the MIT text. 26.4.6 was published at 17:53Z on 2026-10-15, so a strict 20,160-minute age is reached only on 2026-10-29 at 17:53Z |
| 10 | `react-i18next` latest 17.1.9 (2026-10-25), passing 17.0.18 (2026-10-15), MIT | confirmed | Packument; `LICENSE` at `f17e7081` is MIT |
| 11 | `next-intl` 4.14.9 (2026-10-02), MIT; `@swc/core` (postinstall), `@parcel/watcher` (install script), `@eloqnt/*` first published 2026-08 with no repository field | confirmed | Packument dependencies of 4.14.9; `@swc/core@1.16.20` `scripts.postinstall`; `@parcel/watcher@2.5.6` `scripts.install`; `@eloqnt/config`, `format-po`, `format-json` created 2026-08-26, no `repository` in any version; `LICENSE` at `b9fc98a8` is MIT |
| 12 | `react-intl` latest 12.1.6 (2026-10-27), passing 12.1.4 (2026-10-05), BSD-3-Clause | confirmed | Packument (licence field; the formatjs repository's licence file was not found at `main/LICENSE` or `LICENSE.md`, so only the registry field was read) |
| 13 | `axe-core` 4.14.0 (2026-10-05) MPL-2.0; `@axe-core/playwright` 4.14.0 (2026-10-15) MPL-2.0, injects into all frames | confirmed | Packuments; `LICENSE` at `v4.14.0` and at `2375f7f5` are MPL-2.0; `packages/playwright/README.md` at `2375f7f5` ("automatically injects into all frames") |
| 14 | axe-core 4.14: the only WCAG 2.2 A/AA rule is `target-size`, disabled by default; Deque's "about 57%" | confirmed | `doc/rule-descriptions.md` at `v4.14.0` (one rule in that table; "These rules are disabled by default"); `README.md` at the tag ("on average 57% of WCAG issues") |
| 15 | `pa11y` 10.0.0 (2026-08-28), `pa11y-ci` 5.0.0 (2026-10-05), LGPL-3.0-only, fail rule 4 | confirmed | Packuments; `LICENSE` at `920ad865` and at `b4e1316c` are the LGPL v3 text |
| 16 | `lighthouse` 13.6.0 (2026-10-27) / 13.5.0 (2026-09-18), Apache-2.0, 19.4 MB; `eslint-plugin-jsx-a11y` 6.10.2 (2024-10-26) MIT, peer up to ^9, workspace on ESLint 10.13 | confirmed | Packuments (13.6.0 unpacked 19,351,495 B); `LICENSE` at `cb853a38` (Apache-2.0) and `LICENSE.md` at `7f3d698f` (MIT); `pnpm-lock.yaml` locks `eslint@10.13.0` |
| 17 | `recharts` 3.10.1 MIT with `accessibilityLayer` true (`role=application`, `tabIndex` 0); `@visx/*` 4.0.0 MIT (vendor "MIT and ISC"); `chart.js` 4.6.1 / 4.5.1 MIT; `echarts` 6.1.0 Apache-2.0, 60 MB | confirmed | Packuments; the 3.10.1 tarball (integrity matches the packument) read without extracting: `CartesianChart.js` and `rootPropsSlice.js` (`accessibilityLayer: true`), `RootSurface.js` (`role = … 'application'`, `tabIndex = … 0`); `@visx/vendor` licence "MIT and ISC"; licence files at the `gitHead`s are MIT, MIT, MIT and Apache-2.0 |
| 18 | `dompurify` 3.4.17 (2026-10-12) `(MPL-2.0 OR Apache-2.0)`; server use needs a current jsdom | confirmed | Packument; `LICENSE` at `a77a3e78` holds the Apache 2.0 text only; `README.md` at the commit ("we **strongly recommend** to use the latest version of _jsdom_"; happy-dom "not considered safe") |
| 19 | `culori` 4.0.2 (2025-06-27) MIT | confirmed | Packument; `LICENSE` at `5e5bddb3` |
| 20 | WCAG 2.2 Recommendation 12 Dec 2024: 0.04045, `(L1+0.05)/(L2+0.05)`, no rounding, 5.2.3 complete processes | confirmed | `www.w3.org/TR/WCAG22/` (definitions, §5.2.3); Understanding 1.4.3 ("the computed values should not be rounded") |
| 21 | WCAG-EM 2.0, Group Note 23 July 2026 | confirmed | `www.w3.org/TR/WCAG-EM/` ("W3C Group Note 23 July 2026") |
| 22 | CSP3 WD 27 Oct 2026: `frame-ancestors` ignored in `<meta>`, no `default-src` fallback, overrides XFO; CSSOM `cssText`/`insertRule` gated on `'unsafe-eval'` | confirmed | `www.w3.org/TR/CSP3/` (all four statements, the last with its open issue #212) |
| 23 | Camera default allowlist `self`; `prefers-color-scheme` in a cross-origin iframe follows the embedder; SVG as an image runs no script and loads nothing external | **corrected** (the SVG part) | MDN `Permissions-Policy/camera` ("The default allowlist for camera is self"); MDN `prefers-color-scheme` (follows the parent element's `color-scheme`; allowed in cross-origin iframes). MDN "SVG as an image" says *some* browsers restrict it and the limitations "may apply"; corrected in place in section 4.5 (the note already sanitises SVG as defence in depth) |
| 24 | `postMessage`: exact `targetOrigin`, check `origin` and `source`; `location.ancestorOrigins` Baseline 2026, redactable by `referrerpolicy` | confirmed | MDN `Window.postMessage` ("Always provide a specific targetOrigin, not *"; "verify the sender's identity using the origin and possibly source"); MDN `ancestorOrigins` ("Baseline 2026, Newly available", `referrerpolicy` note) |
| 25 | Next.js 16 CSP guide: nonce per request in `proxy.ts`, dynamic rendering, `'unsafe-eval'` only in development | confirmed | `nextjs.org/docs/app/guides/content-security-policy` (docs v16.4.3) |
| 26 | RFC 9110 §15.5.13 412 | confirmed | `rfc9110.txt` §15.5.13 |
| 27 | OFL-1.1 bundling; Noto Sans Arabic and Inter OFL-1.1 | confirmed | OFL official text; `notofonts/arabic` `main/OFL.txt`; `rsms/inter` `master/LICENSE.txt` (both on branches, not tags, as the note says) |
| 28 | CLDR 49 plural categories; Node 22.22.1 (CLDR 48) digits for `ar`, `ar-EG`, `ar-SA` | confirmed | `unicode.org/cldr/charts/49/…/language_plural_rules.html` (Arabic zero/one/two/few/many/other; French and Spanish one/many/other); re-run locally on Node v22.22.1 (ICU 78.2, CLDR 48.0): `ar` → `latn`, `ar-EG` and `ar-SA` → `arab` |
| 29 | Pseudo-locales `en-XA`, `ar-XB` | confirmed | developer.android.com "Test your app with pseudolocales" (names them "English (XA)" and "AR (XB)" with the behaviours stated) |
| 30 | PostgreSQL 17 `REFRESH … CONCURRENTLY` unique index on plain columns, one refresh at a time; `date_trunc`, `generate_series` with a time zone | confirmed | PostgreSQL 17 docs (`sql-refreshmaterializedview.html`, `functions-datetime.html`, `functions-srf.html`) |
| 31 | Benchmark [B1] figures | **corrected** (one figure) | Re-read from the run's own output `downloads/p9e-bench-out/01.txt`–`03-warm.txt` (not re-run): `INSERT 0 11984000`, funnel 571 ms cold and 89–106 ms warm, check outcomes 2.05–3.58 s, rollup reads 147–218 ms cold and 35 ms warm, MV refresh 10.59 s and 13.61 s, 48 h check buckets 2.35 s: all as stated. The 48 h **inquiry** recompute took 0.20 s (DELETE) + 0.80 s (INSERT) + 1.73 s (COMMIT) = **2.7 s**, not 1.7 s; corrected in place in the section 6.2 table |
| 32 | tz 2024a: all offsets multiples of 15 min; 16 zones non-whole-hour | confirmed | Recomputed with Python `zoneinfo` on the same `tzdata.zi` (version 2024a, 497 zones, the 15th of each 2026 month at 12:00 UTC) |
| 33 | CMS via ResDAC: cells of 1–10 barred, derivable values too; CDC USCS: no figure under 16 cases | confirmed | `resdac.org/articles/cms-cell-size-suppression-policy`; `cdc.gov/…/technical-notes/suppression.html` ("not shown … when the case or death counts are below 16") |
| 34 | GDS audit: 143 barriers, 29% missed by all 10 tools, 71% found combined | confirmed | `accessibility.blog.gov.uk/2017/02/24/…` (42 of 143 missed by all tools) |
