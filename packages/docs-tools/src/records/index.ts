/**
 * C276 (Workflow 11E; owner `docs-records`): the cryptographic inventory, the data classification (generated from `packages/core/src/connect/categories.ts` and `ENCRYPTED_COLUMNS`), the logging inventory and the vulnerability policy under `docs/security/`, and `SECURITY.md`.
 *
 * `pnpm --filter @openverify/docs-tools docs:records` writes what {@link renderRecords} returns: the
 * data classification, the area's one generated page. The other pages are hand-written, each held
 * by a record test that {@link checkRecords} runs.
 */
import { staleFiles } from '../fresh-render.js';
import type { CheckResult, RenderResult, Repository } from '../types.js';
import { DATA_CLASSIFICATION_PATH, renderDataClassification } from './classification.js';
import { checkCryptoInventory } from './crypto-inventory.js';
import { checkLogging } from './logging.js';
import { checkSecurityIndex } from './security-index.js';
import { checkSecurityPolicy, checkVulnerabilityPolicy } from './vulnerability-policy.js';

export * from './classification.js';
export * from './crypto-inventory.js';
export * from './logging.js';
export * from './vulnerability-policy.js';
export * from './security-index.js';

/** Renders this area's generated files from the repository's facts; it never writes them. */
export const renderRecords: (repo: Repository) => RenderResult = (repo) => ({
  area: 'records',
  status: 'built',
  files: [{ path: DATA_CLASSIFICATION_PATH, content: renderDataClassification(repo) }],
});

/** Runs this area's record and evidence checks over the committed documents. */
export const checkRecords: (repo: Repository) => readonly CheckResult[] = (repo) => [
  {
    name: 'data-classification',
    status: 'built',
    findings: staleFiles(repo, renderRecords(repo).files).map((stale) => ({
      rule: 'fresh-render',
      path: stale.path,
      message: `the committed page ${stale.reason === 'missing' ? 'is missing' : 'differs from a fresh render'}; run pnpm --filter @openverify/docs-tools docs:records`,
      severity: 'error' as const,
    })),
  },
  checkCryptoInventory(repo),
  checkLogging(repo),
  checkVulnerabilityPolicy(repo),
  checkSecurityPolicy(repo),
  checkSecurityIndex(repo),
];
