/**
 * C278 (Workflow 11E; owner `docs-compliance`): the compliance guide under `docs/compliance/` (not
 * legal advice, not reviewed by counsel while Q7 is open) and its record checks: every page's
 * opening lines, the paths, links and variables each page cites, the access-request section
 * (C278.4, KP11-46) and the retention table (C278.2).
 *
 * `pnpm --filter @openverify/docs-tools docs:compliance` writes what {@link renderCompliance}
 * returns.
 */
import type { CheckFinding, CheckResult, RenderResult, Repository } from '../types.js';
import { accessRequestFindings } from './access-requests.js';
import { guideOpeningFindings } from './opening.js';
import { dataClassification } from '../records/classification.js';
import { RECIPIENTS_PAGE, RECORD_OF_PROCESSING_PAGE, compliancePages } from './pages.js';
import { PROVIDER_FACTS } from './provider-facts.js';
import { renderRecipientsPage } from './recipients.js';
import { renderRecordOfProcessing } from './record-of-processing.js';
import { referenceFindings } from './references.js';
import { retentionFindings } from './retention.js';
import { variableFindings } from './variables.js';

export * from './access-requests.js';
export * from './opening.js';
export * from './pages.js';
export * from './provider-facts.js';
export * from './recipients.js';
export * from './record-of-processing.js';
export * from './references.js';
export * from './retention.js';
export * from './variables.js';

/** Renders this area's generated files from the repository's facts; it never writes them. */
export function renderCompliance(repo: Repository): RenderResult {
  return {
    area: 'compliance',
    status: 'built',
    files: [
      { path: RECIPIENTS_PAGE, content: renderRecipientsPage(PROVIDER_FACTS) },
      {
        path: RECORD_OF_PROCESSING_PAGE,
        content: renderRecordOfProcessing(dataClassification(repo), PROVIDER_FACTS),
      },
    ],
  };
}

const built = (name: string, findings: readonly CheckFinding[]): CheckResult => ({
  name,
  status: 'built',
  findings,
});

/** Runs this area's record checks over the committed guide. */
export function checkCompliance(repo: Repository): readonly CheckResult[] {
  const pages = compliancePages((dir) => repo.listFiles(dir));
  return [
    built('compliance-opening', guideOpeningFindings(repo)),
    built(
      'compliance-references',
      pages.flatMap((path) => referenceFindings(repo, path, repo.readText(path))),
    ),
    built(
      'compliance-variables',
      pages.flatMap((path) => variableFindings(path, repo.readText(path))),
    ),
    built('compliance-access-requests', accessRequestFindings(repo)),
    built('compliance-retention', retentionFindings(repo)),
  ];
}
