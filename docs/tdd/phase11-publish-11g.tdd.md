# Phase 11, Workflow 11G: publish-11g (Q1-Q4; C262, C267.1's publish job, C285, C277.1)

Stage 2, beside codeql-11g and records-11g. Base `9003bc311`, start `4b3a06a0f`; contracts-11g's last
checkpoint `37e4f8922`. The gate's scope (contracts-11g, Stage 1a amendment 4): images-and-chart
(Q2), sign-keyless (Q3 keyless), attestations (Q1 public at the release, with Q3) and npm (Q4,
provenance on the public repository). sign-key is not in scope: no key path and no secret name.

Nothing here was published, pushed, signed, attested, dispatched or changed in a repository
setting. Every command below ran on this host; `cosign sign`, `cosign attest`, `docker push`,
`helm push`, `pnpm publish` without `--dry-run` and the attestation action were never run (rule 2):
they are shown, never executed.

## 0. What the publish job was at the start (`release.yml:622-695` at `2002ecc05`, unchanged to `37e4f8922`)

- `if: vars.OPENVERIFY_PUBLISH == 'true'`, `environment: release`, `needs: stage`, job permissions
  `contents: read`, `id-token`, `packages` and `attestations: write`; it downloaded the staged
  images and files, refused a `-pending-owner` file, installed cosign and Helm, loaded, tagged,
  pushed, signed (keyless) and attested (CycloneDX) each image by the digest the push returned,
  pushed the chart to `oci://ghcr.io/<owner>/charts`, and attested build provenance over
  `staged/SHA256SUMS`; npm ended in a notice ("waits for Q4").
- Missing (inventory section 7.2): a `dry-run` input, a main check on the publish job itself, the
  npm publication; also found here: no check that the downloaded files are the staged bytes
  (`SHA256SUMS`) or that a loaded image is the image the build recorded (`IMAGE-IDS.txt`), no
  provenance for the registry digests (only for the files), the GitHub token in the job's env for
  every step, and no concurrency group of its own.

## 1. Sub-parts images-and-chart, sign-keyless, attestations, npm: RED

The RED test is `infra/tests/release-workflow.test.sh` extended (its publish section and the new "publish, run" section, which executes the publish job's run steps in order with stub docker, cosign, helm, pnpm and corepack over a synthetic staged tree, offline). The workflow was not yet changed.

```
$ bash infra/tests/release-workflow.test.sh   # exit 1
FAIL - the dispatch has a dry-run input, a boolean that defaults to true, so a dispatch is a dry run unless it says false (Workflow 11G) ({})
FAIL - the dispatch takes the version and dry-run, and nothing else (['version'])
FAIL - stage: the notes say network data is the operator's own sync and that verify searched every artifact for the files that must never ship (ADR 0006; Workflow 7A)
FAIL - stage: the notes say the staged files stay unsigned and what the first approved publication signs, never that it happened (rule 10)
FAIL - publish: its own concurrency group, never cancelled, so two publishes never overlap ({})
FAIL - publish: its first step refuses any ref but main, before anything is downloaded (its own branch check)
FAIL - publish: DRY_RUN comes from the dry-run input, and the job holds no token in its env (['GH_TOKEN', 'REGISTRY_OWNER', 'VERSION'])
FAIL - publish: every dry-run test compares with false, so anything but an explicit false is a dry run (fail closed) ([])
FAIL - publish: the token reaches only the steps that log in to the registry ([])
FAIL - publish: every staged file is checked against SHA256SUMS before anything is pushed (the staged bytes, never a rebuild)
FAIL - publish: each loaded image must be the image the build job recorded (IMAGE-IDS.txt) before it is tagged or pushed
FAIL - publish: cosign signs keyless (no key, no key secret) and only by digest: sign, then attest the image's CycloneDX SBOM (sign-keyless; sign-key not in scope) (['cosign sign --yes "$repository@$digest"', 'cosign attest --yes 
FAIL - publish: the chart is pushed as an OCI artifact from its staged package (helm push of the .tgz)
FAIL - publish: build provenance by actions/attest-build-provenance over every staged file and over every pushed digest, only when dry-run is false (attestations) ([(None, {'subject-checksums': 'staged/SHA256SUMS'})])
FAIL - publish: in a dry run a step says what the provenance would cover
FAIL - publish: Node for pnpm is the images' version, with no package-manager cache ([])
FAIL - publish: npm: each staged tarball is published by pnpm with provenance and public access (npm trusted publishing, no stored token; Q4, C285, Stage 1a amendment 5)
FAIL - publish: npm: each tarball's manifest is checked and dry-run published with no OIDC token reachable, before anything is pushed
FAIL - publish, run: a dry run logs in nowhere, pushes nothing, signs and attests nothing (['docker login ghcr.io -u example-actor --password-stdin [oidc=set]', 'docker push ghcr.io/example-owner/openverify-api:0.1.0 [oidc=set]', 
FAIL - publish, run: a dry run calls pnpm publish only with --dry-run, once per tarball, with no OIDC token reachable ([])
FAIL - publish, run: a dry run prints what it would push for each image and the chart (
FAIL - publish, run: it records every pushed digest (six images and the chart) for the provenance step ([])
FAIL - publish, run: it publishes each staged npm tarball once with provenance and public access, through the job's OIDC token, after the images and the chart ([])
FAIL - publish, run: a dispatch from another branch stops the job before anything is pushed, signed or published (None: ['docker login ghcr.io -u example-actor --password-stdin [oidc=set]', 'docker push ghcr.io/example-owner/openv
FAIL - publish, run: a staged file changed after SHA256SUMS stops the job before anything is pushed, signed or published (None: ['docker login ghcr.io -u example-actor --password-stdin [oidc=set]', 'docker push ghcr.io/example-own
FAIL - publish, run: an image that is not the one the build recorded stops the job before anything is pushed, signed or published (None: ['docker login ghcr.io -u example-actor --password-stdin [oidc=set]', 'docker push ghcr.io/ex
FAIL - the three published packages name one GitHub repository, as git+https URLs with their own directory (npm provenance) ({'@openverify/js': (None, None, False), '@openverify/node': (None, None, False), '@openverify/react': (No
FAIL - the packages' repository is this checkout's GitHub repository (None vs hnalpha323/openverify)
# 113 passed, 28 failed, 0 skipped
```

Each failure is the missing wiring itself: no `dry-run` input; no main check, concurrency group, SHA256SUMS or image-id check; the token in the job env; the npm step a notice; and the simulated dry run (dry-run true) logged in, pushed, signed and attested (`docker login`, `docker push`, `cosign sign` and `cosign attest` recorded by the stubs), because nothing read the input. The three manifests have no `repository` field, which npm provenance checks.

## 2. GREEN (checkpoint 1: the workflow)

`.github/workflows/release.yml`: the `dry-run` input (boolean, default true); the stage job's
notes say the staged files stay unsigned, what the first approved publication does and that network
data is the operator's own sync, and its notice names the dry-run value (minimal named edits); the
publish job rewritten as section 4 of the handoff lists. Borrowed edits:
`packages/{node,sdk-js,sdk-react}/package.json` gain `repository` (`git+https://github.com/hnalpha323/openverify.git`
with each package's `directory`), which the pack tool keeps (`KEPT_FIELDS`) and npm's provenance
checks against the repository that built the package.

A first GREEN run failed two checks: the image check and the login sat in one step, so a wrong
image id was found only after `docker login` (the simulated run recorded the login). The image
load and id check became its own step before any login; then:

```
$ bash infra/tests/release-workflow.test.sh   # exit 0
ok   - the dispatch has a dry-run input, a boolean that defaults to true, so a dispatch is a dry run unless it says false (Workflow 11G)
ok   - it names no secret (the publish job signs keyless through its OIDC token)
ok   - verify: gitleaks keeps the repository's rules and adds one entry, the base image's public GPG_KEY fingerprint, only inside an image archive's blob (both conditions)
ok   - publish: its own concurrency group, never cancelled, so two publishes never overlap
ok   - publish: its first step refuses any ref but main, before anything is downloaded (its own branch check)
ok   - publish: DRY_RUN comes from the dry-run input, and the job holds no token in its env
ok   - publish: every staged file is checked against SHA256SUMS before anything is pushed (the staged bytes, never a rebuild)
ok   - publish: each loaded image must be the image the build job recorded (IMAGE-IDS.txt) before it is tagged or pushed
ok   - publish: cosign signs keyless (no key, no key secret) and only by digest: sign, then attest the image's CycloneDX SBOM (sign-keyless; sign-key not in scope)
ok   - publish: the chart is pushed as an OCI artifact from its staged package (helm push of the .tgz)
ok   - publish: build provenance by actions/attest-build-provenance over every staged file and over every pushed digest, only when dry-run is false (attestations)
ok   - publish: npm: each staged tarball is published by pnpm with provenance and public access (npm trusted publishing, no stored token; Q4, C285, Stage 1a amendment 5)
ok   - publish: npm: each tarball's manifest is checked and dry-run published with no OIDC token reachable, before anything is pushed
ok   - publish, run: a dry run passes every step
ok   - publish, run: a dry run logs in nowhere, pushes nothing, signs and attests nothing
ok   - publish, run: a dry run calls pnpm publish only with --dry-run, once per tarball, with no OIDC token reachable
ok   - publish, run: a dry run prints what it would push for each image and the chart
ok   - publish, run: a publication passes every step
ok   - publish, run: it pushes each staged image once, with its version tag
ok   - publish, run: it signs and attests each pushed image by the digest the push returned, never by tag
ok   - publish, run: it pushes the staged chart package to the owner's OCI charts path
ok   - publish, run: it records every pushed digest (six images and the chart) for the provenance step
ok   - publish, run: it publishes each staged npm tarball once with provenance and public access, through the job's OIDC token, after the images and the chart
ok   - publish, run: a dispatch from another branch stops the job before anything is pushed, signed or published
ok   - publish, run: a staged file changed after SHA256SUMS stops the job before anything is pushed, signed or published
ok   - publish, run: a pending-owner artifact stops the job before anything is pushed, signed or published
ok   - publish, run: an image that is not the one the build recorded stops the job before anything is pushed, signed or published
ok   - the three published packages name one GitHub repository, as git+https URLs with their own directory (npm provenance)
ok   - the packages' repository is this checkout's GitHub repository
ok   - actionlint reports no problems
ok   - zizmor finds nothing at medium or above
# 141 passed, 0 failed, 0 skipped
$ bash infra/tests/supply-chain-skeletons.test.sh   # exit 0
# 114 passed, 0 failed, 13 skipped
$ bash infra/tests/ci-workflow.test.sh   # exit 0
# 548 passed, 0 failed, 0 skipped
$ pnpm --filter @openverify/node test; ... @openverify/js; @openverify/react; @openverify/config   # each exit 0
node 508 tests (98.48% lines); js 19; react 55 (96.18%); config 459 (97.22%)
```

Gate: affected scope (rule 21 for a Stage 2 part, rule 22's checkpoint): the three contract tests
that read release.yml, the test scripts of the three packages whose manifests changed and of
@openverify/config (its workspace-conventions test reads every manifest), and prettier over the
four files.

## 3. The publish switch, the page and the notes: RED

`packages/docs-tools/src/selfhost/checks.test.ts` (this area's): once `publishWired` is on, the page
must give `cosign verify` and `cosign verify-attestation --type cyclonedx` with the release
workflow's certificate identity (`https://github.com/<repository>/.github/workflows/release.yml@refs/heads/main`,
the repository the three published manifests name) and GitHub's OIDC issuer, `gh attestation
verify` with `--repo`, `npm audit signatures`, and the statements that staged workflow artifacts
are unsigned, that signatures exist from the first approved publication on and, until it, that no
artifact is signed (rule 10); the switch may be on only while release.yml holds every wired
sub-part; an ungated job fails in both modes; and the committed switch is on with the committed page
passing. `packages/docs-tools/src/release/notes.test.ts` (a named borrowed edit): with the switch on,
the notes carry a `publish-wired` disclosure in place of `unsigned`, saying nothing is signed yet
and what the first approved dispatch will do.

```
$ (cd packages/docs-tools && pnpm exec vitest run src/selfhost/checks.test.ts src/release/notes.test.ts --coverage.enabled=false)   # exit 1
     × asks for each check and statement once the switch is on, with the identity of the repository the packages name 12ms
     × keeps the unsigned statement while on, since nothing is signed until the first approved publication (rule 10) 2ms
     × refuses the switch on while release.yml lacks a wired sub-part, or the packages name no single repository 1ms
     × refuses an ungated job whichever the switch says 1ms
     × turned the switch on with release.yml wired, and the committed page passes it 1ms
     × says nothing is signed yet and what the first approved dispatch will do once the publish job is wired (C262, C285; rule 10) 9ms
AssertionError: expected undefined to be 'C262, C285, C289 (Q1-Q4)' // Object.is equality
AssertionError: expected [] to deeply equal [ …(6) ]
AssertionError: expected [] to deeply equal [ Array(1) ]
AssertionError: expected [] to deeply equal [ …(7) ]
AssertionError: expected [] to deeply equal [ Array(1) ]
AssertionError: expected false to be true // Object.is equality
      Tests  6 failed | 27 passed (33)
$ (cd packages/docs-tools && pnpm exec tsc --noEmit -p .)   # exit 0: the RED tests typecheck
```

## 4. GREEN (checkpoint 2: the switch, the page and the notes)

- `packages/docs-tools/src/selfhost/checks.ts` (this area's): `checkPublishSwitch` on: the six
  wiring items in release.yml (`dryRunDefaultsTrue` over the dispatch's inputs; keyless
  `cosign sign`, `cosign attest --type cyclonedx`, `helm push` to `oci://`, a commit-pinned
  `actions/attest-build-provenance`, `pnpm publish --provenance --access public` in the publish
  job), `publishedRepository` (the one GitHub repository the three manifests name) and
  `releaseIdentity`, the four checks with that identity and `ACTIONS_ISSUER`, and the three
  statements; the gating finding now applies in both modes. A first version used a regular
  expression for the dry-run input, which eslint-plugin-security refused
  (`security/detect-unsafe-regex`, checks.ts:289); it became a line reader.
- Borrowed edits (each file clean in `git status` before the edit; records-11g's Q8 change to
  `switches.ts` was committed at `bda7a8baf` first): `packages/docs-tools/src/switches.ts`
  `publishWired: true` and its header; `switches.test.ts`'s two expectations of the switch's value;
  `packages/docs-tools/src/release/notes.ts`: the `publish-wired` disclosure (contract
  `C262, C285, C289 (Q1-Q4)`) in place of `unsigned` while the switch is on, in the required
  disclosures and the "Artifacts, signatures and sources" section; `docs/release/notes.md`
  re-rendered (`docs:release`, 1 file written: that paragraph only).
- `docs/self-hosting/verify-artifacts.md` rewritten: nothing is signed yet; what the wired job does
  in a dry run and with dry-run false; it fails closed; the four checks with the identity
  `https://github.com/hnalpha323/openverify/.github/workflows/release.yml@refs/heads/main` and the
  issuer `https://token.actions.githubusercontent.com`; what can be checked today.
  `docs:selfhost` wrote its 5 generated files unchanged.

```
$ pnpm --filter @openverify/docs-tools test   # exit 0 (load 3.56)
 Test Files  51 passed (51)
      Tests  442 passed (442)
All files          |   97.74 |    86.43 |   98.57 |   97.75 |
$ pnpm turbo run lint typecheck --force --filter=@openverify/docs-tools --concurrency=1   # exit 0
 Tasks:    2 successful, 2 total
$ pnpm release:check   # exit 0
release:check (default): 0 errors, 82 owner items
```

release:check's items now include two stale-evidence rows this area caused (ASVS v5.0.0-15.1.2 and
15.2.1 cite `infra/tests/release-workflow.test.sh`), reviewed again in section 5; the others (2.1.2,
13.4.1, 13.4.2, 15.1.1, 15.2.3) follow records-11g's and codeql-11g's changes, not this area's.

Gate: affected scope (rule 22): docs-tools' whole test script, its forced lint and typecheck,
release:check (default) and prettier over the TypeScript files.

## 5. By hand: the dry-run evidence (rule 9: evidence, not tests)

Nothing below pushed, signed, attested or published. The real path's commands (section 6) were
never run.

### 5.1 The npm tarballs: `pack-release.ts`, then `pnpm publish <tarball> --dry-run`

```
$ pnpm turbo run build --filter=@openverify/js --filter=@openverify/node --filter=@openverify/react   # exit 0
$ node packages/sdk-react/scripts/pack-release.ts --out <scratch>/stage1/npm --version 0.1.0 packages/sdk-js packages/node packages/sdk-react   # exit 0
@openverify/js@0.1.0 <scratch>/stage1/npm/openverify-js-0.1.0.tgz 11249 bytes sha256 bdbcad1f4b51670a38f868699adf972b7af4130aa29af9a5bba14e0e713a0d15
@openverify/node@0.1.0 <scratch>/stage1/npm/openverify-node-0.1.0.tgz 1578356 bytes sha256 4f36c8c0915ce2b826406bd5dbc00d94a34b063693baed1ec25f513649ceb100
@openverify/react@0.1.0 <scratch>/stage1/npm/openverify-react-0.1.0.tgz 7743 bytes sha256 ef0ef0adfa4525522f2947fb08aa867c4e261759cff41b2bfc7543ca89b3f9b7
# the packed manifests (name, version, private, publishConfig, repository):
@openverify/js 0.1.0 None {'access': 'public', 'provenance': True} {'type': 'git', 'url': 'git+https://github.com/hnalpha323/openverify.git', 'directory': 'packages/sdk-js'}
@openverify/node 0.1.0 None {'access': 'public', 'provenance': True} {'type': 'git', 'url': 'git+https://github.com/hnalpha323/openverify.git', 'directory': 'packages/node'}
@openverify/react 0.1.0 None {'access': 'public', 'provenance': True} {'type': 'git', 'url': 'git+https://github.com/hnalpha323/openverify.git', 'directory': 'packages/sdk-react'}
$ (cd <scratch>/npm && pnpm publish ./openverify-js-0.1.0.tgz --access public --dry-run)                # exit 0
📦 @openverify/js@0.1.0 → https://registry.npmjs.org/
[WARN] Skip publishing @openverify/js@0.1.0 (dry run)
$ (cd <scratch>/npm && pnpm publish ./openverify-js-0.1.0.tgz --provenance --access public --dry-run)   # exit 0, outside CI
📦 @openverify/js@0.1.0 → https://registry.npmjs.org/
[WARN] Skip publishing @openverify/js@0.1.0 (dry run)
$ pnpm publish <scratch>/npm/openverify-js-0.1.0.tgz --provenance --access public --dry-run   # from the repository root: exit 1
Error: ERR_PNPM_GIT_UNCLEAN
  × Unclean working tree. Commit or stash changes first.
$ pnpm publish <scratch>/npm/openverify-js-0.1.0.tgz --provenance --access public --no-git-checks --dry-run   # exit 0
```

Two findings the workflow uses: `--provenance` under `--dry-run` outside any CI provider exits 0,
so pnpm 12.14.0 generates no provenance in a dry run (otherwise it would stop on "Automatic
provenance generation is not supported for this CI provider", a string of its binary); the publish
job's dry run also removes `ACTIONS_ID_TOKEN_REQUEST_URL` and `_TOKEN`, so it can fetch no OIDC
token at all. And pnpm's git checks refuse a working tree with untracked files, which the runner's
checkout is once the staged artifacts are downloaded into `staged/`, so the job passes
`--no-git-checks` (the branch is checked by the job's first step and the bytes by `SHA256SUMS`).
pnpm 12.14.0's binary fetches the GitHub OIDC token itself (`ACTIONS_ID_TOKEN_REQUEST_URL`) and
exchanges it at the registry's `/-/npm/v1/oidc/token/exchange/package/`, as its changelog records.

### 5.2 The chart: `helm package` and `helm show chart` (Helm v4.3.1+gc0d08d0)

```
$ helm package deploy/helm/openverify --destination <scratch>/stage1/chart --version 0.1.0 --app-version 0.1.0   # exit 0
Successfully packaged chart and saved it to: <scratch>/stage1/chart/openverify-0.1.0.tgz
$ helm show chart <scratch>/stage1/chart/openverify-0.1.0.tgz   # exit 0
apiVersion: v2
appVersion: 0.1.0
description: 'A Helm chart for a self-hosted OpenVerify install: the API, the worker,
  the hosted flow, the operator console, the vision service and the code runner, as
  restricted pods with default-deny network policies, over data stores and a mail
  relay the operator runs. A secure default, whose effect depends on the cluster it
  runs in and its network plugin.'
keywords:
- identity-verification
- self-hosted
kubeVersion: '>=1.35.0-0'
name: openverify
type: application
version: 0.1.0
$ sha256sum openverify-0.1.0.tgz
b4daf11a967d499d53eac1c873e45f260881dd0875cd275ceee19c03d09d61d4
```

Helm 4.3.1's binary prints "Pushed: %s" and "Digest: %s" on a push, which the job's chart step reads
(stdout and stderr both go to the file it reads).

### 5.3 The images: a local build of each under the e2e lock, and the digest that would be pushed

Built at `fcf6c023d` (HEAD then) as release.yml builds them (`--platform linux/amd64`, the
labels' VERSION, REVISION and SOURCE_URL arguments), each under `flock -E 75 -w 240
/tmp/openverify-e2e.lock`, every lock wait 0.003-0.005 s:

| Image | Build | Load (1 min) before, after | `docker image inspect --format '{{.Id}}'` |
|---|---:|---|---|
| openverify/api:0.1.0 | 165 s | 2.72, 4.36 | `sha256:e4e8dbbdf161b103fd8fd24de905c5d4a33229472ffbd80c6b987238818a2b96` |
| openverify/dashboard:0.1.0 | 142 s (no Next.js security notice) | 4.49, 6.21 | `sha256:b2f2251afd737c6e9305cdd0214a207d33d238a185d5e95bb8683ea98ab147b5` |
| openverify/flow:0.1.0 | 47 s | 5.56, 5.41 | `sha256:7419d17067a2d70a669f37734425cf25f85472dc770dd662f686aed62d715bb7` |
| openverify/flow:0.1.0-noguidance | 53 s | 5.41, 5.22 | `sha256:b74edb519345c59ac05430bbb141aa2b8b35b92f7836ec7c4064c95885f1f0f0` |
| openverify/code-runner:0.1.0 | 44 s | 5.22, 4.25 | `sha256:aedab4a2dd39d41c63001c5924f9172ebea0e293c32ca3e70c54ebca518efe4a` |
| openverify/vision:0.1.0 | 27 s (cached layers) | 3.75, 3.93 | `sha256:41b9ec8235b075e4e656a8cf74a8c17ff7a77cfc7c279d0d72a4d50c820f984e` |

This host's Docker 29.7.2 uses the containerd image store, where the image id is the manifest
index's digest, which a push sends as it is; on a runner's classic store the id is the config
digest and the registry digest is known only from the push, which is why the job signs the digest
the push returned (`RepoDigests` for that repository) and never a tag. The api and vision builds
carry `dev.openverify.licence-status=pending-owner` at `fcf6c023d` (vision: KP11-39; api: Q11's
label not yet moved by records-11g when built).

### 5.4 The whole publish job as a dry run over these artifacts

The six images were saved with `docker save` (26 s under the e2e lock, lock wait 0.004 s, load 3.25
to 4.44) into a staged tree laid out as the stage job lays it out, with `IMAGE-IDS.txt` as the
build job writes it, the three tarballs and the chart package of 5.1 and 5.2, and `SHA256SUMS` as
the stage job computes it (11 files, 610 MB). A small driver (scratchpad, not committed) read the
publish job from `.github/workflows/release.yml` and ran each of its run steps in order with
`bash -e`, the job's and each step's env, `GITHUB_REF=refs/heads/main`, `DRY_RUN=true` and no
OIDC request variables; action steps were reported, not run; `corepack` and the two installers were
stubbed (the host keeps its own shims; `install-cosign.test.sh` and `install-helm.test.sh` hold the
installers). Real docker, helm and pnpm 12.14.0. Under the e2e lock (wait 0.005 s), 17 s, load 4.06
to 4.83; exit 0:

```
=== Publish only from main
::notice title=release::dry run of 0.1.0: nothing is pushed, signed, attested or published
--- exit 0
=== actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1: action step, not run (if: None)
=== actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333: action step, not run (if: None)
=== actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333: action step, not run (if: None)
=== Check every staged file against SHA256SUMS
./chart/openverify-0.1.0.tgz: OK
./images/IMAGE-IDS.txt: OK
./images/openverify-api-0.1.0.tar: OK
./images/openverify-code-runner-0.1.0.tar: OK
./images/openverify-dashboard-0.1.0.tar: OK
./images/openverify-flow-0.1.0.tar: OK
./images/openverify-flow-noguidance-0.1.0.tar: OK
./images/openverify-vision-0.1.0.tar: OK
./npm/openverify-js-0.1.0.tgz: OK
./npm/openverify-node-0.1.0.tgz: OK
./npm/openverify-react-0.1.0.tgz: OK
--- exit 0
=== Refuse a pending-owner artifact
--- exit 0
=== Install cosign (pinned, checked by SHA-256)
--- exit 0
=== Install Helm (pinned, checksummed)
--- exit 0
=== actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1: action step, not run (if: None)
=== Check the npm tarballs and dry-run their publication
📦 @openverify/js@0.1.0 → https://registry.npmjs.org/
[WARN] Skip publishing @openverify/js@0.1.0 (dry run)
📦 @openverify/node@0.1.0 → https://registry.npmjs.org/
[WARN] Skip publishing @openverify/node@0.1.0 (dry run)
📦 @openverify/react@0.1.0 → https://registry.npmjs.org/
[WARN] Skip publishing @openverify/react@0.1.0 (dry run)
--- exit 0
=== Load each staged image and check it against IMAGE-IDS.txt
openverify/api:0.1.0 is sha256:e4e8dbbdf161b103fd8fd24de905c5d4a33229472ffbd80c6b987238818a2b96, as built
openverify/dashboard:0.1.0 is sha256:b2f2251afd737c6e9305cdd0214a207d33d238a185d5e95bb8683ea98ab147b5, as built
openverify/flow:0.1.0 is sha256:7419d17067a2d70a669f37734425cf25f85472dc770dd662f686aed62d715bb7, as built
openverify/flow:0.1.0-noguidance is sha256:b74edb519345c59ac05430bbb141aa2b8b35b92f7836ec7c4064c95885f1f0f0, as built
openverify/vision:0.1.0 is sha256:41b9ec8235b075e4e656a8cf74a8c17ff7a77cfc7c279d0d72a4d50c820f984e, as built
openverify/code-runner:0.1.0 is sha256:aedab4a2dd39d41c63001c5924f9172ebea0e293c32ca3e70c54ebca518efe4a, as built
--- exit 0
=== Push, sign and attest each image by digest
dry run: would push ghcr.io/hnalpha323/openverify-api:0.1.0 (openverify/api:0.1.0), sign the digest the push returns keyless with cosign and attest staged/sbom/openverify-api-0.1.0.cdx.json to it
dry run: would push ghcr.io/hnalpha323/openverify-dashboard:0.1.0 (openverify/dashboard:0.1.0), sign the digest the push returns keyless with cosign and attest staged/sbom/openverify-dashboard-0.1.0.cdx.json to it
dry run: would push ghcr.io/hnalpha323/openverify-flow:0.1.0 (openverify/flow:0.1.0), sign the digest the push returns keyless with cosign and attest staged/sbom/openverify-flow-0.1.0.cdx.json to it
dry run: would push ghcr.io/hnalpha323/openverify-flow-noguidance:0.1.0 (openverify/flow:0.1.0-noguidance), sign the digest the push returns keyless with cosign and attest staged/sbom/openverify-flow-noguidance-0.1.0.cdx.json to it
dry run: would push ghcr.io/hnalpha323/openverify-vision:0.1.0 (openverify/vision:0.1.0), sign the digest the push returns keyless with cosign and attest staged/sbom/openverify-vision-0.1.0.cdx.json to it
dry run: would push ghcr.io/hnalpha323/openverify-code-runner:0.1.0 (openverify/code-runner:0.1.0), sign the digest the push returns keyless with cosign and attest staged/sbom/openverify-code-runner-0.1.0.cdx.json to it
--- exit 0
=== Push the chart to the registry as an OCI artifact
dry run: would push staged/chart/openverify-0.1.0.tgz to oci://ghcr.io/hnalpha323/charts as openverify:0.1.0
--- exit 0
=== Build provenance for every staged file: action step, not run (if: inputs.dry-run == false)
=== Build provenance for every pushed image and the chart, by digest: action step, not run (if: inputs.dry-run == false)
=== Say what the provenance would cover (dry run)
dry run: actions/attest-build-provenance would attest the 11 files of staged/SHA256SUMS, then the six image digests and the chart digest the pushes return
--- exit 0
=== Publish the npm packages with provenance
dry run: would publish staged/npm/openverify-{js,node,react}-0.1.0.tgz with pnpm publish --provenance --access public (dry-run published above)
--- exit 0
=== Say what was published
::notice title=release::dry run of 0.1.0 done: nothing was pushed, signed, attested or published
--- exit 0
```

The six `ghcr.io/hnalpha323/openverify-<image>:0.1.0` tags the dry run's `docker tag` created on
this host were removed afterwards (untag only).

## 6. The real path, shown and never run (rule 2)

With `OPENVERIFY_PUBLISH` `'true'`, the `release` environment's reviewer's approval and `dry-run`
false, the job runs these, in this order, after the checks of 5.4 (each `<owner>` is
`github.repository_owner` lowercased; nothing here was executed on this host or anywhere):

```
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
docker tag openverify/<image>:<version> ghcr.io/<owner>/openverify-<image>:<version>     # flow-noguidance: openverify/flow:<version>-noguidance
docker push ghcr.io/<owner>/openverify-<image>:<version>
cosign sign --yes ghcr.io/<owner>/openverify-<image>@<digest the push returned>        # keyless: Fulcio certificate from the job's OIDC token, Rekor entry
cosign attest --yes --type cyclonedx --predicate staged/sbom/openverify-<image>-<version>.cdx.json ghcr.io/<owner>/openverify-<image>@<digest>
printf '%s' "$GH_TOKEN" | helm registry login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
helm push staged/chart/openverify-<version>.tgz oci://ghcr.io/<owner>/charts
actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 (v4.2.2), subject-checksums: staged/SHA256SUMS
actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 (v4.2.2), subject-checksums: staged/PUBLISHED-DIGESTS   # six images and the chart, by digest
pnpm publish staged/npm/openverify-<js|node|react>-<version>.tgz --provenance --access public --no-git-checks   # npm trusted publishing: the job's OIDC token, no npm token
```

## 7. The two ASVS rows this area made stale (C274.6; a named borrowed edit)

`release:check` reported `v5.0.0-15.1.2` and `v5.0.0-15.2.1` stale after checkpoint 1 (both cite
`infra/tests/release-workflow.test.sh`). Each was read again against the wired job and kept
`partial`: 15.1.2's note now says the SBOMs stay workflow artifacts until the first approved
publication, whose job (wired, never run) attests each image's SBOM to its digest; 15.2.1's adds that
the publish job waits for the image gate, so a failing gate publishes nothing. Both
`reviewed_commit` `aaa1187d8`; `docs:security` re-rendered `docs/security/asvs-summary.md` (1 file);
`docs:selfhost` and `docs:release` wrote nothing new. `release:check` then: 0 errors, 80 owner
items, and no stale row of this area's (2.1.2, 13.4.1, 13.4.2, 15.1.1 and 15.2.3 follow
records-11g's changes to `docs/checks/catalog.md`, `infra/tests/images.test.sh` and the
vulnerability policy).

## 8. The final gate (checkpoint 3, the last: the area's full gate on the final tree)

On the tree at `ff59774fb` (records-11g's Q10 checkpoint; this area's last change `981ffa8eb`), each
call in the foreground, its exit code read from the command itself:

| Call | Exit | Time | Load (1 min) | Result |
|---|---:|---:|---|---|
| `pnpm format:check` | 0 | 146 s | 2.50 | all files in Prettier style |
| `NODE_OPTIONS=--max-old-space-size=4096 pnpm turbo run lint typecheck --force --concurrency=1 --filter=@openverify/docs-tools --filter=@openverify/node --filter=@openverify/js --filter=@openverify/react` | 0 | 93 s | 6.04 to 4.93 | 8 of 8 tasks |
| `bash infra/tests/release-workflow.test.sh` | 0 | | | 141 passed, 0 failed, 0 skipped, actionlint and zizmor among them |
| `bash infra/tests/ci-workflow.test.sh` | 0 | | | 548 passed, 0 failed, 0 skipped |
| `bash infra/tests/supply-chain-skeletons.test.sh` | 0 | | | 114 passed, 0 failed, 13 skipped (skips: its skeleton-only cases) |
| `bash infra/tests/codeql-workflow.test.sh` (codeql-11g's; it reads every workflow) | 0 | | | 95 passed, 0 failed, 0 skipped |
| `bash infra/scripts/supply-chain.sh zizmor`, `allowlist`, `pii` | 0, 0, 0 | 0, 0, 7 s | | zizmor: low findings only (`self-repository` in ci.yml) |
| `bash infra/scripts/supply-chain.sh osv`, `pnpm-audit`, `pip-audit`, `trivy-config` | 0, 0, 0, 0 | 2, 37, 3, 5 s | 3.04 | |
| `bash infra/scripts/supply-chain.sh chart` | 1, then 0 | 19, 20 s | 2.98 | the first call met records-11g's uncommitted Q10 edit of `deploy/helm/openverify/tests/c263-components_test.yaml` (2 of 199 unittest cases); after its commit `ff59774fb`, 199 of 199, lint, kubeconform and trivy passed |
| `pnpm --filter @openverify/node test`; `@openverify/js`; `@openverify/react` | 0, 0, 0 | 7, 5, 44 s | 2.75 to 5.40 | 508 (98.48% lines), 19, 55 (96.18%) |
| `pnpm --filter @openverify/docs-tools test` | 0 | 25 s | | Tests 442 passed (442), 97.74% lines |
| `pnpm release:check` (default mode) | 0 | | | release:check (default): 0 errors, 85 owner items |
| `gitleaks git --redact .` | 0 | 12 s | | 8,083 commits, no leaks |
| `gitleaks dir --redact --config security/gitleaks-pii.toml .` | 1 (raw matches, by design) | 6 s | | 1,205 raw matches, which the PII step's filter judges: |
| `python3 -I security/gitleaks-pii-filter.py --gitleaks $(command -v gitleaks) dir .` and `... git .` | 0, 0 | 5, 12 s | | 0 kept of 1,205; 0 kept of 1,641 (as at the 11F close) |

release:check's owner items moved from 75 at the start to 85 here through the other Stage 2
parts' changes; none is this area's: its two stale rows (section 7) were reviewed, and
`v5.0.0-15.1.2` is stale again only because records-11g changed
`security/tests/test_check_sbom_licences.py` after `aaa1187d8` (records-11g's or integration-11g's
review).

No e2e gate, shard, Android call or device call ran (rule 21: nothing under `apps/`, `e2e/` or
`android/` changed in this area). Nothing was pushed, published, signed, attested or dispatched.

Checkpoints: 1 `7cb027fd0` (workflow; RED `197072bc5`); 2 `aaa1187d8` (switch and page; RED
`28167d473`); the ASVS rows and dry-run evidence `981ffa8eb`; 3 this commit (the final gate).
