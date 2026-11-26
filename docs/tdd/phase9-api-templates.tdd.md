# Phase 9, Workflow 9A, Stage 3: `api-templates` (family T)

Templates, versions, copy and translations on the server: C149.1-C149.3 and C149.5, C153.2-C153.3,
C154, C156.1 and C156.4, C158.2 and C158.4's version members, C161.5's acknowledgement and C162.

Waited for foundation-9a's checkpoints (rule 17): `CHECKPOINT (T) DONE at b391b698`,
`(F) DONE at 4a619111`, `(H) DONE at 1d023c55`, each an ancestor of `HEAD` when read
(2026-11-05T07:03Z). `flow-i18n`'s `pseudo-locale` checkpoint is `8f89bbe8`.

Every command below ran after `source scripts/env.sh`; its exit code is the one recorded.

## Slice 1: the template repositories (C154.1, C154.5, C154.7, C156.4)

Placeholders `ea7100f3` (`chore(db)`); the publish options parameter joined the RED commit so the test
typechecks.

RED (`a7636c09`):

```
$ (cd packages/db && pnpm exec tsc --noEmit -p .)            # exit 0
$ (cd packages/db && pnpm exec vitest run src/repositories/template-records.test.ts --coverage.enabled=false)   # exit 1
     × stores them on a draft, replaces the ones a change sends and keeps the rest
       AssertionError: expected { …(31) } to match object { description: 'First', …(1) }
     × stores the publish note, acknowledgements and last updater with the publish
       FlowRepositoryNotBuiltError: publishInquiryTemplateVersion is not built yet (api-templates)
     × finds the draft, and the newest version in the statuses asked
       FlowRepositoryNotBuiltError: findTemplateDraft is not built yet (api-templates)
     × keeps a template holding only a draft out of the template reads until it is published
       FlowRepositoryNotBuiltError: createInquiryTemplateWithDraft is not built yet (api-templates)
     × records a promote and finds the template it created by the source template
       FlowRepositoryNotBuiltError: findPromotedTemplateId is not built yet (api-templates)
     × writes one per publish, reads it in its environment only and lists newest first
       FlowRepositoryNotBuiltError: latestDeploymentOfTemplate is not built yet (api-templates)
     × seals a user's preset, lists the user's own newest first and deletes only their own
       FlowRepositoryNotBuiltError: createSimulationPreset is not built yet (api-templates)
```

GREEN:

```
$ (cd packages/db && pnpm exec vitest run src/repositories/template-records.test.ts \
    src/phase9a-template-tables.test.ts src/repositories/inquiry-templates.test.ts --coverage.enabled=false)   # exit 0
 Test Files  3 passed (3)
      Tests  19 passed (19)
```

Existing tests changed because the plan changes what they check:

- `repositories/inquiry-templates.test.ts`: a template with no published version is now not served
  (`null`) instead of throwing, because the first promote of C154.5 creates a template that holds
  only a draft.
- `phase9a-template-tables.test.ts` (foundation-9a's): its "(T) repository stubs reject" case is
  removed, since every stub it called is built (the precedent of `efb373d3` for (S)).

## Slice 2: operator copy rules and `COPY_KEYS` (C162.2-C162.4)

Placeholder `copyRuleProblems` (throws `NotImplementedError`) in the RED commit `f60e4ba0`, with
`copy-rules.test.ts` (11 cases) and the `COPY_KEYS` contents test in `copy-keys.test.ts`.

RED:

```
$ (cd apps/api && pnpm exec tsc --noEmit -p .)               # exit 0
$ (cd apps/api && pnpm exec vitest run src/services/templates/copy-rules.test.ts --coverage.enabled=false)   # exit 1
      Tests  11 failed (11)
     10× NotImplementedError: copyRuleProblems is not built yet (api-templates)
      1× AssertionError (normaliseCopy returned the text unnormalised)
$ (cd packages/flow-spec && pnpm exec vitest run src/v2/copy-keys.test.ts --coverage.enabled=false)          # exit 1
     × declares the consent, notice and terminal texts an operator may override, frozen
       AssertionError: expected [] to deeply equal ArrayContaining{…}
```

GREEN (one expectation of the RED test was incomplete: a consent override in sandbox also carries
the `legal_copy_overridden` warning, which C162.2 asks for; added to the expected list):

```
$ (cd apps/api && pnpm exec vitest run src/services/templates/copy-rules.test.ts --coverage.enabled=false)   # exit 0
      Tests  11 passed (11)
$ (cd packages/flow-spec && pnpm exec vitest run src/v2/copy-keys.test.ts --coverage.enabled=false)          # exit 0
      Tests  3 passed (3)
```

Decisions (recorded as amendments in the report): `COPY_KEYS` holds 20 keys (the six consent texts,
the consent title and button, the two notices, the terminal titles, the flow's continue, help,
link, waiting and halted texts); a biometric consent override (`consent.biometric`,
`consent.biometric-matching`, `BIOMETRIC_CONSENT_COPY_KEYS`) must state `{days}`; every other key and
every component text takes `{organization}` only (the overridable button texts none); any component
attribute of C162.2 is accepted on any component of a screen in the flow, an option only by an
option key it has. Problem codes: `copy_key_unknown`, `copy_empty`, `copy_too_long`,
`copy_control_character`, `copy_bidi_override`, `copy_bidi_unbalanced`, `copy_format_character`,
`copy_markup`, `copy_placeholder_invalid`, `copy_placeholder_unknown`,
`consent_copy_missing_placeholder`, `consent_copy_incomplete`, `locale_unsupported`, and the warning
`legal_copy_overridden` (sandbox; production asks `legal-copy:<key>`).

## Slice 3: the `fields` write rules (C149.2, C149.3, C149.5)

RED (`ad00cfcb`, `fields.test.ts`, 7 cases; the stub accepted every write):

```
$ (cd apps/api && pnpm exec tsc --noEmit -p .)    # exit 0
$ (cd apps/api && pnpm exec vitest run src/services/templates/fields.test.ts --coverage.enabled=false)   # exit 1
     × refuses an unknown key with field_unknown at its pointer, never echoing the value   expected 201 to be 422
     × refuses a wrong type, a value past max-length and an unknown choice at their pointers   expected 201 to be 422
     × refuses a change to a write-once value that is set, and accepts it unchanged   expected 200 to be 422
     × refuses fields past 256 KiB with fields_too_large, its size and limit   expected 400 to be 422
     × answers the values to write with strip-html applied, and points into a screen submission   expected undefined …
      Tests  5 failed | 2 passed (7)
```

The 256 KiB case met the contract's 10,000-character value limit first (400); the GREEN commit
spreads the size over 30 values of 9,000 characters so it reaches the rule it tests.

GREEN:

```
$ (cd apps/api && pnpm exec vitest run src/services/templates/fields.test.ts src/routes/server/inquiries.test.ts --coverage.enabled=false)   # exit 0
      Tests  54 passed (54)
```

`validateInquiryFieldsWrite` now answers the values to write (`strip-html` applied); its callers in
shared files (`services/inquiries.ts`) and in other owners' files (`flow-engine/screen-submission.ts`,
`flow-actions/instant-actions.ts`) still write what they passed, so `strip-html` takes effect only once
they write the answer (a contract deviation in the report). New 422 codes beside C174.8's:
`field_type_invalid`, `field_too_long`, `fields_too_many`.

## Slice 4: drafts, members, validation, ETag and `If-Match` (C154.1-C154.3)

RED (`d2c9f8b1`): `routes/server/inquiry-template-drafts.test.ts` (5 cases) and the changed
`inquiry-template-flow-v2.test.ts` (a draft now takes a v2 flow on create and `PATCH`):

```
$ (cd apps/api && pnpm exec tsc --noEmit -p .)    # exit 0
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template-drafts.test.ts src/routes/server/inquiry-template-flow-v2.test.ts --coverage.enabled=false)   # exit 1
     × is taken by a new draft and on a draft, and served as stored          expected 422 to be 201
     × carries its members, validation, flow digest and last updater, and a strong ETag   expected 422 to be 201
     × takes the members a PATCH sends and checks the copy against its locales           expected 422 to be 201
     × answers 422 with every problem at its pointer without meta.allow-invalid           expected 422 to be 201
     × stores the draft with its problems under meta.allow-invalid and serves them       expected 422 to be 201
     × refuses a stale If-Match with 412 and the current ETag, and takes the current one expected 422 to be 201
      Tests  6 failed | 1 passed (7)
```

GREEN (one expectation was too narrow: the default selfie checks are all beta, so a draft carries
C147.6's `verification_all_beta` warning while staying `valid`; the test now asserts no other
problem):

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template src/services/publish src/phase9a-template-plumbing.test.ts src/routes/dashboard/templates --coverage.enabled=false)   # exit 0
 Test Files  15 passed (15)
      Tests  132 passed (132)
```

Built: `services/templates/versions.ts` (`saveRuleProblems`, `validationOf`, `flowSha256Of`,
`versionEtagOf`, `phase9MembersOf`, `storedCopy`, `storedFieldSchemas`), the members on create and
`PATCH` (`membersOf`, copy NFC-normalised, `last-updater` from the principal), the validation and
flow digest stored with every save, `refuseUnlessAllowed` (coherence keeps today's 422, other rules
answer `definition_invalid` or their own template code with every pointer), `If-Match` compared
under the version's row lock (`lockInquiryTemplateVersionInTx`), and the `ETag` header on create,
read, `PATCH` and publish. `requireFlowV1` now guards only template creation and a v2 draft's
publish, until the v2 publish rules land (slice 5). The `If-Match` header is read from the request's
headers (`ifMatchHeadersSchema`, 400 when malformed), so the frozen route schemas do not change; the
OpenAPI document does not list it yet (a deviation for integration-9a).

## Slice 5: the publish rules, acknowledgements, deployments and events (C154.7-C154.9)

RED (`cf60373e`, `routes/server/inquiry-template-publish.test.ts`, 3 cases):

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template-publish.test.ts --coverage.enabled=false)   # exit 1
     × publishes a valid draft, writes one deployment and fires its events       expected 0 to be greater than 0 (no created event)
     × refuses a draft that breaks a v2 rule, with every problem at its pointer  (the v2 guard answered a plain 422, no definition_invalid)
     × names every acknowledgement a publish lacks, and stores them with the user who gave them   expected 422 to be 200
      Tests  3 failed (3)
```

GREEN (the branch case's draft now declares the field its screen binds, `nickname`: the save rule
`field_unknown` refused it, correctly; the PATCH assertion also prints the body):

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template src/services/publish src/phase9a-template-plumbing.test.ts src/routes/server/phase5-publish.test.ts src/flow-actions/grants.test.ts --coverage.enabled=false)   # exit 0
 Test Files  18 passed (18)
      Tests  143 passed (143)
```

Built: `services/publish/flow-v2.ts` (`flowPublishReport`: the save rules, `checkFlowGraph` in publish
mode, `analyzeFlowForPublish` with `typeFlowCondition`, the resolved signal `collect`, the field schemas,
the checks and each `run_workflow` target's outputs; the acknowledgements of the analyses,
`flowActionAcknowledgements`, the copy's `legal-copy` and `locale-unreviewed:<locale>` in production);
in `publishTemplateVersion`: `publishRulesInTx` (every problem refused; each acknowledgement given by a
user, stored as `{ key, acknowledged-by, acknowledged-at }` and written to the audit entry; an API key
gives none), the theme set passed to `publishHookProblems` (`themeSetPublishProblems`), the publish
note, `deployInTx` (one `dply_` per publish superseding the template's last, `deploymentResourceOf`)
and the events `inquiry-template-version.created` (each new draft), `inquiry-template-version.published`
and `deployment.completed`, dispatched after the commit.

## Slice 6: validate, diff, restore, copy, used-by, promote and deployments (C154.4-C154.7)

RED (`c5acf5fa`, `routes/server/inquiry-template-operations.test.ts`, 8 cases; the plumbing test's
frozen list loses the routes this slice builds):

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template-operations.test.ts --coverage.enabled=false)   # exit 1
     × lists and reads the deployments of the caller environment only        501 "Listing deployments is not built yet"
     × runs every rule on an unsaved body without storing it, and on the stored draft   501
     × names the changed step by id and flags a required check made optional  501
     × restores a version as a new draft, and refuses while a draft stands    expected 501 to be 409
     × copies a template into a new one of the given name                    501
     × answers what names the template, counted where the caller cannot read it   501
     × copies a published version as a draft into another environment, users only, never over a draft   expected 501 to be 403
     × refuses a list it cannot find by kind and name in the target, at its pointer   501
      Tests  8 failed (8)
```

(Before the RED commit the test was corrected twice: an organisation holds one environment per kind, so
the promote target is its production environment; `seedList` answers `{ id }`.)

GREEN:

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template-operations.test.ts --coverage.enabled=false)   # exit 0
      Tests  8 passed (8)
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template src/phase9a-template-plumbing.test.ts src/routes/server/deployments src/plugins/openapi --coverage.enabled=false)   # exit 0
 Test Files  11 passed (11)
      Tests  105 passed (105)
```

Built in `services/templates/operations.ts`: `listDeploymentsFor`, `getDeploymentFor`,
`validateTemplateVersion`, `diffTemplateVersions`, `restoreTemplateVersion`, `copyTemplate`,
`templateUsage`, `promoteTemplate`; the routes call them.

## Slice 7: the session's copy and the consent text check (C162.5, C162.6, C162.9)

RED (`bf05cb97`, `services/templates/session-copy.test.ts`, 4 cases; the stubs accepted every body
and answered no copy):

```
$ (cd apps/api && pnpm exec vitest run src/services/templates/session-copy.test.ts --coverage.enabled=false)   # exit 1
     × accepts the built-in biometric matching text at two retention values, and refuses another   promise resolved "undefined" instead of rejecting
     × accepts a custom override with {days} filled, and refuses the built-in words as custom       promise resolved "undefined" instead of rejecting
     × carries the enabled locales' overrides and the current step's component texts only           expected null to deeply equal { messages: … }
      Tests  3 failed | 1 passed (4)
```

GREEN:

```
$ (cd apps/api && pnpm exec vitest run src/services/templates/session-copy.test.ts --coverage.enabled=false)   # exit 0
      Tests  4 passed (4)
$ (cd apps/api && pnpm exec vitest run src/routes/flow/consent src/phase9a-template-plumbing.test.ts src/routes/flow/session --coverage.enabled=false)   # exit 0
 Test Files  7 passed (7)
      Tests  86 passed (86)
```

`resolveCopyForSession` (C162.6) keeps, per enabled locale, the `COPY_KEYS` overrides and the keys of
the current step (`<step id>.`); texts are sent unfilled. `checkConsentTextsInTx` (C162.9) reads the
version, the environment's face-template retention (`days`) and `organization-display-name`, and
compares each digest (in `text-keys` then `optional-text-keys` order) with the custom text
(`{name}` filled) and every released built-in text of the key and base locale in
`contracts/fixtures/i18n/consent-texts.json` (`{{name}}` filled), NFC-normalised; a body without
digests is accepted (recorded `null` by the consent path), any other mismatch is 422
`consent_text_mismatch`.

## Slice 8: translations, JSON and CSV (C162.7)

RED (`d5061eb2`, `routes/server/inquiry-template-translations.test.ts`, 5 cases; the plumbing test's
translation routes leave the frozen list, and its policy case reads a 200):

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template-translations.test.ts --coverage.enabled=false)   # exit 1
     × reads every text of the latest draft with its locale values                          501 "Reading translations is not built yet"
     × imports into the draft partially, deletes nothing for a blank, and creates a draft when none   501
     × refuses a text that breaks a copy rule at its row and column, never echoing it       expected 501 to be 422
     × round-trips a text that starts with = or - unchanged, every cell quoted              501
     × refuses a file with a column it does not know, naming the column and no value       expected 501 to be 422
      Tests  5 failed (5)
```

GREEN:

```
$ (cd apps/api && pnpm exec vitest run src/routes/server/inquiry-template-translations.test.ts src/phase9a-template-plumbing.test.ts --coverage.enabled=false)   # exit 0
      Tests  18 passed (18)
```

Built: `services/templates/translations.ts` (`readTranslations`, `importTranslations`,
`translationsCsv`, `importTranslationsCsv`). Rows are the version copy's keys in key order: a built-in
key has no step or component; a component key `<step>.<component>.<attribute>` names its step's
display name. A CSV is refused whole on any parser or header problem (`missing_column`,
`unknown_column` and the reader's codes), each named `/rows/<line>/<column>` without a value; a JSON
cell's refusal points at `/data/attributes/translations/<i>/locale-values/<j>/value`.

## Not built in this run

These parts of the bullet are not built; their routes still answer 501 (the plumbing test pins them):

- **Simulate and the presets (C156.4)**: `POST /inquiry-template-versions/:id/simulate` and the
  dashboard `simulation-presets` routes. The repository (`createSimulationPreset`,
  `listSimulationPresets`, `getSimulationPreset`, `deleteSimulationPreset`, sealed scope) is built
  (slice 1). What remains: the simulated scope assembled into the engine's roots, each verification's
  status from `decideVerification` (`packages/core/src/decision-engine.ts`) over the per-check
  overrides, the walk through `nextPosition`/`resumeAt` with `flowConditionEvaluator`
  (`apps/api/src/flow-engine/evaluator.ts`), and `flowOutcome`; the built-in passing and failing preset
  per verification type.
- **Preview (C156.1)**: `POST /inquiry-template-versions/:id/preview` with `pseudoLocalizeTree`
  (`flow-i18n`'s checkpoint `pseudo-locale` at `8f89bbe8` is in place).
- **The (F) version members (C158.2, C158.4)**: `embed-origins` as a subset of the environment's
  `allowed-embed-origins` and `redirect-uri`/`redirect-uri-schemes` checked through
  `services/embed-origins.ts`. They are stored and served as sent, unchecked.
- **Template creation with a flow-spec 2 flow**: `POST /inquiry-templates` still takes a v1 flow only
  (`requireFlowV1`), since its version 1 is published at once and takes no acknowledgements.

## Final gates (each read from its exit code; another agent's suites ran beside them)

| Gate | Result | Time | Load (1 min) |
|---|---|---|---|
| `flock … pnpm install --frozen-lockfile` | exit 0 | | 16.25 |
| `pnpm exec prettier --check --ignore-path=.gitignore` on the 31 files I changed | exit 0 | | |
| `pnpm turbo run lint typecheck --force --concurrency=2 --filter=@openverify/db --filter=@openverify/flow-spec` (4 GB heap) | exit 0, 4 of 4 tasks | 2 m 22 s | 16.25 |
| `pnpm turbo run lint typecheck --force --concurrency=2 --filter=@openverify/api` (4 GB heap) | exit 0, 2 of 2 tasks | 5 m 42 s | 13.00 |
| `pnpm turbo run test --force --filter=@openverify/flow-spec --filter=@openverify/db` | exit 0: flow-spec 432 tests, 96.27% statements; db 2,057 tests, 92.61% | 4 m 4 s | 13.29 |
| API, blob shards 1-4 (each exits 1 on its partial coverage, as expected) | 302, 261, 224, 210 s | | 19.35, 7.61, 8.12, 7.29 |
| API, `--merge-reports` (the gate) | exit 0: 618 files, 8,536 tests, 94.32% statements, 84.78% branches | 15 s | 8.43 |
| `pnpm --filter @openverify/db test:integration` | exit 0, 78 tests | 82 s | 5.28 |
| `--project graph` | exit 0, 13 tests | 33 s | 13.65 |
| `--project api --shard=1/3`, `2/3`, `3/3` | exit 0: 81, 97, 76 tests | 56, 154, 69 s | 8.94, 13.52, 6.98 |

The watchlist benchmark's checks were not run: no file rule 16 names changed (`packages/db/src/index.ts`
and `testing.ts` are untouched).
