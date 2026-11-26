# Phase 9, Workflow 9A Stage 2: flow-spec-logic

Owner of `packages/flow-spec/src/v2/` (except `v2/schemas/` and `v2/copy-keys.ts`), `packages/flow-spec/scripts/` and `packages/flow-spec/schema/`, plus the one borrowed edit of C150.12 in `packages/workflow-engine`. Base: `b38985f8` (Stage 1a done at `e353621e`; foundation-9a's first commit `b38985f8`). Every command ran after `source scripts/env.sh`; outputs are abbreviated, with the real counts.

This agent has no checkpoint of its own in the plan: `api-flow-engine`, `api-flow-actions`, `api-templates`, `flow-renderer` and `flow-server-embed` start on its finished report.

## Slice A: digits, device kind, canonical JSON, client view, projection (C161.4, C150.2, C147.7, C151.5, C151.6)

Placeholder first: `canonicalJson` (the RFC 8785 form of any JSON value), a stub in `v2/graph.ts`, so the RED tests compile (`8b447735`).

### RED

```
$ pnpm exec tsc --noEmit -p .          # clean
$ pnpm exec vitest run src/v2/digits.test.ts src/v2/device-kind.test.ts src/v2/canonical.test.ts \
    src/v2/client-view.test.ts src/v2/projection.test.ts --coverage.enabled=false
FlowSpecNotBuiltError: normalizeDigits is not built yet (flow-spec-logic, Workflow 9A)      x4
FlowSpecNotBuiltError: deviceKindOf is not built yet (flow-spec-logic, Workflow 9A)
FlowSpecNotBuiltError: canonicalJson is not built yet (flow-spec-logic, Workflow 9A)        x4
FlowSpecNotBuiltError: canonicalFlowJson is not built yet (flow-spec-logic, Workflow 9A)    x3
FlowSpecNotBuiltError: clientViewOf is not built yet (flow-spec-logic, Workflow 9A)         x5
FlowSpecNotBuiltError: projection is not built yet (flow-spec-logic, Workflow 9A)           x11
 Test Files  5 failed (5)
      Tests  55 failed | 1 passed (56)       # the one pass: the manifest holds 16 cases
```

Every failure is the frozen stub's own error, the intended reason.

### GREEN

`normalizeDigits` (two ranges only), `deviceKindOf` (a table, unknown values `null`), `canonicalJson` (`v2/canonical-json.ts`, re-exported from `graph.ts`) and `canonicalFlowJson` (layout dropped), `clientViewOf` (an allowlist through `withoutMembers` of `v2/step-members.ts`), and `projection` (exited steps passed as done, the current step, the `next` run, the placeholder rules). The built functions leave `stubs.test.ts`.

```
$ pnpm exec vitest run src/v2 --coverage.enabled=false
 Test Files  8 passed (8)
      Tests  120 passed (120)
$ pnpm exec eslint src/v2 && pnpm exec tsc --noEmit -p .     # clean
```

The sixteen golden projections are produced in their compact form with member order, so the session builder can serve the fixtures' bytes (V03). Decisions left open by C151.6, recorded here and in the report: an exited `device_handoff` is left out (the position carries no handoff state, and leaving a done step out only makes today's SDK start at the current step); an exited consent with custom copy is left out (it has no v1 form); a step id equal to the placeholder's (`continue-1`) is never listed (the graph rules refuse it, `step_id_reserved`); the flow's `description` is not sent.

Refactor on green: the digit ranges of `digits.ts` are written as `\u` escapes (an editor had stored the characters themselves), and the digits test builds its non-digit separator from its code point.

## Slice B: the restricted pattern grammar and the linear-time matcher (C148.3, P03, V10)

Placeholders first (`3a5ac5d3`): `PATTERN_PROGRAM_LIMIT` (2,048 instructions) and `PATTERN_REFUSAL_REASONS` beside the frozen stubs. The golden vectors are generated, never typed: `scripts/pattern-vector-sources.ts` holds 45 patterns with their chosen inputs, alphabets and seeds, and 42 refusals with their reasons; `scripts/write-pattern-vectors.ts` adds seeded random inputs and asks `RegExp` (`u` mode, the whole value) for each answer, writing `src/v2/pattern/vectors.json` (571 match vectors, 107 of them matching). `RegExp` runs only there and in the test, on these fixed patterns, never on an operator's text.

### RED

```
$ pnpm exec tsx scripts/write-pattern-vectors.ts
Wrote src/v2/pattern/vectors.json
$ pnpm exec vitest run src/v2/pattern --coverage.enabled=false
FlowSpecNotBuiltError: compilePattern is not built yet (flow-spec-logic, Workflow 9A)
FlowSpecNotBuiltError: matchPattern is not built yet (flow-spec-logic, Workflow 9A)
 Test Files  1 failed (1)
      Tests  13 failed | 1 passed (14)     # the pass: vectors.json is what the script writes
```

### GREEN

`pattern/parse.ts` reads the grammar into a tree and refuses everything else with its reason and index; `pattern/vm.ts` compiles the tree to a program (counted repeats expanded, at most `PATTERN_PROGRAM_LIMIT` instructions, else `pattern_too_complex`) and runs it as a Pike VM over code points, each instruction visited at most once per position; `pattern/limits.ts` holds the limits and reasons; `pattern/index.ts` keeps each program in a `WeakMap`, so a `CompiledPattern` holds only its `source`, and fails closed (no match) past `PATTERN_INPUT_LIMIT` or for a pattern it cannot compile.

The first GREEN run refused three of my own match vectors, `\d{5}(?:-\d{4})?`, `[a-z]+(?:\.[a-z]+)*` and the MAC-address form `(?::[0-9A-Fa-f]{2}){5}`: each puts a quantifier on a group that holds one, which C148.3 refuses ("no nested quantifiers"; V10's grammar list does not lift it). I kept the rule, moved the first two to the refusals and rewrote the others without the nesting (`(?:-[0-9][0-9][0-9][0-9])?`, `(?:\.[a-z]+)`, `(?::[0-9A-Fa-f][0-9A-Fa-f]){5}`), then regenerated the file. This is recorded for the owner: with a Pike VM, nesting costs no time, and the program limit already bounds its size, so the rule could be relaxed.

The CPU budget was set at 500 ms with its basis after measuring: the six pathological 10,000-character matches took 3 to 74 ms each with coverage instrumentation on (load 1.05 1.95 3.86).

```
$ pnpm exec tsx scripts/write-pattern-vectors.ts      # 570 match vectors, 44 refusals
$ pnpm exec vitest run src/v2 --coverage.enabled=false
 Test Files  9 passed (9)
      Tests  132 passed (132)
$ pnpm exec vitest run src/v2/pattern --coverage.include='src/v2/pattern/**'
All files     |   98.13 |    91.75 |     100 |   97.97 |
$ pnpm exec eslint src/v2 scripts && pnpm exec tsc --noEmit -p .     # clean
```

## Slice C: the strict visibility evaluator (C148.4, F26)

Placeholders first (`chore(flow-spec)`): `VISIBILITY_RULE_LIMITS` (depth 16, 200 nodes) and `VisibilityRuleError` beside the frozen stubs.

### RED

```
$ pnpm exec vitest run src/v2/visibility.test.ts --coverage.enabled=false
FlowSpecNotBuiltError: checkVisibilityRule is not built yet (flow-spec-logic, Workflow 9A)
FlowSpecNotBuiltError: evaluateVisibility is not built yet (flow-spec-logic, Workflow 9A)
 Test Files  1 failed (1)
      Tests  10 failed (10)
```

### GREEN

`checkVisibilityRule` walks the rule with its pointer, counting nodes and depth (past either, one `visibility_rule_invalid` at the root), and reports `visibility_scope_invalid` for any `var` that is not `screen.<field>` of the given fields; `evaluateVisibility` runs the same check (any `screen.<field>` it names is allowed there, since an unfilled field reads `null`) and throws `VisibilityRuleError` before evaluating a rule outside the subset. One test was corrected in GREEN: it read `screen.toString` to show that no prototype member is read, but a field key is lower-case, so the path is outside the subset; it now reads `screen.constructor`, a valid key the evaluator reads as `null` through `Object.hasOwn`.

```
$ pnpm exec vitest run src/v2 --coverage.enabled=false
 Test Files  10 passed (10)
      Tests  140 passed (140)
$ pnpm exec eslint src/v2 && pnpm exec tsc --noEmit -p .     # clean
```

## Slice D: nextPosition, resumeAt, flowOutcome and the H03 golden (C151.2, C151.3, C150.3-C150.5, review H16, H03)

Placeholders first (`chore(flow-spec)`): `FLOW_LOOP_LIMITS` (20 entries of one step, 200 moves), `FLOW_STEP_NOTES` (the step record's note codes), `NextPositionOptions` (`visits`, `moves`, `waited`) as an optional sixth argument of the frozen `nextPosition`, `resumeAt`, `checkScopeStatus`, `RouteTaken.notes` and the halt reason `edge_missing`.

**Found while writing the H03 test:** Phase 8's evaluator answers `{"!==": [x, "failed"]}` with `x` null as **true** (`evaluate.ts`, "defines !== with null as the negation of strict equality"); only its publish typing stops it (`nullable_in_boolean_position`). So the flow's own evaluation entry point (the borrowed edit, slice G) reads a null operand of `!==` as unknown, as `===` does. The flow-spec tests drive the walk with `v2/test-evaluator.ts`, which mirrors those flow rules (the workflow engine depends on this package, so it cannot be imported here).

### RED

```
$ pnpm exec vitest run src/v2/next-position.test.ts --coverage.enabled=false
FlowSpecNotBuiltError: nextPosition is not built yet (flow-spec-logic, Workflow 9A)      x14
FlowSpecNotBuiltError: flowOutcome is not built yet (flow-spec-logic, Workflow 9A)       x8
FlowSpecNotBuiltError: checkScopeStatus is not built yet (flow-spec-logic, Workflow 9A)  x3
FlowSpecNotBuiltError: resumeAt is not built yet (flow-spec-logic, Workflow 9A)          x2
 Test Files  1 failed (1)
      Tests  29 failed | 1 passed (30)       # the pass: FLOW_LOOP_LIMITS states 20 and 200
```

### GREEN

`nextPosition` resolves the exited port's edge and walks: each step entered counts one entry and one move against `FLOW_LOOP_LIMITS` (seeded from `options.visits` and `options.moves`, what the step record already holds); a terminal, an action or a person-visible step stops the walk; a branch with `waitFor` whose named facts read `null` returns `wait` unless `options.waited` names it; otherwise its routes run in order through the injected evaluator: a value routes or falls through, a `missing` path halts with `scope_path_missing`, and a null follows the route's `onNull` (`review` when a stored route has none), the review class adding `review-class-null`. `resumeAt` enters at a step already recorded, without counting it. `flowOutcome` applies C151.3 over the step record as described in its comment; `checkScopeStatus` maps a check's status and reasons through core's `checkErrorClassOf`.

```
$ pnpm exec vitest run src/v2 --coverage.enabled=false
 Test Files  11 passed (11)
      Tests  168 passed (168)
$ pnpm exec vitest run src/v2/next-position.test.ts --coverage.include='src/v2/next-position.ts'
 next-position.ts |     100 |    95.32 |     100 |     100 |
$ pnpm exec eslint src/v2 && pnpm exec tsc --noEmit -p .     # clean
```

The H03 golden passes for every reason of `CHECK_ERROR_REASONS` and an `*_unavailable` reason, under `onNull` `else`, `skip-route` and `review`, for `{"!==": [status, "failed"]}`, `{"!": {"===": ...}}` and `{"!": {"==": ...}}`; the same route with the check `passed` is taken, so the test tells the two apart.

## Slice E: the v1 to v2 migration, its goldens and the equivalence test (C147.10, C151.3, review F07)

Placeholders first: `MIGRATION_NOTE_CODES` and `MIGRATED_SUBMIT_LABEL_KEY` (`screen.continue`, the built-in word flow-renderer provides for a migrated form's submit button).

The sources (`v2/golden/v1-sources.ts`): every stored v1 flow under `contracts/fixtures/` found by a scan (five: the three flow sessions, the template version and `flows/default-gov-id-selfie.json`; the projections are left out, as they are not stored flows), the flow-spec test fixture `validFlow()` (which reads `platform` and `verifications.selfie.status`, outside v1's context), and six synthetic flows, one per rule. The goldens (`v2/golden/migrations/<name>.json`) are written by `scripts/write-migration-goldens.ts` from the implementation and reviewed; the test also asserts each rule by hand on the synthetic flows, so the goldens are not their only check.

The equivalence test runs each source through `v2/test-v1-walk.ts` (a test-only copy of `flow-position.ts`'s walk and `json-logic.ts`'s semantics) and through the migrated flow's `resumeAt`, `nextPosition` and `flowOutcome`, for the all-passed scenario and each verification step failed, in review or skipped, and requires the same path and outcome.

**A design change found while writing it.** C147.10 substitutes the literal `null` for a path outside v1's context. Under the strict dialect, that `null` reaching `!`, `!!`, `and` or `or` is unknown, where v1 read it as falsy, so `{"!": [{"var": "verifications.id.status"}]}` took the transition in v1 and would follow `onNull` in v2. So the migration also folds every sub-condition that reads no `inquiry.status` to its v1 value (a root fold becomes `{"!!": [<v1 truthiness>]}`), with a `condition_folded` note; a `null` left under another operator inside a condition that does read `inquiry.status` keeps its `null_operand` note. The plan's rule is kept (the literal is substituted first); the fold makes the migration lossless for every condition of that shape.

### RED

```
$ pnpm exec vitest run src/v2/migrate.test.ts --coverage.enabled=false
FlowSpecNotBuiltError: migrateFlowWithNotes is not built yet (flow-spec-logic, Workflow 9A)   x8
FlowSpecNotBuiltError: migrateFlow is not built yet (flow-spec-logic, Workflow 9A)            x2
 Test Files  1 failed (1)
      Tests  32 failed | 1 passed (33)     # the pass: the sources include branching flows
```

The first RED run also failed the fixture-name list on its order (`flow-session-declined.json` sorts before `flow-session.json`); the expectation was put in path order before the commit.

### GREEN

`migrate.ts` builds the v2 flow step by step (`<S>-routes` branches with routes `r1`, `r2`, ... labelled "Transition <n>", `onNull: "else"`), substitutes outside-context paths, folds what reads no `inquiry.status` with v1's JSONLogic (`v1Value`), parses the result with `flowV2Schema`, and notes a consent that does not dominate a collecting step through `v2/rules/graph-model.ts` (reachability and dominators, shared with the graph rules). The goldens were then written and reviewed (twelve files), for example `fixture-flows-default-gov-id-selfie.json`: two `-routes` branches on `inquiry.status == "failed"`, each `else` to the next step, no note.

Corrected in GREEN, each a mistake in my RED expectations, not in the rules: the substituted `{"var": "x"}` under `and` is already a literal, so it is not folded and has no `condition_folded` note (only `null_operand`); and a 64-character step id keeps 53 of its characters before the hash suffix, not 48. A further test was added after GREEN for the rarer notes (`operator_outside_v1`, `var_object_context`); writing it showed that folding a `var` of v1's whole context into a literal would give a confident wrong answer (`{"===": [{"var": ""}, {"var": "inquiry"}]}` is false in v1), so such a read is kept as `{"var": "inquiry"}`, never folded, and the publish typing refuses it until the author rewrites it.

```
$ pnpm exec tsx --conditions=@openverify/source scripts/write-migration-goldens.ts   # 12 files
$ pnpm exec vitest run src/v2 --coverage.enabled=false
 Test Files  12 passed (12)
      Tests  200 passed (200)
$ pnpm exec eslint src/v2 scripts && pnpm exec tsc --noEmit -p .     # clean
```

## Slice F: the graph, component and field rules (C147.5, C147.6, C148.1-C148.4, C149.2, C151.8, C152.1)

Placeholders first: `FlowGraphOptions` gains optional `fieldSchemas`, `linkFields`, `customConsentCopy`, `noticeKeys` and `checks`; `FLOW_GRAPH_PROBLEM_CODES` and `FLOW_GRAPH_WARNING_CODES`; `checkFieldSchemaChanges` (C149.2).

The goldens (`v2/golden/graph-cases.ts`): a valid base flow (consent, a screen with a visibility rule and a second submit button, a government ID with an `exhausted` fallback to a document, a branch, a screen, a selfie, an action, both terminals), whose only problems are five spec-1 warnings, and 48 cases, each a mutation with the problems it adds written by hand (severity, code, pointer): one per rule and per case, the allowed cycle through a screen and a branch, the NFC step after the selfie and the legal-notice alternative to consent included as valid cases. `scripts/write-graph-goldens.ts` writes them to `v2/golden/graph/` (49 files, from the case definitions, not from the implementation) for the API's and the console's own tests.

### RED

```
$ pnpm exec vitest run src/v2/graph.test.ts --coverage.enabled=false
FlowSpecNotBuiltError: checkFlowGraph is not built yet (flow-spec-logic, Workflow 9A)
FlowSpecNotBuiltError: checkFieldSchemaChanges is not built yet (flow-spec-logic, Workflow 9A)
 Test Files  1 failed (1)
      Tests  54 failed | 1 passed (55)     # the pass: the 49 golden files are what the cases write
```

### GREEN

`v2/rules/structure.ts` (entry, endpoints, ports per type with `portsOf`, wiring, reachability, `terminal_unreachable`, Tarjan's components for `cycle_not_allowed`, one step per verification type, the order rules and the consent rule through the dominators, the reserved placeholder id, `onNull` route references, the source of `copy_extractions`), `v2/rules/screens.ts` (component count and nesting, patterns through `compilePattern`, visibility through `checkVisibilityRule` with the screen's bound fields, bindings against `fieldSchemas`, submit buttons and links, `prefillFrom`, the byte caps), `v2/rules/warnings.ts` and `v2/rules/fields.ts` (`checkFieldSchemaChanges`, `MAX_FIELD_SCHEMAS`); `checkFlowGraph` runs them in that order over the edges that count (known endpoints, a valid port, the first per port). Every case passed on the first run.

```
$ pnpm exec vitest run --coverage.enabled=false        # the whole package
 Test Files  20 passed (20)
      Tests  398 passed (398)
$ pnpm exec vitest run src/v2/graph.test.ts --coverage.include='src/v2/rules/**' --coverage.include='src/v2/graph.ts'
All files          |   98.24 |    90.52 |   94.16 |   97.88 |
$ pnpm exec eslint src/v2 scripts && pnpm exec tsc --noEmit -p .     # clean
```

Decisions left open by C147.6, recorded here and in the report: both modes run every rule (C154.9 lists all of C147.6 among the publish rules, and a draft stores its problems either way); a step that reaches no terminal and an unreachable step are reported apart; without `fieldSchemas` every bound field counts as PII for the consent rule (fail closed, as masking does); a screen showing a notice satisfies the rule for itself; the spec-1 warning is per step, reachable or not; `email` binds `string` or `email-address`; revealing words match an id segment's start (`flag` matches `flagged`).

## Slice G: the borrowed edit in packages/workflow-engine (C150.12, review F05)

**What the inventory missed.** Phase 8 outcome 6 says `typeCheckCondition` and `evaluateCondition` already take a caller-supplied scope, and that only naming the null's operand was left. Two more things stop a flow condition at the door: `parseCondition` refuses any root outside Phase 8's (`trigger`, `inputs`, `vars`, `steps`, `loop`, `current_case`, `current_run`, `event`; `path_unknown`), and its path grammar refuses a `/` in a member, which every signal name holds (`signals.inquiry/bot_score`). And, found in slice D, `!==` reads a null operand as unequal (true). So the borrowed edit is one new module, `src/expressions/flow-condition.ts` (exported from `expressions/index.ts`), with two functions, `typeFlowCondition(raw, paths)` and `evaluateFlowCondition(raw, roots)`, plus the smallest hooks they need inside the parser and the evaluator, each off unless the new functions turn it on, so Phase 8's behaviour and suites do not change.

### RED

```
$ pnpm exec vitest run src/expressions/flow-condition.test.ts --coverage.enabled=false
Error: typeFlowCondition is not built yet (flow-spec-logic, Workflow 9A)       x4
Error: evaluateFlowCondition is not built yet (flow-spec-logic, Workflow 9A)   x4
 Test Files  1 failed (1)
      Tests  8 failed (8)
```

### GREEN

- `paths.ts`: `parsePath(text, member = MEMBER)` and `FLOW_PATH_MEMBER` (`/^[\w/-]+$/`); Phase 8's callers pass nothing and keep `MEMBER`.
- `parse.ts`: `Reading` gains an optional `roots`; `readPath` checks them in place of `isPathRoot` when present, with `FLOW_PATH_MEMBER`; `parseCondition`'s body moved into `parseWith` unchanged, and `parseConditionOver(raw, roots)` calls it with the roots.
- `evaluate.ts`: `Walk` gains optional `nulls` and `flow`; `readVariable` records a root path read as null when `nulls` is there; `!==` reads a null operand as unknown when `flow` is set, the explicit `!== null` test still answering; `evaluateFlowExpression(expression, scope)` sets both.
- `flow-condition.ts`: `typeFlowCondition(raw, paths)` builds Phase 8's closed `ScopeType` from the concrete paths (a date typed as its ISO text) and runs `typeCheckCondition`; `evaluateFlowCondition(raw, roots)` parses over the roots' names and answers a value, a `null` with its paths, or an error, never a guess.

One expectation of mine was corrected: Phase 8's read pointers end at the `var` member (`/>/0/var`), not at the operand.

```
$ pnpm exec vitest run --coverage.enabled=false           # the whole workflow-engine package
 Test Files  37 passed (37)
      Tests  1984 passed (1984)                            # Phase 8's suites unchanged
$ pnpm exec eslint src/expressions && pnpm exec tsc --noEmit -p .     # clean
```

## Slice H: the publish-time analyses (C150.3, C150.6, C150.7, C150.9, C150.10, C151.13)

Placeholders first: `v2/analyses.ts` (re-exported from `graph.ts`, since the package index is frozen) with `ConditionTyper` (the shape of the engine's `typeFlowCondition`, injected, as the evaluator is), `FlowConditionPathInput`, `FlowScopeContext`, `PublishAnalysisContext`, `ACKNOWLEDGEMENT_KINDS`, `RequiredAcknowledgement`, `PublishAnalysis`, and the stubs `flowScopeAt` and `analyzeFlowForPublish`. The tests drive them with `v2/test-typer.ts`, a test-only typer with the engine typer's shape and the rules the analyses read (the real one is tested in the engine's own suite and, wired, by `api-templates`).

### RED

```
$ pnpm exec vitest run src/v2/analyses.test.ts --coverage.enabled=false
FlowSpecNotBuiltError: analyzeFlowForPublish is not built yet (flow-spec-logic, Workflow 9A)   x12
FlowSpecNotBuiltError: flowScopeAt is not built yet (flow-spec-logic, Workflow 9A)
 Test Files  1 failed (1)
      Tests  13 failed (13)
```

### GREEN

`flowScopeAt` builds the concrete scope at a step from `FLOW_SCOPE_PATHS`' fixed paths, the version's fields (typed from their field types, `person`), each verification step's outcome paths (non-nullable only where the step dominates), its checks (the enabled ones, else the registry's, with each check's tier and stage), its extractions (`FLOW_SCOPE_EXTRACTIONS`), every registry signal (`client` unless its collection tier is `server`, available only when flow-provisional and collected), and each `run_workflow` step's status, error type and declared outputs. `analyzeFlowForPublish` types each route with the injected typer over that scope, then runs the acknowledgement analyses over the graph model: reachability from a branch for adverse paths, a 0-1 breadth-first count of verifications to a completion for asserted facts, and reachability from the entry avoiding a verification type for unverified paths. Every test passed on the first run; two lint findings were then fixed with the suite green.

```
$ pnpm exec vitest run src/v2/analyses.test.ts --coverage.include='src/v2/analyses.ts'
 analyses.ts |   95.32 |    82.66 |   96.29 |   96.52 |
$ pnpm exec vitest run --coverage.enabled=false        # the whole package
 Test Files  21 passed (21)
      Tests  411 passed (411)
```

Decisions left open, recorded here and in the report: a branch that reads a list counts as adverse (it reads no outcome); a check is "not required" by its configuration, else by the registry default; a check's tier is its tier and its alternate (`R/H`), so an `A/H` or `H` check is heuristic; `asserted-fact:` compares the fewest verifications from the route's target and from `else`'s to any completion; `unverified-path:` asks for every completion that a path reaches avoiding all verifications or avoiding one verification type another path holds (so a version with a fallback or an optional verification needs it in production); C128.4's cases are a read of a selfie step's facts, or (on a template Phase 8's `templateIsBiometric` does not call non-biometric, `null` failing closed) a read of `inquiry.status` or of any check status.

## Slice I: field references, the scope's JSON Schema and the v2 JSON Schema (C149.6, C150.10, C147.1)

### RED

```
$ pnpm exec vitest run src/v2/references-schema.test.ts --coverage.enabled=false
FlowSpecNotBuiltError: fieldReferences is not built yet (flow-spec-logic, Workflow 9A)     x2
FlowSpecNotBuiltError: scopeJsonSchema is not built yet (flow-spec-logic, Workflow 9A)     x2
FlowSpecNotBuiltError: flowV2JsonSchema is not built yet (flow-spec-logic, Workflow 9A)    x2
 Test Files  1 failed (1)
      Tests  6 failed (6)
```

### GREEN

`fieldReferences` walks the steps (bindings, visibility reads of `screen.<field>`, branch reads of `inquiry.fields.<key>`, `prefillFrom`, the actions' mappings and inputs) and then the copy's `{name}` placeholders that name a field referenced elsewhere, with pointers into the version's attributes (`/flow/...`, `/copy/...`). `scopeJsonSchema` nests each path, template segments into `additionalProperties`, a nullable path also taking `null`, each with its `x-openverify` annotation. `flowV2JsonSchema` is `z.toJSONSchema` of `flowV2Schema` with its own id; `scripts/export-json-schema.ts` writes `schema/flow.schema.json` (v1) exactly as before and `schema/flow.v2.schema.json` already formatted through Prettier's API with the repository's settings, so the package script's own Prettier step, which names only the v1 file, needs no change. `stubs.test.ts`, contracts-9a's list of frozen stubs, is now a guard that each of them is built (it was not deleted: rule 2).

```
$ pnpm schema:export
Wrote schema/flow.schema.json
Wrote schema/flow.v2.schema.json
$ cmp schema/flow.schema.json <copy taken before>        # v1 unchanged
$ pnpm exec prettier --check schema/flow.v2.schema.json  # All matched files use Prettier code style!
$ pnpm exec vitest run src/v2 --coverage.enabled=false
 Test Files  15 passed (15)
      Tests  287 passed (287)
```

## Slice J: the 2.2.1 window warning (C147.6, C171.4)

The last warning of C147.6, "a session or inquiry window below 20 hours", reads the version's settings, not the flow, so it is its own function, `checkSettingsWindows(settings)`, with pointers into the settings (`/inquiry-expiration-seconds`). Placeholder first (`SHORT_WINDOW_SECONDS`, 72,000, and the stub).

### RED

```
$ pnpm exec vitest run src/v2/settings-windows.test.ts --coverage.enabled=false
Error: checkSettingsWindows is not built yet (flow-spec-logic): 5
      Tests  1 failed (1)
```

### GREEN

`checkSettingsWindows` warns `window_below_20_hours` for `inquiry-expiration-seconds`, `session-expiration-seconds` and C151.10's after-start and after-resume windows (a one-time link's lifetime is not a window a person lives through).

```
$ pnpm exec vitest run --coverage.enabled=false        # the whole package
 Test Files  23 passed (23)
      Tests  432 passed (432)
```

## Final gates (each exit code read from the command, output in files)

```
$ cat /proc/loadavg                                        # 5.22 6.34 4.72 before, 4.60 6.10 4.68 after
$ pnpm --filter @openverify/flow-spec typecheck            # exit 0
$ pnpm --filter @openverify/flow-spec lint                 # exit 0
$ pnpm --filter @openverify/flow-spec test                 # exit 0, 25 s for the three
 Test Files  23 passed (23)
      Tests  432 passed (432)
All files          |   96.18 |     87.5 |   97.18 |   96.95 |
$ pnpm --filter @openverify/workflow-engine typecheck      # exit 0
$ pnpm --filter @openverify/workflow-engine lint           # exit 0
$ pnpm --filter @openverify/workflow-engine test           # exit 0, 94 s for the three (load 4.60 -> 13.33)
 Test Files  37 passed (37)
      Tests  1984 passed (1984)
All files          |   98.02 |    92.22 |   99.12 |   98.22 |
$ pnpm --filter @openverify/flow-spec schema:export        # exit 0
$ git diff --exit-code packages/flow-spec/schema           # exit 0: the committed output is unchanged
$ pnpm exec prettier --check <every file I committed>      # exit 0
$ pnpm turbo run lint typecheck --force --filter=@openverify/flow-spec --filter=@openverify/workflow-engine
 Tasks:    4 successful, 4 total
Cached:    0 cached, 4 total                               # exit 0, 31 s (load 13.36 -> 9.73)
```

## Handoff

No checkpoint of its own: Stage 3 starts on this record. Everything below is exported from `@openverify/flow-spec`'s root, except the workflow engine's two functions.

- **Walk and outcome** (`v2/next-position.ts`): `nextPosition(flow, scope, from, port, evaluate, options?)` and `resumeAt(flow, scope, stepId, evaluate, options?)` answer `NextPosition` (`step`, `action`, `wait {facts, maxSeconds}`, `terminal {terminal}`, `halted {reason: flow_loop_limit | scope_path_missing | edge_missing}`, each with `taken: RouteTaken[]` (`branchId`, `port`, `onNull`, `nullPaths`, `review`, `notes`)); `NextPositionOptions { visits, moves, waited }`; `FLOW_LOOP_LIMITS` (20, 200); `FLOW_STEP_NOTES`; `flowOutcome(stepRecord, verificationOutcomes, flags)`; `checkScopeStatus(status, reasons)`. The engine writes each `RouteTaken.notes` on the branch's step record, `fallback-continue` on an exhausted exit whose step says `onFallback: "continue"`, and passes `flag_for_review:<code>` in `flags`.
- **The evaluator the server injects**: wrap `evaluateFlowCondition(condition, roots)` of `@openverify/workflow-engine` as a `ConditionEvaluator`: `value` as is; `null` with `paths: nullPaths` and `reviewClass` from Phase 7's `ON_NULL_DEFAULTS` for the null's reason; `error` as a `null` of the review class; `missing` for a read the current scope no longer has (`flowScopeAt` lists what it has).
- **Projection and client view**: `projection(flow, position)` (C151.6, the sixteen goldens byte for byte in compact form), `clientViewOf(step)`.
- **Graph rules**: `checkFlowGraph(flow, { mode, fieldSchemas?, linkFields?, customConsentCopy?, noticeKeys?, checks? })`, `FLOW_GRAPH_PROBLEM_CODES`, `FLOW_GRAPH_WARNING_CODES`, `checkFieldSchemaChanges(fields, published)` (pointers `/<i>/type`, `''`), `MAX_FIELD_SCHEMAS`, `checkSettingsWindows(settings)` (pointers `/<setting>`), `SHORT_WINDOW_SECONDS`, `REVEALING_WORDS`, `canonicalFlowJson`, `canonicalJson`. Pointers are into the flow (`/entry`, `/edges/<i>[/from|/to|/port]`, `/steps/<i>[/components/.../field|pattern|link|visibleWhen...]`, `/steps/<i>/routes/<j>/onNull`, `/steps/<i>/action/fromStep`, `/steps/<i>/prefillFrom[/<input>]`, `''` for the flow); the API prefixes `/data/attributes/flow`.
- **Publish analyses** (`v2/analyses.ts`): `analyzeFlowForPublish(flow, { environment, typeCondition, fieldSchemas?, checks?, signalCollect?, workflowOutputs?, templateIsBiometric? })` answers `problems` (typing: `scope_path_unknown`, `scope_path_unavailable_in_flow`, `signal_wait_missing`, `on_null_missing` at `/steps/<i>/routes/<j>`, the typer's own codes at `/steps/<i>/routes/<j>/condition<pointer>`; production: `decision_basis_missing`, `contest_route_missing`, `biometric_basis_missing`; `consent_key_missing`; sandbox warnings `asserted_fact_route`, `unverified_path_completion`) and `acknowledgements` (`{key, kind, target, pointer, reason}`, kinds `ACKNOWLEDGEMENT_KINDS`). `typeCondition` is `typeFlowCondition` of the engine. `flowScopeAt(flow, stepId, context)` is the concrete scope; `scopeJsonSchema(scope)` its JSON Schema.
- **Migration**: `migrateFlow`, `migrateFlowWithNotes`, `MIGRATION_NOTE_CODES`, `MIGRATED_SUBMIT_LABEL_KEY` (`screen.continue`, which flow-renderer provides in the five locales).
- **Screens**: `checkVisibilityRule`, `evaluateVisibility`, `VisibilityRuleError`, `VISIBILITY_RULE_LIMITS`; `compilePattern`, `matchPattern`, `PATTERN_INPUT_LIMIT`, `PATTERN_SOURCE_LIMIT`, `PATTERN_PROGRAM_LIMIT`, `PATTERN_REFUSAL_REASONS`; `normalizeDigits`; `deviceKindOf`; `fieldReferences({flow, copy})` (pointers `/flow/...`, `/copy/...`); `flowV2JsonSchema`, `FLOW_V2_SCHEMA_ID`.
- **Goldens**: `packages/flow-spec/src/v2/golden/migrations/` (12), `golden/graph/` (49, with `base.json`), `src/v2/pattern/vectors.json` (570 match vectors, 44 refusals; Phase 10's Kotlin port passes the same file), `schema/flow.v2.schema.json`. Writers in `packages/flow-spec/scripts/`.
