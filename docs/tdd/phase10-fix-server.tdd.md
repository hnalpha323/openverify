# Phase 10, Workflow 10D Stage 4: fix-server

Agent: fix-server (Claude Code, claude-fable-5-2), 2026-11-11 to 2026-11-12, beside fix-sdk.
Paths: `apps/api/`, `packages/`, `apps/flow/`, `services/vision/`, `e2e/`, `contracts/fixtures/`, `apps/dashboard/`.
Items: the review's HIGH finding A001, and the known items KP10-39 and KP10-40.
No route schema, fixture, vector export, dependency or migration changed; `docs/api/openapi.json` is unchanged.

| Item    | Commits                                               | Result                                                                   |
| ------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| A001    | RED `31e17e3ad`, GREEN `4f67a0ea3`                    | fixed                                                                    |
| KP10-39 | test `d58f7b346`                                      | pinned; the behaviour is stronger than the item read (one file per kind) |
| KP10-40 | stubs `272b817f2`, RED `bac40ce93`, GREEN `38e80cc75` | done, no new dependency                                                  |

Every command below ran from the repository after `source scripts/env.sh`; outputs are abbreviated.

## 1. A001 (HIGH): the notice naming Google was enforced only at publish

**The defect, as read in the code.** `integrityRequested` (`apps/api/src/services/device-integrity/challenges.ts`), the one rule behind the session's `integrity.request` and `POST /flow/integrity-challenges`, asked for a token whenever a `deviceIntegrity` provider was bound and the consent had shown `notice.session-integrity`. `notice.play-integrity` was read only by the publish analysis, which is skipped while no provider is bound and never runs on a v1 flow. A version published before the provider was bound therefore sent a request to Google without the notice that names Google.

**RED.** Three unit cases in `apps/api/src/routes/flow/integrity.test.ts` and a new Testcontainers file, `apps/api/src/services/device-integrity/notice-at-runtime.integration.test.ts` (two installs over one database: one with no provider, one that binds it).

```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/integrity.test.ts --coverage.enabled=false)
 × never asks a session whose consent did not show the notice naming Google (A001)
   AssertionError: expected { inquiry: {…}, … } to match object { integrity: { request: false } }
 × answers 409 and stores no challenge, whatever the session read said
   AssertionError: expected 201 to be 409
      Tests  2 failed | 11 passed (13)

$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts \
     --project api src/services/device-integrity/notice-at-runtime.integration.test.ts)
 × is never asked for a token once the provider is bound
   -     "request": false,
   +     "request": true,
      Tests  1 failed | 1 passed (2)
```

The integration case first shows the order of events: the publish report passes the version with nothing bound and refuses it (`play_integrity_notice_missing`) once bound, and the unbound install serves no `integrity` member.

**GREEN.** `IntegrityRequestQuery` gains `playIntegrityNotice`; `integrityRequested` answers false without it. The challenge route reads it from the consent the session relies on (`sessionIntegrityConsent`), and the session read passes the same consent's text keys to `integritySessionMember` (`consentTextKeys`, from `services/flow.ts`). `playIntegrityNoticeShown(textKeys)` is the one test of the key. No route schema or wire member changed.

```
$ (cd apps/api && pnpm exec vitest run src/routes/flow/integrity.test.ts src/routes/flow/integrity-request-fixtures.test.ts \
     src/routes/flow/integrity-session-member.test.ts src/routes/integrity-routes.test.ts src/jobs/integrity \
     src/jobs/signals/device-integrity-hook.test.ts src/services/device-integrity src/routes/flow/session.test.ts --coverage.enabled=false)
 Test Files  9 passed (9)
      Tests  72 passed (72)

$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/device-integrity/)
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

**Existing tests changed (the behaviour they check changed).** `routes/flow/integrity.test.ts`: the default consent of a session that is asked now shows both notices (`ASKED`). `routes/flow/integrity-request-fixtures.test.ts`: `NOTICE_KEYS` gains `notice.play-integrity`. No assertion was removed.

**What it does not do.** It does not re-validate published versions when a provider is bound: such a version keeps working and is simply never asked for a token, so its Play Integrity signals have no verdict to read, as for any session that sent no token. An operator who wants tokens republishes with the notice, which publish already requires.

## 2. KP10-39: a chip file kind uploaded twice

**What the code does (read first).** The item's hypothesis was that one verification can hold two files of a kind and `latestChipFile` picks the last. It cannot hold two: `files` has the unique index `files_environment_id_verification_id_kind_key`, and every upload goes through `replaceVerificationFile` (`packages/db/src/repositories/files.ts`), which locks the verification, deletes the earlier row of the kind and inserts the new one in one transaction. The upload route then deletes the replaced object from storage (`services/flow.ts`, best effort). `latestChipFile`'s "last of a kind" therefore always sees one file.

**The pin.** Three cases at the end of `apps/api/src/services/nfc-10c.integration.test.ts` (Testcontainers, the real upload and submit routes, the real C62 checks):

- an altered read (`tampered-dg1`) uploaded without a submit, then a sound read (`match`) under a fresh challenge, uploaded and submitted: one `chip-dg1` row, the second read's SHA-256, a new file id, the first object gone from storage, the verification `passed` with Passive Authentication `established`;
- the other way round (`match`, then `tampered-dg1`): `failed` with `dg_hash_mismatch`;
- a second `chip-dg1` row inserted beside the first is refused by the unique index.

```
$ (cd apps/api && bash /tmp/openverify-heavy.sh pnpm exec vitest run --config vitest.integration.config.ts --project api src/services/nfc-10c.integration.test.ts)
 Test Files  1 passed (1)
      Tests  17 passed (17)        # 14 before
```

It passed at once, so two negative controls were run on the working tree and restored (never committed):

| Control           | Change                                                                        | Result                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1, the item's own | `latestChipFile` takes `.at(0)`                                               | 17 passed: the choice is immaterial, because a kind never has two rows                                                              |
| 2                 | `replaceVerificationFile` keeps the first file of a kind and drops the second | 2 failed (both "is replaced" cases; `PermanentJobError: The job cannot succeed (file_missing)` at `processVerification`), 15 passed |

So the property is held by the replacement, and the test fails when the first upload wins.

**Retention.** The superseded file never reaches the C16 pass: its row is deleted in the upload's transaction and its object right after the commit, and the retention pass (`packages/db/src/repositories/retention.ts`, `listInquiriesDueForRetention`, then the redaction of the inquiry's listed files) works from rows. If that best-effort object delete fails, ciphertext stays in the bucket with no row; its data key went with the row, so it cannot be read, and no pass sweeps it. Every replaced upload of any kind behaves this way; no behaviour was added here. It is reported as a Phase 11 note.

## 3. KP10-40: a prehashed signer in `@openverify/emrtd/testing`

**No new dependency.** `@noble/curves` (catalog, already `@openverify/emrtd`'s dependency and what `testSign` uses) signs a digest with `prehash: false`.

**Stubs** (`272b817f2`): `ecdsaSignDigest(curve, scalar, digest, encoding)` and `testSignDigest(key, digest, scheme)` in `packages/emrtd/src/testing/keys.ts`, the second exported from the testing index; both threw.

**RED** (`bac40ce93`). `packages/emrtd/src/testing/sign-digest.test.ts`: RFC 6979's published signatures for P-256 (A.2.5, "sample" and "test") and P-384 (A.2.6, "sample") with `s` in its lower form; `node:crypto`'s `verify` over the message as the independent check; equality with `testSign` on all seven test curves, plain and DER; the refusals. `apps/api/src/services/sandbox-chip.test.ts`: the route's response equals the test chip's own answer to the nonce, and the module exports no signer.

```
$ (cd packages/emrtd && pnpm exec vitest run src/testing/sign-digest.test.ts --coverage.enabled=false)
 × gives RFC 6979’s signature of { curve: 'P-256', … } over the hash of "sample"      Error: not built: P-256 32 32 plain
 × signs a P-256 key’s digest as testSign signs the message, plain and DER           Error: not built: sign-digest/P-256 32 plain
 …
      Tests  13 failed | 1 passed (14)

$ (cd apps/api && pnpm exec vitest run src/services/sandbox-chip.test.ts --coverage.enabled=false)
 × signs through the prehashed signer of the test chips, with no signer of its own (KP10-40)
   AssertionError: expected 'aAcq…' to be 'HsxV…'
      Tests  1 failed | 21 passed (22)
```

**GREEN** (`38e80cc75`). `ecdsaSignDigest` is the one call into the library, and `testSign` now goes through it. `testSignDigest` refuses a key that is not an EC test key and a digest of another length (`RangeError`). `services/sandbox-chip.ts` takes `testSignDigest` from the same lazy import as the chip builder and signs the stored nonce digest with `{ ec: 'plain', hash: 'sha256' }`; `signNonceDigest`, `modPow`, the P-256 order and the `createECDH`/`createHmac` imports are deleted.

```
$ (cd packages/emrtd && pnpm exec vitest run src/testing --coverage.enabled=false)
 Test Files  5 passed (5)
      Tests  74 passed (74)
$ (cd apps/api && pnpm exec vitest run src/services/sandbox-chip.test.ts src/services/sandbox-chip-isolation.test.ts \
     src/routes/flow/government-id-nfc-submit.test.ts --coverage.enabled=false)
 Test Files  3 passed (3)
      Tests  35 passed (35)
```

The signer stays test and sandbox support: `sandbox-chip-isolation.test.ts` (unchanged, green) still shows that building the API and serving a production environment never load `@openverify/emrtd/testing`. The response's bytes changed (another per-signature secret); it verifies as before, and the five sandbox scenarios and `e2e/tests/flow-nfc-android.spec.ts` are green unchanged.

One note on the vectors: the library writes `s` as the lower of `s` and `n - s`. For A.2.5 "sample" the published `s` is the higher one, so the test compares against `n - s`, computed in the test from the published value and the curve's order; `r` is compared as published.

## 4. Final gates

Run beside fix-sdk; heavy calls through `/tmp/openverify-heavy.sh` (slots 1 to 3, no wait observed). Each line is the command's own exit status.

| Gate                                                                                                   | Result                                                    | Time, load                                            |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------- |
| `pnpm exec prettier --check --ignore-path=.gitignore` on every file touched                            | exit 0                                                    |                                                       |
| `pnpm --filter @openverify/emrtd typecheck`, `lint`                                                    | exit 0, exit 0                                            | 3 s, 10 s                                             |
| `pnpm --filter @openverify/emrtd test` (as `vitest run --coverage`)                                    | exit 0: 332 tests in 19 files, 95% statements             |                                                       |
| `pnpm --filter @openverify/api typecheck`                                                              | exit 0                                                    | 85 s, load 6.8                                        |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter @openverify/api lint`                            | exit 0                                                    | 202 s                                                 |
| API unit suite, 12 blob shards and the merge                                                           | merge exit 0: 9,677 tests in 726 files, 94.41% statements | shards 96 to 153 s, merge 51 s, load 9.6 to 14.3      |
| `pnpm --filter @openverify/db test:integration`                                                        | exit 0: 83 tests in 19 files                              | 119 s                                                 |
| API integration, `--project graph`                                                                     | exit 0: 13 tests                                          | 55 s                                                  |
| API integration, `--project api --shard=1/3`, `2/3`, `3/3`                                             | exit 0 each: 99, 103 and 107 tests (309)                  | 107, 170 and 89 s, load 9.7 to 14.5                   |
| `pnpm --filter @openverify/api openapi:write`                                                          | exit 0, `docs/api/openapi.json` unchanged                 | 22 s                                                  |
| Full-stack, one call on a fresh stack: `tests/device-integrity.spec.ts tests/flow-nfc-android.spec.ts` | exit 0: 5 passed (48.7 s)                                 | 175 s with build, up and down, no lock wait, load 9.9 |

The API unit count is 9,673 + 4 (three A001 cases and one KP10-40 case); the API integration project is 304 + 5 (two A001, three KP10-39). A lone unit shard exits 1 on partial coverage, as rule 8 says; the merge is the gate.

Not run, by the parallel-gates rule: the e2e gate, the mocked flow suite (no file of `apps/flow` or `packages/ui` changed), the vision suite (untouched) and other packages' suites.
