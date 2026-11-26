# Actions (plan C152)

An `action` step runs one action from a closed list, exactly once per entry, with ports `next` and `error`. Publish refuses an action without an `error` edge, so a failure always has a path the author chose. Custom code and HTTPS requests stay in [workflows](../workflows/README.md) behind their sandbox and guard; a flow reaches them only through `run_workflow`.

| Kind | Members | What it does |
|---|---|---|
| `run_workflow` | `workflowId`, `version` (`latest-published` or a `wfv_` id), `inputs`, `timeoutSeconds` (1 to 300, default 30) | starts a run of a `trigger-flow` workflow and waits for it |
| `copy_extractions` | `fromStep`, `mapping { <field key>: <extraction> }` | copies a decided verification's extracted values into fields (write-once respected; a `null` extraction is never written) |
| `update_account_fields` | `mapping { <account field key>: <path or literal> }` | updates the inquiry's account through the accounts service, firing `account.updated-fields` |
| `tag_inquiry` | `add[]`, `remove[]` | literal tag names only, never a value |
| `flag_for_review` | `reasonCode` (snake_case, at most 64) | the inquiry goes to review at completion with `flag_for_review:<code>` in its `flow-outcome`, shown in the console and never to the person |

## run_workflow (C152.2)

The target is a workflow of the same environment whose trigger type is `trigger-flow` (Phase 8's ninth trigger type, started only by a flow action, with the inquiry as subject and the declared inputs only). The run is created through Phase 8's run service in the transaction that enters the step, with creator `inquiry-flow` and the inquiry's id, one per `(inquiry, step, entry)`; a run's resource names that creator. The session waits (`position.state: waiting`) and the engine advances when the session poll or the `flow-action-sweep` (every 15 s) finds the run ended: `completed` puts its outputs in scope (`workflows.<step id>.outputs.<name>`) and takes `next`; `errored`, `canceled` or the timeout take `error` with `workflows.<step id>.status` and `.error-type`, and the outputs `null`. A timed-out or errored workflow is never read as an output. At the timeout the run is canceled through Phase 8's cancellation; a step already executing when the cancel lands still finishes.

A non-PII output reads as a number in the flow's typing (Phase 8 outputs carry a name and a PII mark, no type), and a run output declared non-PII shows only as a number or a boolean.

**Authority.** The publisher of the template must hold `workflows:trigger`, every scope of the target version's grant, and `pii:view` when the grant has `pii`; a target with egress marks needs `egress:<step id>` acknowledged. A flow-started run has no causing principal and acts on its frozen grant. On entry the resolved version's grant must not be wider than what the publish checked; otherwise no run starts and the step takes `error` with `workflow_grant_widened`. **Until the version stores the grant it was published against** (a column carried to Workflow 9B), a `latest-published` target is held to no scope and no PII (fail closed); pin a `wfv_` version, whose grant is immutable, for a target that needs scopes.

## Errors

A failed action's `error-type` is one of the codes in [docs/workflows/errors.md, "Flow action steps"](../workflows/errors.md#flow-action-steps), recorded on the step record.

## Rows and redaction (C152.8)

`inquiry_flow_actions` holds one PII-free row per entry: the step, the entry, the run, the status, the error type, and for `update_account_fields` the account and the keys it copied. Redacting the inquiry lists those account targets in its result and audit entry (the copies on the account stay; redact the account to remove them), then deletes the rows; the rows follow the inquiry's retention.

## The flow-failure decision record (C150.7)

A path that ends at a `failure` step on anything but a verification's own outcome writes a decision record of kind `flow-failure`, actor `inquiry-flow`, with a `flow` member (`template-version-id`, `failure-step-id`, the branch routes taken with their `onNull`) and one evidence entry per fact the routes read, by path with its tier and stage, never its value. Phase 8's gates apply: without a decision basis the inquiry goes to review (`decision_basis_missing`); a biometric case needs its basis; an `explicit-consent` basis without the recorded `consent.automated-decision` answers `automated_decision_consent_missing`. The failure screen shows the contest route.
