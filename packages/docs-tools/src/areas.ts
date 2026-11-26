/** The six areas' entry points, for the CLI (contracts-11e): one render and one check each. */
import { checkCatalog, renderCatalog } from './catalog/index.js';
import { checkCompliance, renderCompliance } from './compliance/index.js';
import { checkRecords, renderRecords } from './records/index.js';
import { checkRelease, renderRelease } from './release/index.js';
import { checkSecurity, renderSecurity } from './security/index.js';
import { checkSelfhost, renderSelfhost } from './selfhost/index.js';
import type { CheckResult, DocsArea, RenderResult, Repository } from './types.js';

export interface AreaEntryPoints {
  readonly render: (repo: Repository) => RenderResult;
  readonly check: (repo: Repository) => readonly CheckResult[];
}

export const AREAS: Readonly<Record<DocsArea, AreaEntryPoints>> = Object.freeze({
  security: { render: renderSecurity, check: checkSecurity },
  records: { render: renderRecords, check: checkRecords },
  selfhost: { render: renderSelfhost, check: checkSelfhost },
  compliance: { render: renderCompliance, check: checkCompliance },
  catalog: { render: renderCatalog, check: checkCatalog },
  release: { render: renderRelease, check: checkRelease },
});
