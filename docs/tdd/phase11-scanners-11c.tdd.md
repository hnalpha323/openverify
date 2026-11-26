# Phase 11, Workflow 11C: scanners-11c (family S; C258.2, C259; KP10-52)

Stage 2 agent, beside the other 11C builders. Owned paths: `infra/scripts/install-*.sh` (not gitleaks'), `infra/scripts/supply-chain.sh`, `infra/tests/install-*.test.sh` (not gitleaks'), `infra/tests/supply-chain.test.sh`, `security/allowlist.yaml` and its test; new supporting files `infra/scripts/lib/install-common.sh` and `infra/tests/lib/installer-harness.sh` (contractDeviation: new paths under my scripts). Gates are this agent's own tests (rule 25, parallel gates); every timing carries `cat /proc/loadavg`.

Checkpoints (rule 17):

- `chart-tools`: cosign, Helm 4.3.1 and 3.22.1, helm-unittest 1.2.1, kubeconform 0.8.0 with its converter, chart-testing 3.15.0, kind 0.33.0, kubectl 1.35.9.
- `image-tools`: Trivy 0.76.0 with its checks bundle by digest, Syft 1.54.1, Grype 0.120.1.
- `scanners`: osv-scanner 2.7.0, zizmor 1.31.1, pip-audit through `security/pip-audit/`, `infra/scripts/supply-chain.sh`.

## 1. Checkpoint chart-tools

### Design

Every installer sources one library, `infra/scripts/lib/install-common.sh`, which is the `install-gitleaks.sh` pattern made shared (gitleaks' own installer is unchanged):

- `ov_platform`: linux x86_64 only, else exit 2 before any download.
- `ov_pin <PREFIX>`: `<PREFIX>_VERSION` with `<PREFIX>_SHA256` together over the frozen `<PREFIX>_VERSION_DEFAULT`/`_SHA256_DEFAULT`; a version alone or a malformed SHA-256 exits 2.
- `ov_begin`: a private `mktemp -d` (0700), removed on exit.
- `ov_download`: `curl -sSL --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 300`, 5 attempts with a doubling delay (`INSTALL_RETRY_DELAY_SECONDS`, default 2) on 5xx, timeouts and connection failures; 4xx fails at once.
- `ov_obtain <cache> <verify> <name> <url>...`: a cache copy is verified again (all of it, signature included) before use, discarded and downloaded again when it fails; a verified download fills the cache; nothing reaches the cache or `INSTALL_DIR` before every check passed.
- `ov_release_sha` (lines `<sha>  <asset>`, `<sha> *<asset>`, `<sha> *./_dist/<asset>`; not listed or two digests fail) and `ov_release_sha_only` (a bare SHA-256 file); `ov_check_asset` (release digest, then the pin: "release checksum file: OK", "pinned SHA-256: OK"); `ov_check_pin_only` (a script at a pinned commit).
- `ov_verify_bundle` / `ov_verify_sigcert`: cosign `verify-blob` with the identity and issuer, run only with a cosign whose SHA-256 is `install-cosign.sh`'s pin (`COSIGN_BIN`, else `INSTALL_DIR/cosign`, else PATH; `COSIGN_BIN_SHA256` is the tests' override).
- Exit codes: 0 installed; 1 download, checksum or signature failure; 2 usage (platform, a version without its SHA-256, a missing prerequisite).

The tests share `infra/tests/lib/installer-harness.sh`: a fake `curl` serving a synthetic release by file name with a per-file plan of answers (as `install-gitleaks.test.sh`'s), a fake `uname` (Darwin arm64), a fake `cosign` that records its arguments and answers pass or fail, `run_installer`, and the shared cases `fail_closed_cases` (wrong pin, tampered release line, missing release line, unsupported platform, version without SHA-256) and `signature_cases` (refused signature, no cosign, a cosign that is not the pinned one, the identity and issuer asked). Each `install-<tool>.test.sh` has an offline half (synthetic release) and a network half (the pinned release from its official origin, its version read back); `--offline-only` skips the network half with a `skip` line.

### RED (`8d2e78a62`)

```
$ for t in common cosign helm helm-unittest kubeconform chart-testing kind kubectl; do bash infra/tests/install-$t.test.sh --offline-only; done
common rc=1 # 11 passed, 30 failed, 0 skipped
cosign rc=1 # 4 passed, 12 failed, 1 skipped
helm rc=1 # 4 passed, 14 failed, 1 skipped
helm-unittest rc=1 # 5 passed, 15 failed, 1 skipped
kubeconform rc=1 # 4 passed, 14 failed, 1 skipped
chart-testing rc=1 # 6 passed, 16 failed, 1 skipped
kind rc=1 # 5 passed, 10 failed, 1 skipped
kubectl rc=1 # 6 passed, 17 failed, 1 skipped
FAIL - the synthetic release installs cosign into INSTALL_DIR (exit 3: install-cosign: not built yet (Workflow 11C scanners-11c fills this installer; the pins above are frozen) )
```

Each fails for the intended reason: the skeleton exits 3 "not built" (and `infra/scripts/lib/install-common.sh` does not exist). The checks that pass in RED are the fail-closed ones a skeleton already meets (non-zero, nothing installed).

### GREEN (`44cd9bf2c` test fix, `29343142f` code)

`44cd9bf2c`: the helm-unittest test's synthetic install hook printed "downloading", which matched the installer's own "downloading <asset>" line; the hook now prints a unique marker (the check is unchanged in intent).

```
$ bash infra/tests/install-<tool>.test.sh --offline-only     (load 1.7-2.5)
common rc=0 # 41 passed, 0 failed, 0 skipped
cosign rc=0 # 16 passed, 0 failed, 1 skipped
helm rc=0 # 18 passed, 0 failed, 1 skipped
helm-unittest rc=0 # 20 passed, 0 failed, 1 skipped
kubeconform rc=0 # 18 passed, 0 failed, 1 skipped
chart-testing rc=0 # 22 passed, 0 failed, 1 skipped
kind rc=0 # 15 passed, 0 failed, 1 skipped
kubectl rc=0 # 23 passed, 0 failed, 1 skipped
$ bash infra/tests/install-<tool>.test.sh                    (network half: the pinned release)
cosign rc=0 8s # 18 passed, 0 failed, 0 skipped           load 1.68 2.48 2.23
helm rc=0 3s # 21 passed, 0 failed, 0 skipped             load 1.66 2.45 2.23
kind rc=0 1s # 17 passed, 0 failed, 0 skipped             load 1.66 2.45 2.23
helm-unittest rc=0 7s # 25 passed, 0 failed, 0 skipped    load 1.80 2.45 2.23 (a unit test passes under helm and helm3)
kubeconform rc=0 1s # 20 passed, 0 failed, 0 skipped      load 1.89 2.46 2.23
chart-testing rc=0 10s # 25 passed, 0 failed, 0 skipped   load 1.89 2.46 2.23 (Sigstore bundle verified)
kubectl rc=0 17s # 26 passed, 0 failed, 0 skipped         load 1.77 2.40 2.22 (sig + cert verified)
$ bash infra/tests/supply-chain-skeletons.test.sh
# 103 passed, 0 failed, 7 skipped   (the seven filled installers skip their skeleton check; their pins still pass)
```

Installed for this host into `~/.local/bin` (the default `INSTALL_DIR`, also `SUPPLY_CHAIN_TOOLS_DIR`'s default):

```
install-cosign: installed cosign v3.1.3 to /home/mhnoor/.local/bin/cosign
install-helm: installed helm v4.3.1+gc0d08d0 to ~/.local/bin/helm; helm3 v3.22.1+gd6c1a0e to ~/.local/bin/helm3
install-helm-unittest: installed unittest 1.2.1 to ~/.local/share/helm/plugins/unittest
install-kubeconform: installed kubeconform v0.8.0 to ~/.local/bin/kubeconform, and openapi2jsonschema.py at 02374e583d700721f57300fae78e11acd27ee539 beside it
install-chart-testing: installed ct v3.15.0 to ~/.local/bin/ct
install-kind: installed kind v0.33.0 go1.26.7 linux/amd64 to ~/.local/bin/kind
install-kubectl: installed kubectl v1.35.9 to ~/.local/bin/kubectl
```

Gate (rule 25, my own paths): the eight installer tests above, offline and network, exit 0; `supply-chain-skeletons.test.sh` exit 0; gitleaks (pre-commit) clean on each commit. `pnpm format:check` exit 1 on `apps/demo-web/e2e/tsconfig.json`, sdk-web-11c's uncommitted file (not mine; no shell or Markdown file of mine is in Prettier's scope).

CHECKPOINT chart-tools DONE at 29343142f9975e185a8c80a6b6ab0b05e1a1f983

Handoff (chart-11c, chart-policy-11c, sbom-release-11c, integration-11c):

- Install, from the repository root, each its own call (default `INSTALL_DIR=~/.local/bin`; already done on this host):
  - `infra/scripts/install-cosign.sh` (first: the other installers verify signatures with it);
  - `infra/scripts/install-helm.sh` puts **`helm` = Helm 4.3.1** and **`helm3` = Helm 3.22.1** in `INSTALL_DIR` (for `chart-skeleton.test.sh`: `HELM4=$HOME/.local/bin/helm HELM3=$HOME/.local/bin/helm3`, or both on PATH);
  - `infra/scripts/install-helm-unittest.sh` copies `plugin.yaml`, `untt-linux-amd64` and `LICENSE` into `$HELM_PLUGINS/unittest` (default: `helm env HELM_PLUGINS`, asked of `HELM_BIN`, else `INSTALL_DIR/helm`, else PATH's; `~/.local/share/helm/plugins` here, shared by both Helms). Run: `helm unittest -f 'tests/<file>' deploy/helm/openverify` or `helm3 unittest ...`;
  - `infra/scripts/install-kubeconform.sh` installs `kubeconform` and, beside it (mode 0644), `openapi2jsonschema.py` at commit `02374e583d700721f57300fae78e11acd27ee539`, SHA-256 `d145babf...81f3` verified: `scripts/fetch_k8s_schemas.py` can read it from `$INSTALL_DIR/openapi2jsonschema.py` (or fetch it itself against `KUBECONFORM_SCHEMA_CONVERTER_*` in the installer);
  - `infra/scripts/install-chart-testing.sh` installs `ct` only (`ct install`, never `ct lint`);
  - `infra/scripts/install-kind.sh` installs `kind`; the node images stay in the installer: `KIND_NODE_IMAGE_1_35` and `KIND_NODE_IMAGE_1_37` (read them with `sed -n 's/^KIND_NODE_IMAGE_1_35="\(.*\)"$/\1/p' infra/scripts/install-kind.sh`);
  - `infra/scripts/install-kubectl.sh` installs `kubectl` (signature: `KUBECTL_SIGNER_IDENTITY`, `KUBECTL_SIGNER_ISSUER` in the installer).
- Env of every installer: `INSTALL_DIR`; `<P>_VERSION` with `<P>_SHA256` together; `<P>_CACHE_DIR` (`COSIGN_`, `HELM_` (both Helms), `HELM_UNITTEST_`, `KUBECONFORM_`, `CHART_TESTING_`, `KIND_`, `KUBECTL_`); `INSTALL_RETRY_DELAY_SECONDS`; `COSIGN_BIN`. In CI, run `install-cosign.sh` first into the same `INSTALL_DIR` (e.g. `INSTALL_DIR="$RUNNER_TEMP/bin"`), and key any `actions/cache` on the installer and `infra/scripts/lib/install-common.sh` both.
- Signatures checked: chart-testing (bundle on the archive), kubectl (sig + cert); Helm and helm-unittest sign with PGP only, kind and kubeconform publish none: each of those rests on the release checksum file and the pin.
- Exit codes: 0 installed, 1 download/checksum/signature failure (nothing written), 2 usage (platform, version without SHA-256, no Helm to ask for `HELM_PLUGINS`).
- Tests: `bash infra/tests/install-<tool>.test.sh [--offline-only]` for common, cosign, helm, helm-unittest, kubeconform, chart-testing, kind, kubectl.

## 2. Checkpoint image-tools

Continuation note: the Workflow stopped cleanly on 2026-11-14 at 15:17 EST, after the GREEN commit `f33b7783c` and before this section was written. The RED below was re-run on 2026-11-15 in a scratch worktree detached at the RED commit `941cb7de8` (created and removed under the git lock), so the output is real and from the RED tree; nothing committed was redone.

### Design

The three installers use the shared library unchanged. Each verifies the release's checksum file (`<tool>_<v>_checksums.txt`), the pin, and the checksum file's Sigstore bundle (`<sums>.sigstore.json`) with the pinned cosign:

- Trivy 0.76.0: identity `https://github.com/aquasecurity/trivy/.github/workflows/reusable-release.yaml@refs/tags/v0.76.0`; the checks bundle stays pinned by digest in `TRIVY_CHECKS_BUNDLE_DEFAULT` and is named in the install report.
- Syft 1.54.1: identity `https://github.com/anchore/syft/.github/workflows/release.yaml@refs/heads/main`.
- Grype 0.120.1: identity `https://github.com/anchore/grype/.github/workflows/release.yaml@refs/heads/main`.
- Issuer for all three: `https://token.actions.githubusercontent.com`. Never trivy-action, setup-trivy or anchore's actions.

### RED (`941cb7de8`)

```
$ git worktree add --detach /tmp/scanners-red-wt 941cb7de8   (under the git lock; removed after)
$ bash infra/tests/install-<tool>.test.sh --offline-only     (load 2.85 0.74 0.25)
trivy rc=1 # 7 passed, 17 failed, 1 skipped
syft rc=1 # 6 passed, 16 failed, 1 skipped
grype rc=1 # 6 passed, 16 failed, 1 skipped
FAIL - the synthetic release installs trivy, and only it (exit 3: install-trivy: not built yet (Workflow 11C scanners-11c fills this installer; the pins above are frozen) )
```

Intended reason: the skeletons exit 3 "not built". The checks that pass are the fail-closed ones a skeleton already meets, and the checks-bundle digest line.

### GREEN (`f33b7783c`)

```
$ bash infra/tests/install-<tool>.test.sh --offline-only     (load 3.51 0.91 0.30)
trivy rc=0 # 24 passed, 0 failed, 1 skipped
syft rc=0 # 22 passed, 0 failed, 1 skipped
grype rc=0 # 22 passed, 0 failed, 1 skipped
$ bash infra/tests/install-<tool>.test.sh                    (network half: the pinned release, signature verified)
trivy rc=0 18s # 27 passed, 0 failed, 0 skipped   load 7.60 2.02 0.69
syft rc=0 15s # 25 passed, 0 failed, 0 skipped    load 8.54 2.51 0.87
grype rc=0 16s # 25 passed, 0 failed, 0 skipped   load 10.39 3.22 1.13
$ bash infra/tests/supply-chain-skeletons.test.sh
# 100 passed, 0 failed, 10 skipped   (ten filled installers skip their skeleton check; every pin still passes)
```

Installed for this host:

```
install-trivy: installed trivy 0.76.0 to /home/mhnoor/.local/bin/trivy (checks bundle ghcr.io/aquasecurity/trivy-checks:2.3.0@sha256:3eae4436560566e77115396d0221a64e0cd86d94a3b45203f8ae3f9a85c027cd)
install-syft: installed syft 1.54.1 to /home/mhnoor/.local/bin/syft
install-grype: installed grype 0.120.1 to /home/mhnoor/.local/bin/grype
```

Gate (rule 25, my own paths): the three installer tests, offline and network, exit 0; `supply-chain-skeletons.test.sh` exit 0.

CHECKPOINT image-tools DONE at f33b7783cc65a3071f03c366f13e1d053b3bf38b

Handoff (sbom-release-11c, images-11c, integration-11c):

- Install, each its own call, after `infra/scripts/install-cosign.sh` into the same `INSTALL_DIR`: `infra/scripts/install-trivy.sh`, `infra/scripts/install-syft.sh`, `infra/scripts/install-grype.sh` (default `INSTALL_DIR=~/.local/bin`; done on this host). Env: `INSTALL_DIR`; `TRIVY_VERSION`/`TRIVY_SHA256`, `SYFT_*`, `GRYPE_*` together; `TRIVY_CACHE_DIR`, `SYFT_CACHE_DIR`, `GRYPE_CACHE_DIR`; `INSTALL_RETRY_DELAY_SECONDS`; `COSIGN_BIN`.
- Trivy's checks bundle: read it from the installer, `sed -n 's/^TRIVY_CHECKS_BUNDLE_DEFAULT="\(.*\)"$/\1/p' infra/scripts/install-trivy.sh`, and pass it as `trivy ... --checks-bundle-repository <that>` (supply-chain.sh does). Each vulnerability database is fetched fresh per run, never pinned (C259.3).
- Exit codes as chart-tools: 0, 1 (download, checksum or signature), 2 (usage).
- Tests: `bash infra/tests/install-{trivy,syft,grype}.test.sh [--offline-only]`.

## 3. Checkpoint scanners (osv-scanner, zizmor, supply-chain.sh, the allowlist) and KP10-52

This is my last checkpoint. Its gate is my area's full gate (rule 25 for a Stage 2 agent: my own shell, Python and installer tests, the checks, format), run on the final tree.

### 3.1 osv-scanner 2.7.0 and zizmor 1.31.1 installers

- osv-scanner: the bare binary `osv-scanner_linux_amd64`, checked against `osv-scanner_SHA256SUMS` and the pin. The release publishes SLSA provenance only, which is not verified (slsa-verifier not adopted; amendment 5).
- zizmor: an immutable release with no checksum file and no signature. The release's own checksum source is the asset's `digest` (`sha256:<hex>`) in the GitHub releases API (`api.github.com/repos/zizmorcore/zizmor/releases/tags/v1.31.1`, read without credentials), parsed by the new `ov_release_sha_api` in `infra/scripts/lib/install-common.sh` (python3 -I, json). An answer that is not JSON, names no assets, or lists the asset with no single sha256 fails closed.

RED (`e3a27cf64`):

```
$ bash infra/tests/install-<tool>.test.sh --offline-only          (load 3.32 3.86 1.91)
osv-scanner rc=1 # 4 passed, 13 failed, 1 skipped
FAIL - the synthetic release installs osv-scanner, and only it (exit 3: install-osv-scanner: not built yet ...)
zizmor rc=1 # 5 passed, 12 failed, 1 skipped
FAIL - the synthetic release installs zizmor, and only it (exit 3: install-zizmor: not built yet ...)
```

GREEN (`a4fa02481`):

```
$ bash infra/tests/install-<tool>.test.sh --offline-only          (load 3.27 3.81 1.96)
osv-scanner rc=0 # 17 passed, 0 failed, 1 skipped
zizmor rc=0 # 17 passed, 0 failed, 1 skipped
common rc=0 # 41 passed, 0 failed, 0 skipped
$ bash infra/tests/install-<tool>.test.sh                         (network half)
osv-scanner rc=0 5s # 19 passed, 0 failed, 0 skipped   load 3.96 3.94 2.02
zizmor rc=0 2s # 19 passed, 0 failed, 0 skipped        load 3.96 3.94 2.02
install-osv-scanner: installed osv-scanner version: 2.7.0 to /home/mhnoor/.local/bin/osv-scanner
install-zizmor: installed zizmor 1.31.1 to /home/mhnoor/.local/bin/zizmor
$ bash infra/tests/supply-chain-skeletons.test.sh
# 98 passed, 0 failed, 12 skipped   (all twelve installers filled; every pin still passes)
```

### 3.2 infra/scripts/supply-chain.sh and the gate

Design:

- `infra/scripts/supply-chain.sh <step>|all`, with the frozen steps in order: `osv pnpm-audit pip-audit zizmor trivy-config chart pii allowlist`. Two more entry points serve release.yml's image scans: `gate <format> [--fail-at high|medium] [<prefix>=]<report>...` (formats `osv pnpm-audit pip-audit zizmor trivy-config trivy-image grype`) and `db-age <trivy-version|grype-status> <json>`.
- Exit codes: 0 pass, 1 findings or a scanner failure, 2 usage (unknown step, missing tool naming its installer, a token in the environment), 3 a step whose owner's files are absent. `all` runs every step and exits with the highest code.
- The gate is `infra/scripts/lib/supply-chain-gate.py` (python3 -I; PyYAML for the allowlist from system python3, else `security/python`'s environment).
  - A finding at critical or high fails. So does one with no severity at all: pip-audit reports none, so every pip-audit finding fails closed.
  - zizmor's step also fails at medium.
  - An unexpired entry naming one of a finding's ids or aliases, with the finding's package (or its path, or a directory prefix ending in `/`), covers it.
  - The allowlist is checked against `security/allowlist.schema.json`, read at run time: required members, oneOf package or path, no other member, lengths, the id pattern, a date. An entry is refused when it has expired (before today) or expires more than 90 days ahead (expiry today and today + 90 pass). Any such entry fails every step, through the shared check `run_step` makes before each step.
  - Mediums and lows, the allowlisted findings with their reasons, and the failing ones go to `$GITHUB_STEP_SUMMARY` (stdout when unset). An unused entry is reported, never failed, since one allowlist serves every step.
- Scores are mapped by CVSS: 9.0 or more critical, 7.0 high, 4.0 medium, above 0 low. osv-scanner groups without a score take the advisory's `database_specific.severity`.
- Databases (C259.3): osv-scanner, pnpm audit and pip-audit query OSV, the npm registry and PyPI live, so their view is fresh by construction, and the summary says so with the time. Trivy config uses no vulnerability database; the summary names the pinned checks bundle. `db-age` refuses a Trivy or Grype database older than 24 hours, or one that gives no build date, and writes the build date to the summary.
- A set `GITHUB_TOKEN`, `GH_TOKEN`, `NPM_TOKEN` or `NODE_AUTH_TOKEN` is refused (exit 2). zizmor therefore runs `--offline`, and the summary says its online audits did not run.
- The step inputs:
  - osv: `-L` for every lockfile; each `android/**/*.lockfile` not named `gradle.lockfile` goes through `gradle.lockfile:<path>` (both settings lockfiles and the demo's three combination lockfiles); both `verification-metadata.xml` files are auto-detected by name; `load/uv.lock` is skipped with a notice while absent.
  - pip-audit: `uv export --frozen --format requirements-txt --no-emit-project`, then `uv run --project security/pip-audit --frozen pip-audit --require-hashes --disable-pip --no-deps -r <req> --format json`.
  - trivy-config: `--skip-version-check --checks-bundle-repository <TRIVY_CHECKS_BUNDLE_DEFAULT>` over `infra/` and over `helm template openverify deploy/helm/openverify --output-dir <tmp>` (rendered with `$SUPPLY_CHAIN_TOOLS_DIR/helm`, Helm 4.3.1).
  - chart: runs `deploy/helm/openverify/ci/chart-checks.sh` with the tools dir first on PATH, or exits 3 naming chart-policy-11c.
  - pii: `python3 -I security/gitleaks-pii-filter.py --gitleaks $SUPPLY_CHAIN_TOOLS_DIR/gitleaks dir .` from the root, or exits 3 naming sast-pii-11c; any non-zero is a failure.
- The fixtures are synthetic recorded reports in `infra/tests/fixtures/supply-chain/` (no real package, advisory or address). The test runs every step through fake tools: no network.

RED (`8fbed2a80`):

```
$ bash infra/tests/supply-chain.test.sh           (load 4.82 4.01 2.59)
rc=1 # 2 passed, 134 failed, 0 skipped
FAIL - infra/scripts/supply-chain.sh exists
FAIL - osv: a critical, a high, an advisory-rated high and an unscored finding fail the gate (exit 127, expected 1: ... supply-chain.sh: No such file or directory )
```

First GREEN run: 132 passed, 4 failed. Three were message and marker wording: the stale-database line order, the PII notice naming `security/gitleaks-pii.toml`, and the `all` order check reading the end-of-step lines, which now start with `--`. The fourth was the test's own error: zizmor's rows are zero-based (a real finding at row 23 is line 24 of `.github/actions/setup-pnpm/action.yml`), so the fixture's row 9 is line 10. The test was corrected and the commit says so.

GREEN (`156593522`):

```
$ bash infra/tests/supply-chain.test.sh           (load 6.12 5.11 3.36)
rc=0 # 136 passed, 0 failed, 0 skipped
$ uv run --project security/python --frozen ruff check / ruff format --check / mypy --strict infra/scripts/lib/supply-chain-gate.py
All checks passed! / 1 file already formatted / Success: no issues found in 1 source file
```

A defect the real run showed: zizmor reported absolute paths (`/home/.../.github/actions/...`), which no allowlist path could name.

- RED `96d03a581`: rc=1, 136 passed and 2 failed ("an absolute location under --root is matched as its repository path"; "... reported relative to the repository").
- GREEN `2af9dac17`: the zizmor step passes `--root "$repo/"` and the parser strips it. Result: rc=0, 138 passed.

### 3.3 KP10-52: the bundletool fetch's retry and cache

Named borrowed edits: `services/vision/tests/test_fetch_bundletool.py` and `scripts/fetch_bundletool.py`.

RED (`99fb8b59e`):

```
$ (cd services/vision && uv run --frozen pytest tests/test_fetch_bundletool.py -q --no-cov)
11 failed, 11 passed in 0.44s
E   TypeError: fetch() got an unexpected keyword argument 'retry_delay' | 'sleep' | 'cache_dir'
pytest: error: unrecognized arguments: --cache-dir ...
```

GREEN (`a55384f25`): standard library only, pin unchanged.

- `fetch(..., cache_dir=None, retry_delay=2.0, sleep=time.sleep)`.
- A connection failure, a timeout or a 5xx is retried, at most `ATTEMPTS = 5`, with the delay doubling. A 4xx (`FIRST_SERVER_ERROR = 500`) and a size or digest mismatch fail at once, leaving nothing.
- A cached jar is used (`cached`) only when its size and SHA-256 match the pin; otherwise it is discarded and downloaded again. A verified download fills the cache; a refused one does not.
- `--cache-dir`, `BUNDLETOOL_CACHE_DIR`, `BUNDLETOOL_RETRY_DELAY_SECONDS`.

```
$ (cd services/vision && uv run --frozen pytest tests/test_fetch_bundletool.py -q --no-cov)   22 passed in 0.14s
$ ruff check / ruff format --check (vision's config) / mypy --strict scripts/fetch_bundletool.py   all pass
$ python3 -I scripts/fetch_bundletool.py --dest <tmp>/dest --cache-dir <tmp>/cache    downloaded (2 s, load 5.83)
$ ... --dest <tmp>/dest2 --cache-dir <tmp>/cache                                        cached
$ ... --dest <tmp>/dest2                                                                present
```

### 3.4 The supply-chain checks on the tree (C259.1, C259.4)

Each step is one call under the e2e lock (lock wait 0 s), on 2026-11-15 at HEAD between `2af9dac17` and this commit.

| step | exit | time | load (1/5/15) | result |
|---|---|---|---|---|
| osv | 1 | 4 s | 6.53 5.41 3.74 | 16 lockfiles; 63 findings, 31 failing (critical or high), 32 below the gate; OSV API queried live |
| pnpm-audit | 0 | 47 s | 7.37 5.63 3.83 | 11 findings, none high (7 moderate, 4 low); 840 packages with verified registry signatures |
| pip-audit | 1 | 1 s | 6.31 5.61 3.92 | vision: 8 findings (pypdf 6.21.2 x7, opentelemetry-api 1.45.1), each failing as unscored; load/ skipped (absent) |
| zizmor | 1 | 0 s | 6.31 5.61 3.92 | 11 findings: 1 failing (github-env, .github/actions/setup-pnpm/action.yml:24, high, confidence Low), 10 self-repository (low) |
| trivy-config | 0 | 5 s | 6.31 5.61 3.92 | 32 findings over infra/ and the rendered chart, none high or critical; checks bundle 2.3.0 by digest |
| chart | 3 | 0 s | 4.69 5.31 3.95 | deploy/helm/openverify/ci/chart-checks.sh not built yet (chart-policy-11c's): failing closed |
| pii | 0 | 14 s | 4.69 5.31 3.95 | sast-pii-11c's scan: 0 kept of 1,204 matched |
| allowlist | 0 | 0 s | 7.92 5.99 4.20 | 0 entries |

The real critical and high findings, each with the fix that would close it. Every fixed version below is older than 14 days on 2026-11-15, so each is a bump inside rule 3, never an allowlist entry; none is in a published module's release runtime classpath:

- vision (shipped in the vision image): pypdf 6.21.2 to 6.21.4 (2026-10-28), for GHSA-42gh-23hr-vphw, -4vqv-7265-gm2w, -5849-834g-hvw5, -62m5-6wh8-28x7, -cggf-277g-3q54, -mfr5-77xh-9j7h and -x3rh-gjgm-fmqc (CVSS 7.1). opentelemetry-api 1.45.1 to 1.45.2 (2026-10-29): GHSA-mf5v-w3w3-f6cg is medium (5.3) in OSV but fails pip-audit as unscored.
- Android build tooling, from the `androidLintTool` configuration of every module (AGP's lint):
  - bcprov-jdk18on 1.80.2 to 1.85 (2026-07-12): GHSA-9pwp-9qqc-pr26 critical 9.3, GHSA-qp49-qgx5-5m26 8.7;
  - guava 33.4.0-jre to 33.7.2-jre (2026-09-29): GHSA-xxph-c9ww-hj94 8.2.
- Dokka's `dokkaHtmlGeneratorRuntimeResolver~internal`:
  - freemarker 2.3.32 to 2.3.35 (2026-08-23): GHSA-27j2-h3m2-8237 critical 9.1;
  - jsoup 1.16.1 to 1.23.2 (2026-08-26): GHSA-65r4-943x-97jj 8.7;
  - jackson-core and jackson-databind 2.15.3 to 2.22.3 (2026-09-21): GHSA-7hhh-6rmp-j9qf, -r7wm-3cxj-wff9, -cxp5-3px4-pw24, -j3rv-43j4-c7qm, -q4xh-88c3-wmh7, -rmj7-2vxq-3g9f, -wv8q-qhhj-9h54.
- The SDK's host and device test runtime classpaths:
  - guava 33.6.0-jre and 31.0.1-android to 33.7.2 (-jre / -android);
  - jsoup 1.15.1 to 1.23.2;
  - protobuf-javalite 3.19.1 to 3.25.5 (2024-09-18): GHSA-4gg5-vx3j-xwc7, GHSA-735f-pc8j-v9w8.
- The build plugins' classpaths (only in `android/gradle/verification-metadata.xml` and consumer-check's):
  - jdom2 2.0.6 to its four-part patch release of 2021-12-06, "2.0.6" plus ".1" (GHSA-2363-cqg2-863c);
  - jose4j 0.9.5 to 0.9.6 (GHSA-3677-xxcr-wjqv);
  - jackson 2.22.2 to 2.22.3 (GHSA-7hhh-6rmp-j9qf, -p6pp-m3f8-5c89, -cxp5-3px4-pw24, -wv8q-qhhj-9h54);
  - guava 33.7.1-jre to 33.7.2-jre.
- zizmor `github-env` (high, confidence Low), `.github/actions/setup-pnpm/action.yml:24`. The step appends two lines to `$GITHUB_ENV`: a constant, and `pnpm store path`. Fix, in a file this agent does not own:
  - give that step `id: pnpm` and write `store-path=$(pnpm store path --silent)` to `$GITHUB_OUTPUT`;
  - cache `${{ steps.pnpm.outputs.store-path }}`;
  - set `COREPACK_ENABLE_DOWNLOAD_PROMPT: '0'` as `env:` on the action's install step and in the workflows' top-level `env:`, instead of `$GITHUB_ENV`.

No allowlist entry was added: each finding above has a fix, a rule 3 bump or a workflow edit, that is integration-11c's (contractDeviations).

### 3.5 End gate (rule 25: my own paths, the borrowed edits, the checks)

| call | exit | result | time | load |
|---|---|---|---|---|
| install-common.test.sh | 0 | 41 passed | 2 s | 6.14 |
| install-cosign.test.sh | 0 | 18 passed (network) | 9 s | 6.14 |
| install-helm.test.sh | 0 | 21 passed | 4 s | 5.90 |
| install-helm-unittest.test.sh | 0 | 25 passed | 7 s | 5.75 |
| install-kubeconform.test.sh | 0 | 20 passed | 1 s | 5.45 |
| install-chart-testing.test.sh | 0 | 25 passed | 10 s | 5.45 |
| install-kind.test.sh | 0 | 17 passed | 2 s | 5.07 |
| install-kubectl.test.sh | 0 | 26 passed | 18 s | 5.07 |
| install-trivy.test.sh | 0 | 27 passed | 19 s | 5.60 |
| install-syft.test.sh | 0 | 25 passed | 25 s | 6.35 |
| install-grype.test.sh | 0 | 25 passed | 15 s | 11.38 |
| install-osv-scanner.test.sh | 0 | 19 passed | 6 s | 11.15 |
| install-zizmor.test.sh | 0 | 19 passed | 6 s | 10.58 |
| supply-chain.test.sh (with the allowlist's test) | 0 | 138 passed | 34 s | 7.66 |
| supply-chain-skeletons.test.sh | 0 | 108 passed, 12 skipped | | |
| vision static (ruff, format, mypy src tools) | 0 | | 1 s | 6.22 |
| vision pytest, test files 1-58 (`--cov-fail-under=0`) | 0 | 1,371 passed | 225 s | 5.88 -> 5.29 |
| vision pytest, files 59-110 (`--cov-append`, the 80% gate) | 0 | 1,316 passed, 97.44% total | 600 s (at the call cap) | 5.29 -> 9.55 |
| pnpm format:check | 0 | | | 7.66 |

The second vision half reached the 10-minute call cap: pytest itself took 599.96 s at load 5 to 10, and the result was read from its log after it exited 0. At that load the next run splits vision into three parts (rule 8). The supply-chain checks are in 3.4: osv, pip-audit and zizmor exit 1 on the findings above (integration-11c's bumps and workflow fix), and chart exits 3 until chart-policy-11c lands `chart-checks.sh`.

CHECKPOINT scanners DONE at 2af9dac17a97e1264990802695804273bfc7ad66

Handoff (integration-11c, sbom-release-11c, chart-policy-11c):

- Installers: every `infra/scripts/install-<tool>.sh` is filled. osv-scanner 2.7.0: `osv-scanner_SHA256SUMS` and the pin `160c6253...218b`; no cosign signature (SLSA only, not verified). zizmor 1.31.1: the releases API's asset digest and the pin `d185f726...8c99`; no signature. Env: `OSV_SCANNER_*`, `ZIZMOR_*` (`_VERSION` with `_SHA256`, `_CACHE_DIR`), `INSTALL_DIR`, `INSTALL_RETRY_DELAY_SECONDS`.
- CI order: `install-cosign.sh`, then trivy, syft, grype, osv-scanner, zizmor, helm and gitleaks into one `INSTALL_DIR`, which is `SUPPLY_CHAIN_TOOLS_DIR`. Then `bash infra/scripts/supply-chain.sh <step>`, one step per workflow step, with `GITHUB_STEP_SUMMARY` set, no token in the environment, uv on PATH (pip-audit) and pnpm installed (pnpm-audit).
- release.yml's image scans: run Trivy and Grype without `--exit-code`/`--fail-on`, or keep them and add the gate. Gate with `bash infra/scripts/supply-chain.sh gate trivy-image <json>` and `... gate grype <json>`, and check freshness with `... db-age trivy-version <trivy version --format json>` and `... db-age grype-status <grype db status -o json>`. Each exits 1 on a non-allowlisted critical or high, or a database older than 24 hours.
- KP10-52: `python3 -I scripts/fetch_bundletool.py [--cache-dir <dir>]`; a CI cache step (`actions/cache` on `~/.cache/openverify-bundletool` keyed on `scripts/fetch_bundletool.py`) with `--cache-dir` in ci.yml:461 and android-release.yml:104 is integration-11c's and sbom-release-11c's to add.
