/**
 * C279, C280 and C281 (Workflow 11E; owner `docs-catalog`): `docs/checks/catalog.md` and `docs/checks/limits.json`, `docs/api/README.md`, the neutral mapping `docs/migration/from-hosted-api.md` (under the vendor-naming switch of `src/switches.ts`) and the sharing guide under `docs/connect/`.
 *
 * `pnpm --filter @openverify/docs-tools docs:catalog` writes what {@link renderCatalog} returns;
 * {@link checkCatalog} runs the area's record checks and its fresh-render check, never writing.
 */
import { staleFiles } from '../fresh-render.js';
import type {
  CheckFinding,
  CheckResult,
  GeneratedFile,
  RenderResult,
  Repository,
} from '../types.js';
import { apiReferenceFindings, renderApiReference } from './api-reference.js';
import { calibrationFindings } from './calibration.js';
import { familyPageFindings, limitsFindings, renderCheckCatalog } from './check-catalog.js';
import { connectGuideFindings } from './connect-guide.js';
import { mappingFindings, mappingRows, renderConnectMapping, renderMigration } from './mapping.js';
import { routeTableFor } from './route-table.js';
import { DOCS_SWITCHES } from '../switches.js';

export * from './api-reference.js';
export * from './calibration.js';
export * from './check-catalog.js';
export * from './connect-guide.js';
export * from './mapping.js';
export * from './mapping-data.js';
export * from './route-table.js';

/** The area's generated files, rendered from the repository's facts. */
function catalogFiles(repo: Repository): readonly GeneratedFile[] {
  const switches = DOCS_SWITCHES;
  const vendorNames = switches.vendorNaming
    ? Object.fromEntries(
        mappingRows(repo)
          .filter((row) => row.section === 'checks' && row.counterpart !== null)
          .map((row) => [row.identifier, [row.identifier]]),
      )
    : undefined;
  const optional = [
    renderApiReference(repo, routeTableFor(repo)),
    renderMigration(repo, switches),
    renderConnectMapping(repo, switches),
  ].filter((file): file is GeneratedFile => file !== null);
  return [
    renderCheckCatalog(repo, vendorNames === undefined ? { switches } : { switches, vendorNames }),
    ...optional,
  ];
}

/** Renders this area's generated files from the repository's facts; it never writes them. */
export const renderCatalog: (repo: Repository) => RenderResult = (repo) => ({
  area: 'catalog',
  status: 'built',
  files: catalogFiles(repo),
});

const result = (name: string, findings: readonly CheckFinding[]): CheckResult => ({
  name,
  status: 'built',
  findings,
});

/** Runs this area's record and evidence checks over the committed documents. */
export const checkCatalog: (repo: Repository) => readonly CheckResult[] = (repo) => [
  result('catalog-limits', limitsFindings(repo)),
  result('catalog-family-pages', familyPageFindings(repo)),
  result('catalog-calibration', calibrationFindings(repo)),
  result('catalog-api-reference', apiReferenceFindings(repo)),
  result('catalog-mapping', mappingFindings(repo)),
  result('catalog-connect-guide', connectGuideFindings(repo)),
  result(
    'catalog-fresh',
    staleFiles(repo, catalogFiles(repo)).map((file) => ({
      rule: 'catalog-fresh',
      path: file.path,
      message: `${file.reason === 'missing' ? 'missing' : 'differs from a fresh render'}: run pnpm --filter @openverify/docs-tools docs:catalog`,
      severity: 'error',
    })),
  ),
];
