# Phase 8 research: the action library, the Evaluate Code sandbox and the SSRF-safe HTTPS request

Status: complete, 2026-10-27. Every section was written as it was finished.

**Summary.**
- **Evaluate Code.** `quickjs-emscripten-core` with `@jitl/quickjs-wasmfile-release-sync` 0.32.0 (MIT, 2026-02-16; the bellard engine of 2025-12-22; Emscripten MIT/NCSA) passes rule 4 and the age rule. Its controls are a QuickJS memory cap, a stack cap, an interrupt-based deadline and no host functions by default; the build sets no WebAssembly memory maximum, so the host must pass one. QuickJS keeps producing memory-safety CVEs (seven published on 2025-10-16 alone), and the `quickjs-ng` variant's engine has a 2026 code-execution CVE, so the guest runs one fresh runtime per evaluation inside a child process with an empty environment and Node's permission flags, killed from outside at its deadline, with a no-network container as the hardened option. `node:vm` (documented as not a security mechanism) and vm2 (41 critical advisories in 2026) fail; isolated-vm passes its licence but is a native addon in maintenance mode.
- **HTTPS request.** The existing outbound client already resolves once and connects to the vetted address with SNI and the certificate on the host name, refuses redirects, caps bodies and times, and its address guard matches the IANA registries of 2026-10-13 including mapped, NAT64, 6to4, Teredo and the metadata addresses (also Azure's public `168.63.129.16`). Missing for the action: PUT, PATCH, DELETE; a port policy (443 plus a list, never a Fetch bad port); refusing a caller `Host` header and hop-by-hop headers; literal hosts in definitions; NAT64 network-specific prefixes; signing with the webhook scheme and an idempotency header; rate budgets.
- **Secrets.** Organisation-level keys with sealed per-environment values, write-only, referenced as `{{secrets.<key>}}` in a few fields only, bound to allowed hosts, resolved last, scrubbed by value from everything stored, never passed to code, never in events.
- **Messaging.** Email, SMS and Slack reuse the existing ports or the outbound client, each with a recording sandbox provider, recipient rules, fail-closed budgets (SMS shares the OTP budget), escaping, and at-most-once delivery; Slack through incoming webhooks only.
- **Object actions.** Each calls an existing or planned service; a run acts as a `workflow-run` principal on a scope grant derived from its steps, bounded by its publisher and by whoever triggers it; effects are keyed per run, step and loop index.
- **Article 22.** A decline on a path with no person in it is a solely automated decision: record it, require a declared basis and a contest route in production, tie biometric-based declines to consent, and decide how a review can change a terminal `declined`.

## 0. Scope, conventions and what earlier phases hand over

Prepared 2026-10-27 for OpenVerify Phase 8 ("Workflows and cases", `docs/PLAN.md` §6 Phase 8 and the Cases and Workflows rows of §2 [R1]). This note is the **safety** half of the action library: how to run operator-written code (Evaluate Code), how to make operator-configured outbound HTTPS requests without server-side request forgery, how to hold the credentials those actions need, how to send email, SMS and Slack messages without turning the product into a spam or toll-fraud relay, which existing service every object action calls and with what authority, and what GDPR Article 22 asks of a workflow that declines people automatically. The public behaviour of each step (what Persona's step does) belongs to the sibling note `phase8-behaviour.md` [S1]; the engine (durability, waits, loops, modules) to `phase8-workflow-engine.md` [S2]; the editor and cases to `phase8-editor-cases.md` [S3]. This note cites Persona's public pages only where a safety property or a parity identifier depends on them.

**Conventions.** Everything is in our own words. Identifiers (step names, field names, event names, configuration keys, URL paths) are reproduced only for functional parity. Anything the sources do not state is marked **not documented**; a statement we infer, and that no source makes, is marked **(inference)**. Every claim carries a citation key defined in "Sources and pins", with the URL and the read date (all 2026-10-27). Licence verdicts use repository rule 4 [R2]: ✅ passes, ⚠️ passes with a caveat or needs an owner decision, ❌ fails. Tiers R / H / A are those of ADR 0002 [R3].

**Release-age rule.** pnpm and uv refuse versions younger than 14 days, so a pinnable version was released on or before **2026-10-13**. Each package row gives the latest version and the newest one that passes.

**Method.** The repository was read, never changed or built (other agents are building Phase 6 in the same tree). External pages were fetched by `scripts/as_fetch.py`, which reads each host's `robots.txt` first with RFC 9309 semantics, spaces requests to one host by 1.2 s, sends a descriptive User-Agent without contact details, and sends no personal data. Downloads sit under `downloads/as-*/` (about 10 MB in total); scripts are `scripts/as_*.py`, always run with `python3 -I` and with paths as arguments. Nothing downloaded was executed: the one npm tarball read (the QuickJS release variant) was listed and its LICENSE read with Python's `tarfile` in memory, never extracted or installed. Two Persona developer pages were read from the sibling behaviour agent's local copies (`downloads/docs-pages/`, fetched the same day), to avoid a second request. Three fetch problems are recorded as they happened: `nodejs.org` disallows `/docs/` in its robots file, so the Node.js documentation was read from the tagged sources `nodejs/node@v22.22.1/doc/api/*.md`; EUR-Lex answered `202` with an empty body (a bot challenge), so the GDPR was read from the EU Publications Office's CELLAR endpoint for the same CELEX number; the GitHub advisory API's `page` parameter returned the same 100 rows twice, so only the 100 most recent vm2 advisories were counted.

### 0.1 What exists already (read-only review)

| Area | What the code does today | What it means for Phase 8 | Source |
|---|---|---|---|
| Outbound client | `createOutboundHttp()` builds one client per caller over undici 7.30.1, each with its own `Agent` (no global dispatcher, no environment proxy). GET and POST only. `https:` only unless a client sets `allowPlainHttp`. URLs with credentials refused. No redirect is followed (a 3xx comes back with its `location`). 2xx bodies capped (1 MiB default) and refused unless their media type is on the client's list. 10 s for the whole request (connect, headers and body). Errors carry a code and `retryable`, never the URL or a body. Private networks refused unless a client sets `allowPrivateNetworks` (only the EVM RPC client may) | The HTTPS action can be one more client of this factory; what it lacks is listed in §2.12 | [R5] |
| Address guard | `classifyAddress` sorts every IPv4 and IPv6 literal into `public` or one of twelve refused categories, with the metadata addresses checked before their ranges; the embedded IPv4 of `::ffff:0:0/96` and `64:ff9b::/96` decides those; anything in IPv6 outside the listed rules and outside `2000::/3` is `reserved`. `OPENVERIFY_WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` lifts loopback, private and CGNAT outside production only | Matches the IANA registries as of 2026-10-13 (§2.5); the action needs its own flag, never the webhook one | [R6] |
| Connect-time vetting | `createVettedLookup` resolves inside the socket's `lookup`, refuses the whole answer if any address is refused, and hands the socket exactly one vetted address; literal IP hosts are vetted before the request | This is the resolve-once-and-connect-to-the-checked-address defence OWASP asks for; undici still sets SNI and checks the certificate against the URL's host name (§2.3) | [R7] [R23] |
| Streaming client | `streamClient()` is declared for the Phase 6 list syncs (one allowlisted HTTPS redirect to an exact host, exposed headers, whole-request and idle deadlines); its body is still a Stage 1b stub that refuses every stream | A precedent for "one redirect to an exact host, vetted again, no headers carried over"; not for the HTTPS action | [R5] [R20] |
| Webhook signatures | `OpenVerify-Signature: t=<unix seconds>,v1=<hex HMAC-SHA-256(secret, "<t>.<raw body>")>`, one `v1` per active secret during rotation (at most 8), 300 s tolerance; `@openverify/node` verifies it and throws on any failure | The HTTPS action can sign with the same scheme, which is what the public product does for its own step [D2] (§2.11) | [R8] |
| DNS | A dedicated `node:dns/promises` `Resolver` (3 s, 2 tries) for MX, A, AAAA and TXT; errors name the failure, never the host | Not used by the outbound client, which resolves through `getaddrinfo` in its vetted lookup | [R9] [R7] |
| Mail | One install-wide SMTP transport (`OPENVERIFY_SMTP_URL`, `OPENVERIFY_MAIL_FROM`), a fresh connection per message, 10 s timeouts; `MailMessage.to` is an address object so nodemailer never parses a display name; `configured` tells callers whether SMTP is set | The Send Email action reuses it; there is no sandbox binding for mail today (§4.1) | [R10] |
| SMS | `SmsSender` (`twilio`) and `SandboxSmsSender` bound per environment kind by `OPENVERIFY_PROVIDER_SMS_{SANDBOX,PRODUCTION}`; the sandbox keeps `{destination index, code, sent-at}` in a Valkey sink readable with `sandbox:read`; errors carry a code only | The sandbox context is OTP-shaped (`code`); a workflow message needs a body-shaped sandbox record (§4.2) | [R11] |
| SMS abuse limits | GCRA rules in Valkey that fail closed: per client IP (IPv6 by /64), per inquiry, per destination (hour and day), per number prefix (first eight E.164 digits), per country, and an environment budget per hour | The Send SMS action should consume the destination, prefix, country and environment rules, not the per-IP one (§4.2) | [R12] |
| Sealed columns | `sealValue`/`sealJson` bind each ciphertext to `<table>.<column>#<row id>`, with a fresh AES-256-GCM DEK per value wrapped by the KEK (`ov1.<kid>.<wrapped DEK>.<payload>`); ciphertexts cannot be compared or indexed | Workflow secrets, step inputs and outputs and run logs can all be sealed row-bound (§3) | [R13] |
| Existing secrets | Webhook `secret` encrypted with a static context and shown once (last four kept); `previous_secret` and `custom_headers` sealed for the webhook id; repositories never return them except to the dispatcher | The model for action secrets: write-only, last four shown, opened only by the executing step | [R14] |
| Log redaction | pino redacts credential headers everywhere, any `pii` key up to five levels, and the named Phase 5 and 6 personal keys; workers also redact `secret`, `body`, `bytes`, `template` and more; API logs replace the values of `secret`, `token`, `password`, `code` and the members of `custom-headers` | Redaction by key name cannot recognise a secret value that a step copied into an unrelated field; §3.4 adds value-based scrubbing for resolved secrets | [R15] |
| Object services | `performInquiryAction`/`applyInquiryAction` (approve, decline, mark for review, expire under the row lock, with events and audit), `changeInquiryTags` and `changeAccountTags`, `createInquiry`, `RedactionService.{redactInquiry,redactAccount,redactReport}`; Phase 6's `POST /reports` and `/reports/:id/run` (C72, C74) and Phase 7's lists, graph queries and transactions are planned | Every object action is a thin call into one of these (§5) | [R16] [R17] [R20] [R21] [R22] |
| Principals | API scopes and operator permissions in `packages/core`; a principal can grant only what it holds (`missingPermissions`); audit actors are `user` or `api-key` only, plus a database-only `system` actor | A workflow run needs its own actor type and a scope set bounded by its publisher (§5.1) | [R17] [R18] |
| Idempotency | `Idempotency-Key` on server `POST`/`PATCH`, keyed by environment and principal, fingerprinted, stored 24 h | Workflow steps need their own deterministic effect keys, not HTTP idempotency keys (§5.2) | [R19] |
| Runtime | Node `>=22.18.0` (`package.json`), image `node:22.22.1-bookworm-slim` | The sandbox design targets Node 22's APIs (`worker_threads` limits, the stable permission model since 22.13.0) | [R24] [J2] [J3] |

### 0.2 What earlier phases hand to Phase 8

| From | Handed over | Where it lands here |
|---|---|---|
| Phase 6 | The workflow "Run report" action and match conditions; cases holding reports; `on-report-match: needs_review` as a stopgap until workflows exist (decision 28), which also routes an errored completion report to review (decision 48); linking needs the linked resource's scope (decision 39) | §5 (Run Report row), §6 |
| Phase 7 | Every step built on lists, graph, transactions and devices (Get List Match, Add Item To List, Add Item To Face List, Sync Graph, Run Graph Query, Create Transaction, Update Transaction Status, Set Relation, Trust Device); re-screening custom-list reports on a list update; case modules; transaction children; re-screening on account field changes as a trigger (C110); creating a case from a graph result (C103) | §5 |
| Phase 7 decision 18 | Auto-decline on a signal never happens by default; an operator who wants it writes a Phase 8 workflow (GDPR Art. 22) | §6 |
| PLAN §3 | Evaluate Code on quickjs-emscripten (MIT, WASM, time and memory limits); an SSRF guard on the HTTPS action that blocks private ranges and defends against DNS rebinding | §1, §2 |

## 1. Evaluate Code in QuickJS

### 1.1 What the public step is

The public Evaluate Code step runs an operator-written JavaScript function inside a workflow; its arguments are fields or objects the workflow can reach, and the operator declares a return type of Boolean, Number, Object, String or Nothing, a mismatch being a step error [H1]. It has retry intervals and continue-on-error, and a Run button that executes the function against stub arguments [H1]. Reusable "Custom Functions" are JavaScript too, written as `export default function ({ previous }) { … }` with one typed input and one typed output, environment-scoped, with a draft and a published revision, and null inputs refused unless the function opts in [H5]. The help page mentions "sandbox limits" without stating them, and points to developer documentation for the limits that govern the code [H5]. **Not documented:** the runtime, time and memory limits, whether code can reach the network or the Persona API (the Evaluate Code page names "integrating external data sources" as a use without saying how [H1]), output size, and what happens to `console` output.

### 1.2 Packages, variants and licences

| Package | Latest | Newest passing (≤ 2026-10-13) | Licence | Verdict |
|---|---|---|---|---|
| `quickjs-emscripten` (all four variants plus core) | 0.32.0, 2026-02-16 | **0.32.0** | MIT (registry; LICENSE at `df4efb9`) | ✅ but pulls the debug and asyncify variants too; prefer the core plus one variant [N1] |
| `quickjs-emscripten-core` (TypeScript only) | 0.32.0, 2026-02-16 | **0.32.0** | MIT | ✅ [N2] |
| `@jitl/quickjs-wasmfile-release-sync` (bellard QuickJS, release, synchronous) | 0.32.0, 2026-02-16 | **0.32.0** | MIT; its tarball LICENSE carries the wrapper's and QuickJS's MIT notices | ✅ **recommended** [N3] |
| `@jitl/quickjs-ng-wasmfile-release-sync` (quickjs-ng fork) | 0.32.0, 2026-02-16 | 0.32.0 | MIT | ⚠️ licence passes, but it bundles quickjs-ng v0.12.1, which two 2026 CVEs affect (§1.5) [N4] [V1] |
| `@jitl/quickjs-ffi-types` (dependency of the core and variants) | 0.32.0, 2026-02-16 | **0.32.0** | MIT | ✅ [N5] |
| QuickJS itself (bellard, vendored `2025-09-13+f1139494`, commit of 2025-12-22) | upstream release 2026-06-04 | n/a (vendored in the variant) | MIT (LICENSE at `f1139494`) | ✅ [Q1] [Q2] |
| Emscripten runtime (the generated JavaScript loader and libc pieces inside the variant; the variant is built with Emscripten 5.0.1) | n/a | n/a | MIT **or** University of Illinois/NCSA (dual; either passes) | ⚠️ passes; its notice is not reproduced in the variant's LICENSE, so `THIRD_PARTY_LICENSES.md` should carry it [N9] [N1] |

The variant matrix [N1] [N8]: `release` variants are for production and `debug` variants add assertions, source maps and leak detection; `sync` variants are the default and the fastest, while `asyncify` variants let a host function return a promise that the guest sees as a synchronous call, at about twice the size and lower speed, and one asyncified module can suspend on only one call at a time [N1]. Packaging forms are `wasmfile` (a separate `.wasm` read from disk), `singlefile` (inlined) and an `asmjs` build. Evaluate Code exposes no host function at all (§1.4), so it never needs asyncify: **use `quickjs-emscripten-core` with `@jitl/quickjs-wasmfile-release-sync`**. The variant tarball is 254,219 bytes compressed (SHA-256 `84590538…cf9c8`), its `.wasm` 503,134 bytes; it loads that file with `fs.readFileSync` from its own directory [N3], which matters for the permission flags in §1.6.

Build settings of that variant, read from its Makefile at the release commit [N8]: `ALLOW_MEMORY_GROWTH=1` with no `MAXIMUM_MEMORY` set, `IMPORTED_MEMORY=1` (the host may pass its own `WebAssembly.Memory`; the 0.27.0 changelog added the `wasmMemory` option for that), `STACK_SIZE=5MB` for the C stack inside linear memory, `FILESYSTEM=0`, `ALLOW_UNIMPLEMENTED_SYSCALLS=0`, `AUTO_JS_LIBRARIES=0`, and QuickJS compiled with `CONFIG_STACK_CHECK`. The host callbacks the C code can reach are few and named in `c/interface.c`: calling a registered host function, the interrupt check, freeing a host reference, and the module loader and normaliser [N8].

**Release cadence.** 0.31.0 came out on 2024-09-07 and 0.32.0 on 2026-02-16; `main` has commits up to 2026-07-23 that are not released [N1] [Q5]. Upstream QuickJS released on 2025-09-13 and 2026-06-04 and had commits on 2026-10-26 [Q1] [Q2]; quickjs-ng is at v0.17.0 (2026-09-18) against the v0.12.1 the wrapper vendors [Q3]. The wrapper therefore lags its engines by months, and an OpenVerify release cannot pick up an engine fix without either a wrapper release or building a variant ourselves (inference). The README says the project tries to be secure but **has not been audited** [N1].

### 1.3 The controls the library gives

- **Memory.** `runtime.setMemoryLimit(bytes)` caps QuickJS's own allocator for every context of the runtime together (it calls `JS_SetMemoryLimit`); the one-shot `QuickJS.evalCode(code, { memoryLimitBytes })` does the same [N1] [N8]. It counts QuickJS allocations, not the WebAssembly memory's growth, so the linear memory itself is bounded only by the module's maximum: the build sets none (Emscripten's default ceiling then applies, **not re-read** in this note), so the host should pass a `WebAssembly.Memory` with an explicit `maximum` (inference from `IMPORTED_MEMORY=1` and the `wasmMemory` option [N8] [N1]).
- **Stack.** `runtime.setMaxStackSize(bytes)` sets QuickJS's own stack limit (`JS_SetMaxStackSize`; in asyncify builds it also sizes the asyncify stack) [N8]. The C stack in linear memory is 5 MB [N8]; WebAssembly bounds-checks memory only at the granularity of the whole region, so data in linear memory can overwrite neighbouring data [W1]. QuickJS's limit must therefore stay well below 5 MB so deep recursion throws a `RangeError` before the C stack overruns into the heap (inference); 512 KiB is proposed in §1.8.
- **Time.** `runtime.setInterruptHandler(fn)` is called back from the interpreter, and `shouldInterruptAfterDeadline(deadline)` returns a handler that interrupts once the wall clock passes `deadline` [N1] [N8]. The check runs inside QuickJS's execution loop, so a single long native operation finishes before the handler is consulted (inference); a hard kill outside the VM is needed as a backstop (§1.6).
- **No I/O by default.** No host functionality is exposed to guest code unless the host adds it [N1]; the variant has no filesystem and refuses unimplemented system calls [N8]. There is no `fetch`, no `require`, no timers and no module loader unless the host registers one (inference from [N1] [N8]).
- **Values in and out.** Values cross the boundary through handles (`newString`, `newNumber`, `setProp`, `getProp`, `dump`, `unwrapResult`), each of which the host must dispose of [N1]. There is also a binary serialiser, `QTS_bjson_encode`/`QTS_bjson_decode`, on `JS_WriteObject`/`JS_ReadObject` [N8]. The simplest safe contract is JSON text: one string in, parsed by `JSON.parse` inside the VM, and one string out, produced by `JSON.stringify` inside the VM and parsed on the host with a size cap (inference). The QuickJS object reader has had heap overflows of its own (`JS_ReadString`, `JS_ReadBigInt`, `JS_ReadFunctionTag`, §1.5), so the host should never decode bytes the guest produced with `bjson` (inference).

### 1.4 What the guest gets

Nothing but the JSON value of its declared inputs. No `console` (a run log is a disclosure channel for PII and for secrets copied into inputs; the editor's test run may capture up to 50 lines of 1 KiB, shown only to its author, and production runs capture none: ours), no secrets (§3.5), no network, no clock beyond what QuickJS builds in (`Date.now()` and `Math.random()` remain; outputs are stored, so a replay reads the stored output rather than re-running code: inference), and no access to other steps' raw objects except through mapped inputs. This is narrower than the public step, which takes whole objects as arguments [H1]; mapping fields explicitly keeps PII out of code that does not need it (ours).

### 1.5 Security record of the engines

From the NVD CVE API (keyword `quickjs`, 29 results, of which four concern products that embed or sit beside it: SurrealDB's scripting and NGINX njs) and the upstream pages [V1] [Q1]–[Q3]:

| Published | CVE | Engine and versions | Class | Note |
|---|---|---|---|---|
| 2021-07-13 | CVE-2020-22876 | QuickJS, fixed in 2020-07-05 | stack overflow (DoS) | |
| 2023-05-12 | CVE-2023-31922 | QuickJS commit `2788d71` | stack overflow in `js_proxy_isArray` | |
| 2024-04-23 | CVE-2023-48183, CVE-2023-48184 | QuickJS before `c4cdd61` / `7414e5f` | NULL dereference; use-after-free in async closures | |
| 2024-05-14 | CVE-2024-33263 | QuickJS `3b45d15` | assertion failure | |
| 2025-03-21 | CVE-2024-13903 | quickjs-ng ≤ 0.8.0 | stack-based overflow | |
| 2025-04-27 | CVE-2025-46687, CVE-2025-46688 | quickjs-ng ≤ 0.9.0; QuickJS before 2025-04-26 | heap overflows in the object reader (`JS_ReadString`, `JS_ReadBigInt`) | reachable only through `JS_ReadObject` (inference) |
| 2025-10-16 | CVE-2025-62490 to CVE-2025-62496 | QuickJS before 2025-09-13 | two use-after-free, two out-of-bounds reads, a type confusion in string `+`, integer overflows in the regexp compiler and in BigInt parsing; CVSS up to 8.8 | references point to Google's issue tracker; CVE-2025-62491 is in the `std` library, which quickjs-emscripten does not use (inference) |
| 2025-11-05 | CVE-2025-12745 | QuickJS up to `eb2c890` | over-read in `ArrayBuffer.prototype.slice` | |
| 2026-01-10 / 01-19 | CVE-2026-0821, -0822, -1144, -1145 | quickjs-ng ≤ 0.11.0 | heap overflows in typed arrays, a use-after-free in `Atomics` | |
| 2026-03-06 | CVE-2025-69653, CVE-2025-69654 | QuickJS 2025-09-13, fixed 2025-12-11 | assertion aborts (DoS) | the vendored commit (2025-12-22) is later than the fixes (inference: same branch) |
| 2026-03-12 | CVE-2026-3979 | quickjs-ng ≤ **0.12.1** | use-after-free in an iterator helper | affects the `quickjs-ng` variant of 0.32.0 |
| 2026-05-11 | CVE-2026-37630 | quickjs-ng **0.12.1** | arbitrary code execution via `js_mapped_arguments_mark` | affects the `quickjs-ng` variant of 0.32.0 |
| 2026-09-24 | CVE-2026-88378 | QuickJS commit `04be246` | heap out-of-bounds write in `JS_ReadFunctionTag` (CVSS 9.8, awaiting analysis) | the bytecode reader; not reachable without `JS_ReadObject` with bytecode allowed (inference) |

**Fuzzing.** Google's OSS-Fuzz runs a `quickjs` project against `bellard/quickjs` with libFuzzer, AFL and honggfuzz under the address and memory sanitizers (build file from 2020, last changed 2026-06-08) [Q4]; the vendored source ships three libFuzzer targets (`fuzz_eval`, `fuzz_compile`, `fuzz_regexp`) [N8]. The 2025-10 batch shows a steady supply of memory-safety bugs in a C engine of this size; the GitHub advisory database lists **no** advisory for `quickjs-emscripten` itself [V4].

**What this means.** A QuickJS memory-safety bug is likely to exist at any time (inference from the record). Inside the WASM build it corrupts only the module's linear memory: modules are fault-isolated from the host, cannot escape except through their imports, and keep control-flow integrity, although data inside linear memory can be overwritten and timing side channels remain [W1]. An attacker who wins such a bug controls the QuickJS heap of that module (every runtime and context in it) and can call the module's few imports with chosen arguments [N8] (inference). Reaching the host further needs a second bug in V8's WebAssembly implementation or in the glue code that reads guest memory (inference). Hence one fresh runtime per evaluation, no host functions, no shared module between tenants, and the process boundary of §1.6.

### 1.6 Defence in depth: where the code runs and what an escape reaches

| Where the VM runs | Limits available | What a successful escape reaches | Verdict |
|---|---|---|---|
| The workflow worker's main thread | QuickJS memory, stack, interrupt | Everything the worker holds: `OPENVERIFY_KEK`, the blind-index key, `DATABASE_URL`, Valkey, S3 and provider credentials in its environment and memory, every tenant's data, the network | ❌ |
| A `worker_threads` worker | V8 heap limits (`maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`, `codeRangeSizeMb`, `stackSizeMb`); `terminate()` | The same process memory as above (a V8-level escape is not stopped by a thread). By default the worker's `process.env` **is a copy of the parent's**, so `env: {}` must be passed; and the limits do not cover external memory such as `ArrayBuffer`s, which is where WebAssembly memory lives [J2] | ⚠️ useful for termination, not a boundary |
| A child process (proposed default) | Its own V8 heap flag (`--max-old-space-size`), a wall-clock kill, an empty environment, Node's permission model (`--permission` restricts the file system, child processes, worker threads, native addons, WASI and the inspector; stable since 22.13.0) [J3] | Only what the parent sends it (the inputs of the evaluations it ran), the OS user's rights, and, in Node 22, the network: the permission model has no network permission there [J3]. The model is a seat belt for trusted code and promises nothing against malicious code; it does not carry over to worker threads, file descriptors already open bypass it, and symbolic links are followed [J3] | ✅ default, with the controls below |
| A separate container (proposed for the compose `app` profile) | `network_mode: none`, read-only root, non-root user, `cap_drop: [ALL]`, `no-new-privileges`, memory and PID limits; talks to the worker over a Unix socket on a shared volume (inference: standard container controls) | The inputs it was sent; a further step needs a container or kernel escape | ✅ hardened option |

**Proposed shape (ours).** A small `code-runner` entry (inside `packages/workflow-engine`) that the worker starts as a pool of child processes with `stdio: 'ignore'` plus an IPC channel, `env: {}`, `execArgv: ['--permission', '--allow-fs-read=<runner and variant directories>', '--max-old-space-size=64']`, one QuickJS runtime and context per evaluation (created, used, disposed), a fresh `WebAssembly.Memory` with a fixed `maximum` per module instance, the process recycled after 100 evaluations or after any interrupt, out-of-memory or protocol error, and every IPC message from the child treated as untrusted (schema-checked, size-capped). The parent enforces the deadline independently of the guest: `child.kill('SIGKILL')` at the step's time limit plus 250 ms (ours). The same runner serves the editor's test run, under the same limits.

### 1.7 Alternatives compared

| Option | Version (latest / passing) | Licence | Isolation | Limits | Record and maintenance | Verdict |
|---|---|---|---|---|---|---|
| quickjs-emscripten (release-sync) | 0.32.0 / **0.32.0** | MIT ✅ | A separate interpreter inside a WASM instance; no host functions by default | Memory, stack and interrupt in the VM; WASM memory maximum; process limits around it | QuickJS CVEs as in §1.5; wrapper unaudited and slow to release [N1] | ✅ **recommended**, inside §1.6's process |
| isolated-vm | 7.0.1 (2026-08-05, Node ≥ 24) and **6.2.0** (2026-08-06, Node ≥ 22) both pass the age rule; only 6.2.0 runs on the pinned Node 22 | ISC ✅ | A separate V8 isolate in the same process, via a native addon (`node-gyp-build`) | `memoryLimit` in MB, which its README calls a guideline that a hostile script can exceed two to three times (default 128, minimum 8); CPU and wall time counters | Maintenance mode by its README; CVE-2021-21413 (leaked references give the host) and CVE-2022-39266 (cached data); the README itself advises a different process from critical infrastructure [N6] [V3] | ⚠️ licence passes, but a native addon (an `allowBuilds` entry and a compiler or prebuild in every image), V8 escapes land in-process, and maintenance mode: not recommended |
| `node:vm` | built in | MIT (Node) ✅ | Contexts in the same isolate | Timeouts only | Documented as **not** a security mechanism and not to be used for untrusted code [J1] | ❌ for operator code |
| vm2 | 3.12.2 (2026-09-08) / **3.12.2** | MIT ✅ | A proxy membrane in the same realm and process | `timeout`, `bufferAllocLimit` | Of the 100 most recent GitHub advisories, 70 are live (30 are withdrawn duplicates); 44 of the live ones are critical, 41 of them published in 2026 after the project's revival (3.10.x to 3.12.x), most of them sandbox escapes [V2]. Its own README says new bypasses will likely be found and recommends stronger isolation for untrusted code [N7] | ❌ |
| A standalone WASM runtime (for example Wasmtime, Apache-2.0 per GitHub, v50.0.0 on 2026-10-20; Javy compiles JavaScript to WASM on QuickJS, Apache-2.0 per GitHub) | n/a | Apache-2.0 ✅ (GitHub licence detection; LICENSE files not read) | WASI module in a separate runtime and process | Fuel or epoch interruption, memory limits (inference; not read) | Not evaluated here | ⚠️ a heavier stack (a Rust binary per image, or a sidecar) for the same QuickJS engine; worth it only if V8's WASM sandbox is judged insufficient [W2] |

### 1.8 Recommended limits and their basis

All values are ours and provisional, chosen so one Evaluate Code step stays small next to the workflow engine's step lease; each is a per-step setting that can only be lowered, plus an install ceiling.

| Limit | Default (ceiling) | Basis |
|---|---|---|
| Wall time per evaluation | 1,000 ms (5,000 ms), through `shouldInterruptAfterDeadline`; the parent kills the process at the limit plus 250 ms | The interrupt handler is checked only inside the interpreter (§1.3), so the kill is the bound; the public step has a retry interval, so a time-out is a step error, not a hang [H1] |
| QuickJS memory | 32 MiB (64 MiB) via `setMemoryLimit` | Code transforms a few JSON values; isolated-vm's own minimum is 8 MB [N6] |
| WASM memory maximum | QuickJS limit plus 16 MiB headroom, passed as `WebAssembly.Memory({ initial, maximum })` | The variant's build sets no maximum (§1.2); `worker_threads` limits would not see this memory [J2] |
| Child heap | `--max-old-space-size=64` | Bounds the glue code's own allocations (for example a huge string read out of guest memory: inference) |
| QuickJS stack | 512 KiB via `setMaxStackSize` | Below the 5 MB C stack, so recursion fails cleanly (§1.3) |
| Source size | 64 KiB | Ours |
| Inputs | 256 KiB of JSON text, depth ≤ 32, only declared and mapped fields | Ours; keeps PII out of code that does not use it |
| Output | 64 KiB of JSON text, depth ≤ 32, checked against the declared return type (Boolean, Number, Object, String, Nothing) | The public return types [H1]; the size is ours |
| Network, files, timers, modules, host functions | none | No host functionality unless added [N1] |
| Concurrency | pool size `max(1, CPUs − 1)` per worker, and an environment budget per minute | Ours; a tenant cannot starve the others |
| Errors | `timeout`, `memory_limit`, `stack_overflow`, `invalid_output`, `type_mismatch`, `runtime_error` (message only, capped at 1 KiB, no stack frames from the host), `sandbox_crashed` | Ours; ADR 0002 rule 3a's spirit: an execution failure is reported as such, never as a value [R3] |

**Tier and honesty.** Evaluate Code is R-tier as an execution engine; what the code decides is the operator's logic, so the run records the code's version hash and the step marks any decision that depended on it (ours). The sandbox claim in the docs must say what it does **not** cover: Spectre-class side channels inside one process [W1], a V8 WebAssembly bug, denial of service against the worker pool beyond the budgets, and anything the operator chooses to pass in as an input (inference).

## 2. The SSRF-safe HTTPS request

### 2.1 What the public step is

The public Make HTTPS Request step sends a request to a URL that may be typed in or taken from elsewhere in the workflow, with request headers (key and value), an optional JSON body for PATCH, POST and PUT, an optional response schema, a signing secret, retry intervals, a request timeout and continue-on-error [H2]. The Help Center lists DELETE, GET, PATCH, POST and PUT [H2]; the developer overview says POST and GET [D1], so the method set is a small discrepancy between Persona's own pages. Persona recommends configuring the step to send a `Persona-Signature` header for POST requests, built exactly like its webhook signature (`t=<unix time>`, `v1=<HMAC-SHA-256 of "<t>.<body>">` under a configurable secret), and suggests reusing the webhook secret so existing verification code keeps working [D2]. Secrets can be supplied from Platform Secrets (§3.1) [H4]. **Not documented:** which destination addresses are refused, redirect handling, response size limits, allowed ports, the maximum timeout, and whether GET requests are signed.

### 2.2 What the guidance asks for

OWASP's cheat sheet (last modified 2026-10-26) separates two cases [X1]. When the application talks only to known partners, it should validate the input and compare it with an **allowlist**, building the request from the matched entry. When any external destination must be reachable (its example is webhooks), allowlists do not work and a **blocklist** of non-public destinations is the fallback: resolve every A and AAAA record and check all of them, then **bind the connection to a validated address** while keeping the original host name for the `Host` header, SNI and certificate verification, apply the same policy to retries and fallback connections, and **disable redirects**. It adds network-layer controls (a firewall allowing only legitimate flows), IMDSv2 on AWS, and a minimum deny list that names the AWS, GCP and Azure metadata endpoints, loopback, RFC 1918, link-local and multicast, pointing to the IANA registries as the source [X1].

### 2.3 DNS rebinding, SNI and certificates in the existing client

- **Resolve once, connect to the checked address.** The vetted lookup runs inside the socket's own `lookup`, so there is no second, unchecked resolution between the check and the connection; a mixed answer (one public and one private address) is refused outright, and the socket receives only the first vetted address, even when Node asks for all of them [R7]. Literal IP hosts are checked before the request [R5].
- **SNI and the certificate stay on the host name.** undici's connector calls `tls.connect` with `servername` taken from the URL's host and `host` set to the host name, spreading the agent's connect options (which carry the vetted `lookup`) into the call [R23]. TCP therefore goes to the vetted address, while SNI and Node's certificate check use the name in the URL (inference from [R23]; it is what OWASP describes [X1]).
- **Pooled connections.** A kept-alive connection stays on the address that was vetted when it opened; a new connection runs the lookup again (inference from [R7] [R23]).
- **A caller-set `Host` header is a gap.** undici accepts a `host` request header and uses it as the request's host, independently of SNI [R23]. The HTTPS action must refuse a `Host` header, so the name the TLS layer checked is the name the server routes by (ours). undici already rejects `transfer-encoding`, `keep-alive`, `upgrade` and `expect`, and validates `connection` tokens [R23].
- **URL normalisation (measured on Node 22.22.1 [M1]).** `new URL()` turns `https://0x7f.1/`, `https://127.1/`, `https://017700000001/` and `https://2130706433/` into host `127.0.0.1`; `https://[::ffff:127.0.0.1]/` becomes `[::ffff:7f00:1]`, which the guard's IPv6 parser reads as the mapped IPv4 `127.0.0.1` (by reading `ipv6Bytes` [R6]); percent-encoded host bytes are decoded (`exa%6Dple.com` → `example.com`); a trailing dot survives (`example.com.`); and `:6379` is accepted as a port. The guard must therefore check the parsed host (it does [R5]) and any host allowlist must compare normalised names, trailing dot removed (inference).

### 2.4 Redirects

The existing client follows no redirect and returns the 3xx status with its `location` [R5]. Keep that for the HTTPS action: browsers drop only `Authorization` on a cross-origin redirect [X4], not custom headers such as an `X-API-Key` taken from a secret (§3), so following redirects would carry operator credentials to a host nobody vetted (inference). The step's output exposes the status and, for a 3xx, the `location` value, so a workflow that wants to follow can do so with a second HTTPS step that goes through every check again (ours). Phase 6's one-hop list redirect (exact host, vetted again, no headers carried) stays limited to the list clients [R20].

### 2.5 The guard against the IANA special-purpose registries

Both registries were read as CSV, last modified 2026-10-13 [X2] [X3]. Every block that IANA marks **not** globally reachable, and how `classifyAddress` treats it [R6]:

| IPv4 block (IANA name) | Guard | IPv6 block (IANA name) | Guard |
|---|---|---|---|
| `0.0.0.0/8` this network | `unspecified` | `::1/128` loopback | `loopback` |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` private use | `private` | `::/128` unspecified | `unspecified` |
| `100.64.0.0/10` shared address space | `cgnat` | `::ffff:0:0/96` IPv4-mapped | the embedded IPv4 decides |
| `127.0.0.0/8` loopback | `loopback` | `64:ff9b:1::/48` local-use translation (RFC 8215) | `reserved` |
| `169.254.0.0/16` link local | `link_local` (metadata addresses first) | `100::/64` discard-only | `reserved` |
| `192.0.0.0/24` IETF protocol assignments (with `/29`, `.8`, `.170`, `.171`) | `reserved` (also `.9` and `.10`, which IANA marks reachable: harmless) | `100:0:0:1::/64` dummy prefix (RFC 9780, 2025-04) | not listed; falls to the final `reserved` |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` documentation | `documentation` | `2001::/23` IETF protocol assignments (Teredo `2001::/32`, benchmarking `2001:2::/48`) | `reserved` (also the reachable anycast, AMT, AS112, ORCHIDv2 and DET blocks inside it: harmless) |
| `192.88.99.0/24` deprecated 6to4 relay (with `192.88.99.2/32`) | `reserved` | `2001:db8::/32`, `3fff::/20` documentation | `documentation` |
| `198.18.0.0/15` benchmarking | `benchmarking` | `2002::/16` 6to4 | `reserved` |
| `240.0.0.0/4` reserved | `reserved` | `5f00::/16` SRv6 SIDs (RFC 9602) | not listed; falls to the final `reserved` |
| `255.255.255.255/32` limited broadcast | `broadcast` | `fc00::/7` unique local | `private` |
| `224.0.0.0/4` multicast (its own registry) | `multicast` | `fe80::/10` link local; `fec0::/10`, `ff00::/8` | `link_local`; `reserved`; `multicast` |

**Result.** No non-reachable block is treated as public. The reachable service blocks the guard allows (`192.31.196.0/24`, `192.52.193.0/24`, `192.175.48.0/24`, `2620:4f:8000::/48`) are AS112 and AMT services, which IANA marks globally reachable [X2] [X3]. Two recent IPv6 entries are refused only by the final default rather than by name; since IANA adds blocks inside `2000::/3` from time to time (`3fff::/20` in 2024, `2001:30::/28` in 2022 [X3]), a test should pin one sample address per registry row against a dated copy of the registry, so an update is a reviewed change (ours).

### 2.6 Embedded IPv4: mapped, NAT64, 6to4, Teredo

- **IPv4-mapped** `::ffff:0:0/96` and the **well-known NAT64 prefix** `64:ff9b::/96` (RFC 6052, which IANA marks globally reachable) are classified by their embedded IPv4, so `64:ff9b::a00:1` is private [R6] [X3].
- **Local-use NAT64** `64:ff9b:1::/48` is refused whole [R6] [X3].
- **6to4** (`2002::/16`) and **Teredo** (`2001::/32`) embed IPv4 addresses too, and are refused whole [R6].
- **Not covered: network-specific NAT64 prefixes.** RFC 6052 also lets a network use its own prefix (cited by IANA for `64:ff9b::/96`; the RFC itself was not re-read). On an IPv6-only deployment whose DNS64 synthesises addresses under such a prefix, an attacker's name with the A record `10.0.0.1` comes back as an ordinary global unicast address, and the guard would call it public (inference). An operator setting listing the deployment's NAT64 prefixes, whose embedded IPv4 is then checked like the well-known one, closes this (ours).

### 2.7 Cloud metadata endpoints

| Endpoint | Address | Guard | Source |
|---|---|---|---|
| AWS instance metadata | `169.254.169.254`, `[fd00:ec2::254]` (Nitro instances in IPv6 subnets) | `metadata`, ahead of link-local and unique-local | [X5] [R6] |
| AWS ECS task metadata | `169.254.170.2` | `metadata` | [R6] (code comment; AWS page not re-read) |
| Google Cloud | `metadata.google.internal`, `169.254.169.254`, and `fd20:ce::254` on IPv6-only instances | `metadata` (the name resolves to a refused address) | [X6] [R6] |
| Azure instance metadata | `169.254.169.254` | `metadata` | [X7] [R6] |
| Azure WireServer | `168.63.129.16`, a **public** address Microsoft owns, used on ports 80 and 32526 and for DNS | `metadata` (refused although public) | [X8] [R6] |
| Alibaba Cloud, Oracle Cloud classic | `100.100.100.200`, `192.0.0.192` | `metadata` | [R6] (code comments; vendor pages not re-read) |

The metadata rules are checked before `allowPrivateNetworks` is considered, so no development flag lifts them [R6]. Operators on AWS should also enforce IMDSv2, as OWASP recommends [X1].

### 2.8 Ports

The client accepts any port in the URL [R5] [M1]. A blocked address list says nothing about **public** hosts that run non-HTTP services. The Fetch standard refuses a list of "bad ports" for HTTP(S) fetches (0, 1, 7, 9, 11, 13, 15, 17, 19, 20–23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101–104, 109–111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512–515, 526, 530–532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665–6669, 6679, 6697, 10080) [X4], which still leaves database and cache ports such as 5432 and 6379 open (inference). Proposal: **443 only** by default, plus an environment setting listing extra ports, which can never include a Fetch bad port (ours).

### 2.9 Methods, headers, bodies and responses

- **Methods:** GET, POST, PUT, PATCH, DELETE, for parity with the Help Center [H2]; the client today has GET and POST [R5].
- **Request headers:** at most 32, 8 KiB in total, names matching the HTTP token syntax; refused: `host`, `content-length`, `transfer-encoding`, `connection`, `keep-alive`, `upgrade`, `expect`, `te`, `trailer`, `proxy-*`, and the names OpenVerify sets itself (`openverify-signature`, `idempotency-key`, `openverify-workflow-run`) (ours, with [R23]).
- **Body:** JSON only (`application/json`), at most 256 KiB, built from the step's template with every interpolated value JSON-encoded, never string-concatenated (ours).
- **Response:** 2xx bodies accepted as `application/json` (and `text/plain` as a string), at most 1 MiB (the client default [R5]), parsed with a depth limit and validated against the optional response schema; a non-identity `content-encoding` is refused, because the client does not decompress [R5] (inference: a compressed body would otherwise pass the cap compressed and be unusable). Only allowlisted response headers reach the workflow (`content-type`, `location` on a 3xx, `retry-after`, `etag`) (ours). Response bodies are sealed in the run record (§3.4).

### 2.10 Time, retries and rate

The client's 10 s deadline covers the whole request, body included [R5]; the action exposes the public step's request timeout [H2] between 1 and 30 s (ours). Retries follow the step's retry intervals only for `timeout`, `network` and `dns` failures (the client's `retryable` errors [R5]) and for 429 and 5xx answers, honouring `Retry-After` up to the next interval (ours). A per-environment budget (for example 600 requests per minute, ours, failing closed like the OTP limits [R12]) and a per-host concurrency cap stop a loop step from turning OpenVerify into a load generator (inference).

### 2.11 Signing so the receiver can verify the sender

Reuse the webhook scheme unchanged [R8]: header `OpenVerify-Signature: t=<unix seconds>,v1=<hex HMAC-SHA-256(secret, "<t>.<raw body>")>`, with one `v1` per active secret while a step secret rotates. A receiver then verifies with `@openverify/node`'s `verifyWebhookSignature` as it does for webhooks [R8], which matches the public product's advice to reuse webhook verification code [D2]. Choices (ours):
- Sign every request, including GET and DELETE (over an empty body), so a receiver can always check freshness and origin; the public product documents only POST [D2].
- A secret per step (sealed, §3), with the option to reference the environment's webhook secret for receivers that already verify webhooks [D2].
- Send `Idempotency-Key: <effect key>` (§5.2) and `OpenVerify-Workflow-Run: <wfr_ id>` as plain headers.
- **What v1 does not cover:** the method, the URL and other headers are outside the signed string [R8], so a captured request can be replayed within the tolerance to another endpoint that shares the secret (inference). A per-step secret narrows that, and a later `v2` could adopt RFC 9421 HTTP Message Signatures (an IETF Proposed Standard, 2024), which signs chosen components such as the method and target URI [X9].

### 2.12 What the existing client does and what is missing

| Property | Existing client [R5] [R6] [R7] | HTTPS action needs (ours unless cited) |
|---|---|---|
| Private, loopback, link-local, CGNAT, documentation, reserved, multicast refused; IPv4 and IPv6 | ✅ | keep; never take the webhook or EVM private-network flags |
| Metadata addresses, including the public `168.63.129.16` | ✅ | keep |
| Every resolved address checked; connection bound to the checked one | ✅ | keep |
| SNI and certificate on the URL's host name | ✅ (through undici [R23]) | keep; refuse a caller `Host` header |
| Redirects not followed | ✅ | keep; expose status and `location` |
| `https:` only; no credentials in the URL | ✅ | keep (`allowPlainHttp` never set) |
| Response cap, content-type allowlist, whole-request deadline | ✅ (1 MiB, 10 s) | keep; timeout 1–30 s per step; refuse `content-encoding` |
| Errors without URL or body | ✅ | keep; the step's error codes come from `OutboundHttpError.code` |
| Proxy from the environment ignored | ✅ | keep; an explicit egress-proxy setting later (§2.13) |
| Methods | GET, POST | add PUT, PATCH, DELETE [H2] |
| Ports | any | 443 plus an operator list, never a Fetch bad port [X4] |
| Header policy | caller headers passed through | allowlisted syntax and count; refuse `host` and hop-by-hop names |
| Host source | n/a | scheme, host and port literal in the definition (§2.13) |
| NAT64 network-specific prefixes | not handled | operator setting (§2.6) |
| Signing, idempotency header | webhook dispatcher only | per-step sealed secret, `OpenVerify-Signature`, `Idempotency-Key` |
| Rate and concurrency | none | environment budget and per-host cap |
| Registry drift | none | a dated registry fixture test (§2.5) |

### 2.13 What the guard does not cover

- **Public destinations that trust the operator.** A request leaves from the operator's egress address; a partner that allowlists that address, or the operator's own public admin endpoints, can be reached and will trust it (a confused deputy) (inference). Address checks cannot help; an optional per-environment **host allowlist** can (OWASP's first case [X1]).
- **Data-chosen hosts and DNS exfiltration.** The public step lets the URL come from workflow data [H2]. If a host name is built from end-user fields, the resolver sees those values as DNS labels before any address check refuses the connection (inference). Proposal: the scheme, host and port must be literal in the published definition, and templates may fill only path segments (percent-encoded) and query values (ours; a deliberate narrowing, owner decision 2).
- **OpenVerify itself.** OpenVerify's own public API is a public destination; an HTTPS step calling it needs an API key in a secret like any other receiver, and gains nothing a workflow does not already have (inference).
- **The network layer.** A firewall or egress proxy is the second line OWASP recommends [X1]. The client deliberately ignores `HTTP_PROXY` [R5], so an egress proxy (for example Stripe's `smokescreen`, MIT per GitHub [X10]) would need an explicit setting (ours, later).
- **Content.** The guard decides where a request may go, not whether the answer is true; a response feeds conditions only through its declared schema (ours).

## 3. Secrets for actions

### 3.1 The public model (parity)

Persona's Platform Secrets [H4] (page last updated 2026-09-30):
- stored at the **organisation** level under a snake_case key (for example `crm_api_key`) that cannot be renamed, with a description and **one value for Sandbox and one for Production**;
- referenced from steps that accept templates as `current_run.environment.secrets.<name>`, so the same published definition resolves the right value in each environment; a rotated value applies to the next execution without republishing;
- resolved lazily, one key at a time, only when the step that uses it runs;
- masked as `[REDACTED]` in execution logs, run history and step outputs, encrypted at rest with envelope encryption, never stored in run state, and hidden from run viewers even when they may inspect inputs and outputs;
- governed by two permissions, `organization-secret.view` (names and metadata, never values) and `organization-secret.write`;
- with an explicit warning that the masking covers Persona's own logs and panels only, so a secret placed in an SMS, an email or a note is exposed.

Typical uses named there: authorization headers in HTTPS steps, HMAC signing secrets, and values passed into compute steps [H4].

### 3.2 Storage (proposed)

- **Tables (ours).** `workflow_secrets` (`wsec_`): `organization_id`, `key` (snake_case, unique per organisation, immutable), `description`, `allowed_hosts` (§3.3), `created_by`, timestamps. `workflow_secret_values`: `secret_id`, `environment_id`, `value` sealed with `sealValue('workflow_secret_values.value', <row id>, …)` [R13], `last4`, `version`, `previous_value` (sealed) with `previous_expires_at` for signing secrets in rotation, `rotated_by`, `rotated_at`. This follows the webhook secret pattern: written once, shown never, the last four characters kept for recognition [R14].
- **Keys.** The values sit under the KEK like every sealed column, so they join the KEK rewrap list and `kek:rewrap` covers them (inference from [R13]). They are not personal data, so redaction and DSAR export skip them (ours).
- **Permissions (ours, parity with [H4]).** `secrets:read` (keys, descriptions, hosts, last four, who rotated when) and `secrets:write` (create, set a value, rotate, delete), both operator permissions, neither for viewers; every write is audit-logged with the key name and never the value.
- **API.** `PUT /api/v1/workflow-secrets/:key/values/:environment` takes `secret-value` and answers metadata only; `secret-value` joins `API_LOG_REDACTED_KEYS` so API logs never hold it [R15] (ours).

### 3.3 Referencing without exposure

- **Syntax.** `{{secrets.<key>}}`, a reference resolved by the executor; the published definition stores the reference, never a value (ours, mirroring [H4]).
- **Where a reference may appear (ours).** HTTPS request header values, the HTTPS signing secret, the HTTPS JSON body (some APIs take client credentials there), and the Slack webhook URL field. **Nowhere else:** not in a URL (paths and query strings end up in receivers' and proxies' logs), not in Evaluate Code inputs (§3.5), not in email, SMS or Slack message text, tags, case comments, object fields or conditions. The editor checks this statically and publishing refuses a violation; publishing also refuses a reference to a key without a value for the target environment.
- **Bind each secret to its destinations (ours).** A secret carries `allowed_hosts`, exact host names set by someone holding `secrets:write`; the executor refuses to place a secret into a request whose (static, §2.13) host is not on that list. Without this, anyone who may edit workflows could copy a credential into a header sent to a host of their choosing, which the public model's "builders need not see production secrets" [H4] does not prevent on its own (inference).

### 3.4 Keeping secrets out of run logs, step outputs and events

1. **Resolve last.** The executor opens the sealed value inside the action, after every other check, and holds the plaintext only in the request it builds. The step's recorded input is the unresolved template (ours; [H4] states the same property).
2. **Scrub by value.** Before an output, an error message or a test-run log line is stored, replace every occurrence of each value resolved in that step, and of its base64, base64url and percent-encoded forms, with `[REDACTED]` (ours). Key-name redaction in pino and API logs [R15] cannot catch a receiver that echoes a header into its response body (inference).
3. **Seal what is kept.** Step inputs, outputs and response bodies are stored sealed and row-bound (`workflow_step_runs.output#<id>`) [R13], because they hold PII as well as anything a receiver echoed (ours).
4. **Events carry no bodies.** `workflow-run.created`, `.completed`, `.errored` and `.resumed` [R4] carry the run's ids, status and per-step outcome codes, never step inputs or outputs; outputs are read through the API with `workflows:read` and the viewer's PII mask (ours).
5. **Errors name codes.** The outbound client's errors already omit URLs and bodies [R5], and the SMS adapter's errors are codes only [R11]; the Slack and email actions follow the same rule (ours).
6. **A canary test.** A test runs one step of each kind with a recognisable synthetic secret and asserts it appears in no table (`workflow_*`, `events`, `audit_logs`, `api_logs`, `idempotency_keys`) and in no captured log line (ours; Phase 6 has the same kind of test for provider credentials in startup errors [R20]).

### 3.5 Secrets and Evaluate Code

The public product lets secrets flow into compute steps [H4]. Proposal: **never** (owner decision 4). The guest's output is stored, and code can encode a value in ways value scrubbing cannot recognise (reversed, split, hashed) (inference); a step that needs a credential belongs in the HTTPS action, where the secret is bound to its hosts.

### 3.6 Install credentials

Twilio, SMTP and provider credentials stay environment variables read by the API or the worker, as Phase 5 and 6 established [R10] [R11] [R20]. The public Send Email step's per-step SMTP server and password [D1] would be a workflow secret if it is ever offered (§4.1).

## 4. Messaging actions: email, SMS and Slack

All three send data to a third party and to people. Each ships as an adapter with a deterministic sandbox provider that records and never sends, and configuration refuses to bind a sandbox provider in production (ADR 0002 rule 3d [R3]; the C63 binding pattern [R11]). Each is at most once (§5.2): a message is claimed before it is sent, and a crash after the send leaves the effect `unknown` rather than sending again (ours).

### 4.1 Send Email (and Inquiry Link Email)

- **Public.** Recipient, subject and message taken from workflow values or typed in, HTML with a text fallback, and a note to send only where consent was collected [H9]; the developer overview adds advanced options for the From address and a custom SMTP server (address, port, TLS, user, password) [D1].
- **Port.** `Mailer.send({ to: { address }, subject, text, html? })` over the install's SMTP transport [R10]. The action reuses it unchanged.
- **Per-step SMTP: not offered** (owner decision 6). A custom SMTP host is an outbound connection to an operator-chosen address on a mail port, which the HTTPS guard's port rule forbids (§2.8); if it is ever offered, it needs the same address vetting, ports 465 or 587 only, TLS required, and the vetted address passed to the transport with the original name for TLS (inference; nodemailer's options were not re-read).
- **From.** Always the install's `OPENVERIFY_MAIL_FROM` [R10]; no per-step From, so a workflow cannot send mail that claims another sender (ours).
- **Recipients (ours).** One recipient per step, no cc or bcc. It must be either an address the run's object holds (an inquiry's email field or an OTP-confirmed address), or on an environment allowlist of addresses or domains (team members, a shared review inbox). A literal address typed into a step must be on that list.
- **Limits (ours, built on [R12]).** GCRA rules in Valkey that fail closed: per recipient (5 per hour, 20 per day) and per environment (1,000 per hour).
- **Content (ours).** Subject at most 200 characters with CR and LF removed; text at most 32 KiB; HTML at most 64 KiB from the operator's template, every interpolated value HTML-escaped; `https:` links only; no attachments; no secret references (§3.3).
- **Sandbox.** There is no sandbox mail binding today: the transport is install-wide [R10]. Proposal: in sandbox environments workflow mail goes to a Valkey sink per environment (like the SMS sink, readable with `sandbox:read` [R11]), and is delivered for real only to addresses on the allowlist; development's Mailpit catches everything anyway [R10] (ours).

### 4.2 Send SMS (and Inquiry Link SMS)

- **Public.** A number and a message taken from workflow values or typed in, with advice to use SMS sparingly and with consent [H8]. Persona's SMS-fraud page names traffic pumping (fraudsters making a flow send SMS to number ranges they profit from) and recommends per-user inquiries, a fixed country code, and auto-decline workflows on suspicious regions [H10].
- **Port.** `SmsSender.send({ to: <E.164>, body })` with Twilio, or the sandbox sender, bound per environment kind [R11].
- **Sandbox shape.** The sandbox context is OTP-shaped (`destinationIndex`, `code`) [R11]. A workflow message needs a record of `{ destination index, kind: 'workflow', body (sealed), sent-at }` in the same sink, so the C55.11 search can return it to `sandbox:read` keys (ours; a C55.10 amendment).
- **Recipients (ours).** By default only the run object's OTP-confirmed number; an unconfirmed phone field only with an explicit step option that the publisher acknowledges; a literal number only from an environment allowlist. Destination countries are limited to an environment allowlist, by default the countries the inquiry template's phone step accepts: the public product's main pumping defence is locking the country [H10].
- **Limits.** The action consumes the existing destination (hour and day), prefix, country and environment rules, and shares the environment's hourly SMS budget with OTP sends, so a workflow cannot spend around the OTP caps; like them, it fails closed [R12] (ours).
- **Content (ours).** At most 480 characters; no URL except the inquiry's own flow link (Inquiry Link SMS) or a host on the environment's link allowlist (phishing); no secret references.

### 4.3 Send Slack Message

- **Public.** Two forms. The older one posts to a Slack incoming-webhook URL with a message that can interpolate workflow values (its example includes a reference id and the person's first name), plus a recipient override that works only with deprecated webhooks [H7]. The newer one uses Persona's Slack app through OAuth and posts to a user or channel id [H6].
- **Incoming webhooks [K1].** The operator creates a Slack app in their own workspace, enables incoming webhooks and picks one channel; Slack returns a URL of the form `https://hooks.slack.com/services/T…/B…/…` that is specific to one user and one channel. The URL **is** a secret, and Slack searches for and revokes leaked ones. A post is a JSON `POST` with `text` and optional `blocks`; a webhook cannot change its channel, user name or icon, and cannot delete what it posted. Errors use HTTP 400, 403 and 404 with codes such as `invalid_payload`, `action_prohibited`, `channel_is_archived`, `invalid_token`, `no_active_hooks`, `no_service`, `no_service_id`, `no_team`, `no_text`, `posting_to_general_channel_denied`, `team_disabled`, `too_many_attachments`, `user_not_found` and `channel_not_found`. GovSlack calls go to `slack-gov.com` instead of `slack.com`; the GovSlack webhook host is **not documented** there.
- **Validation (ours).** The URL is stored as a workflow secret (§3) and must be `https:` on exactly `hooks.slack.com`, with a path matching `^/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+$`; a GovSlack host only behind an explicit setting. It is sent through the outbound client like any HTTPS action, and is never logged or shown again. One OAuth example on the same Slack page shows a URL without `/services/` [K1]; accepting that shape is left to the owner (owner decision 7).
- **Rate.** Incoming webhooks allow about one message per second, with short bursts, and answer 429 with `Retry-After` when exceeded [K2]. The action queues per webhook at one per second with a burst of 3 and honours `Retry-After` (ours).
- **Content.** Slack treats `&`, `<` and `>` as control characters and asks for them to be sent as `&amp;`, `&lt;` and `&gt;` when they are not markup [K3]. Escaping every interpolated value that way stops a name such as `<!channel>`, or a disguised link, typed by an end user from pinging a channel or hiding a URL (inference from [K3]). Text at most 3,000 characters (ours). The default templates carry ids and console links, not PII; a template that references PII fields needs the publisher's `pii:view` and marks the step as sending PII off the platform (ours).
- **Terms.** The Slack API Terms (effective 2025-10-10) license API access to develop and use an application, forbid commercially distributing a Slack-integrated application without a separate agreement with Slack or Salesforce, and require an application used outside its own organisation to get explicit authorisation for API Data and keep it to the minimum [K4]. OpenVerify ships no Slack app: each operator creates their own in their own workspace, so the terms bind that operator, and a hosting provider offering OpenVerify to others should read the distribution clause (inference). An OAuth integration like the public newer form would need its own client id, secret and redirect flow per operator: later (owner decision 7).
- **Sandbox.** A sandbox Slack provider records the payload it would have sent in the sandbox sink and posts nothing (ours).

## 5. The object actions

### 5.1 Whose authority a workflow uses

- **A principal of its own.** Audit actors today are `user` and `api-key`, with a database-only `system` actor [R17]. A run should act as `{ type: 'workflow-run', id: 'wfr_…' }`, a new actor type, with the workflow id, version id, step key and publishing user in the entry's metadata (ours). This matches the public model, where a list item's `creator` can be a workflow run or a workflow step [R25].
- **A frozen grant, bounded by the publisher.** At publish time the engine derives the scope set every step needs from the step types (the table below), so nobody types scopes by hand. Publishing requires that the publisher hold every derived scope, by the same rule that stops a principal from granting an API key more than it holds (`missingPermissions`) [R18]; it also requires a publish permission (`workflows:publish`, ours) and, for a production environment, `environments:production` [R18]. The run then acts with exactly that set; the step executor checks each service call against it, so a bug in the derivation fails closed (ours).
- **PII and egress.** A step whose templates read PII fields and send them anywhere (HTTPS, Slack, email, SMS) needs the publisher's `pii:view` [R18] and is marked as sending PII off the platform in the version, which the console and the audit entry show (ours).
- **No amplification by triggers (ours).** Event, scheduled and recurring triggers run on the publisher's frozen grant. A run started by a principal (the public `POST /workflows/{id}/trigger` path [R4], a manual, account or case trigger from the console) acts with at most that principal's rights: the caller must hold `workflows:trigger` **and** every scope in the version's grant. Otherwise a key that may only trigger workflows could decline people through one (a confused deputy). The trigger's input is validated against the version's declared input schema, and object ids in it are resolved inside the environment only.
- **When the publisher loses rights.** Either the version keeps running on its frozen grant and the console flags it until someone with the rights republishes, or it stops (owner decision 9; default: keep running and flag).
- **Run Workflow and Schedule Workflow.** A child run acts on its own version's grant, subject to the same no-amplification rule when the parent was started by a principal; nesting depth at most 5, cycles refused by lineage, and an environment budget for runs per minute (ours).

### 5.2 Effects and idempotency

- **Effect key.** Every side effect gets the deterministic key `<wfr id>/<step key>/<loop index path>`, independent of the attempt number, recorded in `workflow_step_effects` (`environment_id`, unique `effect_key`, `kind`, `status`: `claimed`, `done` or `unknown`, sealed `result`) (ours). It is not the C12 `Idempotency-Key`, which is per HTTP principal and lasts 24 hours [R19].
- **Internal effects: exactly once.** The effect row is written in the same transaction as the change. `applyInquiryAction` already takes the caller's transaction [R16]; the tag, case, report, list and transaction services need `…InTx` forms where they open their own transaction today, as `performInquiryAction` and `changeInquiryTags` do [R16] (inference).
- **External effects.** HTTPS requests are at least once, carrying the key as `Idempotency-Key` so a receiver can drop duplicates (§2.11). Messages are at most once (§4).
- **Already in the target state.** Approving an approved inquiry, or adding a tag it already has, succeeds as `no_change` (the tag service already does nothing for a no-op change [R16]); any other refused transition is the step error `invalid_transition`, which continue-on-error can absorb (ours).

### 5.3 Per action

Scopes in the third column are what the version's grant must contain (existing names from [R18], Phase 6 names from [R20], Phase 7 names from [R21]; names marked "ours" are new).

| Action (public name) | Service it calls | Grant | Effect and notes |
|---|---|---|---|
| Approve Inquiry, Decline Inquiry, Mark Inquiry for Review | `applyInquiryAction(tx, deps, acting, lockedInquiry, 'approved' / 'declined' / 'needs_review')`, with the C10 transition, its events and audit entry under the row lock [R16] | `inquiries:write` | Exactly once in the effect transaction. `declined` and `approved` are terminal: no transition leaves them (`completed`, `failed` and `needs_review` lead to them) [R26]. A decline deletes the inquiry's face template and background rows (C42.2) [R16]. A decline is an Art. 22 decision when no person took part (§6) |
| Create Inquiry | `createInquiry(deps, acting, attributes)` [R16] | `inquiries:write`; `accounts:read` to attach an existing account (Phase 6 decision 39's rule [R20]) | The created id is the effect's result, so a retry returns it instead of creating another |
| Inquiry Link Email, Inquiry Link SMS | the one-time link or session of `resumeInquiry` [R16], then the Mailer or the SMS sender (§4) | `inquiries:write`, `inquiry-sessions:write` | At most once; only to the inquiry's own confirmed contact by default (§4) |
| Create Case, Assign Case, Update Case Status, Add Comment, Add to Queue, Attach Objects, Set or Clear Case SLA | Phase 8's case service [S3] | `cases:write` (ours) | Exactly once; Phase 7's graph bulk actions leave "create a case" to Phase 8 (C103) [R21] |
| Run Report | Phase 6's report creation (`POST /reports`, C72) with `origin: workflow` and a `workflow` run trigger (a C74 amendment) [R20] | `reports:write`; `inquiries:write` or `accounts:read` for the link (decision 39) [R20] | Exactly once for the creation; the engine then waits on `report/<type>.ready` or `.errored` with the step's timeout [S2]. An errored or partial report is a step error, never "no match" (ADR 0002 3a; Phase 6 decision 47) [R3] [R20]. Replaces `on-report-match: needs_review` once workflows exist (decision 28) [R20] |
| Tag Object, Remove Tag, Copy Tags | `changeInquiryTags` [R16], `changeAccountTags` [R22], report tags (C72) [R20], transaction tags (C105) [R21], case tags [S3] | the object type's write scope | Idempotent by nature; the 50-tag cap answers 422 [R16] |
| Update Object, Fetch Persona Object | `updateInquiry` [R16], `updateAccount` [R22] and the Phase 7 transaction update [R21]; reads through the same repositories | the object's write or read scope | Fetch is read-only; writes are exactly once |
| Redact Object | `RedactionService.redactInquiry`, `redactAccount`, `redactReport` [R17]; transaction redaction (C105) [R21] | `inquiries:redact`, `accounts:redact`, `reports:redact`, `transactions:redact` | Idempotent by design (`alreadyRedacted`) [R17] but irreversible: publishing needs an explicit acknowledgement and a cap on objects per run (owner decision 13). The public step also offers field-level and conditional redaction [D1], which the redaction service does not do: deferred (owner decision 15) |
| Get List Match | `matchLists(tx, environmentId, probes)` (C99.1) [R21] | `lists:read`, `pii:view` (the rule of `POST /lists/match`) [R21] | Read only. A list it could not read is `not_applicable` with its reason, never "no match" [R21] |
| Add Item To List | `ListService.createItem` / `ListItemWriter.insertItems` (C99.1), with the run as creator [R21] | `lists:write`, `pii:view` (the graph add-to-list rule, C103) [R21] | The list's match-key uniqueness makes a repeat a no-op (Phase 7 research; inference) |
| Add Item To Face List | the C99.7 path: one consenting inquiry at a time [R21] | `lists:write`, `pii:view` | Refused inside a loop over many objects, as bulk biometric adds are refused in C103 [R21] |
| Sync Graph | none: Phase 7 indexes the graph synchronously [R25] | none | A no-op kept for parity, so imported definitions still validate (ours) |
| Run Graph Query | `POST /graph-queries` (C102), with `account_id` bound to the run's account [R21] | `graph:read` | Read only; results kept 30 days (Phase 7 decision 19) [R21] |
| Create Transaction, Update Transaction Status, Set Relation | the C105 services (`POST /transactions`, status updates, relations) [R21] | `transactions:write` | Exactly once. Transactions created by a run are its children, which is where Phase 7's deferred redaction cascade starts (C110) [R21] |
| Trust Device | none yet: Phase 7's devices have no write route (C91.2) [R21]; the public step only "marks devices as trusted" [D1] | `devices:write` (ours) | What trust changes is **not documented**; ours: a `trusted-at` and `trusted-by` mark on `dev_`, read only by workflow conditions, never by a check, and cleared by device retention |
| Run Workflow, Schedule Workflow | the engine [S2] | `workflows:trigger` (ours) | Depth, cycle and budget limits (§5.1) |
| Make HTTPS Request | §2 | none on objects; `pii:view` when it sends PII | At least once with `Idempotency-Key` |
| Evaluate Code | §1 | none | Pure; the output is recorded |
| Send Email, Send SMS, Send Slack Message | §4 | `pii:view` when a template reads PII | At most once |
| Re-screen triggers (list update, account field change) | Phase 6 C74's `list_update` runs and Phase 7's deferred trigger (C110) [R20] [R21] | `reports:write` | Trigger design belongs to [S2] |

## 6. GDPR Article 22: automatic declines

Not legal advice; the operator is the controller and decides its own basis (the same position Phase 6 took for screening, decision 34 [R20]).

### 6.1 What the law says

- **The rule.** A person has the right not to be subject to a decision based **solely** on automated processing, profiling included, that produces legal effects on them or similarly significantly affects them (Art. 22(1)) [L1]. The Article 29 Working Party's guidelines read this as a prohibition in principle, not a right the person must invoke first [L2].
- **The exceptions.** Such a decision is allowed only when it is necessary for entering into or performing a contract with the person, when Union or Member State law authorises it with suitable safeguards, or with the person's explicit consent (Art. 22(2)) [L1]. Recital 71 names fraud and tax-evasion monitoring and prevention under such law, and the security and reliability of a service, among the purposes law may authorise, and gives the automatic refusal of an online credit application as an example of a covered decision [L1].
- **The safeguards.** Under the contract and consent exceptions, the controller must provide at least the right to obtain human intervention, to express one's point of view and to contest the decision (Art. 22(3)); Recital 71 adds specific information and an explanation of the decision reached after such an assessment [L1].
- **Special categories.** Such decisions may not rest on special-category data, which includes biometric data processed to identify a person (Art. 9(1)), unless the person gave explicit consent or a substantial public interest under law applies (Art. 9(2)(a) or (g)), with safeguards (Art. 22(4)) [L1]. An automatic decline driven by a face comparison or a face-list match falls here (inference).
- **Information duties.** The notices given when data is collected, or obtained from elsewhere, and the answer to an access request must state that such decision-making exists and give meaningful information about the logic involved and its significance and envisaged consequences (Arts. 13(2)(f), 14(2)(g), 15(1)(h)) [L1].
- **DPIA.** A data protection impact assessment is required for a systematic and extensive evaluation of personal aspects based on automated processing on which decisions with legal or similarly significant effects are based (Art. 35(3)(a)) [L1].
- **What counts as human involvement.** A person who routinely applies automatically generated results without real influence does not make the decision less automated. Oversight must be meaningful rather than a token gesture, by someone with the authority and competence to change the decision, who considers all the relevant data; the controller should record in its DPIA how much human involvement there is and at which stage [L2]. Human review on request should likewise be done by someone able to change the decision, who looks at all the relevant data, including what the person adds [L2]. The guidelines' good practice includes a link to an appeals process at the point the decision is delivered, with agreed timescales and a named contact point [L2].
- **Scores can be decisions.** The Court of Justice held on 7 December 2023 (C-634/21, SCHUFA) that a credit agency's automated score is itself an automated individual decision, prohibited in principle, in so far as the agency's clients (such as banks) give it a determining role in granting credit [L3]. A check result, a signal or a report match that an operator's system applies without review could be read the same way (inference).

### 6.2 Which OpenVerify paths are solely automated

- A workflow's **Decline Inquiry** step on a path with no human step before it: no user resolving a case, no manual trigger by a user, no review step (inference).
- An API client that calls `decline` from its own automation: the operator's system decides, and OpenVerify only records the call (inference).
- `declined` is terminal in the state machine [R26], so a human review after an automatic decline cannot reopen the inquiry today; the only remedies are a new inquiry or an action outside OpenVerify.
- Today's defaults avoid automatic declines: the decision engine routes a required check without evidence to `needs_review`, never to a pass (ADR 0002 3b) [R3]; Phase 6's `on-report-match` only routes to review (decision 28) [R20]; and Phase 7 never declines on a signal (decision 18) [R21]. The public product, by contrast, recommends auto-decline workflows, including on `inquiry.failed` and for SMS-fraud regions [H3] [H10].

### 6.3 What the operator must provide (for the operator's documentation)

1. A basis among the three exceptions for each automatic decline, and explicit consent or a law under Art. 9(2)(g) when the decline rests on biometric data.
2. Notice before collection, stating that automated decisions are made, the logic in meaningful terms, and the consequences.
3. A way to obtain human intervention, give a point of view and contest, delivered with the decision, plus a reviewer with authority to change the outcome.
4. A DPIA that records where people are involved.

OpenVerify can make each of these easier and record that it happened; it cannot decide any of them (inference).

### 6.4 What the product should record and offer (proposed)

- **A decision record.** For every approve and decline, whoever made it, an `inquiry_decisions` row (ours): the actor (`user`, `api-key` or `workflow-run`); for a run, the version id, the step key, the conditional path taken and the hash of its JSONLogic rule; `solely-automated` (true when no human step lies on the run's path to the decision, or for an API decision whose caller declared it so); and the evidence considered, as codes and ids only (check names and statuses, report and match ids, list item ids, signal names). It is served on the inquiry with `inquiries:read`, kept with the inquiry, and redacted with it.
- **A basis on decline steps (owner decision 10).** In production, a Decline Inquiry step on a path without a human step needs a declared `decision-basis` (`contract`, `law` or `explicit-consent`) and a contest route (a URL or contact shown to the person, or a case template that a review request opens). Publishing refuses the step without them (ours; the public product has no such gate [H3]).
- **Biometric declines.** A decline whose path reads a biometric result (selfie comparison, liveness, a face list) needs the inquiry's biometric consent to have been recorded, or a declared Art. 9(2)(g) basis (ours; OpenVerify already records biometric consent, PLAN §3 [R1]).
- **Review that can change the outcome.** Either a `declined → needs_review` "reopen for review" transition, audit-logged and allowed only to users holding `inquiries:write`, amending C10 (ours), or the documented position that an operator reverses a decline in its own system. Without one of these, the human intervention of Art. 22(3) cannot change OpenVerify's record [L1] [R26] (owner decision 10).
- **Prefer review to decline.** The editor's decision templates should default to Mark Inquiry for Review followed by a case, with a decline as the case resolution, which keeps a person in the decision (ours; this is also the shape the public best-practice article describes for cases [H3]).
- **Notice text.** The operator's docs get a notice paragraph for each automated path and a DPIA section listing the decision record's fields (ours).

## What Phase 8 should take from this (proposed)

**Evaluate Code**
1. Pin `quickjs-emscripten-core@0.32.0` and `@jitl/quickjs-wasmfile-release-sync@0.32.0` (MIT, 2026-02-16, both pass the release-age rule) in the catalog; not the umbrella `quickjs-emscripten` package, not an `asyncify` variant, not the `quickjs-ng` variant (quickjs-ng v0.12.1 has CVE-2026-3979 and CVE-2026-37630) [N2] [N3] [V1]. Add Emscripten's MIT/NCSA notice to `THIRD_PARTY_LICENSES.md` [N9].
2. Run evaluations in a pool of child processes with `env: {}`, `--permission` and only the runner's and the variant's directories readable, `--max-old-space-size=64`, IPC only, recycled after 100 evaluations or any failure; one fresh QuickJS runtime and context per evaluation; a host-created `WebAssembly.Memory` with a fixed `maximum`; and a parent-side `SIGKILL` at the time limit plus 250 ms (§1.6). In the compose `app` profile, the runner is its own container with no network, a read-only root, no capabilities and no secrets.
3. Expose no host functions, no module loader, no `console` in production runs and no secrets; pass one JSON string in and take one JSON string out; never decode guest bytes with `bjson` (§1.3, §1.4).
4. Limits: 1 s (5 s ceiling), 32 MiB QuickJS memory (64 MiB), 512 KiB stack, 64 KiB source, 256 KiB inputs, 64 KiB output checked against the declared return type, and the error codes of §1.8.
5. Tests (TDD): an infinite loop times out; catastrophic regular-expression backtracking or a long native call ends either through the interrupt or through the parent's kill, never by running past the limit; allocation beyond the limit gives `memory_limit`; deep recursion gives `stack_overflow` without corrupting the next evaluation; `globalThis` has no `require`, `process`, `fetch` or timers; a child's oversized or malformed IPC message is refused; a canary in the parent's environment is unreadable from the guest and absent from the child's `process.env`.
6. Track the wrapper: a monthly check of `justjake/quickjs-emscripten` releases and of NVD for `quickjs`, written into `docs/PROGRESS.md`; if a CVE reachable from ordinary JavaScript lands upstream before a wrapper release, build the variant ourselves from the wrapper's Makefile (owner decision 5).
7. Do not use `node:vm`, vm2 or isolated-vm for operator code (§1.7).

**HTTPS request**
8. Build the action as one more client of `createOutboundHttp()`, with its own policy object (never the webhook or EVM flags), adding PUT, PATCH and DELETE; the header policy of §2.9 (no `Host`, no hop-by-hop names, at most 32 headers and 8 KiB); 443 plus an operator port list that can never contain a Fetch bad port; refusal of a non-identity `content-encoding`; and a per-step timeout of 1–30 s (§2.12).
9. Require the scheme, host and port to be literal in the published definition; templates fill only percent-encoded path segments and query values (owner decision 2).
10. Keep redirects unfollowed; expose `status` and a 3xx `location`.
11. Sign every request with the webhook scheme (`OpenVerify-Signature`, `t=`, `v1=`) under a sealed per-step secret, with dual signing during rotation; send `Idempotency-Key` and `OpenVerify-Workflow-Run`; document that v1 does not sign the method or URL, and keep RFC 9421 as a possible v2 [R8] [X9].
12. Add an operator setting for NAT64 network-specific prefixes (§2.6) and a dated IANA registry fixture test with one sample address per row (§2.5).
13. Budgets: 600 requests per minute per environment and a per-host concurrency cap, failing closed.

**Secrets**
14. Add `workflow_secrets` and `workflow_secret_values` (sealed row-bound, last four, rotation with a previous value) with `secrets:read` and `secrets:write`; references as `{{secrets.<key>}}` only in HTTPS header values, the signing secret, the HTTPS body and the Slack URL; each secret bound to its allowed hosts (§3.2, §3.3).
15. Resolve at the last moment, scrub resolved values (plain, base64, base64url, percent-encoded) from everything stored, seal step inputs and outputs, keep bodies out of `workflow-run.*` events, and add the canary test of §3.4.

**Messaging**
16. Email through the existing `Mailer` with the install's From address; one recipient that is the object's own contact or on an environment allowlist; per-recipient and per-environment limits; escaped HTML templates; a sandbox mail sink (§4.1).
17. SMS through the existing `SmsSender`; OTP-confirmed numbers by default; a country allowlist; the C55.7 rules and the shared hourly budget; 480 characters; links only to the flow or allowlisted hosts; the sandbox sink amended for workflow messages (§4.2).
18. Slack through incoming webhooks only: the URL as a secret, host `hooks.slack.com` and the `/services/T…/B…/…` path, one message per second per webhook with `Retry-After`, `&`, `<` and `>` escaped in interpolated values, no PII in the default templates, and a sandbox provider that records (§4.3).

**Object actions and authority**
19. Add the audit actor `workflow-run`; derive each version's scope grant from its steps; require the publisher to hold the grant (plus `workflows:publish` and, in production, `environments:production`); check every service call against the grant; and require a principal that triggers a run to hold the grant too (§5.1).
20. Add `workflow_step_effects` with deterministic keys; exactly once for internal effects in the service's transaction (adding `…InTx` forms where needed), at least once with `Idempotency-Key` for HTTPS, at most once for messages (§5.2).
21. Wire each action to the service in §5.3; Run Report replaces `on-report-match` once workflows exist and never reads an errored report as "no match"; face-list adds stay one consenting inquiry at a time; Trust Device is ours and labelled so.

**Article 22**
22. Add the `inquiry_decisions` record (actor, version, step, path, rule hash, `solely-automated`, evidence codes); require a declared basis and a contest route for production decline steps without a human step; tie biometric-based declines to recorded biometric consent; default the editor's templates to review and case rather than decline; and decide how a human review can change a terminal decline (owner decision 10) (§6.4).
23. Document, in the operator guide, the four duties of §6.3 and the fields of the decision record for the operator's DPIA.

## Needs the owner

Each item states the default the build uses until the owner decides, so none blocks a Workflow.

1. **Where Evaluate Code runs.** Default: a child-process pool in every deployment (§1.6), and in the compose `app` profile a separate `code-runner` container with no network, a read-only root, no capabilities and no secrets.
2. **Static destinations for HTTPS steps** (narrower than the public step, which takes its URL from workflow data [H2]). Default: scheme, host and port literal in the definition; only path and query templated.
3. **A per-environment host allowlist for HTTPS steps** (OWASP's first case [X1]). Default: available, off; any public address allowed, subject to the guard and the port list.
4. **Secrets in Evaluate Code** (the public product allows secrets in compute steps [H4]). Default: never.
5. **QuickJS build and update policy.** Default: the published `@jitl/quickjs-wasmfile-release-sync@0.32.0` (bellard engine, commit of 2025-12-22); rebuild the variant ourselves only when a CVE reachable from ordinary JavaScript is fixed upstream and the wrapper has not released.
6. **Per-step SMTP and From address in Send Email** (public advanced options [D1]). Default: not offered; the install's SMTP transport and From only.
7. **Slack.** Default: incoming webhooks only, path shape `/services/T…/B…/…` only; the OAuth app form [H6], GovSlack hosts and the URL shape without `/services/` later.
8. **Message recipients.** Default: the run object's own confirmed email or phone, or an environment allowlist; unconfirmed fields only with an acknowledged step option; SMS countries limited to an allowlist.
9. **A publisher who loses the rights a published version needs.** Default: the version keeps its frozen grant and runs; the console flags it, and the audit log records the change, until someone with the rights republishes.
10. **Automatic declines (Art. 22).** Default: in production, a decline step on a path without a human step needs a declared basis and a contest route, and biometric-based declines need recorded biometric consent or a declared Art. 9(2)(g) basis; review after a decline uses a new audited `declined → needs_review` transition (a C10 amendment). Alternative: no transition, with the documented position that the operator reverses decisions in its own system.
11. **PII leaving the platform through templates** (Slack, HTTPS, email, SMS). Default: allowed only when the publisher holds `pii:view`; the step is marked and audited; the default templates carry ids and links only.
12. **Sandbox email.** Default: a sandbox mail sink per environment readable with `sandbox:read`; real delivery in sandbox only to allowlisted addresses.
13. **Redaction steps.** Default: publishing needs an explicit acknowledgement that the step is irreversible, and a run redacts at most 100 objects (ours).
14. **Evaluate Code availability.** The public step is plan-gated [H1]. Default: available in every environment, with an install switch (`OPENVERIFY_WORKFLOW_CODE_ENABLED`, default `true`) for operators who want none.
15. **Field-level and conditional redaction** (public [D1]). Default: deferred; whole-object redaction only.
16. **HTTPS ports.** Default: 443 only, plus an operator list that can never include a Fetch bad port.
17. **Budgets** (all provisional and ours): HTTPS 600 per minute per environment; email 1,000 per hour per environment and 5 per hour per recipient; SMS within the shared OTP budget; Slack 1 per second per webhook; Evaluate Code pool `max(1, CPUs − 1)` per worker. Default: as stated, changed by configuration.
18. **Signing GET and DELETE requests** (the public product documents POST [D2]). Default: sign every request, over an empty body when there is none.

## Sources and pins

Every source was read on **2026-10-27** (fetch times 22:03–22:19 UTC). Each host's robots file was read first: `help.withpersona.com`, `docs.slack.dev`, `slack.com`, `registry.npmjs.org`, `cheatsheetseries.owasp.org`, `www.iana.org`, `fetch.spec.whatwg.org`, `webassembly.org`, `learn.microsoft.com`, `cloud.google.com`, `ec.europa.eu`, `curia.europa.eu` and `publications.europa.eu` allow the pages used; `raw.githubusercontent.com`, `api.github.com`, `bellard.org` and `services.nvd.nist.gov` answer 404 for `robots.txt` (no restriction under RFC 9309); `nodejs.org` disallows `/docs/`, so its pages were **not** fetched and the tagged sources were read instead; `eur-lex.europa.eu` answered 202 with an empty body. Every download is listed with its status, size, SHA-256 and `Last-Modified` in `downloads/as-*/fetch-log.tsv`.

**Repository (R)**, read-only in the repository at the working tree of 2026-10-27 (HEAD `7fe687b7`, with Phase 6 work in progress uncommitted)
- [R1] `docs/PLAN.md` §2 (Cases and Workflows rows), §3 (technology table: workflow code step, editor; data protection; hardening: SSRF guard), §6 Phase 8
- [R2] `CLAUDE.md` rules 3–6
- [R3] `docs/adr/0002-check-tiers.md`
- [R4] `docs/research/persona-surface.md` (`workflow-run.{completed,created,errored,resumed}`; `workflow-runs`, `workflow-versions`, `workflows/{workflow-id}/trigger`; the case paths and events)
- [R5] `apps/api/src/http/index.ts`, `apps/api/src/http/stream.ts`
- [R6] `apps/api/src/webhooks/ssrf.ts`
- [R7] `apps/api/src/webhooks/http-sender.ts` (`createVettedLookup`, `systemResolver`)
- [R8] `packages/node/src/webhook-signature.ts`; `packages/contracts/src/webhooks.ts` (`WEBHOOK_SIGNATURE_HEADER`, 300 s tolerance); `apps/api/src/webhooks/dispatcher.ts`
- [R9] `apps/api/src/dns/index.ts`
- [R10] `apps/api/src/mail/index.ts`; `apps/api/src/ports.ts` (`MailMessage`, `Mailer`)
- [R11] `apps/api/src/ports.ts` (`SmsMessage`, `SmsSender`, `SandboxSmsContext`, `SandboxSmsSender`, `SmsSendError`, `ProviderIdentity`); `apps/api/src/providers/sms/{index,sandbox}.ts`; `apps/api/src/providers/index.ts` (C63 bindings)
- [R12] `apps/api/src/services/otp/limits.ts` (C55.5, C55.7)
- [R13] `packages/db/src/sealed.ts`, `packages/db/src/crypto.ts`
- [R14] `packages/db/src/tables/webhooks.ts`
- [R15] `apps/api/src/logger.ts`, `apps/api/src/jobs/logger.ts`, `packages/contracts/src/redaction.ts` (`API_LOG_REDACTED_KEYS`, `API_LOG_REDACTED_VALUE_MAPS`)
- [R16] `apps/api/src/services/inquiries.ts` (`createInquiry`, `updateInquiry`, `changeInquiryTags`, `resumeInquiry`, `transitionInquiryInTx`, `applyInquiryAction`, `performInquiryAction`, `redactInquiry`)
- [R17] `apps/api/src/ports.ts` (`RedactionService`, `AuditEntry`, `AuditLogger`, `ServiceContext`); `apps/api/src/services/audit-log.ts` (`appendSystemAuditEntry`); `packages/contracts/src/user-audit-logs.ts` (`auditActorSchema`: `user`, `api-key`)
- [R18] `packages/core/src/permissions.ts` (`API_SCOPES`, `OPERATOR_PERMISSIONS`, `BUILTIN_ROLES`, `missingPermissions`)
- [R19] `apps/api/src/plugins/idempotency.ts`
- [R20] `docs/plans/phase-6.plan.md` C72, C74, C85.1, C88; owner decisions 4, 28, 34, 39, 47, 48 and the provider-credential redaction test of C83
- [R21] `docs/plans/phase-7.plan.md` C91.2, C99.1, C99.7, C102, C103, C105, C110; owner decisions 18 and 19
- [R22] `apps/api/src/services/accounts.ts` (`changeAccountTags`, `updateAccount`)
- [R23] `undici` 7.30.1 (`apps/api/package.json`), read in `node_modules/.pnpm/undici@7.30.1/node_modules/undici/lib/core/connect.js` (`servername`, `tls.connect` with the agent's options) and `lib/core/request.js` (header processing)
- [R24] `package.json` (`engines.node >=22.18.0`), `infra/docker/apps.Dockerfile` (`node:22.22.1-bookworm-slim`)
- [R25] `docs/research/phase7-behaviour.md` (list-item `creator` relationship [O14 there]; Sync Graph and the synchronous index, GR8)
- [R26] `packages/core/src/inquiry-state-machine.ts` (allowed transitions; `approved`, `declined`, `expired` terminal)

**Sibling notes (S)** in `resume/phase8-research/`, read for scope only (all still in progress when this note was written): [S1] `phase8-behaviour.md`; [S2] `phase8-workflow-engine.md`; [S3] `phase8-editor-cases.md`.

**Measurement (M)**
- [M1] Node 22.22.1, `new URL()` and `net.isIP()` on synthetic URLs, run from the session scratchpad (no repository code, no download): numeric IPv4 forms become `127.0.0.1`, IPv4-mapped literals become `[::ffff:7f00:1]`, percent-encoded host bytes are decoded, a trailing dot is kept, any port is accepted.

**Persona developer docs (D)**, version 2026-09-29, read from the sibling behaviour agent's copies in `downloads/docs-pages/` (fetched 2026-10-27 from the URLs shown)
- [D1] https://docs.withpersona.com/2026-09-29/workflows.md (triggers, step types, the action list, Send Email's advanced SMTP options, Trust Device, Redact Object)
- [D2] https://docs.withpersona.com/2026-09-29/workflows-best-practices.md (`Persona-Signature` for Make HTTPS Request; reuse of the webhook secret; 30-day wait limit)

**Persona Help Center (H)**, `https://help.withpersona.com/articles/<id>.md`, in `downloads/as-persona/`
- [H0] https://help.withpersona.com/llms.txt (index)
- [H1] Evaluate Code step, `7eNHMEGyHPLu35oakfyo79`
- [H2] Make HTTPS Request step, `5QOFu1KYFl4l14DTWSnbV1`
- [H3] Workflow Best Practices, `63hzKuMfRsrD4AWYSQYmcF`
- [H4] Help Center article `nlTpuEIPeSmXpKY4Bgs9ac`, on the platform's workflow credentials (titled "Platform Secrets"; last updated 2026-09-30)
- [H5] Custom Functions, `a173Vc2K1RfXmRwQEQMZZ9` (last updated 2026-08-31)
- [H6] Send Slack Message (OAuth) step, `cWDpbEP9l8WGpM83OWMyy`
- [H7] Workflows Slack Integration (incoming-webhook form), `7KM3MiMZhGSuqYGqsICjSA`
- [H8] Send SMS step, `19Lpb01dayUoovielLfTZd`
- [H9] Send Email step, `27FwSlEyBXBFqP5CJwSzAH`
- [H10] Deterring SMS fraud, `2UKFOwtn5lbP1re9nR0drr`

**Packages (N)**: registry metadata `https://registry.npmjs.org/<name>`; files at the release commit on `raw.githubusercontent.com`
- [N1] `quickjs-emscripten` **0.32.0** (2026-02-16T04:48:55Z; previous 0.31.0, 2024-09-07), MIT, `gitHead` `df4efb9ef2cb25c417ecb57986da462d11b244ed`; `LICENSE` (SHA-256 `3c6040aa…79db`), `README.md` (variants; runtime limits; "no host functionality … by default"; asyncify limits; "has not been audited"), `CHANGELOG.md` (v0.32.0: bellard `2025-09-13+f1139494`, quickjs-ng v0.12.1, Emscripten 5.0.1, the `HostRef` rework; v0.27.0: `wasmMemory`) at that commit
- [N2] `quickjs-emscripten-core` **0.32.0** (2026-02-16T04:48:40Z), MIT
- [N3] `@jitl/quickjs-wasmfile-release-sync` **0.32.0** (2026-02-16T04:48:50Z), MIT; tarball `https://registry.npmjs.org/@jitl/quickjs-wasmfile-release-sync/-/quickjs-wasmfile-release-sync-0.32.0.tgz` (254,219 B, SHA-256 `8459053841d6b053207b70287b5a6d762fd5608a3908b40956c5aa3178dcf9c8`), listed and its `package/LICENSE` read in memory (quickjs-emscripten and QuickJS MIT notices); `dist/emscripten-module.wasm` 503,134 B
- [N4] `@jitl/quickjs-ng-wasmfile-release-sync` **0.32.0** (2026-02-16T04:48:40Z), MIT
- [N5] `@jitl/quickjs-ffi-types` **0.32.0** (2026-02-16T04:48:32Z), MIT
- [N6] `isolated-vm` 7.0.1 (2026-08-05, `engines.node >=24`) / **6.2.0** (2026-08-06, `engines.node >=22`, dist-tag `backport-v6`), ISC, dependency `node-gyp-build`; `README.md` and `LICENSE` at `699d47a2c9021fbd4953b461bcbca4d7e0e11043` (maintenance mode; SECURITY section; `memoryLimit` a guideline, default 128, minimum 8)
- [N7] `vm2` **3.12.2** (2026-09-08), MIT; `README.md` (security disclaimer, hardening recommendations) and `LICENSE.md` at `a0139cf6a7ad72a685420f53479a99fe385cf394`
- [N8] At `df4efb9…`: `packages/variant-quickjs-wasmfile-release-sync/Makefile` (Emscripten flags), `c/interface.c` (limits, interrupt, host callbacks, `QTS_bjson_*`), `vendor/quickjs/VERSION` (`2025-09-13`), `vendor/quickjs-ng/VERSION` (`v0.12.1`), `vendor/quickjs/fuzz/README`; the tree from `https://api.github.com/repos/justjake/quickjs-emscripten/git/trees/df4efb9ef2cb25c417ecb57986da462d11b244ed?recursive=1`
- [N9] Emscripten `LICENSE` at tag `5.0.1`: https://raw.githubusercontent.com/emscripten-core/emscripten/5.0.1/LICENSE (MIT or University of Illinois/NCSA)

**QuickJS upstream (Q)**
- [Q1] https://bellard.org/quickjs/ (news: releases 2026-06-04, 2025-09-13, 2025-04-26) and https://bellard.org/quickjs/Changelog
- [Q2] https://api.github.com/repos/bellard/quickjs/commits/f1139494d18a2053630c5ed3384a42bb70db3c53 (committed 2025-12-22T14:12:46Z) and `…/commits?per_page=8` (newest 2026-10-26); `LICENSE` at that commit, MIT (SHA-256 `598fd7fc…c18d`)
- [Q3] https://api.github.com/repos/quickjs-ng/quickjs/releases?per_page=4 (v0.17.0 on 2026-09-18, v0.16.2, v0.16.1, v0.16.0); `LICENSE` at `v0.12.1`, MIT (SHA-256 `98de27cc…6b7e`)
- [Q4] OSS-Fuzz: https://raw.githubusercontent.com/google/oss-fuzz/master/projects/quickjs/project.yaml and `build.sh`; history `https://api.github.com/repos/google/oss-fuzz/commits?path=projects/quickjs` (newest 2026-06-08)
- [Q5] https://api.github.com/repos/justjake/quickjs-emscripten/commits?per_page=8 (unreleased commits after 0.32.0 up to 2026-07-23)

**Vulnerability records (V)**
- [V1] NVD CVE API 2.0: https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=quickjs&resultsPerPage=200 (29 results)
- [V2] GitHub Advisory Database: https://api.github.com/advisories?ecosystem=npm&affects=vm2&per_page=100 (the 100 most recent; 70 not withdrawn)
- [V3] https://api.github.com/advisories?ecosystem=npm&affects=isolated-vm&per_page=50 (CVE-2021-21413, CVE-2022-39266)
- [V4] https://api.github.com/advisories?ecosystem=npm&affects=quickjs-emscripten&per_page=50 (none)

**Node.js (J)**, tagged sources of the pinned runtime (nodejs.org's robots file disallows `/docs/`)
- [J1] https://raw.githubusercontent.com/nodejs/node/v22.22.1/doc/api/vm.md (not a security mechanism)
- [J2] https://raw.githubusercontent.com/nodejs/node/v22.22.1/doc/api/worker_threads.md (`resourceLimits`, which exclude external data such as `ArrayBuffer`s; `env` defaults to `process.env`)
- [J3] https://raw.githubusercontent.com/nodejs/node/v22.22.1/doc/api/permissions.md (the permission model, stable since 22.13.0; a seat belt, no guarantee against malicious code; no network permission in 22.x)

**WebAssembly (W)**
- [W1] https://webassembly.org/docs/security/ (Last-Modified 2026-10-21)
- [W2] https://api.github.com/repos/bytecodealliance/wasmtime and `…/javy` (GitHub licence detection Apache-2.0), `…/wasmtime/releases?per_page=2` (v50.0.0, 2026-10-20)

**SSRF, addresses and HTTP (X)**
- [X1] https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html (Last-Modified 2026-10-26)
- [X2] https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv (Last-Modified 2026-10-13)
- [X3] https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv (Last-Modified 2026-10-13)
- [X4] https://fetch.spec.whatwg.org/ (Living Standard, last updated 19 October 2026): "bad port" list; `Authorization` removed on a cross-origin redirect
- [X5] https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html
- [X6] https://cloud.google.com/compute/docs/metadata/querying-metadata
- [X7] https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service
- [X8] https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16
- [X9] https://www.rfc-editor.org/info/rfc9421 (RFC 9421, HTTP Message Signatures, Proposed Standard, 2024)
- [X10] https://api.github.com/repos/stripe/smokescreen (licence MIT per GitHub; not archived)

**Slack (K)**
- [K1] https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
- [K2] https://docs.slack.dev/apis/web-api/rate-limits
- [K3] https://docs.slack.dev/messaging/formatting-message-text (escaping `&`, `<`, `>`)
- [K4] https://slack.com/terms-of-service/api (Slack API Terms of Service, effective October 10, 2025)

**Law and guidance (L)**
- [L1] Regulation (EU) 2016/679 (GDPR), OJ L 119, 4.5.2016, the official text from the EU Publications Office: http://publications.europa.eu/resource/celex/32016R0679.ENG (served as XHTML, SHA-256 `962539af…`); Arts. 9, 13(2)(f), 14(2)(g), 15(1)(h), 22, 35(3)(a); Recital 71. The EUR-Lex page for CELEX 32016R0679 answered 202 with an empty body
- [L2] Article 29 Working Party, Guidelines on Automated individual decision-making and Profiling for the purposes of Regulation 2016/679 (WP251rev.01, adopted 3 October 2017, revised 6 February 2018): page https://ec.europa.eu/newsroom/article29/items/612053/en and document https://ec.europa.eu/newsroom/article29/redirection/document/49826 (PDF, 37 pages)
- [L3] Court of Justice of the EU, Press Release No 186/23, 7 December 2023, Case C-634/21 SCHUFA Holding (Scoring): https://curia.europa.eu/jcms/upload/docs/application/pdf/2023-12/cp230186en.pdf (the judgment itself was not read)

## Fact-check (2026-10-27)

**Method.** An independent pass, run 2026-10-27 between 22:40 and 23:15 UTC, that fetched every source again. Each host's
`robots.txt` first (RFC 9309; `publications.europa.eu` redirects its robots file to `op.europa.eu/robots.txt`, which was
followed as the RFC allows and permits `/resource/`), at most one request per 1.2 s per host, no automatic redirects (the
CELLAR 303 and the Curia 302 were each fetched as their own request after a robots check), User-Agent
`OpenVerify-factcheck/1.0 (research; no contact)`, GitHub API unauthenticated, no personal data sent. Downloads are in new
directories `downloads/fc-npm/`, `fc-tgz/`, `fc-raw2/`, `fc-web/`, `fc-web2/`, `fc-legal/` and `fc-gh-api/`, stored as
served; tarballs were listed and read in memory with `tarfile`, never extracted; PDFs were read as text by
`scripts/fc_pdf.py`; every reader ran under `python3 -I`; nothing downloaded was executed. Repository facts were read at
`3a3ef409` (and `node_modules/.pnpm/undici@7.30.1`). Result: **32 confirmed, 0 corrected, 0 could not verify.**

| # | Fact | Result | Primary source re-read |
|---|---|---|---|
| 1 | quickjs-emscripten 0.32.0 | **Confirmed** (2026-02-16T04:48:55.938Z, MIT, `gitHead` `df4efb9…`; 0.31.0 on 2024-09-07; `LICENSE` at `df4efb9` SHA-256 `3c6040aa…`) | `https://registry.npmjs.org/quickjs-emscripten`; raw `LICENSE` |
| 2 | `@jitl/quickjs-wasmfile-release-sync` 0.32.0 tarball | **Confirmed.** Published 04:48:50.962Z, MIT; the tarball is 254,219 bytes with SHA-256 `8459053841d6b053207b70287b5a6d762fd5608a3908b40956c5aa3178dcf9c8`; `package/LICENSE` carries the wrapper's and QuickJS's MIT notices; `dist/emscripten-module.wasm` is 503,134 bytes and the loader reads it with `fs.readFileSync` | registry document and tarball |
| 3 | core and ffi-types 0.32.0 | **Confirmed** (04:48:40Z and 04:48:32Z on 2026-02-16, MIT, same `gitHead`) | registry `quickjs-emscripten-core`, `@jitl/quickjs-ffi-types` |
| 4 | Vendored engines and Emscripten | **Confirmed.** v0.32.0's changelog names bellard `2025-09-13+f1139494`, quickjs-ng v0.12.1 and Emscripten 5.0.1; commit `f1139494` is dated 2025-12-22T14:12:46Z | raw `CHANGELOG.md` at `df4efb9`; `https://api.github.com/repos/bellard/quickjs/commits/f1139494…` |
| 5 | Release-sync build flags | **Confirmed.** `IMPORTED_MEMORY=1`, `ALLOW_MEMORY_GROWTH=1`, `STACK_SIZE=5MB`, `AUTO_JS_LIBRARIES=0`, `ALLOW_UNIMPLEMENTED_SYSCALLS=0`, `FILESYSTEM=0`, `-DCONFIG_STACK_CHECK`; no `MAXIMUM_MEMORY` in the file | raw `packages/variant-quickjs-wasmfile-release-sync/Makefile` at `df4efb9` |
| 6 | README controls and audit status | **Confirmed** | raw `README.md` at `df4efb9` |
| 7 | QuickJS and quickjs-ng licences | **Confirmed.** Both are MIT grants; SHA-256 `598fd7fc928e…` (bellard at `f1139494`) and `98de27cc1e8c…` (quickjs-ng at `v0.12.1`) match | raw `LICENSE` at both refs |
| 8 | Emscripten dual licence | **Confirmed** (MIT or University of Illinois/NCSA) | raw `LICENSE` at `5.0.1` |
| 9 | NVD record for `quickjs` | **Confirmed.** 29 results. CVE-2025-62490 to 62496 were published 2025-10-16 with CPE ranges ending before 2025-09-13, CWE-416 twice, CWE-125 twice, CWE-704, CWE-191 (its text says integer overflow) and CWE-190, CVSS up to 8.8. CVE-2026-3979 (quickjs-ng up to 0.12.1, use-after-free) and CVE-2026-37630 (quickjs-ng 0.12.1, arbitrary code execution) as stated. Four of the 29 are SurrealDB (1) and NGINX njs (3) | `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=quickjs&resultsPerPage=200` |
| 10 | OSS-Fuzz project | **Confirmed** (libFuzzer, AFL, honggfuzz; address and memory sanitizers; main repository `bellard/quickjs`) | raw `projects/quickjs/project.yaml` at `master` |
| 11 | WebAssembly isolation and its limits | **Confirmed** (no escape except through the APIs provided; data in linear memory can overwrite neighbours; timing side channels remain) | `https://webassembly.org/docs/security/` |
| 12 | Node 22.22.1 `vm`, workers, permission model | **Confirmed.** `vm` is "not a security mechanism"; worker `resourceLimits` cover only the JS engine, not external data such as `ArrayBuffer`s; `env` defaults to `process.env`; the permission model has been stable since v22.13.0, restricts the file system, child processes, worker threads, native addons, WASI and the inspector, lists no network permission, gives no guarantee against malicious code, is not inherited by workers, is bypassed by open file descriptors and follows symbolic links | raw `doc/api/{vm,worker_threads,permissions}.md` at `v22.22.1` |
| 13 | vm2 3.12.2 advisories | **Confirmed** (3.12.2 on 2026-09-08, MIT; of the 100 most recent advisories 70 are not withdrawn, 44 of those are critical and 41 of the critical ones were published in 2026) | registry `vm2`; `https://api.github.com/advisories?ecosystem=npm&affects=vm2&per_page=100` |
| 14 | isolated-vm 7.0.1 / 6.2.0 | **Confirmed.** 7.0.1 (2026-08-05, Node ≥ 24, `gitHead` `699d47a2`) and 6.2.0 (2026-08-06, Node ≥ 22, dist-tag `backport-v6`), ISC, depends on `node-gyp-build`; the README at `699d47a2` states maintenance mode and that `memoryLimit` is a guideline an attacker can exceed two to three times (default 128 MB, minimum 8 MB); advisories CVE-2021-21413 and CVE-2022-39266 | registry `isolated-vm`; raw `README.md`, `LICENSE`; advisories API |
| 15 | OWASP SSRF cheat sheet | **Confirmed.** `Last-Modified: Mon, 26 Oct 2026 21:52:05 GMT`. The bind-to-the-validated-address advice (keeping the original name for the `Host` header, SNI and certificate checks, and applying the policy to retries and fallback connections) sits under domain-name validation and the any-destination case points back to it; redirects disabled; firewall controls; IMDSv2 | `https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html` |
| 16 | IANA registries against `ssrf.ts` | **Confirmed.** Both CSVs carry `Last-Modified` 13 Oct 2026. Every row marked not globally reachable maps to a refused category in `apps/api/src/webhooks/ssrf.ts`; `100:0:0:1::/64` and `5f00::/16` lie outside `2000::/3` and fall to the final `reserved` | `https://www.iana.org/assignments/iana-ipv{4,6}-special-registry/…-1.csv`; `apps/api/src/webhooks/ssrf.ts` |
| 17 | Existing outbound client | **Confirmed** (`method: 'GET' \| 'POST'`; `https:` unless `allowPlainHttp`; no redirects; 1 MiB and 10 s defaults; content-type allowlist; vetted lookup; the URL parser checks scheme, credentials and host but not the port) | `apps/api/src/http/index.ts` |
| 18 | undici 7.30.1 SNI, lookup and `host` header | **Confirmed** (SNI from the URL host; `tls.connect` receives the agent's options and the host name; a caller `host` header becomes the request host; `transfer-encoding`, `keep-alive`, `upgrade` and `expect` refused); `apps/api` pins undici 7.30.1 | `node_modules/.pnpm/undici@7.30.1/node_modules/undici/lib/core/{connect,request}.js` |
| 19 | Cloud metadata addresses | **Confirmed** (AWS `[fd00:ec2::254]` on Nitro instances in IPv6 subnets; GCP `metadata.google.internal`, `169.254.169.254`, `fd20:ce::254` on IPv6-only instances; Azure IMDS `169.254.169.254`; `168.63.129.16` a Microsoft-owned public virtual address used on ports 80 and 32526 and for DNS) | the four vendor pages cited as [X5]–[X8] |
| 20 | Fetch Standard bad ports and redirect rule | **Confirmed.** "Last Updated 19 October 2026"; the bad-port table equals the note's list; on a cross-origin redirect the spec deletes the CORS non-wildcard request-header names, which is `Authorization` alone | `https://fetch.spec.whatwg.org/` |
| 21 | OpenVerify webhook signature | **Confirmed** (`MAX_SIGNATURES` 8, `DEFAULT_TOLERANCE_SECONDS` 300, HMAC-SHA256 over the timestamp, a dot and the raw body) | `packages/node/src/webhook-signature.ts`; `packages/contracts/src/webhooks.ts` |
| 22 | Persona's Make HTTPS Request | **Confirmed** (see the behaviour note's fact-check, row 15) | Help Center `5QOFu1KYFl4l14DTWSnbV1`; `workflows-best-practices.md` |
| 23 | Persona Platform Secrets | **Confirmed** | Help Center `nlTpuEIPeSmXpKY4Bgs9ac` |
| 24 | Persona Evaluate Code | **Confirmed** | Help Center `7eNHMEGyHPLu35oakfyo79` |
| 25 | Slack incoming webhooks | **Confirmed** (the URL contains a secret that Slack revokes when leaked and is specific to one user and one channel; channel, username and icon cannot be overridden; error codes listed; incoming webhooks 1 per second with 429 and `Retry-After`; `&`, `<` and `>` sent as entities) | `https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks`, `/apis/web-api/rate-limits`, `/messaging/formatting-message-text` |
| 26 | Slack API Terms | **Confirmed** (effective October 10, 2025; commercial distribution of a Slack-integrated application needs a separate agreement with Slack or Salesforce; explicit authorisation and minimum-necessary use of API Data from outside organisations) | `https://slack.com/terms-of-service/api` |
| 27 | GDPR provisions | **Confirmed** against the Official Journal text: Art. 22(1)–(4), Recital 71 (the online-credit example; fraud and tax-evasion monitoring and service security under law; specific information, human intervention, point of view, explanation, challenge), Arts. 13(2)(f), 14(2)(g), 15(1)(h), 35(3)(a) | `https://publications.europa.eu/resource/celex/32016R0679.ENG` → CELLAR `3e485e15-11bd-11e6-ba9a-01aa75ed71a1.0006.03/DOC_1` |
| 28 | WP251rev.01 on human involvement | **Confirmed** (adopted 3 October 2017, last revised 6 February 2018; oversight must be meaningful, not a token gesture, by someone with the authority and competence to change the decision; the DPIA records the degree of human involvement; good practice includes a link to an appeals process where the decision is delivered) | `https://ec.europa.eu/newsroom/article29/redirection/document/49826` (PDF) |
| 29 | CJEU C-634/21 SCHUFA | **Confirmed** (Press Release No 186/23 of 7 December 2023: the score is an automated individual decision, prohibited in principle, in so far as the agency's clients such as banks attribute to it a determining role in granting credit; part of the sentence uses a shifted font encoding and was decoded) | `https://curia.europa.eu/site/upload/docs/application/pdf/2023-12/cp230186en.pdf` |
| 30 | Inquiry state machine | **Confirmed** (`expired`, `approved` and `declined` have no outgoing transitions; `completed` and `failed` lead to `approved`, `declined` or `needs_review`; `needs_review` to `approved` or `declined`) | `packages/core/src/inquiry-state-machine.ts` |
| 31 | Audit actors and `missingPermissions` | **Confirmed** (`AUDIT_ACTOR_TYPES` is `user` and `api-key`; `appendSystemAuditEntry` writes a `system` actor; `missingPermissions` returns what the holder lacks, documented as the rule that a principal grants only what it holds) | `packages/contracts/src/user-audit-logs.ts`; `apps/api/src/services/audit-log.ts`; `packages/core/src/permissions.ts` |
| 32 | SMS sandbox shape and OTP limits | **Confirmed** (`SandboxSmsContext` holds environment, `destinationIndex` and `code`; the limits fail closed and include the first-eight-digit prefix, country and environment hourly budgets) | `apps/api/src/ports.ts`; `apps/api/src/services/otp/limits.ts` |
