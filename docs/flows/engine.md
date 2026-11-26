# The server engine (plan C151)

The server decides every step a person sees (`apps/api/src/flow-engine/`, on `@openverify/flow-spec`'s pure `nextPosition`). A client renders the step it is given and never evaluates a transition.

## The position and the step record

Each inquiry has a position on its row: the current step (`flow_step_id`), its state (`active`, `waiting`, `halted`, `ended`), the previous person-visible step and the flow-spec version, plus the first session's device class and platform. The engine appends one entry to the **step record** (`inquiry_flow_steps`) per step entered and closes it on exit with the port, an outcome code, the time waited, notes and a `sensitive` mark, in the transaction that moves the position and under the inquiry's row lock. The record holds ids and codes, never a value, but it is **pseudonymous, not PII-free**: a route on a field or a button the person chose can reveal what they entered, so an exit through a screen button other than `next`, or a route that reads a PII path, is marked sensitive. No route serves the step record in Phase 9.

The position starts at the flow's `entry` on `created` to `pending` (the first `GET /flow/session`), applying the after-start window ([expiry windows](#expiry-windows-c15110)). An inquiry with no position pinned to a flow-spec 1 version (every inquiry from before Phase 9) is positioned once, on its next flow request, by replaying the migrated flow over its stored facts, recorded as one entry noted `position_backfilled`.

## Advancing

Each exit advances in the transaction that records it: a consent recorded, a screen submitted, a verification decided (`passed`, `needs_review` or `skipped` take `next`; ending without passing takes `exhausted`, or fails the inquiry when there is no such edge), an action finished, a branch's signal snapshot written, a branch wait elapsed (found by the session poll or the sweep), and Phase 7's handoff resolved (continued here or redeemed take `next`; a decline moves nothing; the desktop's "this was not me" takes the position back to the handoff step). The walk goes through `branch` and `action` steps until it reaches a step a person sees, a wait or a terminal step. **Caps** (ours, provisional): 20 entries of one step and 200 moves per inquiry; past either the flow is `halted` with `flow_loop_limit`, the session says it cannot continue, and an operator expires or resumes the inquiry.

## Only the current step

The flow API records consent, creates or reuses a verification, takes an upload, a screen submission or a handoff request only for the step the position names; anything else answers 409 `flow_step_not_current`, with no detail of another path. Two exceptions keep Phase 7's behaviour: a session with no consent of its own (a phone a handoff redeemed) records its own consent after the flow passed its consent step, which moves nothing, and the web flow asks for it first; and a late handoff request after the step was left is answered by Phase 7's own state machine.

## Required verifications and the outcome (C151.3)

The outcome considers only the verification types whose steps were entered on the path. The inquiry completes when the position reaches a completion with every entered verification decided; fails at a failure step, or when a verification ends without passing and has no `exhausted` edge; and goes to review at completion when an entered verification needs review, a fallback was taken with `onFallback: review`, a `flag_for_review` action ran, a branch took `onNull: review` or met a review-class null, or a branch recorded `scope_path_missing`. The same pure `flowOutcome` serves the engine and simulate. A list screening that later finds the inquiry already in `needs_review` records `inquiry_already_decided` and moves nothing.

Every inquiry carries a PII-free **`flow-outcome`** `{ verification-types-on-path, fallbacks-taken, flags }`, served on every read of the inquiry and in `inquiry.completed`'s `meta`, so a consumer can tell a fully verified completion from one through a fallback or with no verification.

**Inquiry attributes:** `previous-step-name` and `next-step-name` (the current step's id, `null` once ended) are served on a single inquiry's read; without PII visibility each is `null` when the step was reached through a sensitive exit. Lists and event payloads leave them out (an event fails closed).

## The session API (C151.5, C151.7)

`GET /api/v1/flow/session` (and every screen submission) answers, beside Phase 1's members: `position { step-id, state, previous-step-id, retry-after-ms }`, `step` (the current step's client view: an allowlist of what the renderer needs, never a step's name, a branch or an action), `values` (the current screen's own fields only), `locales { enabled, default }`, `copy` (the current step's texts), `embed { allowed-origins }`, `completion { redirect-url }`, `spec-version`, `links { help-url, privacy-url }` (the version's two links, each `null` unless it is an `https:` URL of at most 2,048 characters; present whenever the engine positioned the inquiry), and `theme` (the inquiry's theme set, else the version's, else the environment's default set; left out for the built-in theme: [themes](../themes/README.md#which-theme-a-flow-renders)). **A session without a consent of its own** (a phone a handoff redeemed after the path passed its consent step) is served that consent step's client view as `step`, with no `values` and the position unchanged; recording it moves nothing. **Negotiation:** the request header `OpenVerify-Flow-Spec` lists the versions a client renders (`1, 2`; absent means `1`); the response header names the version served; `step` and `values` go only to a client that declared `2`. Negotiation changes only what is sent, never the path, a wait or the required verifications. The web flow sends `1, 2`, and the API's CORS allows and exposes the header.

## Today's Android SDK (C151.6)

A flow-spec 2 version's session carries, in `flow`, the **v1 projection**: the exited steps the SDK passes as done, the current step, and the unconditional run after it that has a v1 form, ending at a terminal step or at a `server-continuation` placeholder the SDK shows as unsupported (never "Completed"). A current step with no v1 form, a consent step with custom copy, and a verification step with an `exhausted` edge (owner decision after Workflow 9A's stop) are placeholders. `FlowCoordinatorProjectionTest` drives today's SDK over the golden projections in `contracts/fixtures/api/flow-projections/`, and the session serves them byte for byte. **A flow-spec 1 version keeps serving its own stored v1 flow**, transitions included, because its migrated branches would stop the SDK after the ID step; a client can still act only on the step the server names. So linear flows keep working on today's SDK, and v2-only steps stop it safely until Phase 10.

## Expiry windows (C151.10)

An inquiry's `expires-at` moves at four moments. At each one the window in force is **the inquiry's own, else its pinned version's setting**: the inquiry's own windows are set by `POST /inquiries`' `meta` and change that inquiry only (`apps/api/src/flow-engine/expiry.ts`). The `meta` names are public; the semantics the public sources leave open are ours.

| Moment                         | The inquiry's own window (`POST /inquiries` `meta`) | Else the version's setting (default)               | What happens                                                                                                                      |
| ------------------------------ | --------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Creation                       | `expiration-after-create-interval-seconds`          | `inquiry-expiration-seconds` (86,400)              | `expires-at` = creation time + window                                                                                             |
| Start (`created` to `pending`) | `expiration-after-start-interval-seconds`           | `inquiry-expiration-after-start-seconds` (none)    | `expires-at` = `started-at` + window; with neither set, the start changes nothing. This may shorten the expiry                    |
| Resume                         | `expiration-after-resume-interval-seconds`          | `inquiry-expiration-after-resume-seconds` (86,400) | `expires-at` = the later of `expires-at` and now + window, so a resume never shortens it                                          |
| One-time link created          | `one-time-link-expiration-seconds`                  | `one-time-link-expiration-seconds` (86,400)        | the link lives the request's own `expires-in-seconds`, else the inquiry's window, else the version's, and never past `expires-at` |

Every window, in `meta` and in the settings, is a whole number of seconds from 300 to 2,592,000 (5 minutes to 30 days; `MIN_EXPIRATION_SECONDS` and `MAX_EXPIRATION_SECONDS` in `packages/contracts/src/template-settings.ts`). Each `meta` key is optional.

- **What the inquiry serves.** Every inquiry resource carries the three windows that act after creation: `expiration-after-start-interval-seconds`, `expiration-after-resume-interval-seconds` and `one-time-link-expiration-seconds`. **`null` means the inquiry has no window of its own and its template version's setting applies**; it never means "no expiry" or zero. They are set at creation only. The creation window needs no column of its own: `expires-at` shows it. The console's inquiry page shows the three read-only, `null` as "The template’s default" (`windowWords`, `apps/dashboard/src/components/lifecycle/inquiry-view.tsx`).
- **Where the start applies.** The engine applies the after-start window when it positions an inquiry on `created` to `pending` (the first `GET /flow/session`; `applyStartWindow` in `apps/api/src/flow-engine/position.ts`).
- **Where a resume applies.** `POST /inquiries/:id/resume` and the redemption of a one-time link (`POST /flow/one-time-links/redeem`) each extend the expiry in their own transaction, under the inquiry's row lock, after the session is created (`extendExpiryOnResumeInTx`). A refused resume (409, 410 or the session cap) and a refused redemption (401) move nothing.
- **Ours: nothing is revived.** A decided or redacted inquiry is never moved, and a start or a resume never moves an inquiry already at or past its `expires-at`, so whether an inquiry ends expired never depends on when the expiry sweep runs. A link that would end at or before now is refused with 409 `invalid-transition`.
- **Carried to Workflow 9D** (plan, amendment FE2): the flow paths that start an inquiry outside the engine (`openInquiry`, and `getFlowSession`'s fallback for a flow it cannot walk) skip the after-start window, and a Phase 7 handoff redemption opens a session without extending the expiry.

## Selfie capture time (C171.4, WCAG 2.2.1)

`POST /api/v1/flow/selfie-captures/:id/extend` gives the current step's capture 180 more seconds, at most ten times (`SELFIE_CAPTURE_EXTENSION_LIMIT`, ours: WCAG 2.2.1's minimum, bounding a capture's life at 33 minutes). The web flow warns 20 seconds before the limit and extends in one action.

## Races

Testcontainers tests (`apps/api/src/flow-engine/flow-engine-races.integration.test.ts`, `apps/api/src/flow-actions/flow-actions.integration.test.ts`): two tabs submitting one screen, a decision racing a submission, a poll and the sweep ending one wait, two finishes of one action, and `run_workflow` against a run completing, erroring and timing out.
