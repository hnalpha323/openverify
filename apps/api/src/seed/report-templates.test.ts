/**
 * C71.3 (F11, H09, V01): the default report templates `seed:dev` creates, on PGlite after the
 * source rows are reconciled from the committed manifest (C76.4).
 */
import { REPORT_TYPES, REPORT_REGISTRY, type ReportType } from '@openverify/core';
import {
  createEnvironment,
  listReportTemplates,
  type Db,
  type ReportTemplateWithVersion,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { resolveReportTemplateConfig } from '@openverify/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertPublishableConfig } from '../services/reports/templates.js';
import { ulidIdGenerator } from '../ports.js';
import { fixedClock } from '../test-support/fakes.js';
import { reconcileWatchlistSources } from '../watchlists/reconcile.js';
import { DEFAULT_REPORT_TEMPLATE_NAMES, seedReportTemplates } from './report-templates.js';

const clock = fixedClock(new Date('2026-10-27T12:00:00Z'));

let database: TestDatabase;
let environments: { sandbox: string; production: string };

async function templatesOf(db: Db, environmentId: string): Promise<ReportTemplateWithVersion[]> {
  const all: ReportTemplateWithVersion[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await listReportTemplates(db, environmentId, { size: 100, after });
    all.push(...page.items);
    if (page.next === null) {
      return all;
    }
    after = page.next;
  }
}

function byType(templates: readonly ReportTemplateWithVersion[]) {
  return new Map(templates.map((template) => [template.reportType, template] as const));
}

beforeEach(async () => {
  database = await createTestDatabase();
  const { organization, environment } = await createTestTenant(database.db);
  const production = await createEnvironment(database.db, {
    id: testId('env'),
    organizationId: organization.id,
    kind: 'production',
  });
  environments = { sandbox: environment.id, production: production.id };
});

afterEach(async () => {
  await database.close();
});

describe('seedReportTemplates (C71.3)', () => {
  it('creates one published template per report type in each environment, the sandbox list types selecting only the sandbox lists and the production ones the enabled real sources', async () => {
    await reconcileWatchlistSources(database.db, { disabled: [], clock });

    const seeded = await seedReportTemplates(database.db, {
      environments,
      ids: ulidIdGenerator,
      clock,
    });

    // Eleven types (the nine of Phase 6 and Phase 7's ip-address and custom-list) in two environments.
    expect(seeded).toEqual({ created: 22, existing: 0, skipped: 0 });
    const sandbox = byType(await templatesOf(database.db, environments.sandbox));
    const production = byType(await templatesOf(database.db, environments.production));
    expect([...sandbox.keys()].sort()).toEqual([...REPORT_TYPES].sort());
    expect([...production.keys()].sort()).toEqual([...REPORT_TYPES].sort());
    for (const type of REPORT_TYPES) {
      for (const template of [sandbox.get(type), production.get(type)]) {
        expect(template).toMatchObject({
          name: DEFAULT_REPORT_TEMPLATE_NAMES[type],
          status: 'active',
          currentVersion: { version: 1, status: 'published' },
        });
      }
    }
    expect(DEFAULT_REPORT_TEMPLATE_NAMES.watchlist).toBe('Default watchlist');

    const lists = (template: ReportTemplateWithVersion | undefined) =>
      template?.currentVersion.config['search-lists'];
    // The sandbox templates select only the synthetic lists the seed imports (F11, decision 14).
    for (const type of ['watchlist', 'business-watchlist', 'crypto-address-watchlist'] as const) {
      expect(lists(sandbox.get(type))).toEqual(['openverify-sandbox']);
      // Production: the enabled real sanctions sources, never a sandbox list (P13); un-sc is
      // disabled by default (decision 1).
      expect(lists(production.get(type))).toEqual([
        'eu-fsf',
        'ofac-consolidated',
        'ofac-sdn',
        'uk-sanctions-list',
      ]);
    }
    expect(lists(sandbox.get('politically-exposed-person'))).toEqual(['openverify-sandbox-pep']);
    // V01: the production PEP template pins wikidata-pep before any sync.
    expect(lists(production.get('politically-exposed-person'))).toEqual(['wikidata-pep']);
    for (const type of REPORT_TYPES.filter((each) => REPORT_REGISTRY[each].sourceKind === null)) {
      expect(sandbox.get(type)?.currentVersion.config).not.toHaveProperty('search-lists');
    }
  });

  it('seeds templates that publish in their environment kind with the default configuration', async () => {
    await reconcileWatchlistSources(database.db, { disabled: [], clock });
    await seedReportTemplates(database.db, { environments, ids: ulidIdGenerator, clock });

    for (const kind of ['sandbox', 'production'] as const) {
      const templates = await templatesOf(database.db, environments[kind]);
      expect(templates).toHaveLength(REPORT_TYPES.length);
      for (const template of templates) {
        const type: ReportType = template.reportType;
        const config = template.currentVersion.config;
        expect(() => {
          assertPublishableConfig(kind, type, config);
        }).not.toThrow();
        expect(resolveReportTemplateConfig(type, config)).toBeDefined();
      }
    }
  });

  it('seeds the custom-list template with no pinned list, so each report names its own (C106.2)', async () => {
    await reconcileWatchlistSources(database.db, { disabled: [], clock });
    await seedReportTemplates(database.db, { environments, ids: ulidIdGenerator, clock });

    for (const kind of ['sandbox', 'production'] as const) {
      const template = byType(await templatesOf(database.db, environments[kind])).get(
        'custom-list',
      );
      // A fresh environment has no list, so nothing is pinned and no list provenance is guessed;
      // the template is not recurring, and nothing on it pauses or resumes a run.
      expect(template?.currentVersion.config).toEqual({ 'list-ids': null });
      expect(
        resolveReportTemplateConfig('custom-list', template?.currentVersion.config ?? {}),
      ).toMatchObject({ 'list-ids': null, 'recurrence-interval-days': null });
      expect(template?.currentVersion.config).not.toHaveProperty('search-lists');
    }
  });

  it('finds the templates of an earlier run and creates none again', async () => {
    await reconcileWatchlistSources(database.db, { disabled: [], clock });
    await seedReportTemplates(database.db, { environments, ids: ulidIdGenerator, clock });

    const again = await seedReportTemplates(database.db, {
      environments,
      ids: ulidIdGenerator,
      clock,
    });

    expect(again).toEqual({ created: 0, existing: 22, skipped: 0 });
    expect(await templatesOf(database.db, environments.sandbox)).toHaveLength(REPORT_TYPES.length);
  });

  it('skips and counts a template whose resolved list would be empty', async () => {
    await reconcileWatchlistSources(database.db, {
      disabled: [
        'ofac-sdn',
        'ofac-consolidated',
        'eu-fsf',
        'uk-sanctions-list',
        'openverify-sandbox',
      ],
      clock,
    });

    const seeded = await seedReportTemplates(database.db, {
      environments,
      ids: ulidIdGenerator,
      clock,
    });

    // The three sanctions types in both environments; PEP and the other types are created.
    expect(seeded).toEqual({ created: 16, existing: 0, skipped: 6 });
    const sandbox = byType(await templatesOf(database.db, environments.sandbox));
    expect(sandbox.has('watchlist')).toBe(false);
    expect(
      sandbox.get('politically-exposed-person')?.currentVersion.config['search-lists'],
    ).toEqual(['openverify-sandbox-pep']);
  });
});
