# Format, versions and migration (plan C147)

`@openverify/flow-spec` exports one strict zod schema per version: `flowV1Schema` (Phase 1's `flowSchema`, unchanged) and `flowV2Schema`. `FLOW_SPEC_VERSIONS` is `[1, 2]`, and `parseAnyFlow` / `safeParseAnyFlow` dispatch on `metadata.specVersion`. `pnpm --filter @openverify/flow-spec schema:export` writes `schema/flow.v1.schema.json` and `schema/flow.v2.schema.json`, so other tools can validate documents of either version.

## The v2 document

```json
{
  "metadata": { "specVersion": 2, "id": "kyc-standard", "version": 3, "name": "KYC standard" },
  "entry": "consent",
  "steps": [
    { "id": "consent", "type": "consent", "textKeys": ["consent.biometric"], "required": true },
    { "id": "id_card", "type": "government_id", "sides": "both", "maxAttempts": 3, "captureMethods": ["camera"] },
    { "id": "done", "type": "completion" }
  ],
  "edges": [
    { "id": "e1", "from": "consent", "port": "next", "to": "id_card" },
    { "id": "e2", "from": "id_card", "port": "next", "to": "done" }
  ],
  "layout": { "consent": { "x": 0, "y": 0 } }
}
```

- Step and edge ids match `^[a-z][a-z0-9_-]{0,63}$`, are unique, and stay stable across versions: they key the diff, the step record and the scope paths (`verifications.id_card.status`). **Step ids are visible to the person** (the session names the current step) and to operators, so the builder generates opaque ids and keeps names apart; publish warns when a person-visible id holds a revealing word (`pep`, `sanction`, `fraud`, `risk`, `watchlist`, `flag`).
- Steps run only along edges; list order is the outline's display order and nothing more.
- Member names stay camelCase, as in v1, so every v1 step schema is reused.

## Caps (ours, provisional)

`FLOW_V2_CAPS` (`packages/flow-spec/src/v2/schemas/common.ts`) bounds the counts: 200 steps, 400 edges, 20 routes per branch, 40 components per screen (nested ones counted) and containers nested at most 3 deep, 1,000 template fields. The graph rules bound the bytes: a step's serialised config at most 16 KiB, a whole flow at most 512 KiB. Each is ours (the public plans' caps are not), with its basis beside it in the code.

## Graph rules (C147.6)

`checkFlowGraph(flow, options)` runs after the schema, on save, validate, publish and promote. A problem is `{ pointer, code, detail, severity }` with an RFC 6901 pointer into the flow, which the API prefixes with `/data/attributes/flow`. The rules: the entry and every edge endpoint exist; every port is valid for its step's type and wired where required; every step is reachable and reaches a terminal step; a cycle only through `screen` and `branch` steps; at most one step per verification type; the order rules of v1 on every path (`nfc` after a `selfie`, an `aamva` reading a `government_id` after it); **a consent step dominates every step that uploads data**, a screen bound to a PII field included (a screen showing a legal notice satisfies it for itself). Warnings never block: a verification whose required checks are all `beta`, a path to a completion through no verification, two steps collecting the same value without `prefillFrom`, a window below 20 hours (WCAG 2.2.1). The codes are `FLOW_GRAPH_PROBLEM_CODES` and `FLOW_GRAPH_WARNING_CODES` in `@openverify/flow-spec`, beside the contracts' `FLOW_DEFINITION_PROBLEM_CODES`; a draft stores its problems, and publish refuses them (`definition_invalid`).

## The hash

`flow-sha256` is the SHA-256 of the RFC 8785 canonical JSON (`canonicalFlowJson`) of everything but `layout`, so moving a node on the canvas changes nothing a reviewer must read again.

## Versions are never rewritten

A stored template version is never migrated in place. The API reads a v1 version as it was stored; every new draft may be v2; a v1 draft opened in the builder (Workflow 9C) is migrated and saved as v2 with its notes. A flow-spec 1 version keeps serving its stored v1 flow to every client (see [the engine](engine.md)).

## The migration from v1 (C147.10)

`migrateFlowWithNotes(flow)` answers `{ flow, notes[] { pointer, code, detail } }`, lossless and golden-tested on every v1 fixture of the repository (`packages/flow-spec/src/v2/golden/migrations/`). Each v1 step keeps its id. The conditional transitions listed before a step's first unconditional transition become a `branch` step `<step>-routes` whose routes (`r1`, `r2`, ... labelled "Transition <n>") are those transitions in order, with `else` the first unconditional transition or the next step in list order; transitions v1 never reached are dropped with a note. A last step that is not terminal gets a synthetic `completion`. **Conditions keep v1's meaning:** a path outside v1's context becomes the literal `null` (v1's `readVar` fallback), and every sub-condition that reads no `inquiry.status` is folded to its v1 value (`condition_folded`), because the strict dialect reads a `null` under `!`, `and` or `or` as unknown where v1 read it as falsy. A v1 `form` becomes a `screen` with the matching components and a submit button (`continue`, copy key `screen.continue`). An equivalence test runs every stored v1 fixture through a copy of the v1 walk and through the migrated v2 engine and requires the same path and outcome. The note codes are `MIGRATION_NOTE_CODES`. A migrated draft that puts a verification before consent is refused at publish by the consent rule above (it already failed at run time).

A v1 form field's `pattern` keeps its `new RegExp` check in v1 only; v2 patterns run on the linear-time matcher (see [steps](steps.md)).
