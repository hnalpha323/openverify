/**
 * C71.3 (F11): the default report templates `seed:dev` creates, one published template per report
 * type in each environment (`Default watchlist`, ...), with every default and explicit source
 * lists: the sandbox templates select only the sandbox lists (`openverify-sandbox`,
 * `openverify-sandbox-pep`), the production ones the enabled real sources; a template whose
 * resolved list would be empty is skipped and counted. `seedDevEnvironment` reconciles the source
 * rows first (C76.4), then calls this.
 *
 * The signature is frozen by `foundation-6` (Stage 1b). Built by `integration-6a` (Workflow 6A
 * Stage 4): the plan gives the file to `api-reports`, the Stage 1b hook commit to
 * `api-watchlists`, and neither built it.
 */
import { reportTemplateConfigSchema } from '@openverify/contracts';
import { REPORT_REGISTRY, REPORT_TYPES, type ReportType } from '@openverify/core';
import {
  createReportTemplate,
  listReportTemplates,
  listWatchlistSourceRows,
  type Db,
  type EnvironmentKind,
} from '@openverify/db';
import type { Clock, IdGenerator } from '../ports.js';
import { watchlistSourceCatalog } from '../services/reports/source-catalog.js';
import { assertPublishableConfig, defaultSearchLists } from '../services/reports/templates.js';

/** The name of each seeded template (`Default watchlist`, ...): how a later run finds it again. */
export const DEFAULT_REPORT_TEMPLATE_NAMES: Readonly<Record<ReportType, string>> = Object.freeze({
  watchlist: 'Default watchlist',
  'business-watchlist': 'Default business watchlist',
  'crypto-address-watchlist': 'Default crypto address watchlist',
  'politically-exposed-person': 'Default politically exposed person',
  'adverse-media': 'Default adverse media',
  'business-adverse-media': 'Default business adverse media',
  'email-address': 'Default email address',
  'phone-number': 'Default phone number',
  'address-lookup': 'Default address lookup',
  // C106.1 (Phase 7); integration-7a seeds its sandbox template's own settings.
  'ip-address': 'Default IP address',
  // C106.2 (Workflow 7B): no list pinned (`list-ids` null; a fresh environment has none), so each
  // report names its own; not recurring.
  'custom-list': 'Default custom list',
});

export interface SeedReportTemplatesInput {
  environments: Readonly<Record<EnvironmentKind, string>>;
  ids: IdGenerator;
  clock: Clock;
}

/** What the seed did; counts only. */
export interface SeededReportTemplates {
  created: number;
  /** Already there from an earlier run. */
  existing: number;
  /** Not created: the resolved source list would be empty. */
  skipped: number;
}

export type SeedReportTemplates = (
  db: Db,
  input: SeedReportTemplatesInput,
) => Promise<SeededReportTemplates>;

/** The names of the templates already in the environment, by type. */
async function existingNames(db: Db, environmentId: string): Promise<Set<string>> {
  const names = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const page = await listReportTemplates(db, environmentId, { size: 100, after });
    for (const template of page.items) {
      names.add(`${template.reportType}\u0000${template.name}`);
    }
    if (page.next === null) {
      return names;
    }
    after = page.next;
  }
}

/**
 * The source list a seeded template pins (C71.2, C71.3): in a sandbox environment the enabled
 * sandbox-only lists of the type's kind, so a fresh stack answers without a download (F11); in
 * production every enabled source of that kind that is not sandbox-only, which answers
 * `list_unavailable` until the operator syncs (V01). `undefined` for a type without lists.
 */
async function seededSearchLists(
  db: Db,
  kind: EnvironmentKind,
  type: ReportType,
): Promise<string[] | undefined> {
  const sourceKind = REPORT_REGISTRY[type].sourceKind;
  if (sourceKind === null) {
    return undefined;
  }
  if (kind === 'production') {
    return defaultSearchLists(db, kind, type);
  }
  const sandboxLists = watchlistSourceCatalog()
    .all()
    .filter((source) => source.kind === sourceKind && source.sandboxOnly)
    .map((source) => source.id);
  return (await listWatchlistSourceRows(db, sandboxLists))
    .filter((row) => row.enabled)
    .map((row) => row.id)
    .sort();
}

/** C71.3: see the file header. Counts only; a run after an earlier one finds its templates. */
export const seedReportTemplates: SeedReportTemplates = async (db, { environments, ids }) => {
  const counts: SeededReportTemplates = { created: 0, existing: 0, skipped: 0 };
  for (const kind of ['sandbox', 'production'] as const) {
    const environmentId = environments[kind];
    const existing = await existingNames(db, environmentId);
    for (const type of REPORT_TYPES) {
      const name = DEFAULT_REPORT_TEMPLATE_NAMES[type];
      if (existing.has(`${type}\u0000${name}`)) {
        counts.existing += 1;
        continue;
      }
      const lists = await seededSearchLists(db, kind, type);
      if (lists?.length === 0) {
        counts.skipped += 1;
        continue;
      }
      const config: Record<string, unknown> = {
        ...(reportTemplateConfigSchema(type).parse({}) as Record<string, unknown>),
        ...(lists === undefined ? {} : { 'search-lists': lists }),
        ...(type === 'custom-list' ? { 'list-ids': null } : {}),
      };
      // The publish rules every template meets (C71.2), so a seeded one never differs from one
      // created through the API.
      assertPublishableConfig(kind, type, config);
      await createReportTemplate(db, environmentId, {
        id: ids.newId('rptp'),
        name,
        reportType: type,
        version: { id: ids.newId('rptpv'), config },
      });
      counts.created += 1;
    }
  }
  return counts;
};
