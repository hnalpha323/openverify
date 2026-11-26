/**
 * C273, C274 and C275 (Workflow 11E; owner `docs-security`): the threat model (`docs/security/threat-model.md`) and its parsing test, the ASVS 5.0.0 Level 2 checklist (`docs/security/asvs-5.0.0-l2.csv`) and its evidence test, the generated `docs/security/asvs-summary.md`, and the MASVS v2.1.0 checklist (`docs/security/masvs-2.1.0.csv`).
 *
 * `pnpm --filter @openverify/docs-tools docs:security` writes what {@link renderSecurity} returns.
 * C274.6's staleness reads git, so it is {@link checkSecurityWith}'s, with an injected history:
 * `checkSecurityWith(repo, { history: createGitEvidenceHistory(repo.root) })` in the real tree.
 */
import type { CheckFinding, CheckResult, RenderResult, Repository } from '../types.js';
import {
  ASVS_CSV_PATH,
  ASVS_IDS_PATH,
  MASVS_CSV_PATH,
  MASVS_IDS_PATH,
  parseSecurityChecklist,
  parseStandardIdList,
  securityChecklistFindings,
  type SecurityChecklistRow,
} from './checklist.js';
import { stalenessCheck, type EvidenceHistory } from './staleness.js';
import { ASVS_SUMMARY_PATH, renderAsvsSummary } from './summary.js';
import { THREAT_MODEL_PATH, parseThreatModel, threatModelFindings } from './threat-model.js';

export * from './threat-model.js';
export * from './checklist.js';
export * from './summary.js';
export * from './staleness.js';

const missing = (name: string, path: string, contract: string): CheckResult => ({
  name,
  status: 'built',
  findings: [
    {
      rule: 'missing',
      path,
      message: `${path} is missing (${contract})`,
      severity: 'error',
    } satisfies CheckFinding,
  ],
});

/** The committed rows of a checklist, or none when its file is absent. */
const rowsOf = (repo: Repository, path: string): readonly SecurityChecklistRow[] =>
  repo.exists(path) ? parseSecurityChecklist(repo.readText(path)) : [];

/** Renders this area's generated files from the repository's facts; it never writes them. */
export const renderSecurity: (repo: Repository) => RenderResult = (repo) => ({
  area: 'security',
  status: 'built',
  files: [
    {
      path: ASVS_SUMMARY_PATH,
      content: renderAsvsSummary(rowsOf(repo, ASVS_CSV_PATH), rowsOf(repo, MASVS_CSV_PATH)),
    },
  ],
});

/** C273.4: the threat model's rules, or one `missing` finding when the file is absent. */
export function checkThreatModel(repo: Repository): CheckResult {
  if (!repo.exists(THREAT_MODEL_PATH)) {
    return missing('threat-model', THREAT_MODEL_PATH, 'C273.1');
  }
  return {
    name: 'threat-model',
    status: 'built',
    findings: threatModelFindings(repo, parseThreatModel(repo.readText(THREAT_MODEL_PATH))),
  };
}

/** C274.3 or C275.3 over one checklist, with the threat model's ids. */
function checkChecklist(
  repo: Repository,
  name: string,
  csvPath: string,
  idsPath: string,
  contract: string,
): CheckResult {
  if (!repo.exists(csvPath) || !repo.exists(idsPath)) {
    return missing(name, repo.exists(csvPath) ? idsPath : csvPath, contract);
  }
  const threatIds = new Set(
    repo.exists(THREAT_MODEL_PATH)
      ? parseThreatModel(repo.readText(THREAT_MODEL_PATH)).rows.map((row) => row.id)
      : [],
  );
  const ids = parseStandardIdList(repo.readText(idsPath));
  return {
    name,
    status: 'built',
    findings: securityChecklistFindings(repo, rowsOf(repo, csvPath), { csvPath, ids, threatIds }),
  };
}

/** Runs this area's record and evidence checks over the committed documents. */
export const checkSecurity: (repo: Repository) => readonly CheckResult[] = (repo) => [
  checkThreatModel(repo),
  checkChecklist(repo, 'asvs', ASVS_CSV_PATH, ASVS_IDS_PATH, 'C274.1'),
  checkChecklist(repo, 'masvs', MASVS_CSV_PATH, MASVS_IDS_PATH, 'C275.1'),
];

/** What {@link checkSecurityWith} needs beside the repository. */
export interface SecurityCheckDeps {
  /** C274.6's history: the files changed since a commit (git in the real tree). */
  readonly history: EvidenceHistory;
}

/** {@link checkSecurity} plus C274.6's staleness of both checklists, as `owner` findings. */
export const checkSecurityWith: (
  repo: Repository,
  deps: SecurityCheckDeps,
) => readonly CheckResult[] = (repo, deps) => [
  ...checkSecurity(repo),
  stalenessCheck('asvs-staleness', ASVS_CSV_PATH, rowsOf(repo, ASVS_CSV_PATH), deps.history),
  stalenessCheck('masvs-staleness', MASVS_CSV_PATH, rowsOf(repo, MASVS_CSV_PATH), deps.history),
];
