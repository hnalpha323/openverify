/**
 * The inputs only a `release.yml` run makes (docs-release; C284.4, C257.5, C262.4; KP11-47 (b),
 * (c)): the staged run's record and the chart's copy of the models manifest.
 *
 * `docs/release/staged-run.json` (`openverify/staged-run@1`, docs-release's format) is where the
 * orchestrator records a staged run once one exists: its run id, commit and date, each image's
 * digest, each staged file's SHA-256, and each `security/check-sbom-licences.py` report
 * (`openverify/sbom-licence-report@1`: `artifact`, `result` `pass`/`owner`/`fail`, `owner` items).
 * `release.yml` was never dispatched (KP10-59), so the record does not exist: the release notes say
 * "staged run pending" and release:check reports it (`--tag` refuses it).
 */
import type { CheckFinding, Repository } from '../types.js';

export const STAGED_RUN_PATH = 'docs/release/staged-run.json';
export const STAGED_RUN_SCHEMA = 'openverify/staged-run@1';
export const MODELS_MANIFEST = 'models/manifest.json';
export const CHART_MODELS_MANIFEST = 'deploy/helm/openverify/files/models-manifest.json';

export interface StagedImage {
  readonly name: string;
  readonly digest: string;
}

export interface StagedArtifact {
  readonly path: string;
  readonly sha256: string;
}

export interface LicenceReport {
  readonly artifact: string;
  readonly result: 'pass' | 'owner' | 'fail';
  readonly owner: readonly { readonly name: string; readonly reason?: string }[];
}

export interface StagedRun {
  readonly runId: string;
  readonly commit: string;
  readonly date: string;
  readonly images: readonly StagedImage[];
  readonly artifacts: readonly StagedArtifact[];
  readonly licenceReports: readonly LicenceReport[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  keys.every((key) => typeof value[key] === 'string' && value[key] !== '');

/** Reads the staged run's record: `null` when absent, a message when it is malformed. */
export function readStagedRun(repo: Repository): StagedRun | null | string {
  if (!repo.exists(STAGED_RUN_PATH)) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(repo.readText(STAGED_RUN_PATH));
  } catch {
    return 'the record is not JSON';
  }
  if (!isRecord(data) || data.schema !== STAGED_RUN_SCHEMA) {
    return `the record's schema is not ${STAGED_RUN_SCHEMA}`;
  }
  if (!strings(data, ['run-id', 'commit', 'date'])) {
    return 'the record lacks run-id, commit or date';
  }
  const list = (key: string): Record<string, unknown>[] | null => {
    const value = data[key];
    return Array.isArray(value) && value.every(isRecord) ? value : null;
  };
  const images = list('images');
  const artifacts = list('artifacts');
  const reports = list('licence-reports');
  if (
    images === null ||
    artifacts === null ||
    reports === null ||
    !images.every((image) => strings(image, ['name', 'digest'])) ||
    !artifacts.every((artifact) => strings(artifact, ['path', 'sha256'])) ||
    !reports.every(
      (report) =>
        strings(report, ['artifact']) &&
        ['pass', 'owner', 'fail'].includes(String(report.result)) &&
        Array.isArray(report.owner),
    )
  ) {
    return 'the record lacks images, artifacts or licence-reports in their shape';
  }
  return {
    runId: String(data['run-id']),
    commit: String(data.commit),
    date: String(data.date),
    images: images.map((image) => ({ name: String(image.name), digest: String(image.digest) })),
    artifacts: artifacts.map((artifact) => ({
      path: String(artifact.path),
      sha256: String(artifact.sha256),
    })),
    licenceReports: reports.map((report) => ({
      artifact: String(report.artifact),
      result: report.result as LicenceReport['result'],
      owner: (report.owner as unknown[]).filter(isRecord).map((item) => ({
        name: String(item.name),
        ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
      })),
    })),
  };
}

/** The staged run's rule: pending while none is recorded; each licence report that is not a pass. */
export function stagedFindings(repo: Repository): readonly CheckFinding[] {
  const run = readStagedRun(repo);
  if (run === null) {
    return [
      {
        rule: 'staged-run',
        path: STAGED_RUN_PATH,
        message:
          'orchestrator: no staged release.yml run is recorded: the image digests, checksums and SBOM licence reports are "staged run pending" (KP10-59)',
        severity: 'owner',
      },
    ];
  }
  if (typeof run === 'string') {
    return [{ rule: 'staged-run', path: STAGED_RUN_PATH, message: run, severity: 'error' }];
  }
  return run.licenceReports
    .filter((report) => report.result !== 'pass')
    .map((report) => ({
      rule: 'staged-run',
      path: STAGED_RUN_PATH,
      message: `owner: ${report.artifact}'s licence check is "${report.result}" (${report.owner.map((item) => item.name).join(', ') || 'no owner item named'}): a decision or a built decline outcome is needed`,
      severity: 'owner' as const,
    }));
}

/** KP11-47 (c): the chart's copy of the models manifest equals `models/manifest.json`. */
export function modelsManifestFindings(repo: Repository): readonly CheckFinding[] {
  if (!repo.exists(MODELS_MANIFEST) && !repo.exists(CHART_MODELS_MANIFEST)) {
    return [];
  }
  if (
    !repo.exists(MODELS_MANIFEST) ||
    !repo.exists(CHART_MODELS_MANIFEST) ||
    repo.readText(MODELS_MANIFEST) !== repo.readText(CHART_MODELS_MANIFEST)
  ) {
    return [
      {
        rule: 'models-manifest',
        path: CHART_MODELS_MANIFEST,
        message: `the chart's copy differs from ${MODELS_MANIFEST} (or one is missing): copy ${MODELS_MANIFEST} over it`,
        severity: 'error',
      },
    ];
  }
  return [];
}
