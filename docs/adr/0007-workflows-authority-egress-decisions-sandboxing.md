# ADR 0007: Workflows: authority, egress, automated decisions and sandboxing

- **Status:** Accepted (Workflow 8A Stage 1a, 2026-11-02). It extends ADR 0002 to workflows, as ADR 0005 did to reports and ADR 0006 to signals.
- **Date:** 2026-11-02
- **Related:** ADR 0002 (check tiers and honesty), ADR 0005 (report honesty), ADR 0006 (signals); `docs/plans/phase-8.plan.md` C112-C128, C143, decisions 1, 5, 7, 28-36, 41-51, 76-80; `docs/plans/phase-8-review-resolution.md`; `docs/research/phase8-workflow-engine.md`, `phase8-actions-sandbox.md`.

## Context

A workflow is a graph an operator writes, which then acts with no person watching. It can decline a person, add them to a block list, redact their data, send their data to a third party and run code the operator pasted in. Four things make that different from every earlier phase:

1. **A workflow acts long after its author.** Authority checked at a request is authority checked once. A run started by an event or a schedule has no caller, and its publisher may have left.
2. **Operators write text that a server evaluates.** Conditions, templates and Evaluate Code are all programs of a kind, and the libraries that run such text keep producing escapes: Handlebars and liquidjs had advisories in 2026, and `vm2` alone had 41 critical ones.
3. **A workflow reaches the network.** An HTTPS step in a server that holds identity data is the classic server-side request forgery position, and a signing key shared with webhooks would let any author forge our own webhooks.
4. **A decline without a person is a solely automated decision.** GDPR Article 22 applies, and Article 9 when a face was involved. A workflow must not be a way around a safeguard an inquiry would otherwise have.

The honesty rules of ADR 0002 apply here in a new form. An execution failure must not become a value that a later step reads as an answer.

## Decision

### 1. A workflow acts on a frozen grant, never wider than a person gave it

- **A principal of its own.** A run acts as `{ type: 'workflow-run', id: 'wfr_…' }`, recorded as such in the audit log, in report actions, in status history and as a list item's creator. A run never reads as a user, an API key or the system (owner decision 12 after Workflow 6B).
- **The grant is derived, then frozen.** At publish the engine derives each version's grant from its steps as `{ scopes, pii }`, API scopes only. Publishing is a user's act: the publisher must hold every scope, `workflows:publish`, `pii:view` when `pii` is true, and `environments:production` in production. API keys cannot publish.
- **No amplification.** A run started by a principal acts with no more than that principal holds. A child run's grant must be a subset of its parent's effective grant. When an event caused by a principal reaches an adverse step, that principal must hold the step's scope. An event with no principal (the end user's flow, a system job) is exempt.
- **Losing the right stops the workflow.** A deactivated publisher, or one who loses a right an egress, redaction or adverse step uses, pauses the workflow until a holder of the rights republishes.
- **Environments do not meet.** A workflow belongs to one environment, because its lists, templates, secrets and providers do. An object id from another environment resolves to "not found".

### 2. Nothing an operator writes becomes host code

- Conditions are data in our own JSONLogic dialect, walked by our own evaluator with budgets. Templates are JSON values with per-sink encoding. No template library is used, and no field of a definition reaches `eval`, `Function`, a template compiler or a module loader.
- Evaluate Code's source is the one place operator text is executed, and only in QuickJS compiled to WebAssembly, inside a child process with an empty environment, Node's permission flags and no IPC channel, on framed pipes whose length is checked before a byte is buffered. It gets no host function, no module loader, no timers, no network and no secret. A fresh instance and a fresh memory serve each evaluation, a child serves one environment at a time, and the parent kills it from outside at its deadline.
- In the compose `app` profile the runner is a separate container with no network, a read-only root and no secrets. The in-worker pool shares the worker's network namespace, so production logs a warning naming that exposure.

**What this does not cover,** stated in `docs/workflows/evaluate-code.md`: a QuickJS memory-safety bug combined with a V8 WebAssembly bug, Spectre-class side channels inside one process, denial of service beyond the budgets, and anything the operator passes in.

### 3. Egress is literal, signed in its own format, and marked

- **The HTTPS action is the only way out,** on the existing outbound client with a policy of its own. Scheme, host and port are literal in the published definition, so end-user data never becomes a DNS label. Every resolved address is vetted and the socket bound to the vetted one, redirects are not followed, and metadata addresses are refused before any other rule.
- **Workflows cannot forge webhooks.** Workflow requests are signed only with a workflow secret, under `OpenVerify-Request-Signature` with `w1=` over the method, target and body. Webhook verification refuses it, even when an operator stores the same value in both places.
- **Secrets are bound.** A workflow secret is sealed per environment, bound to its hosts and placements, resolved last, and scrubbed by value from everything stored. It is never readable by a condition or by Evaluate Code.
- **Personal data leaving is a marked act.** A step whose rendered values carry PII taint and leave the platform needs the publisher's `pii:view` and an acknowledgement, and each send writes an audit entry with the step and destination, never the values. Default templates carry ids and links.

### 4. Every side effect has a key and a stated guarantee

Every effect has the key `<run>/<node>/<iteration path>`, independent of the attempt.

| Effect | Guarantee |
|---|---|
| Internal (create, transition, tag, assign, list item, transaction) | Exactly once, in one transaction with its effect row |
| HTTPS request | At least once, carrying the key as `Idempotency-Key` |
| Message (email, SMS, Slack) | At most once; a crash between claim and answer is `unknown`, which blocks a resume until acknowledged |
| Evaluate Code | Pure; its recorded output is read on resume |

The one internal exception is redacting an inquiry or an account, which commits in stages with storage deletes after the commit, so its effect is claimed first and a repeat reads `no_change`. Messaging outputs say `recorded`, `accepted` or `unknown`, never "sent" or "delivered". `docs/workflows/delivery.md` lists each action.

### 5. An execution failure is a step error, never a value

- A report that errored is never "no match", a list that was not screened is never "not listed", a graph that was not indexed is never "not linked", a timed-out wait is reported as timed out, and an unknown message effect is never "sent".
- An unknown is `null` with its reason, and a nullable path cannot be a direct operand of a boolean position. Every condition that reads one declares `on-null`, with no default.
- No workflow passes a check.

### 6. A workflow declines a person only on a declared, recorded path

- **Every adverse step is recorded,** whoever makes it: a decline, a block-list or face-list add, an adverse transaction status, an account archived. The record keeps the path taken, the evidence as codes and ids, the tier and confidence of H-tier inputs, and what was still pending.
- **`solely-automated` is computed at run time from what happened,** never from the shape of the graph. Only a wait resolved, not timed out, by a `case.resolved` event a user resolved singly, holding the decision's scope, on a case holding the subject, whose resolution the route read, counts as a person taking part.
- **A production adverse step needs a declared basis and a contest route** that reaches the person. A biometric one also needs a declared biometric basis, and with explicit consent both the Art. 9 consent and `consent.automated-decision` are checked at the decision. One whose path reads an H-tier value needs an explicit acknowledgement. There is no static exemption, and sandbox environments warn instead.
- **A person can always reach a person.** A declined inquiry can be reopened for review, by a user only, and automated declines are refused until a user decides. A decline's biometric deletion is not undone.

This is not legal advice. The operator is the controller and decides its own basis. OpenVerify records what happened and refuses to make the unlawful path the easy one.

### 7. Where it is enforced

| Rule | Enforcement point |
|---|---|
| The actor, in every table and reader | `packages/db` checks, `storedActorOf` in `apps/api`, the contracts' audit actor, and a test per pin |
| Grants, publishers, causing principals | the publish service, the step executor and a refusal test per path (C121) |
| Definitions are data | strict zod schemas, our evaluator's limits and the property test that no evaluation throws a host error (C113, C114) |
| The sandbox | the code-runner security tests and the container's infra test (C123.9) |
| Egress | the guard's tests, the dated registry fixture, the pooling tests and the canary test across tables, Valkey, storage and logs (C124, C125.5) |
| Null and taint | the publish rules with golden invalid definitions, one per rule (C114.6, C115.6) |
| Effects | the effect store and the resume tests (C117.5, C120.3) |
| Decisions | the golden cases for `solely-automated`, the publish gates and the reopen test (C128.2-C128.6) |

## Alternatives considered

| Option | Why not |
|---|---|
| Adopt an engine | Inngest (SSPL), Restate (BSL), n8n (Sustainable Use) and Windmill (AGPL) fail rule 4. Temporal, Hatchet, Trigger.dev, Conductor and Kestra add services. DBOS (MIT) keeps run state outside Drizzle, sealing and redaction. |
| Run Evaluate Code in `node:vm` or vm2 | `node:vm` is documented as not a security mechanism; vm2 had 41 critical advisories in 2026. isolated-vm is a native addon in maintenance mode. |
| Run a run with its publisher's live permissions | A publisher's permissions change after publish, and a broad publisher would hand every trigger their rights. A frozen grant bounded by both ends fails closed. |
| Sign workflow requests with a webhook secret | Any workflow author could forge an OpenVerify webhook to anyone who verifies them. |
| Decide "a person reviewed this" from the graph | A timeout, a CSV run and a bulk resolution all pass a static path check while no person looked. |
| Exempt declines that sit behind a review step | The same reason, and the operator would get no prompt to declare a basis. |
| Turn a failed step into `false` so conditions stay simple | It is ADR 0002's fake pass in a new place: operators stop looking at a branch that says "clear". |

## Consequences

- More to publish: a production workflow with an adverse or egress step needs a basis, a contest route and acknowledgements before it goes live. This is intended.
- More to run: secure production use of Evaluate Code wants the `socket:` runner in its own container.
- More words in the console and docs: delivery guarantees, null reasons, unknown effects and the difference between `recorded` and `accepted`.
- A run's values are personal data: they are sealed, masked fail closed, kept 30 days by default, and purged and redacted with their subjects. Copies sent elsewhere cannot be redacted, and the docs say so.
