/**
 * The frozen switches Workflow 11E's documents read (contracts-11e), in one place:
 *
 * - `vendorNaming` (C280.6, Q8, granted 2026-11-21 by the orchestrator under the owner's delegation:
 *   a factual docs-only migration page naming the source system, no logo, no copied text, a
 *   not-affiliated line; product UI and branding keep the CLAUDE.md bar): on, so the migration
 *   mapping is the vendor-named `docs/migration/from-persona.md`, the catalog's vendor-name column
 *   and the mapping page give the source identifiers as the source API names them, and only that
 *   page (besides the plan's exempt paths) may name the vendor. Turned on by Workflow 11G's
 *   records-11g; `switches.test.ts` holds it to PROGRESS's Q8. Off (Q8 declined), the neutral
 *   `docs/migration/from-hosted-api.md` is the mapping and no page names the vendor.
 * - `publishWired` (C277.1, C262, C285; Q1-Q4 granted 2026-11-21 by the orchestrator under the
 *   owner's delegation): on since Workflow 11G's publish-11g wired `release.yml`'s publish job
 *   (images by digest to GHCR, cosign keyless signatures and SBOM attestations, the chart as an
 *   OCI artifact, build provenance, the npm packages with provenance, a `dry-run` input that
 *   defaults to true). Wired is not published: the job runs only when the owner sets the
 *   repository variable `OPENVERIFY_PUBLISH` to `'true'` and the `release` environment's reviewer
 *   approves the run, and release.yml has never been dispatched (KP10-59). So
 *   `verify-artifacts.md` gives the `cosign verify`, attestation and npm provenance checks and
 *   still says no artifact is signed until the first approved publication
 *   (`selfhost/checks.ts` holds the page and the workflow's wiring to this switch). Off, the page
 *   says "no artifact of this release is signed" and gives no verification command.
 *
 * Changing either is an owner-gated act (C289): each follows its owner item as PROGRESS records it.
 */

export interface DocsSwitches {
  readonly vendorNaming: boolean;
  readonly publishWired: boolean;
}

export const DOCS_SWITCHES: DocsSwitches = Object.freeze({
  vendorNaming: true,
  publishWired: true,
});

/** C280.5: where the migration mapping lives, by the vendor-naming switch. */
export const MIGRATION_PAGES = Object.freeze({
  neutral: 'docs/migration/from-hosted-api.md',
  vendorNamed: 'docs/migration/from-persona.md',
});

/** The migration page the switch selects. */
export function migrationPagePath(switches: DocsSwitches = DOCS_SWITCHES): string {
  return switches.vendorNaming ? MIGRATION_PAGES.vendorNamed : MIGRATION_PAGES.neutral;
}

/** The repository variable `release.yml`'s publish job is gated by (C262.2). */
export const PUBLISH_VARIABLE = 'OPENVERIFY_PUBLISH';
export const RELEASE_WORKFLOW = '.github/workflows/release.yml';

/** What `release.yml`'s `publish` job declares: its `if:` condition and its environment. */
export interface PublishJob {
  readonly condition: string | null;
  readonly environment: string | null;
}

/**
 * Reads the `publish:` job of `release.yml` (two-space job keys under `jobs:`, four-space members)
 * without a YAML library: its `if:` and `environment:` lines. `null` when the job is absent.
 */
export function publishJobOf(workflow: string): PublishJob | null {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === '  publish:');
  if (start < 0) {
    return null;
  }
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:/.test(line));
  const body = lines.slice(start + 1, end < 0 ? lines.length : end);
  const member = (key: string): string | null => {
    const line = body.find((candidate) => candidate.startsWith(`    ${key}:`));
    return line === undefined ? null : line.slice(`    ${key}:`.length).trim();
  };
  return { condition: member('if'), environment: member('environment') };
}

/** Whether the publish job is still gated by the owner's variable in the `release` environment. */
export function publishGatedByVariable(job: PublishJob | null): boolean {
  return (
    job?.environment === 'release' && job.condition?.includes(`vars.${PUBLISH_VARIABLE}`) === true
  );
}
