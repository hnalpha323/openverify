# ADR 0002: Check tiers (R / H / A) and the honesty policy

- **Status:** Accepted. The tiers come from `docs/PLAN.md` §4 and the honesty rules from `CLAUDE.md` rule 5. The field names below are the binding intent; the Phase 1 contract in `packages/core` fixes their exact spelling.
- **Date:** 2026-10-20
- **Related:** `docs/PLAN.md` §2 (check statuses, types, stages) and §4 (catalog); ADR 0001

## Context

OpenVerify reimplements a catalog of 75+ identity-verification checks (`docs/PLAN.md` §4). They fall into three groups:
- Some can be implemented exactly, for example ICAO 9303 check digits, expiry dates and AAMVA header validation.
- Some can only be approximated with signal processing or weak open models, for example tamper, screen-recapture and fabrication detection.
- Some need data or credentials that an open-source project cannot ship, for example AAMVA DLDV, eCBSV, credit bureaus and carrier data.

These results decide whether a real person is approved, declined or sent to review. Overstating what a check can do causes concrete harm:
- fraud gets through when a check "passes" without evidence;
- legitimate users get declined when a weak heuristic is treated as authoritative.

A check that silently passes is worse than no check at all, because operators stop looking.

Shared vocabulary, from `docs/PLAN.md` §2:
- **Check statuses:** `passed`, `failed`, `not_applicable`, `pending`.
- **Check types:** `user_behavior`, which gives the end user a retry hint, and `fraud`.
- **Stages:** `ga`, `beta`, `sunset`.

## Decision

### 1. Every check has a tier

| Tier | Meaning | Example |
|---|---|---|
| **R**, real | Deterministic logic or a permissively licensed open model, with unit tests on synthetic fixtures | `id_mrz_inconsistency_detection`, `id_expired_detection`, `crypto_wallet_validity_detection` |
| **H**, heuristic | Signal-processing or weak-model heuristic. Always `stage: beta`, with a confidence score and reasons | `id_tamper_detection`, `id_electronic_replica_detection`, `selfie_glasses_detection` |
| **A**, adapter | Needs licensed data or credentials. Ships as a provider interface plus a deterministic **sandbox provider** | `id_aamva_database_lookup`, `aamva_name_comparison` |

Combined tiers are written as in the catalog:
- **R+A**: our real matching logic, with records from an adapter. Example: `database_name_comparison`.
- **A/H**: an adapter, with a heuristic default only when a permissive model exists. Example: `id_age_inconsistency_detection`.
- **H/A**: a heuristic default that can be replaced by an adapter. Example: `selfie_suspicious_entity_detection`.

### 2. Every registry entry declares its honesty metadata

Each entry carries:
- `id`: snake_case, exactly as in `docs/PLAN.md` §4;
- `tier`;
- `type`: `user_behavior` or `fraud`;
- `stage`: `ga`, `beta` or `sunset`;
- `version`.

A registry unit test asserts that every §4 check id is present with these fields. H-tier and A/H-tier entries must have `stage: beta`, unless rule 3f promotes them.

### 3. Honesty rules

a. **Never fake `passed`.** A check reports `passed` only when it actually ran on real input and its evidence met the configured threshold. Anything else is reported as such, never as a pass:
   - **Input absent or not relevant**, for example no barcode on a passport: `not_applicable`, with a machine-readable reason.
   - **Still running or retrying:** `pending`.
   - **Could not execute** after retries, for example the model failed to load, the provider erred or timed out, or the image is unreadable: `not_applicable` with reason `execution_error`, or the defined `user_behavior` failure when the cause is the user's capture.

b. **Required checks never auto-approve without evidence.** If a check that the template marks *required* ends `not_applicable` or `pending`, the decision engine routes the inquiry to `needs_review`. It never auto-approves.

c. **Heuristics are labelled.** H-tier results carry:
   - a `confidence` in [0, 1];
   - reason codes;
   - the thresholds that were applied.

   Thresholds are configurable per template. The dashboard shows a **Beta** badge, and the docs describe the method as a heuristic.

d. **Sandbox providers are deterministic and sandbox-only.**
   - The same input always yields the same output, driven by documented magic values, so tests and demos can exercise every outcome.
   - Results are labelled with the provider id and `sandbox: true`.
   - Configuration validation **refuses to bind a sandbox provider in a production environment**, and the service fails to start.

e. **Unconfigured providers in production:** the check returns `not_applicable` with reason `provider_not_configured`. Rule (b) applies if the check is required. The dashboard shows "not configured" rather than a result.

f. **Provenance on every result:**
   - the implementation version;
   - the model id and SHA-256, for model-based checks;
   - the provider id;
   - the thresholds used.

   Promotion to `ga` works as follows:
   - **R-tier:** passing synthetic-fixture tests, plus a calibration report (FAR/FRR on the public-domain fixture set, Phase 4 harness) for model-based checks.
   - **H-tier:** only with a calibration report and review. Otherwise it stays `beta`.

g. **No unearned claims.** The README and docs publish each check's tier and stage. OpenVerify does not claim certifications it does not hold, for example iBeta PAD or ISO/IEC 30107-3 liveness conformance. Limits are stated plainly, for example that liveness is spoofable by injection attacks (`docs/PLAN.md` §9).

### 4. Where it is enforced

| Rule | Enforcement point |
|---|---|
| Registry fields, H-tier ⇒ beta | `packages/core` registry schema and a catalog-completeness unit test |
| (a), (b), (e) | Decision-engine unit tests: required + `not_applicable`/`pending` ⇒ `needs_review`; no code path returns `passed` on error |
| (d) | Configuration validation test: a production environment plus a sandbox provider fails startup |
| (f) | Result schema (zod) requires the provenance fields |

## Alternatives considered

| Option | Why not |
|---|---|
| Ship only R-tier checks | Honest, but it leaves large gaps against the feature map, and operators could not plug in the licensed providers they already pay for. |
| Ship heuristics as `ga` with tuned thresholds | Misleading. Operators would treat weak signals as authoritative. |
| "Mock pass" responses for A-tier checks in production | Dishonest and dangerous: it approves people on fabricated evidence. Rejected outright. |
| Return `failed` when a provider is not configured | It penalises end users for an operator configuration gap. `not_applicable` plus `needs_review` for required checks puts the decision with the operator, where it belongs. |

## Consequences

- **More reasons for the dashboard to explain:** results carry statuses, reason codes and Beta badges. The review UI must show them clearly.
- **Operators carry the cost of required A-tier checks:** they must configure a real provider or accept manual review for those checks. This is intended.
- **Calibration work is needed:** a harness reporting FAR/FRR (Phase 4) is a prerequisite for promoting any model-based check to `ga`.
