# Phase 8 research: the visual workflow editor and case management (engineering)

Status: complete, 2026-10-27. Every section was written to disk as it was finished; every source was read on 2026-10-27.

## 0. Scope, method and conventions

Prepared 2026-10-27 for OpenVerify Phase 8 ("Workflows and cases", `docs/PLAN.md` §6 Phase 8 and the Cases and Workflows rows of §2 [R1]). This note is the **engineering** half for two surfaces: the visual workflow editor in the console, and case management (data model, queues, assignment, status machine, SLA timers, comments, attachments, export, print and the reviewer screen). Persona's public behaviour for workflows and cases is the subject of the sibling note `phase8-behaviour.md` [S1]; the durable engine, its timers, expressions and versioning are in `phase8-workflow-engine.md` [S2]; the action library, the Evaluate Code sandbox and the SSRF-safe request are in `phase8-actions-sandbox.md` [S3]. Where this note needs a public identifier (a path, an attribute, an event name) it takes it from the repository's surface index [R4] or from the public OpenAPI files listed in section 9 [O1], and does not re-derive Persona's semantics.

**Conventions.** Everything is written in our own words. Identifiers (attribute names, enum values, event names, configuration keys, URL paths) are reproduced only for functional parity. Anything the sources do not state is marked **not documented**; a statement inferred here that no source makes is marked **(inference)**. Every claim carries a citation key defined in section 9 with its URL and read date (all 2026-10-27). Licence verdicts use rule 4 of `CLAUDE.md` [R2]: ✅ passes, ⚠️ passes with a caveat or needs an owner decision, ❌ fails. Tiers R / H / A are those of ADR 0002 [R3]. Fixture examples use fictional people, `example.com` addresses and documentation IP ranges only.

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-13**. Each package row gives the latest version and the newest one that passes. pnpm measures the age in minutes at install time, so a version published late on 2026-10-13 passes the date rule but is refused by an install run before the same hour on 2026-10-27; such versions are flagged.

**Method.**
- The repository was read, never changed: `docs/PLAN.md`, `CLAUDE.md`, ADR 0002, the surface index, the Phase 6 and Phase 7 plans, the Phase 7 engineering note (the model for this one), `THIRD_PARTY_LICENSES.md`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, the console (`apps/dashboard`: `next.config.ts`, `package.json`, `proxy.ts`, the file proxy route, the image, selfie-evidence, table, dialog, JSON-editor and note components, the global CSS), `packages/core/src/permissions.ts`, `packages/db/src/{sealed,crypto}.ts`, `packages/db/src/tables/verifications.ts`, `packages/contracts/src/{files,ids}.ts`, `apps/api/src/storage/index.ts`, `apps/api/src/routes/dashboard/files.ts`, `apps/api/src/jobs/inquiry-expiry.ts`, `apps/api/src/webhooks/dispatcher.ts`, the vision service's EXIF schema and the API image's `Dockerfile` [R1]–[R23].
- Package facts come from each registry's metadata document and the LICENSE file at the release tag or commit. Five tarballs and one published build were read **as data** (listed, scanned for CSP-relevant constructs, measured gzip size) and never executed or installed [M1]. Specifications and guidance come from their publishers' pages. Every host's `robots.txt` was read before any other request to it; at most one request per 1.1 s per host; a descriptive User-Agent without contact details; no personal data sent. One host's robots file (`www.w3.org`) carries `Disallow: /TR/?`; Python's parser reads that as covering `/TR/WCAG22/`, so the WCAG 2.2 criteria are cited from W3C's *Understanding WCAG 2.2* pages, which quote each criterion, instead of from the recommendation itself.
- Downloads total about 14 MB, under `downloads/ec-*/`; scripts are `scripts/ec_*.py`. Nothing from a download was run.

**Summary.**
- **Editor.** `@xyflow/react` 12.12.0 (MIT, 2026-09-24; peer `react >=17`, so React 19.3 is in range) with its MIT/ISC dependencies; 52 KB gzip ESM; no `eval`, no `innerHTML`, no injected `<style>` in the ESM build. Keyboard selection and arrow-key moves exist, but **creating a connection needs a pointer** and default handles are 6 × 6 px, so a list (outline) view that can add, connect, reorder and delete steps is the WCAG 2.2 equivalent, not an extra. Auto-layout: `@dagrejs/dagre` 3.1.1 (MIT) ✅; `elkjs` is `EPL-2.0 OR GPL-3.0-or-later` ❌ for a shipped console; `d3-hierarchy` (ISC) ✅ for trees only. Undo/redo, versions and diffs are ours (the vendor's undo example is under its Pro licence). The definition is a JSON graph validated by a zod schema plus graph rules on the server.
- **Cases.** Public identifiers: `case_`, `ctmpl_`, `cqueue_`, `cscm_`; templates carry `resolutions` and the same `field-schemas` union as transaction types, so Phase 7's field-schema walker is reused; statuses are free strings in the public examples (the list is **not documented** in the template schema). Queue claims use `FOR UPDATE SKIP LOCKED`; round-robin and least-loaded need a per-queue serialising lock because `SKIP LOCKED` cannot lock an aggregate.
- **SLA.** Deadlines computed in business time from an operator calendar (IANA zone, weekly hours, holiday dates), stored as UTC instants, fired by a database-backed sweep that emits `case.sla-expired` once per SLA epoch. Library: `temporal-polyfill` 1.0.5 (MIT) for explicit DST disambiguation, or Luxon 3.7.2 (MIT, already in the lockfile through BullMQ) whose ambiguous-time behaviour its docs call undefined. No holiday data ships: `date-holidays` data is **CC BY-SA 3.0** (its npm metadata says CC-BY-3.0) ❌.
- **Comments.** Plain text with mentions by default; if Markdown is wanted, `markdown-it` 15.0.2 (MIT) with HTML off, then DOMPurify 3.4.17 (`MPL-2.0 OR Apache-2.0`, taken under Apache-2.0 ✅), or `react-markdown` 10.1.0 (MIT) with no raw HTML. Images in comments refused.
- **Attachments.** A new `case_attachments` table on the existing `encryptBytes` + `FileStorage` path (the `files` table needs a verification); typed by content; images re-encoded without metadata. ClamAV (GPL-2.0) is acceptable only as an operator-run network service OpenVerify talks to over clamd's `INSTREAM`, behind a scanner port with a sandbox provider; clamd's TCP socket is neither encrypted nor authenticated.
- **Export and print.** CSV through Phase 7's neutralising writer; JSON; print CSS in the browser for Phase 8. A server PDF (pdf-lib MIT, last release 2021; pdfmake/pdfkit MIT with Adobe AFM files under their own notice) handles only JPEG and PNG, embeds JPEG bytes with their EXIF (pdf-lib) and needs an embedded font for non-Latin names, so it waits for Phase 9's `print` routes.
- **Reviewer.** `@panzoom/panzoom` 4.6.2 (MIT, 6.7 KB gzip, no style injection) with our own buttons and keys; `react-zoom-pan-pinch` 4.2.0 injects a `<style>` element (CSP caveat); OpenSeadragon (BSD-3) is tile-oriented and heavy. Images keep streaming through the console's authenticated proxy: S3 presigned URLs cannot work, because the stored objects are AES-GCM ciphertext.

## 1. What exists today in the repo (read-only survey)

| Area | What the code does today | What it means for Phase 8 | Source |
|---|---|---|---|
| Console stack | Next.js 16.4.x, React 19.3.x, Tailwind 4, no component library beyond `@openverify/ui` (alert, button, card, checkbox, field); runtime dependencies are `@openverify/*`, `@simplewebauthn/browser`, `qrcode`, `server-only`, `zod`. No graph, editor, Markdown, date or zoom library | Every editor and case library is a new runtime dependency of a shipped bundle, so rule 4 applies at runtime; the §5 tooling exception does not | [R8][R18] |
| Console headers | Every response sends `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `nosniff`, and a `Permissions-Policy` that denies camera, microphone, geolocation and payment. A script CSP with per-request nonces "is left for a later phase" | Libraries must keep working under the planned nonce policy (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'` as in the Next.js guide [D18]); Phase 7 already tests its explorer under an injected policy | [R7][R6] |
| Images in the console | `<img src="/files/:id/content">` served by the console's own route handler, which calls the API with the operator's session cookie, passes on only JPEG, PNG and WebP (and a PDF only as an attachment), answers `Cache-Control: private, no-store` and `nosniff`, and reduces API errors to a bare status. The API route needs `inquiries:read` **and** `pii:view`, decrypts, re-checks size, SHA-256 and content type, and writes a `file.viewed` audit entry per view | The reviewer screen already has a safe image path; a zoom library must work from one `<img>` (one audited fetch), not from tiles or blob URLs it fetches itself | [R9][R16] |
| Side-by-side today | The selfie card shows the government ID front beside the centre pose with similarity, threshold and its basis; alt texts name the pose or document, never the person; statuses are text badges, never colour alone; images are a fixed 12 rem high with `object-contain` | The case reviewer screen extends this pattern (zoom, rotate, synchronised view) rather than inventing a new one | [R10] |
| Components | `DataTable` (semantic table, named focusable scroll region, no row selection), `Dialog`, `JsonEditor` (a monospaced text area with Format and Validate, "no editor dependency", errors by JSON Pointer), `HiddenValue`/`RedactedValue`, `NoteEditor` (inquiry note ≤ 2,000 characters, sealed, shown with `whitespace-pre-wrap`) | Comments can reuse the note's plain-text rendering; the workflow definition can always be edited as JSON with pointers, which doubles as an accessible fallback | [R11] |
| Fonts | The console uses Tailwind's `font-sans` system stack; no web font is bundled | Browser printing needs no font licence; a server-side PDF would (section 6) | [R11] |
| Roles and scopes | 28 API scopes plus operator permissions (`pii:view`, users, roles, settings, `environments:production`); built-in roles `admin`, `developer`, `reviewer`, `viewer`; viewers get every `:read` except API logs, audit logs and the sandbox SMS sink; unknown stored permissions grant nothing | Phase 8 adds workflow and case scopes; reviewers need case read/write and the review actions; viewers would get `cases:read` automatically unless listed in `NOT_FOR_VIEWERS` (section 3.7) | [R12] |
| Object storage | `FileStorage` port over S3 (RustFS in dev) that only ever sees ciphertext; keys are `<environment id>/<256 random bits>`; delete removes every stored version | Case attachments reuse the port unchanged | [R13] |
| Encryption | `encryptBytes` per file with the file id as AAD context (`ov1-bytes:<context>`), the wrapped DEK in the row; row-bound sealing `sealValue`/`sealJson` with AAD `<table>.<column>#<row id>` | Comment text and case `fields` are sealed per row; attachments get their own id as context | [R14] |
| Files table | `files.verification_id` is NOT NULL with a cascade to verifications; one file per kind per verification; MIME type sniffed from magic bytes (JPEG, PNG, WebP; PDF header within the first 1,024 bytes for documents); 10 MiB cap | An attachment is not a verification file: it needs its own table (or a nullable owner, which would weaken today's invariants) | [R15] |
| EXIF | Uploads are stored as received; the vision service reads EXIF (software, make, model, dates) and reports only **whether** GPS is present, never its values; coordinates are "EXIF-upright" | An original served to a browser, put in an export or embedded in a PDF carries any GPS tags it had (inference from the stored bytes); section 7.3 | [R21] |
| Sweeps and outbox | Repeatable jobs take overdue rows in batches `FOR UPDATE SKIP LOCKED`, act in a savepoint per row and dispatch events after commit; the webhook dispatcher treats the database row, not the queue, as the source of truth | The SLA expiry sweep follows the same shape (section 4.7) | [R17] |
| Dates | `luxon` 3.7.2 is already in the lockfile, pulled by `cron-parser` 5.10.1 under `bullmq` 6.3.11; no other date library; the API image is `node:22.22.1-bookworm-slim`, whose Node has ICU 78.2 with tz data 2025c and **no** global `Temporal` (measured) | Business-time arithmetic needs a library or our own code (section 4) | [R18][R22] |
| Identifiers | `<prefix>_<ULID>` with lowercase-letter prefixes; Phase 6 took `rep`, `rptp`, `rptpv`, `rpr`, `ract`, `rpm` | Case prefixes can follow the public ones (`case`, `ctmpl`, `cqueue`, `cscm`) since they are lowercase letters (section 3.1) | [R20][O1] |
| Hand-offs | Phase 6 deferred the workflow "Run report" action and match conditions, cases holding reports, and `print` (Phase 9); its `on-report-match: needs_review` is a stop-gap until workflows exist. Phase 7 deferred every workflow step built on lists, graph, transactions and devices, case modules, transaction children, re-screen triggers and "create a case" from graph bulk actions; decision 18 allows auto-decline on a signal only through a Phase 8 workflow | The editor's palette and the case model must have slots for these (sections 2.3 and 3.2) | [R5][R6] |
| Format model | Phase 7's engineering note chose Cytoscape for the graph explorer with a Table view as the default for keyboard and screen-reader users, a shared selection, and a CSP test under an injected nonce policy | The workflow editor follows the same pattern: a canvas plus an always-available list view, with the same CSP test (section 2.6) | [R23][R6] |

## 2. The workflow editor

### 2.1 `@xyflow/react`

| Fact | Value | Source |
|---|---|---|
| Latest / newest passing | **12.12.0** (2026-09-24T12:41Z) for both; the 12.x line started 2024-07-09; seven 12.11.x releases from June to September 2026 | [N1] |
| Licence | MIT, LICENSE at tag `@xyflow/react@12.12.0` ("Copyright (c) 2019-2025 webkid GmbH") ✅ | [N1] |
| React 19 | `peerDependencies`: `react >=17`, `react-dom >=17`, so the console's React 19.3.1 is in range; the registry declares no upper bound (inference: no claim of tested support beyond the range) | [N1][R18] |
| Runtime dependencies | `@xyflow/system` 0.0.83 (MIT, same day), which pulls `d3-drag`, `d3-zoom`, `d3-selection` 3.0.0 and `d3-interpolate` 3.0.1 (ISC, all 2021), and through them `d3-dispatch` 3.0.1, `d3-transition` 3.0.1, `d3-timer` 3.0.1 (ISC), `d3-color` 3.1.0 (ISC, 2022) and `d3-ease` 3.0.1 (**BSD-3-Clause**, which is on the list) ✅; `classcat` 5.0.5 (MIT, 2024); `zustand` **^4.4.0**, so 4.5.7 (MIT, 2025-05-15) with `use-sync-external-store` 1.7.0 (MIT), **not** zustand 5 (latest 5.0.16, 2026-10-22) | [N1][N2][N3] |
| Size | tarball 251,386 B; `dist/esm/index.js` 233,341 B, **52,068 B gzip** (level 9, measured; before tree-shaking and without `@xyflow/system` and d3); `dist/style.css` 18,596 B, `dist/base.css` 13,585 B | [M1] |
| CSP scan of the ESM build | no `eval`, no `new Function`, no `innerHTML`, no `<style>` injection, no `setAttribute('style')`, no worker, no `fetch`; 11 key-handler and 18 `aria-*` references (the UMD build has three `innerHTML` writes, which the console does not use) | [M1] |
| Attribution | A small "React Flow" link is rendered by default. The licence does not require it; the vendor's page asks that it be removed only by Pro subscribers | [D4] |
| Server rendering | Supported since 12; for it, a node's `width` and `height` are written as **inline styles** | [D5] |

**CSP consequence (inference from [D5] and [D18]).** A nonce-based `style-src` allows `<link rel="stylesheet">` from `'self'` and nonced `<style>` elements, but nonces never apply to `style="…"` attributes in server-rendered HTML. React on the client sets styles through the CSSOM, which `style-src` does not govern. So the editor should render **client-only** (a client component mounted after hydration, or `next/dynamic` without SSR), and import `@xyflow/react/dist/base.css` through the bundler so it ships as a same-origin stylesheet. Phase 7's explorer test (an injected `script-src 'self' 'nonce-…' 'strict-dynamic'; worker-src 'none'; object-src 'none'` and an assertion of zero violations) is reused with a `style-src 'self' 'nonce-…'` added [R6].

### 2.2 Auto-layout

The layout only places steps; it never changes what a workflow does. A library the console ships runs in the operator's browser, so rule 4 applies at runtime and the §5 tooling exception does not [R2][R19].

| Library | Latest / newest passing | Licence | What it does for a workflow graph | Verdict |
|---|---|---|---|---|
| `@dagrejs/dagre` + `@dagrejs/graphlib` | 3.1.3 (2026-10-24) / **3.1.1** (2026-08-08) with graphlib **4.0.5** (2026-08-03; latest 4.0.7, 2026-10-24) | MIT at `c3ed0802` and `d3a0cf36` ✅ [N4] | Layered (Sugiyama-style) layout of directed graphs with per-node sizes; the vendor's guide recommends it for trees, notes it handles dynamic node sizes and sub-flows, does not route edges, and has an open issue when sub-flow nodes connect outside their sub-flow [D2] | ✅ **recommended**. Pin 3.1.1 with graphlib 4.0.5 (3.1.1 pins graphlib exactly). Major 2 came out 2025-11-20 and major 3 on 2026-03-22, so the API is moving (maintenance note) |
| `elkjs` | **0.12.0** (2026-07-17) | registry `EPL-2.0 OR GPL-3.0-or-later`; LICENSE.md at `ff5771d7` is the EPL-2.0 text naming GPL as its Secondary Licence [N5] | Full layered layout with edge routing and ports; the vendor's guide calls it the most configurable [D2] | ❌ for the console: neither option is on the allow-list for a shipped runtime library, and the weak-copyleft exception covers only unmodified tooling that never ships [R2] |
| `d3-hierarchy` | **3.1.2** (2022-04-02) | ISC at `7bea49ef` ✅ [N6] | Tree layouts with a single root and one size for every node [D2] | ⚠️ only if every workflow were a tree. A conditional that re-joins, or a parallel step with a join, is not a tree (inference), so it is not the default |
| Our own layered layout | — | ours | Rank by longest path from the trigger, order within a rank by branch index, fixed spacing | ✅ a fallback of about a hundred lines if dagre's churn becomes a problem (inference) |

**How layout is used (recommendation).** Positions are stored in the definition's separate `layout` member (2.5), not in the steps, so a "tidy up" is one undoable command, version diffs ignore layout-only changes, and the definition's hash covers only behaviour. Run dagre on demand (a button and when a version without positions is opened), with `rankdir` top-to-bottom and measured node sizes; never re-layout on every edit, which would move steps under the operator's pointer.

### 2.3 Editor patterns

- **Palette.** The server publishes a step and action catalogue (type, display key, the zod schema of its configuration rendered to JSON Schema for the form, which triggers allow it, the scopes it needs, and whether it is available in this environment). The palette is built from that catalogue, so the console never hard-codes what a step accepts (inference). Actions whose data source is an adapter (a report type, an SMS or email provider, a list kind) show "not configured" instead of disappearing, matching ADR 0002 §3e [R3]. The catalogue has slots for every step earlier phases deferred: the "Run report" action and match conditions (Phase 6) and the list, graph, transaction and device steps, case modules and re-screen triggers (Phase 7 C110) [R5][R6]. Adding a step works three ways: drag from the palette (pointer), click a palette item then "add after the selected step" (single pointer, 2.5.7), and the outline view (keyboard, 2.4).
- **Connection validation.** `isValidConnection` exists for exactly this purpose [D6]. Rules (ours): no edge into the trigger; no self-edge; an output port accepts at most one edge unless the step is a parallel fork; a conditional's ports are its named branches plus `else`; a target is not already an ancestor unless the edge is a loop's back-edge inside its own body; a module's input mapping is complete; ports exist on both steps. The same function runs on the server at save and publish, which is the authority (the client check is only feedback).
- **Undo and redo.** The vendor's undo/redo example is a Pro example under the "xyflow Pro License" [D3], so nothing from it is used. Ours: the editor state is one immutable document `{ definition, layout, selection }`; every user action is a command producing the next document; history is a bounded stack (100 entries) of document snapshots, structurally shared so a snapshot costs little; drags and typing are coalesced into one entry per gesture or per field blur; selection changes are not history entries. Keys: Ctrl or Cmd with Z, and Ctrl or Cmd with Shift and Z (or Ctrl+Y), active only while focus is inside the editor (2.4). `zundo` 2.3.0 (MIT, 2024-11-17, for zustand 4 or 5) would do this over a zustand store [N7], but the history is small enough to own (recommendation).
- **Drafts, versions and diffs.** Public version statuses are `draft`, `published` and `archived`, and a version carries `description`, `trigger-type`, `inputs`, `outputs`, `published-at` and `last-updater`; the public version object does **not** expose the step graph, so the definition format is ours [O1]. A published version is immutable; editing opens or continues the single draft (the inquiry-template pattern [R6]). The diff between two versions is computed on the server from the two definitions, keyed by step id: steps added, removed, or changed (each change as a list of JSON Pointers with before and after values, PII-free by construction because definitions hold configuration, not subject data), edges added or removed, trigger and input/output changes. Layout-only changes are listed separately and collapsed. The console shows the diff as a list (the accessible form) and as badges on the canvas (an icon and a word, never colour alone, 1.4.1) [A8].
- **Validation errors on nodes.** Save and publish answer RFC 9457 problems with JSON Pointers into the definition (`/steps/<id>/config/…`, `/edges/<id>`), as the console's `JsonEditor` already consumes [R11]. The editor maps each pointer to its step and shows an error badge with a count; the step's accessible name gets the error through `aria-describedby`; an errors panel lists every problem with a "go to step" button that focuses the node and opens its form; the count is announced through a polite live region (4.1.3) [A5]. Warnings (an unused output, a step that can never run) do not block publish; errors do.
- **Simulation.** The public product offers a run simulation [S1]; its engine side is [S2]'s. In the editor it reads as a run overlay (each step's status as an icon and a word) on a selected past run or a dry run (inference).

### 2.4 Accessibility of the node editor

**What `@xyflow/react` provides** [D1]: Tab moves through focusable nodes and edges (`tabIndex=0`, `role="group"` by default); Enter or Space selects, Escape clears; arrow keys move a selected node (Shift for larger steps) when `nodesDraggable` and `nodesFocusable` are on; the canvas pans to a focused node (`autoPanOnNodeFocus`); a live region announces moves (the page names these live updates; the `aria-live="assertive"` value is read from the 12.12.0 ESM build [M1], not from the page (corrected in fact-check)); all built-in strings are replaceable through `ariaLabelConfig` (so they can be translated); `ariaRole` and `domAttributes` set roles and ARIA attributes per node or edge. The vendor's page claims these help meet WCAG 2.1 AA "when properly implemented" [D1].

**What it does not provide (from the page and the shipped CSS).**
- No keyboard way to **create** a connection is described [D1]; `connectOnClick` exists in the build (click a source handle, then a target) [M1], which is a single-pointer alternative for 2.5.7 but not a keyboard method for 2.1.1 [A1][A4].
- Default handles are 6 × 6 CSS px (`style.css`) [M1], below the 24 × 24 px of 2.5.8 unless an equivalent control exists on the page [A3].
- The default CSS sets `outline: none` on focused nodes and edges [M1], so a custom node must draw its own focus indicator with 3:1 contrast (2.4.7, 1.4.11) [A14][A6].
- A canvas carries meaning by position; a screen reader gets a flat list of groups (inference).

**The equivalent (recommendation): an outline view, always available, sharing state with the canvas.** It follows the APG tree view pattern [A9]: the trigger is the root; each step is a tree item named by its type, its own name and its error count; a conditional's branches and a parallel step's lanes are child groups; a loop's body is a child group. Keys follow the pattern (Up and Down move, Right opens or enters, Left closes or goes to the parent, Home and End, type-ahead) [A9]. Each item has a menu button (Enter) with "add a step after", "add a branch", "move up", "move down", "connect next step to…" (a list box of valid targets, filtered by the same validation function), "delete" (with confirmation) and "open settings". Every canvas operation is reachable here, which is what satisfies 2.1.1, 2.5.7 and 2.5.8's "equivalent" exception for the canvas [A1][A4][A3]; the canvas stays the visual view. Selection and focus follow between the two views.

**Other criteria that bite here.** 2.1.4: editor shortcuts that are single characters must be focus-scoped or remappable, so use modifier chords and scope them to the editor region [A2]. 2.4.11: side panels and toasts must not cover the focused node (the canvas should pan the focused node clear of the panels) [A7]. 1.4.10: the outline view and forms reflow at 320 px; the canvas is a two-dimensional diagram, which the criterion exempts [A10]. 4.1.3: validation results and save outcomes announced politely; move announcements keep the library's assertive region but should be throttled (inference) [A5]. 1.1.1: the canvas region gets a text alternative that summarises it ("12 steps, 2 branches, 1 error") and points to the outline [A11].

### 2.5 Storing the definition as a JSON graph validated with zod

- **Shape (ours; the public format is not documented [O1]).** `{ "schema-version": 1, "trigger": { type, config }, "steps": [{ id, type, name, config }], "edges": [{ id, from, "from-port", to }], "inputs": [{ name, type, required }], "outputs": [{ name }], "layout": { "<step id>": { x, y } } }`. `inputs` and `outputs` mirror the public version attributes [O1]. Step ids are editor-generated, stable across versions (they key the diff) and match `^[a-z][a-z0-9_]{0,39}$` so they read as variable names in expressions (inference; [S2] owns the expression scope).
- **Validation in two layers.** (1) A zod schema: a discriminated union on `type` for triggers and steps, each step's `config` its own strict schema from the catalogue (2.3), strict objects throughout (unknown keys refused), caps (ours: at most 200 steps, 400 edges, names 1–80 characters, a step's config at most 16 KiB, the whole definition at most 256 KiB serialised, string fields bounded). zod 4.6.7 is already a direct dependency of the API and the console [R8][R18]. (2) A pure graph check in `packages/workflow-engine` run after the schema: exactly one trigger; edge endpoints exist; port rules of 2.3; every step reachable from the trigger; no cycle except a loop's back-edge inside its own body; every branch either connected or explicitly ended; module references point at published modules of the same environment; expression and template fields parse ([S2]). Both layers return JSON Pointers, so the console needs one error mapper.
- **Storage.** `workflow_versions.definition jsonb` (immutable once published), with `definition_sha256` over the canonical serialisation of everything except `layout`, so "no behavioural change" is a hash comparison (inference). Definitions hold configuration only; a step's config never holds subject data, and secrets for actions are references to stored secrets, never values ([S3]).
- **Never interpreted as code.** The definition is data walked by the engine; zod validates shape only (as Phase 7's field-schema walker does [R23]). JSON Schema for the forms is generated from zod on the server (`z.toJSONSchema`), never the other way round.

### 2.6 Performance and testing

Workflows are tens of steps, not thousands, so the DOM renderer is fine (inference; Phase 7 noted the vendor's own performance advice is about memoising custom nodes and collapsing large trees [R23]). Custom node components are memoised and receive only their step's data. Tests: the zod schema and the graph check are pure and test-first with golden definitions (valid, and one invalid per rule); the console's editor gets Playwright tests for keyboard-only authoring through the outline view (add a trigger, a conditional with two branches, a wait, publish), the canvas and outline staying in sync, undo/redo, the diff view, error badges, and the CSP test of 2.1.

## 3. Cases: data model, queues, assignment and the status machine

### 3.1 Public identifiers the design has to carry

From the public OpenAPI files (identifiers only; every file matched to the published tree's blob hash) [O1] and the surface index [R4]:

- **Case** (`case_…`). Attributes: `status` (a string; the examples mix `Open`, `Pending`, `Approved`, `Declined`, `open` and `resolved`), `name` (examples like `MRR-3`, `KYC-6`, `WATC-16`), `resolution` (nullable; example `Escalated`), `created-at`, `updated-at`, `assigned-at`, `resolved-at`, `redacted-at`, `sla-expires-at`, `creator-id`/`creator-type` (`user`, `workflow-run`), `assignee-id`, `assigner-id`/`assigner-type` (`case-assignment-policy`, `user`, `workflow-run`; an assigner id example starts `cap_`), `resolver-id`/`resolver-type` (`api-key`, `user`, `workflow-run`), `updater-id`/`updater-type` (`api-key`, `case-assignment-policy`, `user`, `workflow-run`), `tags`, `fields` (keys not inflected) and `attachments` (`filename`, `url`, `byte-size`). Every `*-type` is an open enum. Relationships: `accounts`, `case-comments`, `case-template`, `case-queue` (nullable), `inquiries`, `reports` and `verifications` (both polymorphic), `txns` (transactions). Several user ids in the examples are **email addresses**.
- **Case template** (`ctmpl_…`): `status` (`active`, `archived`), `name`, `resolutions` (a string list, example `Approved`, `Declined`), `created-at`, `updated-at`, `archived-at`, and `field-schemas`, which references the **same** `field-schema.yaml` union that transaction types use (the example shows a `string` with `max-char-length` and `sanitize`, and a `multi-choices` with `options` and `allow-empty`). No list of statuses, no SLA and no queue appear in the template object.
- **Case queue** (`cqueue_…`): `status` (`active`, `archived`), `name`, timestamps. Membership and assignment policy are not in the object.
- **Case comment** (`cscm_…`): `message` (null once redacted; the identifiers and timestamps stay), `created-at`, `updated-at`, `redacted-at`, `commenter-id`, `commenter-type` (example `user`).
- **Routes**: `POST /cases` (`case-template-id`, `creator-email-address`, `case-queue-id`, `fields`, `tags`, and `meta.object-ids`); `GET /cases` filtered by `status`, `case-template-id`, `account-id`, `reference-id`, `inquiry-id`, `report-id`; `POST /cases/search` (an `and`/`or`/`not` tree, nesting depth 2, at most 20 clauses per level, predicates `eq`, `gt`, `gte`, `lt`, `lte`); `cases/{id}` and its `add-comment` (`meta.message`, at least one character), `add-objects`/`remove-objects` (`meta.object-ids`: accounts, documents, graph queries, inquiries, reports, report runs, "sars", transactions, verifications), `add-tag`, `remove-tag`, `set-tags`, `assign` (`meta.user-email-address`), `set-status` (`meta.status`); `case-templates/{id}`.
- **Events**: `case.assigned`, `.created`, `.exported`, `.queue-updated`, `.redacted`, `.reopened`, `.resolved`, `.sla-expired`, `.status-updated`, `.updated-fields`, `.updated-tags` [R4].
- **Not in the public objects or paths** (the docs may say more; that is [S1]'s subject): how statuses are defined, how queues get members, what a `case-assignment-policy` is, how SLAs are configured (business hours, pausing), how attachments are uploaded, whether comments can be edited, and what "export" and "print" produce.

The four public prefixes are lowercase letters, so they fit the repository's id rule as they are [R20]. Using them eases migration (inference); the owner decides (section 12).

### 3.2 Data model (proposed)

| Table | Holds | Notes (ours unless cited) |
|---|---|---|
| `case_templates` (`ctmpl_`) | name, status, `archived_at`, current published version | Environment-scoped like every resource |
| `case_template_versions` | immutable: `field_schemas` (the Phase 7 union, validated by the C104 walker [R6][O1]), `statuses` (`[{ key, label, category: open \| pending \| resolved, pauses_sla }]`), `initial_status`, `resolutions` (strings, public [O1]), `name_prefix` (for `KYC-6`-style names), default queue, SLA policy reference (section 4), the object types a case may hold, the attachment policy (section 5.3) | Draft, published, superseded, exactly as inquiry and report templates; a case keeps the version it was created under |
| `case_queues` (`cqueue_`) and `case_queue_members` | name, status; strategy `manual`, `round_robin` or `least_loaded`; `rr_cursor_user_id`; per-member `active`, `paused_at`, `max_open` | A member must hold the case review permissions (3.7); deactivating a user removes them from every queue |
| `cases` (`case_`) | template version, queue, `name` (unique per environment), `status_key`, `status_category`, `resolution`, `assignee_user_id`, `assigned_at`, the creator, assigner, resolver and updater as `(type, id)`, `resolved_at`, `tags text[]`, sealed `fields` (row-bound AAD [R14]), the SLA columns of 4.4, `redacted_at`, `version` (optimistic concurrency) | `name` comes from a per-template counter row taken `FOR UPDATE` in the creating transaction, so names are gap-tolerant but unique |
| `case_inquiries`, `case_accounts`, `case_reports`, `case_verifications`, `case_transactions`, `case_graph_queries` | `(environment_id, case_id, object_id, added_by_type, added_by_id, added_at)` | One join table per object type with composite foreign keys to `(environment_id, id)`, as Phase 6's report joins do [R5], so the database refuses a cross-environment link and redaction cascades are explicit. At most 100 held objects per case. "sars" and documents wait (no such objects in OpenVerify yet) |
| `case_comments` (`cscm_`) | commenter `(type, id)`, sealed `message`, `mentioned_user_ids`, timestamps, `edited_at`, `redacted_at` | Section 5 |
| `case_attachments` | section 5.3 | Not the `files` table, whose rows must belong to a verification [R15] |
| `case_history` | append-only `(case_id, seq, at, actor_type, actor_id, kind, from, to, request_id)` | The reviewer timeline. Values are PII-free by rule: field changes record the keys, comment and attachment entries their ids |

**Holding an object grants nothing.** A case can hold an inquiry the reader cannot open; the case page then shows the held object's id and type with "no access" rather than its content, and every link goes through the object's own route and scope (inference, consistent with the masking-at-every-exit pattern [R6]).

### 3.3 Queues and assignment strategies

All three strategies end in the same transition (`assign`), which writes `assignee_user_id`, `assigned_at`, the assigner `(type, id)` (`user`, `workflow-run`, or `case-assignment-policy` for a queue strategy, as the public enum names [O1]), a history row and `case.assigned`.

- **Manual.** `POST /cases/{id}/assign` with `meta.user-email-address` for parity [O1] and `meta.user-id` (ours, so an integration need not handle email addresses). The target must be an active member of the organisation with the review permissions; a refusal names the reason, never whether an email address exists in another organisation (inference).
- **Pull ("next case").** A reviewer takes the most urgent unassigned case from the queues they belong to. `SKIP LOCKED` is built for exactly this: rows another transaction holds are skipped, which the PostgreSQL manual describes as an inconsistent view suitable for queue-like tables with several consumers [D19].

  ```sql
  -- inside one transaction; $1 = environment, $2 = the reviewer's queue ids
  SELECT id FROM cases
   WHERE environment_id = $1 AND queue_id = ANY($2)
     AND assignee_user_id IS NULL AND status_category <> 'resolved' AND redacted_at IS NULL
   ORDER BY sla_expires_at NULLS LAST, created_at, id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  -- then UPDATE … SET assignee_user_id = $reviewer … WHERE id = $picked
  ```
  An index on `(environment_id, queue_id, sla_expires_at, created_at, id) WHERE assignee_user_id IS NULL AND status_category <> 'resolved'` keeps it an index scan (inference; to be confirmed with `EXPLAIN` in a Testcontainers test, as Phase 7 does for its plans [R23]).
- **Round-robin (push, on entering a queue).** Lock the queue row (`SELECT … FROM case_queues WHERE id = $1 FOR UPDATE`), pick the first eligible member after `rr_cursor_user_id` in user-id order (eligible: active, not paused, under `max_open`), assign, move the cursor, commit. The queue lock serialises concurrent assignments into one queue, so no two cases read the same cursor (inference). If no member is eligible, the case stays unassigned in the queue and is picked up by pull or by the next membership change.
- **Least-loaded.** Same queue lock, then count each eligible member's open assigned cases and take the smallest, ties to the least recently assigned, then user id. A locking clause cannot be combined with aggregation [D19], which is why the queue row is the lock. A member in two queues can be counted by two queue transactions at once, so the balance across queues is approximate; that changes only balance, never correctness (inference). If exact counts matter, keep `case_member_loads(user_id, open_count)` updated in the same transactions and lock those rows in user-id order to avoid deadlocks (inference).
- **Fairness.** For cases: earliest SLA deadline first, then age, so nothing starves while deadlines advance (inference). For reviewers: round-robin gives each eligible member one turn per cycle; paused members are skipped and do not keep a turn; `max_open` stops one fast reviewer from hoarding (inference). Every automatic assignment is explainable from the history row (strategy, cursor or counts at the time).
- **Re-assignment.** When a member is removed, deactivated or loses permissions, their open cases return to the queue (or to the queue's strategy) in one sweep, with history rows and `case.assigned` to `null` (inference; whether the public event fires on unassignment is not documented).

### 3.4 The status machine and the audit trail

- **States.** A template version defines statuses with a category (ours): `open`, `pending` (waiting on someone; pauses the SLA by default) and `resolved`. The public examples treat both statuses and resolutions as operator-defined strings [O1], so the categories are what the engine reasons about (inference).
- **Transitions (pure, in `packages/core`, like the existing inquiry, verification, report and report-match machines [R24]).**
  - `set-status` between non-resolved statuses: `case.status-updated`.
  - Into `resolved` (ours): requires a `resolution` from the version's `resolutions`; sets `resolved-at` and the resolver; `case.status-updated` then `case.resolved`.
  - Out of `resolved` (to an open or pending status): `case.reopened`; the current `resolution` and `resolved-at` are cleared, the earlier ones stay in history (ours; the public reopen semantics are **not documented** here).
  - Queue change: `case.queue-updated`; fields: `case.updated-fields` (keys only); tags: `case.updated-tags`; redaction: `case.redacted`; export: `case.exported`; SLA: `case.sla-expired` (section 4) [R4].
  - Every transition takes the case row `FOR UPDATE`, checks `version` when the caller sent one (409 on mismatch), writes history and stages events through the transactional publisher in the same transaction [R17].
- **Resolving a case decides nothing else.** Approving or declining a held inquiry is a separate, explicit action with the inquiry's own scope and its own events; a workflow can chain them (the "case" trigger and the "on resolved" event [S1][S2]). This keeps decisions about a person explicit, in the spirit of ADR 0002's rule that nothing is approved without evidence [R3], and of Phase 7 decision 18, which allows an automatic decline on a signal only through a workflow an operator writes [R6].
- **Three records, three purposes.** `case_history` is the timeline a reviewer reads (append-only; no update or delete route); platform `events` feed webhooks; `audit_logs` record who read or changed what, including every unmask of sealed fields and every attachment view (as `file.viewed` does today [R16]).

### 3.5 Fields, tags and search

- **Fields** reuse Phase 7's field-schema walker (C104) because the template's `field-schemas` is the same public union [O1][R6]; stored as one sealed JSON per case; masked member-wise without `pii:view`; an alias or `write_once` field behaves as it does for transactions.
- **Tags** as `text[]` with GIN, as for accounts [R23].
- **Search.** `POST /cases/search` compiles the public boolean tree (depth 2, 20 clauses) into parameterised SQL over plaintext columns only (status, template, queue, assignee, tags, timestamps, SLA state); sealed fields are searchable only through keyed indexes for fields the operator marks `searchable`, as Phase 7 does for transactions (inference) [R23].

### 3.6 Redaction and retention

- **Case redaction** (`case.redacted`): comment messages set to null with ids and timestamps kept (the public behaviour [O1]); sealed `fields` nulled; attachments' objects deleted with every stored version [R13] and their rows marked; history kept (it is PII-free by construction); held objects are **not** redacted with the case (they have their own lifecycle and scopes) unless the operator also redacts them (inference).
- **A held object redacted elsewhere** stays linked and shows "redacted" (the console already has `RedactedValue` [R11]).
- **Retention** (ours, mirroring C16 and Phase 6's report retention [R5]): `case-retention-days` counted from `resolved_at`, enforced by redaction, never deletion.

### 3.7 Scopes and roles (ours)

`cases:read`, `cases:write` (create, fields, tags, held objects, comments, attachments), `cases:assign` (assign others; self-assignment through "next case" needs only `cases:write`), `cases:resolve`, `cases:redact`, `cases:export`, `case-templates:read|write|publish`, `case-queues:read|write`, and for workflows `workflows:read|write|publish` and `workflow-runs:read|write` ([S2] owns the last two). The viewer role automatically gets every `:read` that is not in `NOT_FOR_VIEWERS` [R12]; that is acceptable for `cases:read` because sealed values stay masked without `pii:view`. `cases:export` is not a `:read`, so viewers do not get it. The reviewer role gets cases read, write, assign, resolve and redact; whether it also gets export is an owner decision (section 12).

## 4. SLA timers

### 4.1 What is public

A case carries a nullable `sla-expires-at` instant, and `case.sla-expired` is a public event whose example payload is the case document itself (with `sla-expires-at` set and the case still `Open`) [O1][R4]. How an SLA is configured (its duration, calendar, business hours, holidays, pausing, what happens on reassignment or reopening) is **not documented** in the public objects; the docs and help centre are [S1]'s subject. Everything below that goes beyond those two identifiers is ours.

### 4.2 Policies and business calendars (ours)

- **SLA policy** (versioned, referenced by a case template version): `target` (business minutes, 1 to 525,600), `calendar-id` or `24x7`, `starts-on` (`created`, `entered-queue` or `assigned`), `pause-categories` (default `pending`), `on-reopen` (`continue` or `restart`).
- **Business calendar** (versioned): `time-zone` (an IANA id), `week` (per weekday, zero or more `[start, end)` local wall-clock intervals, `HH:MM`, non-overlapping, at least one business hour per week), `holidays` (local dates `YYYY-MM-DD`, each with a label; closed all day), optional `closures` (local date-time ranges). Validation refuses a zone the runtime does not know (Luxon, for example, marks such a zone invalid with the reason "unsupported zone" [D7]).
- **The tz database** that every runtime uses is public domain ("all files in the tz code and data … are in the public domain", with three BSD-licensed code files when present) [N28], so zone rules carry no licence question. The API image's Node 22.22.1 has ICU 78.2 with tz data **2025c** [R22]; Postgres has its own copy. Business time is computed only in the API, never in SQL, so one tz version decides each deadline (inference).

### 4.3 Time zones and daylight saving time

- **Store instants, compute in local time.** Deadlines and every SLA timestamp are `timestamptz` instants. Business intervals are defined in the calendar's local wall time and converted to instants day by day.
- **Gaps and repeats.** On a spring-forward day some local times do not exist; on a fall-back day some occur twice. Temporal's `ZonedDateTime` lets the caller choose: `earlier`, `later`, `compatible` (the default: later for gaps, earlier for repeats, as `Date` does) or `reject` (throw) [D11]. Luxon moves a nonexistent time forward by the gap, but its own docs call its handling of ambiguous (repeated) times **undefined** [D7]. A day of 09:00–17:00 is unaffected by a 02:00 transition, but 24-hour desks and zones that change at midnight are (inference).
- **Choice (recommendation).** Validate calendars with `reject`, so a boundary that falls in a gap or repeat in the next two years is refused with the dates named; compute deadlines with `compatible`. An interval boundary at local midnight is written `00:00`, which is the case that exposes midnight transitions (inference).
- **Arithmetic.** "Target" is elapsed business time: the deadline is the instant at which the sum of business-interval durations since the start (net of pauses) reaches the target. A DST shift inside business hours therefore counts real elapsed time (inference). Luxon's docs make the same distinction between variable-length units (days) and exact units (hours) [D7].
- **Rule changes.** If the tz database changes a zone's rules after a deadline was computed, the stored instant stays; MDN describes the same hazard for stored timestamps (its Brazil example) [D11]. A maintenance command `cases:sla-recompute` recomputes running deadlines after a Node upgrade that changes tz data (inference).
- **Test fixtures (inference: from tz rules; each test asserts the runtime's offsets first, so a changed tz database fails loudly):** America/New_York on 2026-03-08 and 2026-11-01 (the transitions measured in this session with `Intl` [M2]), Europe/London, Asia/Kolkata (no DST, +05:30), Australia/Lord_Howe (a 30-minute DST shift), Pacific/Chatham (+12:45), and one zone that changes at local midnight.

### 4.4 Pausing and the state on the case

| Column | Meaning (ours) |
|---|---|
| `sla_policy_version_id` | pinned at start, like the template version |
| `sla_state` | `none`, `running`, `paused`, `met`, `expired` |
| `sla_epoch` | incremented on every start, pause, resume and recompute; a timer for an old epoch does nothing |
| `sla_consumed_ms` | business milliseconds used before the current running segment |
| `sla_segment_started_at` | start of the current running segment |
| `sla_expires_at` | the public `sla-expires-at`; null while paused or not started |
| `sla_expired_at`, `sla_met_at` | when it fired or was met |

Pause (the status enters a pause category): `consumed += businessTime(segment start, now)`, `expires_at = null`, epoch + 1. Resume: `segment start = now`, `expires_at = addBusinessTime(now, target − consumed)`, epoch + 1. Resolve: `met` if before the deadline; an expired SLA stays `expired` (the breach is a fact) and the case still resolves. Reopen: `continue` or `restart` per the policy. A calendar change (a holiday added) recomputes running deadlines of cases on that calendar, with history rows (inference; owner question 6). All of this is two pure functions in `packages/core`, `addBusinessTime(start, ms, calendar)` and `businessTimeBetween(a, b, calendar)`, with a bound on the days scanned (3,660) so a misconfigured calendar cannot loop, and property tests (adding then measuring returns the input; both are monotonic) (inference).

### 4.5 Libraries

| Library | Latest / newest passing | Licence | Zones and DST | Verdict |
|---|---|---|---|---|
| **`temporal-polyfill`** | 1.0.6 (2026-10-13T20:13Z: passes the date rule, but pnpm refuses it until 2026-10-27T20:13Z) / **1.0.5** (2026-09-11) | MIT (LICENSE in the 1.0.5 tarball) [N10] ✅; deps `temporal-spec` 1.0.1 (Apache-2.0, types only) ✅ and `temporal-utils` 1.0.3 (MIT) ✅ | Full Temporal: `ZonedDateTime` with the four `disambiguation` modes [D11]. The README claims "less than 20 kB" [D9]; the global build measured 189,821 B, 33,625 B gzip [M1] | ✅ **recommended for the API**: Temporal is a finished proposal expected in ES2027 [D10], absent from Node 22.22.1 [R22] and of limited browser availability [D11], so a ponyfill now and the native object later |
| `@js-temporal/polyfill` | **0.5.1** (2025-03-31) | ISC ✅; dep `jsbi` 4.3.2 (Apache-2.0) ✅ [N10] | Full Temporal | ⚠️ works, but its last release is 19 months old and it is about 3 MB unpacked |
| **Luxon** | **3.7.2** (2025-09-05) | MIT at `4262a38d` ✅ [N9] | IANA zones through `Intl` [D7]; ambiguous local times undefined [D7] | ✅ alternative: already in the lockfile through `bullmq` → `cron-parser` 5.10.1 [R18], so adopting it adds no package; the gap and repeat checks of 4.3 would be ours |
| `date-fns` + `@date-fns/tz` | **4.4.0** (2026-05-29) + **1.5.0** (2026-05-21) | MIT (registry; `@date-fns/tz` LICENSE.md at `main`) ✅ [N8] | `TZDate` does `Date` arithmetic in a given zone (916 B to 1.2 kB) [D8]; gap and repeat behaviour **not documented** in its README | ✅ fine for display; not chosen for deadline arithmetic |
| `date-fns-tz` | **3.2.0** (2024-09-30) | MIT ✅ [N8] | older helper pair for date-fns 3 and 4 | not needed |

### 4.6 Holiday data

| Source | Licence | Verdict |
|---|---|---|
| `date-holidays` 3.38.0 (2026-10-24) / 3.37.0 (2026-09-20) | The registry says `(ISC AND CC-BY-3.0)`, but the LICENSE file at `v3.37.0` says the holiday data in `holidays.yaml` is **CC BY-SA 3.0** because it relies on Wikipedia articles, with the code under ISC [N11]. Its parser pulls `moment-timezone`, `astronomia` and calendar packages | ❌ share-alike data is not on the allow-list (rule 4 lists CC-BY, not BY-SA) [R2]; also a correction to the registry metadata |
| `holidays` (PyPI) 0.107 (2026-10-19) / **0.106** (2026-10-05) | MIT at `v0.107` [N12]; data are Python code | ⚠️ permissive, but Python (the SLA code is TypeScript), maintained by volunteers, and public holidays differ by region and employer (inference). Usable only as an operator's own tool to produce a CSV |
| iCalendar import | `ical.js` 2.2.1 is MPL-2.0 ❌ at runtime; `node-ical` 0.27.3 (2026-10-03) is Apache-2.0 and pulls `temporal-polyfill` and `rrule-temporal` [N13] | Not needed in Phase 8 |

**Recommendation.** Ship **no** holiday data. Operators enter holiday dates in the console or import a CSV of `date,label` through Phase 7's `csv-parse` pipeline [R6]. The docs point to their government's published calendar. This keeps the SLA honest: OpenVerify never claims to know an operator's holidays (inference).

### 4.7 Firing the expiry reliably

- **The database row is the source of truth**, as for webhook deliveries [R17]. A repeatable `case-sla` sweep (every 30 s, ours) takes due rows in batches:

  ```sql
  SELECT id, sla_epoch FROM cases
   WHERE sla_state = 'running' AND sla_expires_at <= $now
   ORDER BY sla_expires_at
   LIMIT 500
   FOR UPDATE SKIP LOCKED;
  ```
  and for each row, in a savepoint, sets `sla_state = 'expired'`, `sla_expired_at = $now`, writes a history row and stages `case.sla-expired` through the transactional publisher; events dispatch after commit, as `inquiry-expiry` does [R17]. Because the state changes in the same transaction as the event is staged, the event fires **once per epoch** however many sweepers run (inference).
- **With the engine's timers.** If Phase 8's engine keeps a generic durable timer table with fenced claims [S2], the SLA uses it (`kind = case_sla`, subject = case id, `epoch`), and the handler re-checks `sla_state` and `sla_epoch` under the row lock, so a pause or resume never needs to delete a timer (inference).
- **Not BullMQ delayed jobs alone.** A delayed job may be lost if Valkey loses data, and a pause would have to find and remove it. A delayed job may be added as a latency hint, never as the trigger of record (inference).
- **Lateness** is bounded by the sweep interval plus batch time; consumers should read `sla-expires-at` in the payload, not the delivery time. One clock (the injected `Clock` port) is used for both computing and comparing deadlines (inference).
- **Workflows.** `case.sla-expired` is an event like any other, so escalation (reassign, raise priority, notify) is a workflow on that event [S1][S2], not hard-coded behaviour.

## 5. Comments and attachments

### 5.1 Comments: storage, mentions and rendering

- **Public shape.** `add-comment` takes `meta.message` (at least one character); a comment has `message`, `commenter-id`, `commenter-type`, timestamps and `redacted-at`, and its message becomes null on redaction [O1]. Whether the message is Markdown, whether mentions exist and whether comments can be edited are **not documented** in the objects ([S1]).
- **Storage (ours).** `case_comments.message` sealed with row-bound AAD [R14]; at most 10,000 characters (ours; the inquiry note's cap is 2,000 [R11]); `mentioned_user_ids` as a separate validated array; edits allowed to the author for 15 minutes, each edit kept in history as "edited" without the old text (inference: keeping old text would keep PII the author meant to remove). No delete route: removal is redaction (null message, ids and times kept, as the public object does [O1]).
- **Mentions (ours).** The editor offers a list box of users who can read the case; the stored text carries a token such as `@[usr_…]` and the server checks each id against the organisation and the case's read permission. A mention creates an in-console notification and, if the operator configured the email adapter (Mailpit in development), an email that contains **a link only, never the comment text**, since the text may hold personal data (inference).
- **Default rendering: plain text.** Render as React text with `whitespace-pre-wrap`, as the inquiry note does [R11], with mention tokens and OpenVerify ids (`inq_…`, `acc_…`, `case_…`) turned into links by our own tokenizer, and bare `https://` URLs shown as text with an explicit "open link" control that shows the host first (inference). React escapes text, and OWASP lists text sinks as safe [W3]. This needs no new dependency.
- **If Markdown is wanted (owner question 7), two safe routes:**
  1. **`react-markdown` 10.1.0** (MIT, 2025-03-07) renders Markdown to React elements without `dangerouslySetInnerHTML`; raw HTML is escaped, or dropped with `skipHtml`; `allowedElements` limits tags; the default `urlTransform` makes URLs safe, and the README warns that replacing it, or adding plugins and components, can reopen XSS and suggests `rehype-sanitize` (MIT, 6.0.0) as the backstop [N18]. It brings the unified/remark/rehype tree (about a dozen MIT packages, inference from its dependency list).
  2. **`markdown-it` 15.0.2** (MIT, 2026-09-11; the default preset has `html: false`; `validateLink` refuses `javascript:`, `vbscript:`, `file:` and `data:` links except `data:image/gif|png|jpeg|webp` [M1]) producing an HTML string, then **DOMPurify** 3.4.17 on that string before `dangerouslySetInnerHTML`. OWASP recommends DOMPurify for HTML sanitising, warns that modifying content after sanitising voids it, and asks for regular updates because bypasses keep appearing [W3]. DOMPurify on the server needs a DOM such as an up-to-date jsdom, and its README says happy-dom is not safe [N15]; so sanitise in the browser (a client component), where it is 29,828 B minified [M1]. DOMPurify can return `TrustedHTML` (`RETURN_TRUSTED_TYPE`) for a later Trusted Types policy [N15].
  Either way: no images (an image in a comment is a request to whatever host the author chose, which leaks the reader's address and reading time; the console's future `img-src 'self'` would also block it) (inference), no raw HTML, links limited to `https:` and `mailto:` with `rel="noopener noreferrer nofollow"`, and server-side length and nesting caps.
- **`sanitize-html`** 2.18.0 (MIT, 2026-09-30; latest 2.18.1, 2026-10-14) sanitises on the server with `htmlparser2` and `postcss` [N16]; it would let a server component render sanitised HTML. It is a second sanitiser to keep patched, so it is not recommended alongside DOMPurify (inference). `isomorphic-dompurify` 4.5.0 (MIT) brings jsdom 30 into the console server [N17]; not needed if sanitising happens in the browser. `marked` 18.1.1 (MIT, 2026-10-12) is another parser with no sanitiser of its own (registry facts only) [N19].

### 5.2 Licences of the comment stack

| Package | Version (latest / newest passing) | Licence | Verdict |
|---|---|---|---|
| `markdown-it` | 15.0.3 (2026-10-16) / **15.0.2** (2026-09-11). By date the newest passing release is 14.3.2 (2026-09-12) on the 14 line | MIT at `3c51991c` [N14] | ✅ |
| its dependencies at 15.0.2 | `argparse` ^3 → **3.0.2** (2026-09-10; latest 3.0.4), `entities` 8.1.0, `linkify-it` 6.1.0, `mdurl` 2.1.0, `uc.micro` 3.0.0, `punycode.js` 2.3.1 | `argparse` **PSF-2.0** (LICENSE at `b24ea189`: the PSF licence version 2); `entities` BSD-2-Clause; the rest MIT [N14] | ✅ all on the list. `argparse` serves only the CLI in `bin/` [M1]. Note: markdown-it **14.x** depends on `argparse` ^2.0.1, whose registry licence is `Python-2.0`, not literally on the list (⚠️), which is another reason to take 15.0.2 |
| `dompurify` | **3.4.17** (2026-10-12) for both | registry `(MPL-2.0 OR Apache-2.0)`; the LICENSE file at `a77a3e78` holds the Apache-2.0 text; the built file's header names both licences [M1][N15] | ✅ **under its Apache-2.0 option**. Rule 4 allows a dual licence when one option passes [R2]; the MPL option is not used, so the shipped-weak-copyleft question (as for Eigen in onnxruntime-web [R19]) does not arise. Record the choice in `THIRD_PARTY_LICENSES.md` |
| `react-markdown` | **10.1.0** (2025-03-07) | MIT at `44d2e4a4` [N18] | ✅ |
| `rehype-sanitize` | **6.0.0** (2023-08-26) | MIT [N18] | ✅ |
| `sanitize-html` | 2.18.1 / **2.18.0** | MIT (LICENSE in the apostrophe monorepo at `9500b8b0`) [N16] | ✅ (not recommended, see above) |

### 5.3 Attachments through the existing storage

- **Public shape.** A case lists `attachments` with `filename`, `url` and `byte-size`; no upload path appears in the public surface (**not documented** here) [O1][R4].
- **Table (ours).** `case_attachments` (a new prefix of lowercase letters, for example `catt`): `case_id`, `storage_key` from `newStorageKey(environment)` [R13], `wrapped_dek` from `encryptBytes` with the attachment id as context [R14], `mime_type` sniffed, `byte_size`, `sha256`, sealed `original_filename` (a filename like `passport-avery-example.jpg` is personal data, inference), `uploaded_by_type`/`_id`, `scan_status` (`not_scanned`, `pending`, `clean`, `infected`, `error`), `scan_provider`, `scanned_at`, `deleted_at`.
- **Limits (ours, following OWASP's checklist: allow-listed types, the type validated from content rather than `Content-Type`, generated names, a size limit, authorised users only, storage outside any web root, antivirus where available [W2]).** Types: JPEG, PNG, WebP, PDF (the existing detectors: magic bytes, and a `%PDF-` header within the first 1,024 bytes [R15]); 10 MiB per file (the existing `MAX_UPLOAD_BYTES` [R15]); 20 attachments per case; filenames from clients never reach a header, a path or an object key.
- **Images are re-encoded.** OWASP advises decoding and re-encoding images while removing unneeded metadata, and notes that the image processor itself handles untrusted input and should be sandboxed and limited [W2]. The vision service already decodes images with Pillow and reads EXIF without returning GPS values [R21]; a new vision endpoint can return an EXIF-upright, metadata-free rendition, which is what the console and every export show (inference). Whether the original is kept (sealed, for evidence) or discarded is an owner decision (section 12).
- **PDFs are never rendered in the console**, as today: served as an attachment under a server-made name [R9][R16]. A preview, if wanted, is page images rendered by the vision service's guarded PDF child (Phase 5), never the PDF itself (inference).
- **Download.** `Content-Disposition: attachment; filename="case-attachment-<id>.<ext>"`, `nosniff`, `private, no-store`, and an audit entry per view, mirroring `file.viewed` [R16]; through the console's authenticated proxy, never a direct storage URL (section 7.4).

### 5.4 Malware scanning

- **ClamAV's licence.** ClamAV is GPL-2.0 (`COPYING.txt` on its main branch) [N29]. Rule 4 governs what OpenVerify depends on and ships [R2]. If OpenVerify never links, bundles or redistributes ClamAV and only talks to an operator-run `clamd` over its documented socket protocol, ClamAV is not a dependency (inference). The GNU FAQ says pipes, sockets and command-line arguments are normally used between separate programs, unless the exchange is intimate enough to amount to shared internal data structures, and that containers do not change that analysis [D17]. `INSTREAM` sends file bytes in length-prefixed chunks and receives a verdict line [D16], which is not an intimate exchange (inference). **Not legal advice**; the owner decides whether an optional compose profile may reference the official `clamav/clamav` image (section 12).
- **The client.** `clamscan` 2.4.0 (MIT, 2024-10-21) [N29], or a small client of our own: the protocol is a framed command, 4-byte big-endian chunk lengths and a zero-length terminator, capped by `clamd`'s `StreamMaxLength`, which answers "INSTREAM size limit exceeded" when passed [D16]. Our own client (recommendation) avoids a dependency and lets us map every non-clean answer, including a size-limit refusal, to `error`, never to `clean`.
- **Security properties and what they do not cover.** `clamd`'s TCP socket is neither encrypted nor authenticated and must not face untrusted networks [D16], so OpenVerify's docs should require a Unix socket or a private network. `clamd` parses hostile files, so it runs in its own container with no other access (inference). It needs about 3 GiB of RAM at minimum and 4 GiB preferred, and briefly twice its signature memory during reloads [D16]. Signatures update only through `freshclam` or `cvdupdate`; scripted downloads are refused upstream [D16]. A clean verdict says no known signature matched; it does not detect new or targeted malware (inference). The signature database's own licence was **not established** in the pages read (gap).
- **Port and tiers (ADR 0002 [R3]).** `AttachmentScanner` with providers `none` (default: every attachment is `not_scanned`, and the console says so), `clamd` (operator-run), and `sandbox` (deterministic: the EICAR test string is `infected`, everything else `clean`; refused in production). A file is downloadable while `not_scanned` or `pending` only behind a warning; `infected` files are never served, only redacted (inference).
- **Alternatives.** Commercial scanners behind the same port (A tier, operator account); YARA rules match patterns, not a curated antivirus corpus (inference); public multi-scanner services raise the data-leakage concern OWASP names [W2], and identity documents must not be sent to them (inference). Re-encoding images (5.3) and rasterising PDFs are the content-disarm measures OWASP lists [W2], and they do not depend on a scanner.

### 5.5 PII, redaction and retention per item

| Item | Personal data | Masking | Redaction | Retention |
|---|---|---|---|---|
| Comment text | yes (reviewers quote names, numbers) | masked without `pii:view` (ours) | message null; ids, author and times kept [O1] | with the case (3.6) |
| Mentions | operator user ids, not subject data | shown to case readers | kept (they are operator data) | with the case |
| Attachment content | yes, often special-category (identity documents) | needs `pii:view` and `cases:read`, like file content today [R16] | object and every stored version deleted [R13]; row kept with `deleted_at` | with the case; never longer than the held inquiry's biometric retention when the file is a face image (inference) |
| Attachment filename | possibly | sealed; never in logs or headers | nulled | with the case |
| Scan results | no | — | kept (status only) | with the case |

## 6. Export and print

### 6.1 What is public, and what earlier phases decided

`case.exported` is a public event [R4]; the export's format and route are **not documented** in the surface index. `print` routes exist for inquiries, reports and verifications (`…/{id}/print`) but **not for cases** [R4], and Phase 6 put `print` in Phase 9 [R5]. So Phase 8 needs: CSV and JSON exports with `case.exported`, and a printable case page; a server-made PDF can wait for Phase 9's `print` routes (recommendation).

### 6.2 CSV with formula-injection neutralising

- **The risk.** A spreadsheet treats a cell starting with `=` as a formula, which can exploit the spreadsheet program, rely on users clicking through warnings, or exfiltrate data from open sheets [W1]. Case fields, comments, names and tags are attacker-influenced (a fraudster picks their own name and email), so every export is exposed (inference).
- **Rule.** Use Phase 7's shared writer (`packages/checks/src/csv/`, C100.6): quote every field, double embedded quotes, and prefix `'` to a cell that starts with `=`, `+`, `-`, `@`, tab, CR, LF or the full-width `＝`, `＋`, `－`, `＠` [R6]. That is OWASP's list, including the full-width forms that some locales read as formulas and the reminder that separators and quotes must be handled too because they can start a new cell mid-value [W1]. OWASP also warns that Excel may drop quotes and escapes when a file is saved and reopened, re-arming a neutralised formula [W1]; the docs repeat that no escape is safe in every spreadsheet.
- **Content (ours).** One row per case: id, name, template, status, status category, resolution, queue, assignee id, created, assigned, resolved, SLA state, `sla-expires-at`, tags, and the ids of held objects. Sealed `fields` only with `pii:view` and an explicit "include fields" choice; comments never in CSV (multi-line personal text belongs in JSON).
- **Mechanics (ours).** An export is an asynchronous job (at most 10,000 cases), its file encrypted into storage under a new key and downloadable through the console's proxy for 24 hours, then deleted; one audit entry per export with the filter and counts; `case.exported` per exported case, since the public event's subject is a case (inference) [R4].

### 6.3 JSON

A per-case JSON bundle (ours): the case document as the API returns it, its history, comments, attachment metadata (not bytes), and the held objects' ids and types. Masking follows the requester's permissions at every exit, as the existing contract builders do [R6]. JSON has no formula problem, but a consumer may paste values into a spreadsheet, so the docs point to the CSV rule (inference).

### 6.4 Printing in the browser (Phase 8)

- **Print stylesheet.** `@media print` with `@page` for size and margins; `@page` is Baseline 2024, working across current browsers since December 2024 [D13]. The print view hides navigation, toasts and action controls, expands closed `<details>`, keeps each image with its caption (`break-inside: avoid`), and prints a footer with the environment (sandbox or production), case id, the printing operator's id, the time, and "contains personal data" when it does (ours).
- **What the browser gives for free.** Images print with EXIF orientation applied, because `image-orientation: from-image` is the initial value and is Baseline [D12]; WebP prints; the system fonts cover the scripts of real names, so no font ships (inference; the console bundles no web font [R11]).
- **Audit.** The Print button writes an audit entry before calling `window.print()`; the browser's "save as PDF" is outside our control (inference).

### 6.5 A server-made PDF (for Phase 9's `print` routes)

| Option | Latest / newest passing | Licence | Images | Fonts | Verdict |
|---|---|---|---|---|---|
| `pdf-lib` (+ `@pdf-lib/fontkit` for custom fonts) | **1.17.1** (2021-11-06) for both; fontkit **1.1.1** (2020-11-28); `@pdf-lib/standard-fonts` 1.0.0, `@pdf-lib/upng` 1.0.1 | MIT (LICENSE.md at `v1.17.1`; standard-fonts MIT) ✅ [N20] | JPEG and PNG only (`embedJpg`, `embedPng`) [D14]. The JPEG embedder reads only the frame header and writes **the original bytes** as the image stream (`DCTDecode`) [D14], so EXIF segments, GPS included, go into the PDF and the orientation flag is ignored (inference from the code) | The 14 standard fonts use WinAnsi, 218 Latin characters; anything else needs an embedded font through fontkit [D14] | ⚠️ permissive, but no release for almost five years (maintenance risk), and every image must be pre-processed |
| `pdfmake` on `pdfkit` | pdfmake 0.3.13 (2026-10-25) / **0.3.11** (2026-06-12), depending on `pdfkit` ^0.19.1 (**0.19.1**, 2026-06-10); pdfkit latest **0.20.2** (2026-08-30) | MIT for both (LICENSE at `c880a938` and `8d72a71c`) ✅ [N21]; pdfkit ships the standard fonts' AFM metric files under Adobe's own notice (free use, copying and distribution provided the notices stay and modifications are marked) [D15] ⚠️ (a permissive notice that is not one of rule 4's names [R2]) | pdfkit 0.20.2 reads the JPEG EXIF orientation and accepts JPEG and PNG only; anything else is "Unknown image format" [D15]. Its loader reads a **string image source as a local file path** [D15], so a document definition must never carry a caller's string as an image source (inference) | pdfmake's bundled default fonts were not checked (gap); a font that covers many scripts is usually under the SIL Open Font License, which rule 4 does not name (inference; owner question 9) | ⚠️ best of the libraries, after the font decision |
| `jspdf` | **4.2.1** (2026-03-17) | MIT ✅ [N22] | — | — | browser-first; not assessed further |
| A headless browser rendering the print view | — | not reviewed here (gap) | same as 6.4 | system fonts of the image | not recommended: a browser in the API image is a large attack surface whose third-party licences need their own review (inference) |

**Either library needs the same pre-processing (recommendation).** Every image goes through the vision service's rendition endpoint (5.3): EXIF-upright, metadata stripped, re-encoded as JPEG or PNG. That removes GPS and other metadata, fixes orientation for pdf-lib, and makes WebP printable, since neither library embeds WebP [D14][D15].

### 6.6 What a printout or export must leave out or mask

- **Default is the masked view.** Printing and exporting start from what the requester sees without `pii:view`. "Include personal data" needs `pii:view` (and `cases:export` for exports), shows a confirmation, and is recorded with the audit entry (ours).
- **Never included:** secrets and tokens (API keys, webhook secrets, session or one-time-link tokens, MFA material); storage keys and wrapped data keys; raw face templates or embeddings; raw device or browser fingerprints (Phase 7 masks them [R6]); EXIF and GPS metadata (6.5); data of other environments; IP addresses and user agents unless `pii:view` (masked today [R12]).
- **Included only with personal data on:** case `fields`, comment text, attachment filenames, held objects' personal attributes, document and selfie images. Identity images and face photos are biometric or special-category data in many regimes (Phase 7's note [R23]); the printout's footer says so.
- **Redacted content** prints as "redacted", never as an empty value (the console's `RedactedValue` [R11]).

## 7. The reviewer UI with side-by-side images

### 7.1 Layout

A case page has a header (name, status, resolution, assignee, queue, SLA state as text and time remaining), the held objects, the timeline (history and comments), attachments, and a **compare panel**. The compare panel builds on what the selfie card already does (the ID front beside the centre pose, with the similarity, threshold and its basis, text badges and person-neutral alt texts [R10]) and adds zoom, pan, rotate-for-viewing and a linked view. Side by side above 1,024 px, stacked below; the images themselves are two-dimensional content, which 1.4.10 exempts, but the controls and text reflow [A10].

### 7.2 Zoom and pan libraries

| Library | Latest / newest passing | Licence | Size (measured) | What it brings | CSP and accessibility findings | Verdict |
|---|---|---|---|---|---|---|
| **`@panzoom/panzoom`** | **4.6.2** (2026-04-02) for both | MIT (`MIT-License.txt` in the tarball) ✅ [N24] | ES build 26,822 B, **6,733 B gzip**; no dependencies | Pan and zoom of one element by CSS transform; a programmatic API (zoom in, zoom out, pan, reset) | Static scan found no `<style>` injection, `innerHTML`, `eval`, workers or fetches [M1]; no keyboard handling of its own, so buttons and keys are ours (which lets them meet 2.1.1, 2.1.4 and 2.5.8 by design) | ✅ **recommended** |
| `react-zoom-pan-pinch` | **4.2.0** (2026-09-03) for both | MIT at `34abc1ff` ✅ [N23] | ESM 162,609 B, 32,897 B gzip; no dependencies | React components, pinch, double-click, and built-in keys: arrows pan, `+`/`=` and `-`/`_` zoom, `0` resets, ignoring modifier chords and editable targets [M1] | Inserts a `<style>` element into `<head>` at import time [M1], which a nonce-only `style-src` blocks, so its CSS would have to be supplied separately (inference). Its single-character keys are read by a handler on its wrapper element [M1], so they act only while it has focus (inference), which 2.1.4 accepts [A2] | ⚠️ usable with the CSP work |
| `panzoom` (anvaka) | **9.4.4** (2026-03-26) for both | MIT at `4998d790` ✅; deps `amator` (MIT), `wheel` (MIT), `ngraph.events` (BSD-3-Clause), `bezier-easing` (MIT) ✅ [N25] | not measured | Pan and zoom for DOM and SVG | not scanned | ✅ alternative |
| OpenSeadragon | **6.1.1** (2026-09-09) for both | BSD-3-Clause at `201d4783` ✅ [N26] | minified build 352,735 B | A deep-zoom viewer with its own toolbar | not scanned; tile-oriented viewers fetch many image requests, each of which would be an audited `file.viewed` (inference) | ❌ oversized for two photos of at most 10 MiB |
| Our own (CSS `transform` on an `<img>` in a scroll box) | — | ours | about 150 lines (inference) | exactly what we need | no library CSP risk | ✅ fallback |

### 7.3 EXIF orientation and metadata

- **Display.** Browsers apply EXIF orientation to `<img>` by default (`image-orientation: from-image`, Baseline widely available); MDN warns that, for security reasons, `none` does not undo the EXIF orientation of images it calls non-secure-origin [D12]. The vision service reports boxes "in pixels of the EXIF-upright upload" [R21], so a portrait box drawn over the displayed image lines up with what the browser shows (inference: both apply the same flag).
- **PDF.** pdf-lib ignores the flag; pdfkit applies it (6.5) [D14][D15].
- **Metadata.** Stored originals keep their EXIF, and the vision schema only records whether GPS is present [R21]. Today the console's `<img>` receives the original bytes [R9], so "save image as" yields the GPS tags if the capture had them (inference). Recommendation: serve the metadata-free rendition (5.3) to the console and every export; keep the original for vision and forensic checks only.

### 7.4 Serving sealed images

| Option | How | Verdict |
|---|---|---|
| **Stream through the API and the console's proxy (today)** | `<img src="/files/:id/content">` on the console's origin; the proxy calls the API with the session; the API checks `inquiries:read` and `pii:view`, decrypts, verifies size, SHA-256 and type, audits `file.viewed`, answers `private, no-store` [R9][R16] | ✅ **keep**; add a sibling route for case attachments and for renditions |
| S3 presigned URLs | A time-limited URL straight to the object store | ❌ cannot work as designed: the stored object is AES-GCM ciphertext whose data key is wrapped in the database row [R13][R14], so the browser would receive ciphertext. Making it work means storing plaintext or giving the browser a data key (inference) |
| API-signed capability URLs | An HMAC token over file id, user, session and an expiry of about a minute | Only where a cookie cannot travel (a separate image origin, a server-side renderer). Such a URL works for whoever holds it until it expires, so it can leak through screenshots, logs or history; the console's `no-referrer` policy limits one channel [R7]. Not needed in Phase 8 (inference) |

No `blob:` URLs and no service-worker caching of images: the future `img-src` can stay `'self'`, and nothing is persisted in the browser (inference).

### 7.5 Comparing the document portrait with the selfie

- **Pair.** The ID front zoomed to the portrait box (or the server-written `chip-portrait` for an NFC read [R15]) beside `selfie-center`; the left and right poses on request. "Link views" applies the same zoom and pan to both.
- **Numbers in words.** Show the similarity, the threshold, the threshold's basis and the check status exactly as the selfie card does [R10]; never call a score a "match" when the status says otherwise (ADR 0002 §3c [R3]).
- **Viewing aids only.** Rotate in 90° steps, brightness and contrast through CSS filters, a grayscale toggle; none changes stored data or a check result. Any automated tamper hint stays an H-tier result with its `beta` badge [R3].
- **Decisions stay explicit.** Approve, decline and mark-for-review are buttons with confirmation that call the held inquiry's own routes and scopes (3.4).

### 7.6 Keyboard shortcuts

- WCAG 2.1.4: a shortcut made of character keys only must be possible to turn off, remappable to include a modifier, or active only while its component has focus [A2]. The success criterion's notes count sequences of character keys too [A2].
- **Proposal (ours).** In the image viewer, active only while it has focus: `+`, `-`, `0`, arrows, `R`. Page-level chords: Alt+Shift with a letter for next case, previous case, assign to me, and focus comment. A settings switch turns page-level shortcuts off. Every shortcut is listed in a dialog and exposed with `aria-keyshortcuts` (inference). **No decision has a shortcut**: approving or declining a person needs a button and a confirmation (inference, in the spirit of ADR 0002 [R3]).

### 7.7 WCAG 2.2 AA for the case and reviewer screens

| Criterion | What it requires here (our reading) | Source |
|---|---|---|
| 1.1.1 Non-text content | Alt text names the image's role ("ID front, zoomed to the portrait"), never the person, as today | [A11][R10] |
| 1.4.1 Use of colour | Statuses, SLA state and diff markers as text or icon plus text | [A8] |
| 1.4.3 Contrast (minimum) | Text 4.5:1 (3:1 for large text), including the print view | [A12] |
| 1.4.10 Reflow | Panels stack at 320 px; images exempt as two-dimensional content | [A10] |
| 1.4.11 Non-text contrast | Zoom buttons, focus rings and node outlines at 3:1 | [A6] |
| 2.1.1 Keyboard | Zoom, pan, rotate, compare, assign, comment and resolve by keyboard | [A1] |
| 2.1.4 Character key shortcuts | 7.6 | [A2] |
| 2.2.1 Timing adjustable | Applies to time limits the content sets for the user; an SLA countdown informs the reviewer and does not limit their session (inference), but any auto-release of a pulled case after inactivity would be such a limit | [A13] |
| 2.4.7 Focus visible | A visible focus indicator on every control, including canvas nodes whose default outline is removed | [A14][M1] |
| 2.4.11 Focus not obscured (minimum) | A sticky decision bar or toasts must not hide the focused element | [A7] |
| 2.5.7 Dragging movements | Panning by drag also by buttons; editor connections also through the outline view | [A4] |
| 2.5.8 Target size (minimum) | Controls at least 24 × 24 CSS px or spaced, or an equivalent control on the page | [A3] |
| 4.1.3 Status messages | Assignment, save and SLA changes announced politely without moving focus | [A5] |

## 8. Licence and release-age table

Cutoff 2026-10-13 (section 0). "Ships" means the code reaches a runtime artefact (the console bundle, the API image or the vision image), where rule 4 applies without the tooling exception [R2][R19].

| Package | Latest (date) | Newest passing (date) | Licence (as read) | Where | Verdict | Source |
|---|---|---|---|---|---|---|
| `@xyflow/react` | 12.12.0 (2026-09-24) | **12.12.0** | MIT | console | ✅ | [N1] |
| `@xyflow/system` | 0.0.83 (2026-09-24) | **0.0.83** | MIT | console (dep) | ✅ | [N2] |
| `zustand` | 5.0.16 (2026-10-22) | 5.0.15 (2026-08-13); **4.5.7** (2025-05-15) is what `^4.4.0` resolves to | MIT | console (dep) | ✅ | [N3] |
| `use-sync-external-store` | 1.7.0 (2026-09-09) | **1.7.0** | MIT | console (dep) | ✅ | [N3] |
| `classcat` | 5.0.5 (2024-04-02) | **5.0.5** | MIT | console (dep) | ✅ | [N3] |
| `d3-zoom`, `d3-drag`, `d3-selection`, `d3-interpolate`, `d3-transition`, `d3-dispatch`, `d3-timer`, `d3-color` | 3.0.x / 3.1.0 (2021–2022) | same | ISC | console (dep) | ✅ | [N2] |
| `d3-ease` | 3.0.1 (2021-06-05) | same | BSD-3-Clause | console (dep) | ✅ | [N2] |
| `@dagrejs/dagre` | 3.1.3 (2026-10-24) | **3.1.1** (2026-08-08) | MIT | console | ✅ | [N4] |
| `@dagrejs/graphlib` | 4.0.7 (2026-10-24) | **4.0.5** (2026-08-03) | MIT | console (dep) | ✅ | [N4] |
| `elkjs` | 0.12.0 (2026-07-17) | 0.12.0 | EPL-2.0 OR GPL-3.0-or-later | would ship in the console | ❌ | [N5] |
| `d3-hierarchy` | 3.1.2 (2022-04-02) | **3.1.2** | ISC | console (optional) | ✅ | [N6] |
| `zundo` | 2.3.0 (2024-11-17) | 2.3.0 | MIT | not needed | ✅ | [N7] |
| `temporal-polyfill` | 1.0.6 (2026-10-13T20:13Z, pnpm-refused until 2026-10-27T20:13Z) | **1.0.5** (2026-09-11) | MIT | API | ✅ | [N10] |
| `temporal-spec` / `temporal-utils` | 1.0.1 (2026-07-27) / 1.0.3 (2026-09-11) | same | Apache-2.0 (types only) / MIT | API (deps) | ✅ | [N10] |
| `@js-temporal/polyfill` (+ `jsbi` 4.3.2) | 0.5.1 (2025-03-31) | 0.5.1 | ISC (+ Apache-2.0) | alternative | ✅ | [N10] |
| `luxon` | 3.7.2 (2025-09-05) | **3.7.2** | MIT | already in the lockfile | ✅ | [N9][R18] |
| `date-fns` / `@date-fns/tz` | 4.4.0 (2026-05-29) / 1.5.0 (2026-05-21) | same | MIT | console display (optional) | ✅ | [N8] |
| `date-fns-tz` | 3.2.0 (2024-09-30) | same | MIT | not needed | ✅ | [N8] |
| `date-holidays` | 3.38.0 (2026-10-24) | 3.37.0 (2026-09-20) | registry `(ISC AND CC-BY-3.0)`; LICENSE: data **CC BY-SA 3.0**, code ISC | would ship data | ❌ | [N11] |
| `holidays` (PyPI) | 0.107 (2026-10-19) | **0.106** (2026-10-05) | MIT | operator tooling only | ⚠️ (not shipped) | [N12] |
| `ical.js` | 2.2.1 (2025-08-08) | 2.2.1 | MPL-2.0 | would ship | ❌ | [N13] |
| `node-ical` | 0.27.3 (2026-10-03) | 0.27.3 | Apache-2.0 | not needed | ✅ | [N13] |
| `markdown-it` | 15.0.3 (2026-10-16) | **15.0.2** (2026-09-11) by version; 14.3.2 (2026-09-12) by date | MIT | console (optional) | ✅ | [N14] |
| `argparse` (for markdown-it 15) | 3.0.4 (2026-10-24) | **3.0.2** (2026-09-10) | PSF-2.0 | console (dep, CLI only) | ✅ | [N14] |
| `argparse` 2.0.1 (for markdown-it 14) | — | 2.0.1 (2020-08-28) | `Python-2.0` | would ship | ⚠️ (not literally on the list) | [N14] |
| `entities` | 8.1.0 (2026-09-07) | **8.1.0** | BSD-2-Clause | console (dep) | ✅ | [N14] |
| `linkify-it`, `mdurl`, `uc.micro`, `punycode.js` | 6.1.0, 2.1.0, 3.0.0 (2026-07-22), 2.3.1 (2023) | same | MIT | console (dep) | ✅ | [N14] |
| `dompurify` | 3.4.17 (2026-10-12) | **3.4.17** | MPL-2.0 OR Apache-2.0 | console (optional) | ✅ under Apache-2.0 | [N15][M1] |
| `isomorphic-dompurify` | 4.6.0 (2026-10-16) | 4.5.0 (2026-10-06) | MIT (pulls jsdom 30) | not needed | ✅ | [N17] |
| `sanitize-html` | 2.18.1 (2026-10-14) | **2.18.0** (2026-09-30) | MIT | not recommended | ✅ | [N16] |
| `react-markdown` | 10.1.0 (2025-03-07) | **10.1.0** | MIT | console (optional) | ✅ | [N18] |
| `rehype-sanitize` | 6.0.0 (2023-08-26) | **6.0.0** | MIT | console (optional) | ✅ | [N18] |
| `marked` | 18.1.2 (2026-10-26) | 18.1.1 (2026-10-12) | MIT | not needed | ✅ | [N19] |
| `pdf-lib` (+ fontkit 1.1.1, standard-fonts 1.0.0, upng 1.0.1) | 1.17.1 (2021-11-06) | **1.17.1** | MIT | API (Phase 9) | ⚠️ unmaintained since 2021 | [N20] |
| `pdfmake` | 0.3.13 (2026-10-25) | **0.3.11** (2026-06-12) | MIT | API (Phase 9) | ⚠️ via pdfkit's AFM notice and fonts | [N21] |
| `pdfkit` | 0.20.2 (2026-08-30) | **0.20.2**; pdfmake 0.3.11 resolves `^0.19.1` to **0.19.1** (2026-06-10) | MIT; AFM files under Adobe's notice | API (Phase 9) | ⚠️ | [N21][D15] |
| `jspdf` | 4.2.1 (2026-03-17) | 4.2.1 | MIT | not needed | ✅ | [N22] |
| `@panzoom/panzoom` | 4.6.2 (2026-04-02) | **4.6.2** | MIT | console | ✅ | [N24] |
| `react-zoom-pan-pinch` | 4.2.0 (2026-09-03) | **4.2.0** | MIT | console (alternative) | ⚠️ CSP | [N23] |
| `panzoom` (+ `amator`, `wheel`, `ngraph.events`, `bezier-easing`) | 9.4.4 (2026-03-26) | 9.4.4 | MIT (+ MIT, MIT, BSD-3-Clause, MIT) | alternative | ✅ | [N25] |
| `openseadragon` | 6.1.1 (2026-09-09) | 6.1.1 | BSD-3-Clause | not recommended | ✅ licence | [N26] |
| `exifr` | 7.1.3 (2021-08-05) | 7.1.3 | MIT | not needed (vision reads EXIF) | ✅ | [N27] |
| `file-type` | 22.2.0 (2026-10-14) | 22.1.1 (2026-09-17) | MIT | not needed (own detectors [R15]) | ✅ | [N27] |
| `clamscan` | 2.4.0 (2024-10-21) | 2.4.0 | MIT | API (optional client) | ✅ | [N29] |
| ClamAV (`clamd`) | — | — | GPL-2.0 | operator-run service, never shipped | ⚠️ owner (5.4) | [N29][D16][D17] |
| IANA tz database | — | — | public domain (three BSD-3 code files) | every runtime | ✅ | [N28] |


**Records to update** (for whichever slice adopts): `THIRD_PARTY_LICENSES.md` §2 rows for each adopted package with its version and verification date; a note that DOMPurify is taken under Apache-2.0; the Excluded table gains `elkjs` (EPL-2.0 or GPL-3.0), `date-holidays` data (CC BY-SA 3.0, with the registry's wrong `CC-BY-3.0`) and `ical.js` (MPL-2.0 at runtime) [R19]; PLAN §3's editor row adds the layout library [R1].

## 9. Sources and pins

Every source was read on **2026-10-27**. Robots files were read first for each host: `registry.npmjs.org`, `reactflow.dev`, `developer.mozilla.org`, `www.gnu.org`, `cheatsheetseries.owasp.org`, `owasp.org`, `www.postgresql.org` and `pypi.org` allow the pages used; `www.w3.org` allows the *Understanding* and APG pages (its `Disallow: /TR/?` is why the recommendation itself was not fetched, section 0); `raw.githubusercontent.com`, `tc39.es` and `nextjs.org` answer 404 for `/robots.txt`, and `data.jsdelivr.com` and `cdn.jsdelivr.net` answer 400 (no robots file). Downloads total about 14 MB under `downloads/ec-*/`; scripts are `scripts/ec_fetch.py`, `ec_npm.py`, `ec_npm_local.py`, `ec_npm_fmt.py`, `ec_licenses.py`, `ec_tgz.py`, `ec_html_text.py`, `ec_tree_check.py` and `ec_blob_match.py`.

**Repository (R)**, read-only at the working tree of 2026-10-27 (`7fe687b7` plus Phase 6 work in progress)
- [R1] `docs/PLAN.md` §2 (Cases and Workflows rows; Platform row: print-to-PDF), §3 (technology table: workflow code step, workflow editor / graph UI, data protection, SSRF guard), §5, §6 Phase 8, §9
- [R2] `CLAUDE.md` rules 2–5 (rule 4 licence policy, rule 5 honesty)
- [R3] `docs/adr/0002-check-tiers.md` (tiers, §3a–3f)
- [R4] `docs/research/persona-surface.md` (case events, `workflow-run.*` events, `case-templates/{id}`, `cases*`, `workflow-runs`, `workflow-versions`, `workflows/{id}/trigger`, the `…/print` paths of inquiries, reports and verifications)
- [R5] `docs/plans/phase-6.plan.md`: the deferral list (the workflow "Run report" action and match conditions, cases holding reports, `print` in Phase 9), C84.3 and decisions 28 and 48 (`on-report-match`), report joins with composite keys, C73.6 retention
- [R6] `docs/plans/phase-7.plan.md`: inventory table (console: no tabs, no selection; headers only), patterns to mirror (versioned templates, state machines, masking at every exit), C100.6 (the shared CSV writer), C103.2 ("Creating a case waits for Phase 8"), C104 (field schemas), C108 (explorer with Cytoscape, Table view, CSP test F33), C110 (deferred to Phase 8), decisions 18 and 36
- [R7] `apps/dashboard/next.config.ts` (security headers; `images.unoptimized`; no script CSP yet)
- [R8] `apps/dashboard/package.json` (runtime dependencies)
- [R9] `apps/dashboard/src/app/files/[id]/content/route.ts` (authenticated stream, accepted types, PDF only as attachment, `no-store`, `nosniff`)
- [R10] `apps/dashboard/src/components/verification-image.tsx` and `selfie-evidence.tsx` (side-by-side ID front and centre pose; alt-text and badge conventions)
- [R11] `apps/dashboard/src/components/{data-table,dialog,json-editor,masked-value,hidden-value}.tsx`, `components/lifecycle/{note-editor,redacted-value}.tsx`, `src/app/globals.css` and `packages/ui/src/styles.css` (`font-sans`, no web font)
- [R12] `packages/core/src/permissions.ts` (28 scopes, operator permissions, built-in roles, `NOT_FOR_VIEWERS`, `pii:view` meaning)
- [R13] `apps/api/src/storage/index.ts` (ciphertext-only `FileStorage`, `newStorageKey`, versioned delete)
- [R14] `packages/db/src/sealed.ts`, `packages/db/src/crypto.ts` (row-bound sealing; `encryptBytes` with the file id as context; envelope `ov1`)
- [R15] `packages/db/src/tables/verifications.ts` (`files`: `verification_id` NOT NULL, one file per kind) and `packages/contracts/src/files.ts` (file kinds incl. `portrait` and `chip-portrait`, `detectImageMimeType`, `detectUploadMimeType`, `MAX_UPLOAD_BYTES` 10 MiB, the PDF header window)
- [R16] `apps/api/src/routes/dashboard/files.ts` (`inquiries:read` + `pii:view`, decrypt and integrity checks, `file.viewed` audit, attachment disposition with a server-made name)
- [R17] `apps/api/src/jobs/inquiry-expiry.ts` (batches `FOR UPDATE SKIP LOCKED`, a savepoint per row, events after commit) and `apps/api/src/webhooks/dispatcher.ts` (the database row as the source of truth)
- [R18] `pnpm-workspace.yaml` (catalog: `next` ^16.4.2, `react` ^19.3.1; `sharp` ignored) and `pnpm-lock.yaml` (`luxon@3.7.2` via `cron-parser@5.10.1` via `bullmq@6.3.11`; no editor, Markdown, sanitiser, PDF, zoom or other date library)
- [R19] `THIRD_PARTY_LICENSES.md` (§2.2 planned `@xyflow/react`; §5 exceptions incl. the pending Eigen decision; Excluded: reportlab, fpdf2, borb, pdf.js fonts)
- [R20] `packages/contracts/src/ids.ts` (prefix table, lowercase letters, ULIDs)
- [R21] `services/vision/src/openverify_vision/schemas.py` (`ExifSummary`: GPS values never returned; boxes in EXIF-upright pixels), `document_forensics.py` (Pillow EXIF reads), `apps/api/src/ports.ts` (`has_gps`)
- [R22] `infra/docker/apps.Dockerfile` (`node:22.22.1-bookworm-slim`); local `node --version` 22.22.1, `process.versions.tz` 2025c, ICU 78.2, `typeof Temporal` undefined [M2]
- [R23] `docs/research/phase7-lists-graph-transactions.md` (format model; §4.5 CSV injection; §6 explorer, its CSP notes and WCAG list; §7.2 zod walking and `z.toJSONSchema`; §5.7 privacy and Art. 9 references)
- [R24] `packages/core/src/{inquiry,verification,report,report-match}-state-machine.ts` (the state-machine style)

**Sibling notes (S)** in `resume/phase8-research/`, read for scope only, all in progress at the time: [S1] `phase8-behaviour.md`; [S2] `phase8-workflow-engine.md`; [S3] `phase8-actions-sandbox.md`.

**Public OpenAPI (O)**
- [O1] `github.com/persona-id/persona-openapi`, directory `2026-09-29/`, tree `c30a98bcff4b629172eebd28706ff61c948b8d90` (the tree listing saved by the Phase 7 research, `phase7-research/downloads/fc-gh-persona-tree-0929/`). Fetched from `https://raw.githubusercontent.com/persona-id/persona-openapi/main/2026-09-29/<path>` and each file's git blob SHA-1 matched to that tree: `components/schemas/case-comment.yaml` (`6b4710ab…`), `case-template.yaml` (`4b2ec998…`), `case-queue.yaml` (`852c515a…`), `workflow-version.yaml` (`154d6b35…`), `workflow.yaml` (`abc7975f…`), `workflow-run.yaml` (`85e81b41…`), `cases-included-objects.yaml` (`86c15d56…`); `components/examples/case-template.yaml` (`8be40ec6…`), `case-sla-expired-webhook-body.yaml` (`6ee7759e…`); `paths/cases_{case-id}_add-comment.yaml` (`eacfa277…`), `_assign.yaml` (`592bbea4…`), `_set-status.yaml` (`7519f74d…`), `_add-objects.yaml` (`8de33064…`), `paths/cases_search.yaml` (`0c0c756e…`). `components/schemas/case.yaml` (`abf1386c…`) and `paths/cases.yaml` (`048ef642…`) were read from the Phase 7 behaviour note's local copy `phase7-research/downloads/behaviour-openapi-e64dbfb/`, which also matches. Identifiers only.

**Measurements (M)**, static reads of published files, nothing executed
- [M1] `scripts/ec_tgz.py` over: `@xyflow/react-12.12.0.tgz` (SHA-256 `b61b1486…3fac`; `dist/esm/index.js`, `dist/style.css`), `react-zoom-pan-pinch-4.2.0.tgz` (`9092ffc2…255c`), `@panzoom/panzoom-4.6.2.tgz` (`5a42f422…0c61`), `temporal-polyfill-1.0.5.tgz` (`c630451e…4839`), `markdown-it-15.0.2.tgz` (`3237f5ec…23c1`; default preset `html: false`, `BAD_PROTO_RE`, `GOOD_DATA_RE`, `bin/markdown-it.mjs`); `dompurify@3.4.17/dist/purify.es.mjs` from jsDelivr (`60c5d5cc…5cbd`, header naming Apache-2.0 and MPL-2.0); jsDelivr file listings for `openseadragon@6.1.1` and `dompurify@3.4.17` (sizes). Gzip sizes at level 9 with Python's `gzip`
- [M2] Node 22.22.1 on this machine: `Intl.DateTimeFormat` for America/New_York at 2026-03-08T06:59Z/07:00Z (01:59 EST → 03:00 EDT) and 2026-11-01T05:59Z/06:00Z (01:59 EDT → 01:00 EST); `process.versions.tz` 2025c; no global `Temporal`

**Packages (N)**: registry metadata `https://registry.npmjs.org/<name>` (PyPI: `https://pypi.org/pypi/<name>/json`) and the LICENSE file at `https://raw.githubusercontent.com/<repo>/<ref>/<file>`
- [N1] `@xyflow/react` **12.12.0** (2026-09-24), MIT, LICENSE at tag `@xyflow/react@12.12.0` (SHA-256 `023119ac…c9ff`); deps `zustand` ^4.4.0, `classcat` ^5.0.3, `@xyflow/system` 0.0.83; peers `react`, `react-dom` `>=17`
- [N2] `@xyflow/system` **0.0.83** (2026-09-24), MIT; `d3-zoom` 3.0.0, `d3-drag` 3.0.0, `d3-selection` 3.0.0, `d3-interpolate` 3.0.1, `d3-transition` 3.0.1, `d3-dispatch` 3.0.1, `d3-timer` 3.0.1, `d3-color` 3.1.0 (ISC; LICENSE at `d3/d3-zoom@debbe3d7`, SHA-256 `e008c5e2…`), `d3-ease` 3.0.1 (BSD-3-Clause, registry)
- [N3] `zustand` 5.0.16 (2026-10-22) / 5.0.15 (2026-08-13) / **4.5.7** (2025-05-15), MIT, LICENSE at `869cd7ae` (`c1e6e266…`); `use-sync-external-store` **1.7.0** (2026-09-09), MIT; `classcat` **5.0.5** (2024-04-02), MIT, LICENSE.md at `e7889b4d` (`f101c761…`)
- [N4] `@dagrejs/dagre` 3.1.3 (2026-10-24) / **3.1.1** (2026-08-08; majors 2.0.0 on 2025-11-20 and 3.0.0 on 2026-03-22), MIT, LICENSE at `c3ed0802` (`6a349742…`); `@dagrejs/graphlib` 4.0.7 (2026-10-24) / **4.0.5** (2026-08-03), MIT, LICENSE at `d3a0cf36`
- [N5] `elkjs` **0.12.0** (2026-07-17), registry `EPL-2.0 OR GPL-3.0-or-later`, LICENSE.md at `ff5771d7` (`637e81f4…`, EPL-2.0 text with the GPL as Secondary Licence)
- [N6] `d3-hierarchy` **3.1.2** (2022-04-02), ISC, LICENSE at `7bea49ef` (`e008c5e2…`)
- [N7] `zundo` **2.3.0** (2024-11-17), MIT (registry), peer `zustand ^4.3.0 || ^5.0.0`
- [N8] `date-fns` **4.4.0** (2026-05-29), MIT (registry; LICENSE not found at the paths tried); `@date-fns/tz` **1.5.0** (2026-05-21), MIT, LICENSE.md at `date-fns/tz@main` (`cc726772…`); `date-fns-tz` **3.2.0** (2024-09-30), MIT
- [N9] `luxon` **3.7.2** (2025-09-05), MIT, LICENSE.md at `4262a38d` (`6cb2f2bf…`)
- [N10] `temporal-polyfill` 1.0.6 (2026-10-13T20:13:31Z) / **1.0.5** (2026-09-11), MIT (LICENSE in the 1.0.5 tarball, "Copyright (c) 2026 Adam Shaw"); `temporal-spec` 1.0.1 (Apache-2.0), `temporal-utils` 1.0.3 (MIT); `@js-temporal/polyfill` **0.5.1** (2025-03-31), ISC, LICENSE at `f3c07e50` (`ffc4aee7…`), dep `jsbi` 4.3.2 (Apache-2.0, registry)
- [N11] `date-holidays` 3.38.0 (2026-10-24) / **3.37.0** (2026-09-20), registry `(ISC AND CC-BY-3.0)`, LICENSE at tag `v3.37.0` (`809343d7…`: `holidays.yaml` data CC BY-SA 3.0, code ISC); `date-holidays-parser` **3.4.7** (2025-02-01), ISC, LICENSE at `v3.4.7` (`6e61ea3d…`)
- [N12] `holidays` (PyPI) 0.107 (2026-10-19) / **0.106** (2026-10-05), MIT, LICENSE at `vacanza/holidays@v0.107` (`a9a45b34…`), requires `python-dateutil`
- [N13] `ical.js` **2.2.1** (2025-08-08), MPL-2.0 (registry); `node-ical` **0.27.3** (2026-10-03), Apache-2.0 (registry), deps `rrule-temporal`, `temporal-polyfill`
- [N14] `markdown-it` 15.0.3 (2026-10-16) / **15.0.2** (2026-09-11) / 14.3.2 (2026-09-12), MIT, LICENSE at `3c51991c` (`792c48c5…`); `argparse` 3.0.4 (2026-10-24) / **3.0.2** (2026-09-10), PSF-2.0, LICENSE at `b24ea189` (`ab745c50…`); `argparse` 2.0.1 `Python-2.0` (registry); `entities` 8.1.0 (BSD-2-Clause), `linkify-it` 6.1.0, `mdurl` 2.1.0, `uc.micro` 3.0.0, `punycode.js` 2.3.1 (MIT, registry)
- [N15] `dompurify` **3.4.17** (2026-10-12), registry `(MPL-2.0 OR Apache-2.0)`, LICENSE at `a77a3e78` (`cfc7749b…`, Apache-2.0 text); README at the same commit (server use needs jsdom, happy-dom "not considered safe", Trusted Types and `RETURN_TRUSTED_TYPE`)
- [N16] `sanitize-html` 2.18.1 (2026-10-14) / **2.18.0** (2026-09-30), MIT, LICENSE at `apostrophecms/apostrophe@9500b8b0/packages/sanitize-html/LICENSE` (`24526b61…`); `htmlparser2` 12.0.0 (MIT)
- [N17] `isomorphic-dompurify` 4.6.0 (2026-10-16) / **4.5.0** (2026-10-06), MIT, deps `jsdom` ^30, `dompurify`
- [N18] `react-markdown` **10.1.0** (2025-03-07), MIT, `license` and `readme.md` at `44d2e4a4` (`f6196c64…`; `skipHtml`, `allowedElements`, `urlTransform`, the Security section); `rehype-sanitize` **6.0.0** (2023-08-26), MIT
- [N19] `marked` 18.1.2 (2026-10-26) / **18.1.1** (2026-10-12), MIT (registry)
- [N20] `pdf-lib` **1.17.1** (2021-11-06), MIT, LICENSE.md at `v1.17.1` (`f2c9fc00…`); `@pdf-lib/fontkit` **1.1.1** (2020-11-28), `@pdf-lib/standard-fonts` **1.0.0** (2020-09-13; LICENSE.md `45cc2bb9…`), `@pdf-lib/upng` **1.0.1** (2020-02-20), MIT
- [N21] `pdfmake` 0.3.13 (2026-10-25) / **0.3.11** (2026-06-12), MIT, LICENSE at `c880a938` (`ab919430…`); `pdfkit` **0.20.2** (2026-08-30), MIT, LICENSE at `8d72a71c` (`5f0d5197…`), `lib/font/data/MustRead.html` (`b226bfc0…`, the Adobe AFM notice); `pdfkit` 0.19.1 (2026-06-10)
- [N22] `jspdf` **4.2.1** (2026-03-17), MIT (registry)
- [N23] `react-zoom-pan-pinch` **4.2.0** (2026-09-03), MIT, LICENSE at `34abc1ff` (`307a51eb…`)
- [N24] `@panzoom/panzoom` **4.6.2** (2026-04-02), MIT (`MIT-License.txt` in the tarball)
- [N25] `panzoom` **9.4.4** (2026-03-26), MIT, LICENSE at `4998d790` (`ed21250a…`); `amator` 1.1.0 (MIT), `wheel` 1.0.0 (MIT), `ngraph.events` 1.4.0 (BSD-3-Clause), `bezier-easing` 3.2.0 (MIT), registry
- [N26] `openseadragon` **6.1.1** (2026-09-09), BSD-3-Clause, LICENSE.txt at `201d4783` (`17da96b2…`)
- [N27] `exifr` **7.1.3** (2021-08-05), MIT; `file-type` 22.2.0 (2026-10-14) / **22.1.1** (2026-09-17), MIT (registry)
- [N28] IANA tz database LICENSE, `https://raw.githubusercontent.com/eggert/tz/main/LICENSE` (`06134085…`: public domain, with BSD-3-Clause for `date.c`, `newstrftime.3`, `strftime.c` when present)
- [N29] `clamscan` **2.4.0** (2024-10-21), MIT, LICENSE at `e35a4a8c` (`8a150368…`); ClamAV `COPYING.txt` at `Cisco-Talos/clamav@main` (`0c4fd2fa…`, GNU GPL version 2)

**Documentation (D)**
- [D1] https://reactflow.dev/learn/advanced-use/accessibility ("Last updated on October 11, 2026")
- [D2] https://reactflow.dev/learn/layouting/layouting
- [D3] https://reactflow.dev/examples/interaction/undo-redo (a Pro example under the "xyflow Pro License")
- [D4] https://reactflow.dev/learn/troubleshooting/remove-attribution
- [D5] https://reactflow.dev/learn/advanced-use/ssr-ssg-configuration
- [D6] https://reactflow.dev/examples/interaction/validation (`isValidConnection`)
- [D7] Luxon docs `docs/math.md` and `docs/zones.md` at `moment/luxon@4262a38d` (raw.githubusercontent.com)
- [D8] `date-fns/tz` README at `main`
- [D9] `fullcalendar/temporal-polyfill` README at `main`
- [D10] https://github.com/tc39/proposals/blob/main/finished-proposals.md (Temporal listed, expected publication year 2027; read raw)
- [D11] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/ZonedDateTime (Last-Modified 2026-10-27: limited availability; ambiguity and gaps; the `disambiguation` option; offset ambiguity after tz updates)
- [D12] https://developer.mozilla.org/en-US/docs/Web/CSS/image-orientation (Baseline widely available; initial `from-image`)
- [D13] https://developer.mozilla.org/en-US/docs/Web/CSS/@page (Baseline 2024)
- [D14] `Hopding/pdf-lib@v1.17.1`: `README.md` (Fonts and Unicode; fontkit), `src/core/embedders/JpegEmbedder.ts`, `src/core/embedders/StandardFontEmbedder.ts`
- [D15] `foliojs/pdfkit@8d72a71c`: `lib/image.js` (JPEG and PNG only; string sources read with `fs.readFileSync`), `lib/image/jpeg.js` (EXIF orientation), `lib/font/data/MustRead.html`
- [D16] ClamAV documentation at `Cisco-Talos/clamav-documentation@main`: `src/manual/Usage/ClamdProtocol.md` (sockets, TCP not encrypted or authenticated, `INSTREAM`, `StreamMaxLength`), `src/manual/Installing/Docker.md` (RAM), `src/faq/faq-freshclam.md` (supported update methods)
- [D17] https://www.gnu.org/licenses/gpl-faq.html#MereAggregation and #AggregateContainers
- [D18] https://nextjs.org/docs/app/guides/content-security-policy (served as Markdown: nonces need dynamic rendering; example `script-src 'self' 'nonce-…' 'strict-dynamic'` and `style-src 'self' 'nonce-…'`; no `eval` in production)
- [D19] https://www.postgresql.org/docs/17/sql-select.html (the locking clause: `SKIP LOCKED`, queue-like tables, no locking with aggregation)

**OWASP (W)**
- [W1] https://owasp.org/www-community/attacks/CSV_Injection (Last-Modified 2026-10-27)
- [W2] https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html (Last-Modified 2026-10-26)
- [W3] https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html (Last-Modified 2026-10-26: DOMPurify recommended; safe sinks; React 19 and `javascript:` URLs)

**Accessibility (A)**: W3C *Understanding WCAG 2.2* pages, each quoting its criterion, `https://www.w3.org/WAI/WCAG22/Understanding/<name>.html` (several Last-Modified 2026-09-03)
- [A1] `keyboard` (2.1.1); [A2] `character-key-shortcuts` (2.1.4); [A3] `target-size-minimum` (2.5.8); [A4] `dragging-movements` (2.5.7); [A5] `status-messages` (4.1.3); [A6] `non-text-contrast` (1.4.11); [A7] `focus-not-obscured-minimum` (2.4.11); [A8] `use-of-color` (1.4.1); [A10] `reflow` (1.4.10); [A11] `non-text-content` (1.1.1); [A12] `contrast-minimum` (1.4.3); [A13] `timing-adjustable` (2.2.1); [A14] `focus-visible` (2.4.7)
- [A9] https://www.w3.org/WAI/ARIA/apg/patterns/treeview/ (Last-Modified 2026-10-23: keyboard interaction for trees)

## 10. Gaps

- The signature database licence of ClamAV was not found in the pages read.
- `date-fns` 4.4.0's LICENSE file was not found at the paths tried; its MIT licence rests on the registry metadata.
- `pdfmake`'s bundled default fonts and `@pdf-lib/standard-fonts`' metric provenance were not checked.
- A headless browser's third-party licences (for a server PDF) were not reviewed.
- WCAG 2.2 was read through W3C's *Understanding* pages, not the recommendation itself (robots, section 0).
- Persona's documented case behaviour (statuses, queues, assignment policies, SLA configuration, attachments, export and print) is [S1]'s subject and was not re-derived here.

## 11. What Phase 8 should take from this (proposed)

**Editor**
1. **Stack.** `@xyflow/react` 12.12.0 with `@xyflow/system` 0.0.83, `zustand` 4.5.7, `classcat` 5.0.5 and the d3 3.x modules (all MIT, ISC or BSD) through the pnpm catalog. Render the editor client-only and import `@xyflow/react/dist/base.css` through the bundler, so nothing needs inline styles under a nonce `style-src` (2.1).
2. **Layout.** `@dagrejs/dagre` 3.1.1 with `@dagrejs/graphlib` 4.0.5, run on demand; positions live in the definition's `layout` member and are excluded from the behaviour hash and the diff. `elkjs` goes to the Excluded table (2.2).
3. **Outline view.** An APG tree-view outline that can add, branch, connect, reorder, delete and configure every step, with selection shared with the canvas. It is what makes the editor meet 2.1.1, 2.5.7 and 2.5.8, so it is built first and tested keyboard-only (2.4). Custom nodes draw a 3:1 focus ring, handles get a 24 px hit area, the library's strings go through `ariaLabelConfig` into the console's i18n keys, and the canvas has a text summary.
4. **Definition.** A JSON graph (`schema-version`, `trigger`, `steps`, `edges`, `inputs`, `outputs`, `layout`) validated by a strict zod discriminated union and then by a pure graph check in `packages/workflow-engine` (one trigger, reachability, ports, no cycles outside loop bodies, module references, expression parsing [S2]); caps of 200 steps, 400 edges, 16 KiB per step config and 256 KiB per definition; errors as JSON Pointers in RFC 9457 problems; `definition_sha256` over everything but `layout` (2.5).
5. **Editing aids.** Our own undo/redo (immutable documents, 100 entries, gestures coalesced, focus-scoped modifier chords); immutable published versions with one draft; a server-side diff keyed by step id, shown as a list and as canvas badges; errors as node badges with `aria-describedby` and an errors panel; a palette built from a server catalogue that marks unavailable actions "not configured" and already lists the steps Phases 6 and 7 deferred (2.3).

**Cases**
6. **Model.** The tables of 3.2, with the public prefixes `case`, `ctmpl`, `cqueue` and `cscm`; template versions pinned per case with statuses in three categories (`open`, `pending`, `resolved`), `resolutions` and Phase 7's `field-schemas` walker; one join table per held object type with composite foreign keys; an append-only, PII-free `case_history`.
7. **Assignment.** Manual (by `user-id` and, for parity, `user-email-address`), pull with `FOR UPDATE SKIP LOCKED` ordered by SLA deadline then age, and round-robin and least-loaded under a queue-row lock; `max_open` per member; a re-assignment sweep for members who lose access; the partial index of 3.3 with an `EXPLAIN` test.
8. **State machine.** A pure machine in `packages/core`, every transition under the case row lock with optimistic `version`, history and events in the same transaction, and the public event names of 3.4. Resolving a case never decides a held object.
9. **Scopes.** `cases:read|write|assign|resolve|redact|export`, `case-templates:read|write|publish`, `case-queues:read|write`, plus the workflow scopes of [S2], each with a `PERMISSION_INFO` label; `cases:export` is not given to viewers (3.7).

**SLA**
10. **Policies and calendars** as versioned objects (3.2, 4.2); two pure functions (`addBusinessTime`, `businessTimeBetween`) on `temporal-polyfill` 1.0.5, validating calendars with `disambiguation: 'reject'` over two years and computing with `'compatible'`; the state columns of 4.4 with an `sla_epoch`; tz-fixture tests that assert the runtime's offsets first.
11. **Firing.** A 30 s `case-sla` sweep (or the engine's durable timers [S2]) taking due rows `FOR UPDATE SKIP LOCKED`, moving them to `expired` and staging `case.sla-expired` in the same transaction, once per epoch; BullMQ delays only as a hint; escalation as workflows on that event (4.7).
12. **No holiday data ships**; operators enter dates or import a `date,label` CSV through the Phase 7 parser (4.6).

**Comments and attachments**
13. **Comments** as sealed plain text with validated mentions, rendered as React text; mention emails carry a link, never the text. If Markdown is chosen: `react-markdown` 10.1.0 with raw HTML off and the default URL transform, or `markdown-it` 15.0.2 plus DOMPurify 3.4.17 (under Apache-2.0) in the browser; no images either way (5.1).
14. **Attachments** in `case_attachments` on the existing `encryptBytes` and `FileStorage` path, typed by content (JPEG, PNG, WebP, PDF), 10 MiB each and 20 per case, sealed filenames, downloads through the console proxy with server-made names, an audit entry per view. Images get a vision-made rendition (EXIF-upright, metadata stripped) that is what the console and exports show; PDFs are never rendered (5.3).
15. **Scanning** through an `AttachmentScanner` port: `none` by default (the console says "not scanned"), `clamd` as an operator-run service reached over a Unix socket or private network with our own `INSTREAM` client that maps every non-clean answer to `error`, and a deterministic EICAR-based sandbox refused in production. The docs state what scanning cannot catch, clamd's lack of transport security, and its RAM needs (5.4).

**Export, print and review**
16. **Exports.** Asynchronous CSV (Phase 7's neutralising writer) and a per-case JSON bundle, masked by default, `pii:view` plus `cases:export` for personal data, `case.exported` per case, one audit entry per export, files deleted after 24 hours (6.2, 6.3).
17. **Print** by a print stylesheet in Phase 8, with an audit entry, a footer naming the environment, the case, the printer and "contains personal data"; a server PDF waits for Phase 9's `print` routes and then uses pdfmake/pdfkit or pdf-lib only on pre-processed images (6.4, 6.5).
18. **Reviewer screen.** A compare panel on `@panzoom/panzoom` 4.6.2 with our own buttons and focus-scoped keys, zoom to the portrait box from the vision result, linked views, viewing aids that change nothing stored, decisions only through confirmed buttons; images keep streaming through the console proxy, never presigned URLs (7.1–7.6).
19. **Accessibility and CSP tests.** axe plus keyboard-only Playwright tests for the editor's outline view, the case page and the compare panel against the criteria of 7.7; Phase 7's injected-CSP test extended to the editor and the reviewer screen with `style-src 'self' 'nonce-…'`.
20. **Records.** `THIRD_PARTY_LICENSES.md` rows for every adopted package, DOMPurify's Apache-2.0 election, and Excluded entries for `elkjs`, `date-holidays` data and `ical.js`; PLAN §3's editor row gains the layout library; the surface index notes that case statuses, queue membership, assignment policies, SLA configuration and attachment upload have no public identifiers beyond those in 3.1.

## 12. Needs the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Reuse the public prefixes `case`, `ctmpl`, `cqueue`, `cscm` | **Yes** (migration ease; they fit the id rule) |
| 2 | React Flow attribution link: keep it, hide it under a Pro subscription, or hide it unpaid (the licence allows it; the vendor asks otherwise) | **Keep it visible** (no account, no cost, respects the vendor's request) |
| 3 | Date library for SLA arithmetic | **`temporal-polyfill` 1.0.5** (explicit DST handling; swap for native Temporal later); Luxon 3.7.2 if adding no package matters more |
| 4 | Holiday data | **Ship none**; operator-entered dates and CSV import |
| 5 | SLA on reopen | **Continue** the consumed time (policy can choose restart) |
| 6 | A calendar edit (holiday added) recomputes running SLAs | **Yes**, with a history row per affected case |
| 7 | Comment format | **Plain text with mentions**; Markdown (via `react-markdown`, no raw HTML, no images) only if asked |
| 8 | ClamAV: may `infra/docker-compose.yml` carry an optional profile referencing the official `clamav/clamav` image, given ClamAV is GPL-2.0 and never linked or redistributed (not legal advice) | **No profile in the repo**; documentation of how an operator runs it, and the scanner default `none` |
| 9 | Fonts for a future server PDF: fonts covering many scripts are usually SIL OFL, which rule 4 does not name; pdfkit's AFM files carry Adobe's notice | **Decide in Phase 9**; Phase 8 prints through the browser and ships no font |
| 10 | Keep attachment and capture originals (sealed, for evidence) or keep only renditions | **Keep the sealed original for vision and forensics; serve and export only the rendition** |
| 11 | Serve metadata-free renditions instead of originals for **existing** inquiry images too (changes Phase 1–5 behaviour) | **Yes**, through a new vision endpoint and the same proxy |
| 12 | Does the built-in reviewer role get `cases:export`? | **No** (admin only; custom roles can add it) |
| 13 | Least-loaded assignment: approximate across queues, or exact with a per-user counter table | **Approximate** (balance only; correctness unaffected) |
| 14 | Comment edits | **Allowed to the author for 15 minutes**, logged as edited without the old text |
| 15 | Export download lifetime and size | **24 hours, 10,000 cases** per export |


## Fact-check (2026-10-27)

**Method.** An independent pass, run 2026-10-27 between 22:40 and 23:15 UTC, that fetched every source again. Each host's
`robots.txt` first (RFC 9309), at most one request per 1.2 s per host, no automatic redirects, User-Agent
`OpenVerify-factcheck/1.0 (research; no contact)`, GitHub API unauthenticated, no personal data sent. Downloads are in new
directories `downloads/fc-npm/`, `fc-npm2/`, `fc-tgz/`, `fc-raw2/`, `fc-raw3/`, `fc-web/`, `fc-openapi/` and
`fc-gh-api2/`, stored as served; tarballs were listed and read in memory with `tarfile`, never extracted or installed;
readers `scripts/fc_*.py` under `python3 -I`; nothing downloaded was executed. Repository facts were read at `3a3ef409`.
Result: **29 confirmed, 1 corrected, 0 could not verify.**

| # | Fact | Result | Primary source re-read |
|---|---|---|---|
| 1 | `@xyflow/react` 12.12.0, licence, peers, dependencies | **Confirmed.** Published 2026-09-24T12:41:36Z, the latest stable version (13.0.0-next.0 is a prerelease); MIT; peers `react` and `react-dom` `>=17`; dependencies `@xyflow/system` 0.0.83, `zustand` ^4.4.0 (the newest 4.x is 4.5.7, 2025-05-15) and `classcat` ^5.0.3 (5.0.5). At the tag (annotated tag `69b435b` → commit `3d35b573`) the `LICENSE` is at the repository root, not under `packages/react/`; its SHA-256 `023119ac…c9ff` equals the note's and the tarball's `package/LICENSE` | `https://registry.npmjs.org/@xyflow/react`; `https://api.github.com/repos/xyflow/xyflow/git/matching-refs/tags/@xyflow/react@12.12`, `/git/tags/69b435b…`; raw `LICENSE` at `3d35b573`; the 12.12.0 tarball |
| 2 | ESM size and static scan | **Confirmed.** Tarball 251,386 bytes, SHA-256 `b61b1486…3fac`; `dist/esm/index.js` 233,341 bytes, 52,068 at gzip level 9; no match for `eval(`, `new Function`, `innerHTML`, a created `style` element, `setAttribute('style'`, `fetch(` or `new Worker` | tarball, read in memory |
| 3 | React Flow accessibility features | **Corrected (source).** The page (last updated October 11, 2026) lists Tab focus (`tabIndex` 0, `role="group"`), Enter or Space to select, Escape to clear, arrow-key moves (Shift for larger steps), auto-pan on focus, ARIA descriptions and the `ariaLabelConfig` keys including the live move message, and describes no keyboard way to create a connection. It does not give the live region's politeness: `aria-live="assertive"` is in the 12.12.0 ESM build. §2.4 was corrected in place to cite [M1] for that value | `https://reactflow.dev/learn/advanced-use/accessibility`; tarball `dist/esm/index.js` |
| 4 | Default handle size and removed focus outline | **Confirmed** (`.react-flow__handle` 6 px by 6 px; `outline: none` on focused nodes, edges and selections) | tarball `dist/style.css` |
| 5 | Undo/redo is a Pro example | **Confirmed** ("License: xyflow Pro License") | `https://reactflow.dev/examples/interaction/undo-redo` |
| 6 | Attribution | **Confirmed** (React Flow is MIT; the vendor asks for a subscription to remove the attribution) | `https://reactflow.dev/learn/troubleshooting/remove-attribution` |
| 7 | dagre 3.1.1 with graphlib 4.0.5 | **Confirmed** (3.1.1 on 2026-08-08, `gitHead` `c3ed0802`, depends on graphlib 4.0.5 exactly; 3.1.3 on 2026-10-24 latest; graphlib 4.0.5 on 2026-08-03, `gitHead` `d3a0cf36`, latest 4.0.7; both `LICENSE` files MIT, SHA-256 `6a349742…`) | registry `@dagrejs/dagre`, `@dagrejs/graphlib`; raw `LICENSE` at both commits |
| 8 | elkjs licence and verdict | **Confirmed** (registry `EPL-2.0 OR GPL-3.0-or-later`; `LICENSE.md` at `ff5771d7` is the EPL-2.0 text naming the GPL as a Secondary License, SHA-256 `637e81f4…`; neither option is allowed for a shipped runtime library) | registry `elkjs`; raw `LICENSE.md` |
| 9 | d3 licences | **Confirmed** (`d3-ease` 3.0.1 BSD-3-Clause; `d3-zoom`, `d3-drag`, `d3-selection`, `d3-interpolate`, `d3-transition`, `d3-dispatch`, `d3-timer`, `d3-color` ISC) | registry documents of the nine packages |
| 10 | Public case identifiers | **Confirmed** (prefixes, `resolutions`, `field-schemas` referencing `./field-schema.yaml`, `assign` with `meta.user-email-address`, `set-status` with `meta.status`, the object types, the search limits; tree `c30a98b`; 63 files fetched at `e64dbfb` match their blob hashes) | `https://raw.githubusercontent.com/persona-id/persona-openapi/e64dbfb…/2026-09-29/…` |
| 11 | Workflow-version object has no step graph | **Confirmed** (attributes `workflow-name`, `description`, `status`, `trigger-type`, `live`, `rollout-label`, `rollout-percentage`, `last-updater`, `inputs`, `outputs` and timestamps; no steps or graph) | `components/schemas/workflow-version.yaml` |
| 12 | `SKIP LOCKED` and aggregation | **Confirmed** | `https://www.postgresql.org/docs/17/sql-select.html` |
| 13 | temporal-polyfill 1.0.5 / 1.0.6 | **Confirmed**, with a time note: 1.0.5 (2026-09-11) and 1.0.6 (2026-10-13T20:13:31Z) are MIT in the registry. pnpm's 14-day window for 1.0.6 closed at 2026-10-27T20:13:31Z, before this check ran (23:13Z), so 1.0.6 is pinnable as well; 1.0.5 stays valid. The 1.0.5 tarball's `LICENSE` was not re-read | `https://registry.npmjs.org/temporal-polyfill` |
| 14 | Temporal status | **Confirmed** (finished proposals list Temporal with expected publication year 2027; MDN marks `ZonedDateTime` limited availability, with `disambiguation` `earlier`, `later`, `compatible` (default) and `reject`) | raw `tc39/proposals/main/finished-proposals.md`; MDN `Temporal/ZonedDateTime` |
| 15 | Node 22.22.1 ICU, tz and Temporal | **Confirmed** on the local Node 22.22.1 binary (ICU 78.2, tz 2025c, no global `Temporal`); `apps.Dockerfile` names `node:22.22.1-bookworm-slim`; the image itself was not run | `node -p process.versions`; `infra/docker/apps.Dockerfile` |
| 16 | Luxon in the lockfile and its ambiguity caveat | **Confirmed** (3.7.2, 2025-09-05, MIT; `bullmq@6.3.11` → `cron-parser@5.10.1` → `luxon@3.7.2`; `docs/zones.md` at `4262a38d` calls ambiguous-time behaviour undefined) | registry `luxon`; `pnpm-lock.yaml`; raw `docs/zones.md` |
| 17 | date-holidays data licence | **Confirmed** (LICENSE at `v3.37.0`: `holidays.yaml` data CC BY-SA 3.0, code ISC; registry `(ISC AND CC-BY-3.0)`) | raw `LICENSE`; registry `date-holidays` |
| 18 | tz database licence | **Confirmed** (public domain; BSD 3-clause for three named files when present) | raw `eggert/tz/main/LICENSE` |
| 19 | markdown-it 15.0.2 | **Confirmed** (2026-09-11, MIT, `gitHead` `3c51991c`; the built file's default preset has `html: false`; link validation refuses `vbscript:`, `javascript:`, `file:` and `data:` except the four image types; `argparse` ^3.0.0, newest passing 3.0.2, PSF licence version 2 at `b24ea189`, imported only by `bin/markdown-it.mjs`) | registry `markdown-it`, `argparse`; the 15.0.2 tarball; raw `LICENSE` files |
| 20 | DOMPurify 3.4.17 | **Confirmed** (2026-10-12, `(MPL-2.0 OR Apache-2.0)`; `LICENSE` at `a77a3e78` holds only the Apache-2.0 text, SHA-256 `cfc7749b…`; the README says server use needs a DOM such as an up-to-date jsdom and that happy-dom is not considered safe; OWASP's XSS cheat sheet recommends DOMPurify) | registry `dompurify`; raw `LICENSE`, `README.md`; OWASP XSS cheat sheet |
| 21 | react-markdown 10.1.0 | **Confirmed** (2025-03-07, MIT; no `dangerouslySetInnerHTML`; `skipHtml`, `allowedElements`, `urlTransform`) | registry; raw `readme.md`, `license` at `44d2e4a4` |
| 22 | ClamAV licence, protocol and RAM | **Confirmed** (GPL version 2; the TCP socket is neither encrypted nor authenticated; `INSTREAM` chunks carry a 4-byte unsigned length in network byte order; `StreamMaxLength` gives "INSTREAM size limit exceeded"; RAM minimum 3 GiB, preferred 4 GiB) | raw `Cisco-Talos/clamav/main/COPYING.txt`; `clamav-documentation` `ClamdProtocol.md`, `Docker.md` |
| 23 | GNU GPL FAQ on separate programs | **Confirmed** | `https://www.gnu.org/licenses/gpl-faq.html` |
| 24 | OWASP File Upload and CSV Injection | **Confirmed** | `https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html`; `https://owasp.org/www-community/attacks/CSV_Injection` |
| 25 | pdf-lib 1.17.1 | **Confirmed** (2021-11-06, MIT; JPEG and PNG only; the JPEG embedder writes the input bytes as a `DCTDecode` stream; the standard fonts use WinAnsi with 218 Latin characters) | registry; raw `README.md`, `JpegEmbedder.ts` at `v1.17.1` |
| 26 | pdfkit 0.20.2 and pdfmake 0.3.11 | **Confirmed** (pdfkit MIT at `8d72a71c`; `lib/image.js` reads a string source with `fs.readFileSync` and accepts only JPEG and PNG; `lib/image/jpeg.js` parses EXIF orientation; `MustRead.html` carries Adobe's AFM notice; pdfmake 0.3.11 depends on `pdfkit` ^0.19.1) | registry `pdfkit`, `pdfmake`; raw files at `8d72a71c` |
| 27 | Zoom libraries | **Confirmed** (`@panzoom/panzoom` 4.6.2, 2026-04-02, `MIT-License.txt`; `panzoom.es.js` 26,822 bytes, 6,733 at gzip level 9, no style injection; `react-zoom-pan-pinch` 4.2.0 defines a `styleInject` helper and calls it at module top level, adding a `<style>` element to the document head) | the two tarballs, read in memory |
| 28 | Console headers, file route, files table, ciphertext storage | **Confirmed** (`Content-Security-Policy: frame-ancestors 'none'` only; the API file route needs `inquiries:read` and `pii:view` and audits `file.viewed`; `files.verification_id` is NOT NULL; AES-256-GCM per value and per file with the wrapped data key in the row; storage holds ciphertext only) | `apps/dashboard/next.config.ts`; `apps/api/src/routes/dashboard/files.ts`; `packages/db/src/tables/verifications.ts`, `crypto.ts`; `apps/api/src/storage/index.ts` |
| 29 | `image-orientation` and `@page` | **Confirmed** (`from-image` is the initial value, Baseline widely available since April 2020; `@page` Baseline 2024, since December 2024) | MDN `CSS/image-orientation`, `CSS/@page` |
| 30 | Next.js CSP guide | **Confirmed** (nonces require dynamic rendering; the example policy has `style-src 'self' 'nonce-…'`) | `https://nextjs.org/docs/app/guides/content-security-policy` |
