# Verifying release artifacts

**No artifact of this release is signed yet.** Staged workflow artifacts are unsigned: check each one against the run's `SHA256SUMS`. Image signatures, SBOM attestations, build provenance and npm provenance exist only from the first approved publication on, and until that publication no image, chart or npm package of this release is signed, attested or published to a registry (C277.1, C262, C285; review H16). The publish job that will make them is wired (owner items Q1 to Q4 granted on 2026-11-21, Workflow 11G), but `.github/workflows/release.yml` has never run (KP10-59). The docs test `packages/docs-tools/src/selfhost/checks.ts` holds this page to the publish switch, `publishWired` in `packages/docs-tools/src/switches.ts`, and to the workflow's wiring.

## What is defined, and what has run

- **`.github/workflows/release.yml`** is defined and has never run. Started by hand only, it builds the five images (and the flow image's no-guidance variant), the chart package and the three npm tarballs; scans each image and writes SBOMs with a licence check; installs and upgrades the chart on kind; searches every artifact for files that must never ship; and stages every artifact with `SHA256SUMS` and the release notes as workflow artifacts kept 30 days.
- **Its `publish` job** runs only from `main`, only in the `release` environment (whose reviewer approves each run) and only when the repository variable `OPENVERIFY_PUBLISH` is `'true'`; none of these exists yet, and each is the owner's release-time step. Every dispatch is a dry run unless its `dry-run` input is set to false: a dry run checks every staged file against `SHA256SUMS`, checks each loaded image against the build's recorded image id, checks and dry-runs each npm tarball, and prints every push, signature, attestation and publication it would make, making none. With `dry-run` false the first approved dispatch will push each image with its version tag to `ghcr.io/<owner>/openverify-<image>`, sign the digest the push returns with cosign (keyless, the job's OIDC identity) and attest the image's CycloneDX SBOM to it, push the chart package to `oci://ghcr.io/<owner>/charts`, write build provenance (GitHub artifact attestations) for every staged file and every pushed digest, and publish `@openverify/js`, `@openverify/node` and `@openverify/react` with npm provenance through npm's trusted publishing (no stored npm token).
- **It fails closed.** A staged `pending-owner` artifact stops the whole publication before anything is pushed. Today the verify job would fail on two open items: the vision image's licence check fails on what `opencv-python-headless` bundles (FFmpeg, libquadmath, libgfortran; KP11-39, the owner's decision), and the image gate fails on the Debian bases' findings that have no Debian fix and on Node 22.23.4's highs that 22.23.5 fixes (KP11-42, the release step's). So no staged run exists, and the release notes' digests and checksums read "staged run pending" (`docs/release/notes.md`).
- **`.github/workflows/android-release.yml`** is defined and has never run. Nothing is on Maven Central (Phase 10 P4 pending): the Android artifacts are built from source or from the staged local Maven repository the build writes (`docs/android/release-and-support.md`).

## Checking a published artifact (from the first approved publication on)

These checks have nothing to verify until the first approved publication. Every signature and attestation names the release workflow on `main` of `hnalpha323/openverify` as its signer, so check that identity and GitHub's OIDC issuer, never only that a signature exists. Verify by digest, never by tag: read the digest the registry gives for the version tag, then use it below in place of `<digest>`; `<image>` is one of `api`, `dashboard`, `flow`, `flow-noguidance`, `vision` and `code-runner`.

1. **The image signature** (cosign, keyless):

   ```bash
   cosign verify \
     --certificate-identity https://github.com/hnalpha323/openverify/.github/workflows/release.yml@refs/heads/main \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com \
     ghcr.io/hnalpha323/openverify-<image>@sha256:<digest>
   ```

2. **The image's SBOM attestation** (CycloneDX, the SBOM the release's licence check read):

   ```bash
   cosign verify-attestation --type cyclonedx \
     --certificate-identity https://github.com/hnalpha323/openverify/.github/workflows/release.yml@refs/heads/main \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com \
     ghcr.io/hnalpha323/openverify-<image>@sha256:<digest>
   ```

3. **Build provenance** (SLSA Build-track, GitHub artifact attestations), for an image or the chart by digest, and for any staged file, the chart package and the npm tarballs among them:

   ```bash
   gh attestation verify oci://ghcr.io/hnalpha323/openverify-<image>@sha256:<digest> --repo hnalpha323/openverify \
     --signer-workflow hnalpha323/openverify/.github/workflows/release.yml
   gh attestation verify oci://ghcr.io/hnalpha323/charts/openverify@sha256:<digest> --repo hnalpha323/openverify
   gh attestation verify openverify-<version>.tgz --repo hnalpha323/openverify
   ```

4. **The npm packages' provenance:** in a project that installed them, `npm audit signatures` checks each package's registry signature and its provenance attestation (npm's CLI is your own tool; this project adopts none). `pnpm audit signatures` checks the registry signatures only. A tarball fetched from the registry whose SHA-256 matches its line in the release's `SHA256SUMS` is the staged file, and `gh attestation verify` checks it as in step 3.

A signature proves which workflow built an artifact from which commit; it does not prove that the source is free of defects (C262.5).

## What you can check today

1. **Build from source at a commit you have read.** Every image builds from this repository (`infra/docker/*.Dockerfile`, `services/vision/Dockerfile`; [install-compose.md](install-compose.md#steps)); the chart is `deploy/helm/openverify`; the Android modules build with the Gradle wrapper (`docs/android/release-and-support.md`).
2. **Pin what you built by digest.** Record each image's digest (`docker image inspect --format '{{.Id}}'`) when you build it, push it to your registry, and set `<component>.image.digest` in the chart's values.
3. **The inputs are pinned.** Base images are pinned by digest in the Dockerfiles' build arguments and in compose; the tools the scans use are pinned by version and SHA-256 in `infra/scripts/install-*.sh`; npm dependencies by `pnpm-lock.yaml`, Python by each `uv.lock`, Gradle by its lockfiles and `android/gradle/verification-metadata.xml`; model weights by `models/manifest.json`, checked by vision at start.
4. **Scan your own build.** `bash infra/scripts/supply-chain.sh all` runs the per-push checks (osv-scanner, pnpm audit, pip-audit, zizmor, Trivy over the configuration and the chart, the chart's checks, the PII scan, the allowlist's expiry); `python3 -I security/check-sbom-licences.py` checks an SBOM's licences; the Android SBOMs come from `./gradlew cyclonedxBom` in `android/` (CLAUDE.md lists each command).
5. **The licences** of everything shipped are in `THIRD_PARTY_LICENSES.md`, with the two recorded owner exceptions for shipped code (section 6: SCUBA's two files in `openverify-nfc`, and Eigen inside ONNX Runtime) and the licence decisions Q11 records (nodemailer's MIT-0, shipped in the API image, and JUnit 4's EPL-1.0, test scope only).

The release checklist (`docs/release/checklist.md`) keeps every one of these as an open line until the owner closes it.
