# Branching: the scope, conditions and onNull (plan C150)

A `branch` step holds ordered routes, each `{ key, label, condition, onNull? }`, and a catch-all `else`. The server tries the routes in order and takes the first whose condition holds. Conditions are written in the workflow engine's JSONLogic dialect ([workflow conditions](../workflows/conditions.md)) and evaluated **on the server only**, by `@openverify/workflow-engine`'s `evaluateFlowCondition`. No route condition, threshold, signal name or branch internal is ever sent to a client.

## The scope

A condition reads paths of the flow's typed scope (`FLOW_SCOPE_PATHS` in `@openverify/flow-spec`; `flowScopeAt` gives what the scope holds at a step). Each path carries its type, whether it can be `null`, a PII mark, a tier and stage, and a **source**:

| Path | What | Source |
|---|---|---|
| `inquiry.status`, `inquiry.fields.<key>` | the inquiry and its fields (fields stay on the server) | server; person for a field the person entered |
| `verifications.<step id>.status`, `.attempts`, `.attempts-remaining` | a verification step's outcome | verification |
| `verifications.<step id>.<extraction>` | an extracted value (`country-code`, `id-class`, `birthdate`, `age-years`, `expiration-date`; a document's `document-type`), `R/H` `beta` | verification |
| `checks.*` | a check's status (`passed`, `failed`, `not_applicable`, or `null` while pending or errored) | verification |
| `device.kind`, `device.platform` | the session's device class | client |
| `signals.<name>` | a Phase 7 signal's provisional snapshot (flow-provisional signals only) | server, or client for the three session-integrity signals |
| `workflows.<step id>.status`, `.error-type`, `.outputs.<name>` | an embedded workflow's result | server |
| `session.*`, `account.*` | the session (resumed, handoff state) and the inquiry's account | server |

`lists.*` is described but not available in a flow: no list screening finishes before completion. A route that reads a path the scope does not have at that step is refused at publish (`scope_path_unknown`, `scope_path_unavailable_in_flow`).

## Nulls and onNull

A path that can be `null` (an extraction the document lacked, a signal not yet collected, a check that errored) never reaches a boolean position silently. A route that reads one must declare `onNull` (`on_null_missing` otherwise; there is no default): `else`, `skip-route` (try the next route), `review` (send the inquiry to review) or `route:<key>`. A `null` whose reason is in the review class of Phase 7's `ON_NULL_DEFAULTS` (an outage, an unconfigured provider) sends the inquiry to review whatever `onNull` says. An errored check never takes a route that means "not failed" (golden test H03): the flow's evaluator reads a `null` operand of `!==` as unknown, where Phase 8's `evaluateCondition` reads it as true. A read of a path the stored flow names but the current registry no longer has is `scope_path_missing`: the person's part ends at once and the inquiry goes to review.

## Waits and provisional signals (C150.5, C150.9)

A branch may wait for nullable facts: `waitFor { facts, maxSeconds }` (at most 30 seconds' poll interval, `retry-after-ms` 2,000). The position is `waiting`; the session poll and the 15-second `flow-action-sweep` end a wait that is over, and the route then reads what is there, following `onNull` for what is still `null`. A branch that reads a Phase 7 signal reads its **provisional snapshot** (`inquiry_flow_signal_snapshots`), computed by Phase 7's own function when the branch is entered, from the payloads stored so far; before the first payload a client-collected signal is `null` with the reason `not_yet_collected` (ignore class), so the route's `onNull` decides with no review. Only signals the registry marks `flowProvisional` can be read (the network, device and session signals; not `country_comparison` or `list_match_count`), and a read needs a `waitFor` (`signal_wait_missing`). The inquiry's own `signals` are still computed at completion. A branch on a signal inherits its error rate and is shown `beta`.

## Fallbacks (C150.6)

A verification step's `exhausted` edge is taken when its attempts end without passing. With `onFallback: "review"` (the default) the inquiry goes to review at completion; `"continue"` needs a `fallback:` acknowledgement. **The failed verification stays failed**: a fallback never counts it passed, and `flow-outcome.fallbacks-taken` names the step. A step with no `exhausted` edge fails the inquiry when its attempts end. A version that uses a fallback does not run on today's Android SDK until Phase 10 (owner decision after Workflow 9A's stop).

## Acknowledgements and adverse paths (C150.7, C150.8, C150.10, C151.13)

`analyzeFlowForPublish` works out what a version needs acknowledged at publish, each `<kind>:<target>`, given by a person (an API key cannot publish a version that needs one) and stored with who and when:

- `heuristic:<branch>`: a route reads a heuristic fact (an extraction, a signal), whichever way it routes;
- `fallback:<step>`: a fallback that continues;
- `adverse-path:<step>`: a path that fails a person on anything but a verification's own outcome; in production it also needs the failure step's `decisionBasis`, a contest route and, for a biometric template, a `biometricBasis`, and it writes a `flow-failure` decision record ([actions](actions.md));
- `asserted-fact:<route>`: a route that lowers friction on a fact the person or their device reports (production; sandbox warns);
- `unverified-path:<completion>`: a completion reachable through no verification, or skipping a type another path requires (production; sandbox warns);
- `egress:<step>`, `legal-copy:<key>`, `locale-unreviewed:<locale>`: an embedded workflow that sends data out, an overridden legal text, a machine-drafted locale shown in production.

`validate` in publish mode (`POST /inquiry-template-versions/:id/validate`) answers the list as `acknowledgements-required`.
