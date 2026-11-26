# Provenance

Every copy says where it came from. A cloned result is never shown, served or counted as a check the destination ran (rule 5, ADR 0002).

## The marker

**Ours** (reason: the source API marks a clone in its console only; OpenVerify also makes it machine-readable, so integrations and audits can tell a copy from a fresh result). `provenance` on a copied object:

- a clone: `{kind: 'connect-clone', share-token-id, source-organization-name, source-environment-kind, source-created-at, source-status, cloned-at}`, with `cloned: true` beside each copied check;
- a hydrated object: `{kind: 'connect-hydrate', share-token-id, source-organization-name, hydrated-at, fields[]}` (the hydrated keys only).

The source's object ids are not disclosed (**ours**, reason: least disclosure; the token links the two sides' audit). Checks keep their tier, stage and ADR 0002 provenance as the source recorded them. After a destination-side withdrawal, `provenance.consent-withdrawn-at` is set on the copies.

As built (KP11-20 and KP11-88, open after Workflow 11F and carried to the next release): the inquiry resource serves `provenance`, and the console shows a "Cloned" banner on a cloned inquiry and a "Cloned verifications" table on it; the verification and check resources do not yet serve `provenance` or `cloned`, accounts and transactions do not yet serve their hydrated fields, and the decision resource does not yet serve `relied-on-cloned`. Until then the console marks clones only on an inquiry that is itself a clone, so a clone made by client-side redemption into a live inquiry, or a cloned verification attached to an open inquiry, has no verification-level marker in the console.

## What a clone counts for: `accept-cloned-results`

**Ours** (reason: relying on another organisation's checks is the destination's business and legal decision, so it is off unless the destination turns it on, and recorded when it does). `accept-cloned-results` is a template-version setting, `{verification-types[], max-age-days (1 to 3,650)}`; absent means off. Publishing a version that sets it needs the audited acknowledgement `cloned-results`.

- **Off (the default).** A cloned inquiry is created in `needs_review`, whatever the source's status, and a cloned verification counts toward no required check: in a flow, the step runs as if no copy existed. A cloned failure lands in review, never in `failed` or `declined` by itself.
- **On.** A cloned verification of a listed type, which passed and whose source decision is younger than `max-age-days` at the destination's decision, counts toward that step's required checks. A cloned failure never declines or fails anything: it routes the inquiry to `needs_review`. A cloned inquiry runs the destination's own decision rules, never the source's status. The decision record names the share token and sets `relied-on-cloned: true`. A clone whose destination consent was withdrawn stops counting from then on.
- **Outside the decision engine.** Cloned rows stage no `verification.*` or check event (the destination learns of them through `connect/share-token.inbound-redeemed`); a workflow condition or action treats a cloned check or verification as absent unless the version lists its type and it counts; analytics leave cloned checks and verifications out of pass rates and failure distributions.

A destination that turns the setting on relies on another organisation's checks and configuration. The platform makes that visible and records it; it does not make it safe.

## The binding rule (C235.8)

A copy proves something about whoever the source verified, not about whoever is in the destination's flow now. So a template whose destination-side `share-consent` step leads into `accept-cloned-results` must keep a **live `selfie` step whose face match runs against the cloned portrait** (a cloned government ID's portrait, which needs the policy's `biometric` and `files`), binding the person in the flow to the copy. The alternative is the separate audited acknowledgement `cloned-results-unbound`, which accepts the risk that the copy belongs to someone else: someone who obtained the link reuses another person's verified identity. Publishing refuses a version that has neither (`cloned_results_without_binding`). `selfie` may be listed in `accept-cloned-results` only with that acknowledgement, because a cloned selfie binds nothing to the person in the flow.

The publish rule is enforced. The run-time half is not proved end to end: the destination's accept does not wait for the redemption job (C238.4's waiting position is not built), so a clone counts only on steps entered after the job commits, and the skip of a government-ID step satisfied by a clone, with the live selfie matched against the cloned portrait, is not reliable and is not driven by a full-stack spec (KP11-19, open after Workflow 11F: the next release). The flow never shows a hydrated or cloned value to the person ([client-side](client-side.md)).
