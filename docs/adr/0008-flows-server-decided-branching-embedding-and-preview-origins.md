# ADR 0008: Flows: server-decided branching, embedding and preview origins

- **Status:** Accepted (Workflow 9A Stage 1a, 2026-11-04). It extends ADR 0002 to flows, as ADR 0005 did to reports, ADR 0006 to signals and ADR 0007 to workflows.
- **Date:** 2026-11-04
- **Related:** ADR 0002 (check tiers and honesty), ADR 0003 (web routing), ADR 0004 (Kotlin Multiplatform), ADR 0006 (signals), ADR 0007 (workflows); `docs/plans/phase-9.plan.md` C147-C162, C171.4, C175, decisions 2-10, 14-20, 68 and 73, its "Workflow 9A Stage 1a amendments" and the "Owner decision after Workflow 9A's stop"; `docs/plans/phase-9-review-resolution.md`; `docs/research/phase9-behaviour.md`, `phase9-engineering.md`, `phase9-inventory.md`.

## Context

Until Phase 9 a flow was a list of fixed screens. Its conditions read only `{ inquiry: { status } }` and ran on the clients, and the server required every verification step of the flow, whatever the path. Phase 9 makes the flow a graph: screens of components, branches with ordered routes, action steps that start workflows, and an `exhausted` port that leads to a fallback. A route can read the person's verifications, their device, Phase 7's signals, a workflow's outputs and what they typed. That changes five things:

1. **Whoever evaluates a route chooses the friction a person meets.** A client that evaluates its own routes can take the path with fewer checks, so a modified client, or a person editing a request, could skip a verification.
2. **A route over a missing fact must go somewhere.** A signal that has not been computed, a check whose provider is down or a workflow that timed out has no value. Reading it as `false` turns "unknown" into "not risky".
3. **A flow is operator-written text that a server walks.** Conditions, visibility rules, patterns and copy are all written by the operator, and the person meets them in a page that holds their identity data.
4. **The flow can now be framed.** An embedded flow runs inside another site's page, and the console's preview inside the console, so who may frame which document, and who may talk to it, become security boundaries.
5. **A route can fail a person on something other than a verification.** A branch on a signal, an age or a list match that leads to a failure screen is an automated decision about the person, with the same law behind it as ADR 0007's adverse steps.

## Decision

### 1. The server decides every step

- The server holds each inquiry's position, records every step the person enters and exits, and decides the next step after every exit (a consent, a screen submission, a verification decided, an action finished, a wait ended, a handoff resolved). The required verifications are those on the path taken, from that record.
- A client renders the step it is given and never chooses a path. Every flow route that takes input (consent, verification, upload, screen submission, handoff) accepts it only for the current step; any other answers `flow_step_not_current`.
- The only facts a client influences are those it reports itself or the person enters. Each scope path carries its source (`verification`, `server`, `person`, `client`, `operator`), the builder labels self-asserted and client-reported facts, and a route that lowers friction on one needs an `asserted-fact:` acknowledgement in production.
- **Negotiation changes only what is sent, never the path.** A client lists the flow-spec versions it renders in `OpenVerify-Flow-Spec`. A client that knows only spec 1 receives a v1 projection: the steps it already passed, the current step and the unconditional run after it, with no condition, step name or v2 internal. Where the path next meets a step it cannot render (a screen, a branch, an action, a wait, custom consent copy, or a verification step with an `exhausted` edge), the projection holds a `server-continuation` placeholder, which today's Android SDK decodes as unsupported and stops at. A host test of the SDK's own navigation proves that it never reports "Completed" before the server's position is a completion step, and never finalises on an exhausted step (owner decision after Workflow 9A's stop).

### 2. An unknown never takes a branch silently

- Conditions are Phase 8's JSONLogic dialect, typed at publish against the flow's scope and evaluated **on the server only**, by `@openverify/workflow-engine`'s evaluator. Neither client bundle carries it. The web flow evaluates only same-screen visibility rules, with `packages/flow-spec`'s strict evaluator, which the server runs again over what was submitted.
- An unknown path is refused at publish. A nullable fact read by a route needs an `onNull` the author chose (`route:<key>`, `skip-route`, `else` or `review`), with no default and no `error`, because a person must never reach a dead end.
- An errored or unconfigured check reads `null`, never "not failed". A path a stored version names but the scope no longer has never follows `else`: it ends the person's part and sends the inquiry to review.
- A failed verification stays failed on every exit. A fallback through `exhausted` sends the inquiry to review unless the author acknowledged `fallback:<step>`, and a timed-out or errored workflow is never read as an output.

### 3. A flow never executes operator text or reaches the network

- A flow document is data walked by the server engine. No member reaches `eval`, `Function`, `new RegExp`, a template compiler or a module loader.
- Field patterns run only on our own linear-time matcher over a restricted grammar, with a 10,000-character input cap, on the server and in the clients' inline feedback, so a pattern cannot backtrack and both sides agree.
- Operator copy is plain text on declared keys with `{name}` placeholders, rendered as text; bidi overrides and format characters are refused.
- Code and HTTPS calls stay in Phase 8 workflows, behind ADR 0007's sandbox and guard. A flow reaches them only through `run_workflow`, whose target's grant is checked when the template is published and again on entry.

### 4. Who frames whom is a response header, per request, failing closed

- The flow is served by a flow server that computes the headers per request:
  - **hosted:** `frame-ancestors 'none'` and `X-Frame-Options: DENY`;
  - **preview:** `frame-ancestors` the console's origin only, and `connect-src 'none'`, so a preview can leak nothing it was given;
  - **embed:** `frame-ancestors` the inquiry's allowed origins (the environment's list, narrowed per template version). An unknown inquiry, an inactive template, an empty list, a malformed id or a failed lookup all answer `'none'`.
- Origins follow one grammar and are matched by one function, `matchesOriginPattern` in `@openverify/contracts/origin-pattern`, which the settings validator, the flow server and the embed bridge all import. `https://evilhost.com` never matches `https://*.host.com`. `localhost` is allowed in sandbox only.
- `frame-ancestors` in a `<meta>` element is ignored by browsers, so the header is the only control; a static host cannot embed the flow.
- **Messages name their origin.** Every `postMessage` names its exact target origin, and every receiver checks `event.origin` and `event.source`, parses the message with a schema, caps its size and ignores anything else. No message carries personal data, a token, a step id or a field value. The preview has no session and makes no network call; the console posts it the document and any theme assets it needs.
- Redirects carry only `inquiry-id` (and `status` when the version opts in, labelled a hint), are checked against an allowlist whenever the session answers, and happen through a "Continue" button, never on a timer.

**What the allowlist does not cover,** stated in `docs/flows/`: a compromised allowed site, a top-level copy of the hosted page on another domain, and a browser that ignores CSP.

### 5. A heuristic keeps its tier, and a failure on anything but a verification is acknowledged

- A route that reads a heuristic (an H-tier signal or check, a non-required check, an extraction) inherits its error rate, is shown `beta` in the builder and needs `heuristic:<step>` whichever way it routes.
- A verification outcome is a verification's own decided status and attempts, nothing else. A failure step reachable through a route on any other fact, or through the catch-all or an `onNull` of a branch that reads one, needs `adverse-path:<step>`, and in production a decision basis and a contest route, with Phase 8's biometric cases and consent check.
- When an inquiry fails on such a path, a decision record of kind `flow-failure` records the routes taken and the facts as codes with their tiers, marked solely automated, and the failure screen shows the contest route. The builder offers `flag_for_review` first.
- Branches read Phase 7's signals only through provisional snapshots of the signals whose inputs exist before completion (`flowProvisional` in the registry). The inquiry's own signals are still computed once, at completion.

## Consequences

- Clients get simpler: the web flow no longer evaluates transitions, and Phase 10's Android SDK renders the server's step. Until then today's SDK runs linear flows and stops on its unsupported screen where a version needs a newer client, so a version with screens, actions, waits, custom consent copy or fallbacks does not run on it; publish warns.
- Every exit costs a transaction under the inquiry row lock, and the step record grows with the path. Both are bounded (20 entries per step, 200 moves per inquiry).
- The step record is pseudonymous, not PII-free: a route on a typed value or a chosen button can reveal what was entered, so such rows are marked and served only with PII visibility.
- Embedding needs the flow server; a static host can serve the hosted flow but not the embedded one.

## Alternatives not taken

- **Client-side evaluation with server re-checking.** Two evaluators can disagree, and the server would still have to decide the path to know what to require.
- **Taking the `exhausted` port only for clients that declare spec 2.** It would make the path depend on what the client declares, which rule 1 forbids (option (ii) after Workflow 9A's stop).
- **`X-Frame-Options` or `<meta>` CSP for embedding.** The first cannot list several origins, and the second is ignored for `frame-ancestors`.
- **A regular-expression library for patterns.** Each backtracking engine accepts a pattern that takes exponential time; a linear matcher over our own grammar does not.
