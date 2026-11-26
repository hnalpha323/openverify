/**
 * C277 (Workflow 11E; owner `docs-selfhost`): the self-hosting guide under `docs/self-hosting/`, its
 * generated `configuration.md` (from `apps/api/src/config-registry.ts`), the generated blocks inside
 * three hand-written pages (the load report's figures in `sizing.md`, the metric registry in
 * `monitoring.md`, the migration files in `upgrades.md`), and the record checks over every page.
 * `pnpm --filter @openverify/docs-tools docs:selfhost` writes what {@link renderSelfhost} returns;
 * nothing here writes.
 */
import { METRIC_REGISTRY } from '../../../../apps/api/src/metrics-registry.js';
import { staleFiles } from '../fresh-render.js';
import type {
  CheckFinding,
  CheckResult,
  GeneratedFile,
  RenderResult,
  Repository,
} from '../types.js';
import { spliceBlock } from './blocks.js';
import {
  SELFHOST_DIR,
  checkCommands,
  checkLinks,
  checkPages,
  checkPublishSwitch,
  checkQuotedFacts,
  checkRepositoryPaths,
  checkVariableNames,
} from './checks.js';
import { CONFIGURATION_PAGE, renderConfigurationReference } from './configuration.js';
import {
  ASVS_CSV,
  HARDENING_PAGE,
  MASVS_CSV,
  parseChecklist,
  renderHardeningChecklist,
} from './hardening.js';
import {
  LOAD_REPORT,
  MIGRATIONS_DIR,
  SUMMARY_SCHEMA,
  readSummaryBlock,
  renderLoadFigures,
  renderMetricTable,
  renderMigrationList,
} from './figures.js';

export { CONFIGURATION_PAGE, renderConfigurationReference } from './configuration.js';

/** A generated block inside a hand-written page: its page, its name and how it renders. */
export interface SelfhostBlock {
  readonly page: string;
  readonly name: string;
  /** The block's body, or the reason it cannot be rendered. */
  readonly render: (repo: Repository) => { body: string } | { error: string };
}

/** The generated blocks of this area. */
export const SELFHOST_BLOCKS: readonly SelfhostBlock[] = [
  {
    page: `${SELFHOST_DIR}/sizing.md`,
    name: 'selfhost-load-figures',
    render: (repo) => {
      if (!repo.exists(LOAD_REPORT) || !repo.exists(SUMMARY_SCHEMA)) {
        return { error: `${LOAD_REPORT} or ${SUMMARY_SCHEMA} is missing` };
      }
      const read = readSummaryBlock(
        repo.readText(LOAD_REPORT),
        JSON.parse(repo.readText(SUMMARY_SCHEMA)) as unknown,
      );
      return read.summary === null
        ? { error: `${LOAD_REPORT}: ${read.errors.join('; ')}` }
        : { body: renderLoadFigures(read.summary) };
    },
  },
  {
    page: `${SELFHOST_DIR}/monitoring.md`,
    name: 'selfhost-metrics',
    render: () => ({ body: renderMetricTable(METRIC_REGISTRY) }),
  },
  {
    page: `${SELFHOST_DIR}/upgrades.md`,
    name: 'selfhost-migrations',
    render: (repo) => ({ body: renderMigrationList(repo.listFiles(MIGRATIONS_DIR)) }),
  },
];

/** Each block's page with the block re-rendered, or why it cannot be. */
function renderBlocks(repo: Repository): {
  files: GeneratedFile[];
  findings: CheckFinding[];
} {
  const files: GeneratedFile[] = [];
  const findings: CheckFinding[] = [];
  for (const block of SELFHOST_BLOCKS) {
    const problem = (message: string): void => {
      findings.push({ rule: 'generated-block', path: block.page, message, severity: 'error' });
    };
    if (!repo.exists(block.page)) {
      problem(`is missing, so its ${block.name} block cannot be rendered`);
      continue;
    }
    const rendered = block.render(repo);
    if ('error' in rendered) {
      problem(rendered.error);
      continue;
    }
    const content = spliceBlock(repo.readText(block.page), block.name, rendered.body);
    if (content === null) {
      problem(`does not hold the ${block.name} markers once each, start before end`);
      continue;
    }
    files.push({ path: block.page, content });
  }
  return { files, findings };
}

/** The hardening checklist from the two checklists, or why it cannot be rendered. */
function renderHardening(repo: Repository): {
  files: GeneratedFile[];
  findings: CheckFinding[];
} {
  const findings: CheckFinding[] = [];
  const rows = [ASVS_CSV, MASVS_CSV].map((csv) => {
    const parsed = repo.exists(csv)
      ? parseChecklist(repo.readText(csv))
      : { rows: [], errors: ['is missing'] };
    for (const error of parsed.errors) {
      findings.push({
        rule: 'generated-page',
        path: csv,
        message: `${error}, so ${HARDENING_PAGE} cannot be rendered`,
        severity: 'error',
      });
    }
    return parsed.rows;
  });
  if (findings.length > 0) {
    return { files: [], findings };
  }
  return {
    files: [
      { path: HARDENING_PAGE, content: renderHardeningChecklist(rows[0] ?? [], rows[1] ?? []) },
    ],
    findings,
  };
}

/** The generated files of this area, rendered in memory. */
function generatedFiles(repo: Repository): readonly GeneratedFile[] {
  return [
    { path: CONFIGURATION_PAGE, content: renderConfigurationReference() },
    ...renderHardening(repo).files,
    ...renderBlocks(repo).files,
  ];
}

/** Renders this area's generated files from the repository's facts; it never writes them. */
export const renderSelfhost: (repo: Repository) => RenderResult = (repo) => ({
  area: 'selfhost',
  status: 'built',
  files: generatedFiles(repo),
});

/** The generated pages and blocks whose committed copy is missing or differs from a fresh render. */
function checkFreshRender(repo: Repository): CheckResult {
  return {
    name: 'selfhost-fresh-render',
    status: 'built',
    findings: [
      ...renderBlocks(repo).findings,
      ...renderHardening(repo).findings,
      ...staleFiles(repo, generatedFiles(repo)).map((stale) => ({
        rule: 'fresh-render',
        path: stale.path,
        message: `${stale.reason === 'missing' ? 'is missing' : 'differs from a fresh render'}: run pnpm --filter @openverify/docs-tools docs:selfhost`,
        severity: 'error' as const,
      })),
    ],
  };
}

/** Runs this area's record and evidence checks over the committed documents. */
export const checkSelfhost: (repo: Repository) => readonly CheckResult[] = (repo) => [
  checkFreshRender(repo),
  checkPages(repo),
  checkVariableNames(repo),
  checkCommands(repo),
  checkRepositoryPaths(repo),
  checkLinks(repo),
  checkPublishSwitch(repo),
  checkQuotedFacts(repo),
];
