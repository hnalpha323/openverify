/** C71: report templates, versions and their configuration. */
import { REPORT_REGISTRY, REPORT_TYPES, reportConfigDefaultValues } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  REPORT_TEMPLATE_CONFIG_SCHEMAS,
  RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS,
  reportTemplateConfigSchema,
  resolveReportTemplateConfig,
  resolvedReportTemplateConfigSchema,
  watchlistSourceIdSchema,
} from './report-template-config.js';
import {
  buildReportTemplateResource,
  buildReportTemplateVersionResource,
  createReportTemplateBodySchema,
  createReportTemplateVersionBodySchema,
  listReportTemplatesQuerySchema,
  listReportTemplateVersionsQuerySchema,
  publishReportTemplateVersionBodySchema,
  reportTemplateDocumentSchema,
  reportTemplateVersionDocumentSchema,
  reportTemplateVersionName,
  updateReportTemplateBodySchema,
  updateReportTemplateVersionBodySchema,
} from './report-templates.js';
import { readFixture } from './test-support.js';

const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('reportTemplateConfigSchema (C71.2)', () => {
  it('has an input and a resolved schema per type', () => {
    expect(Object.keys(REPORT_TEMPLATE_CONFIG_SCHEMAS)).toEqual([...REPORT_TYPES]);
    expect(Object.keys(RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS)).toEqual([...REPORT_TYPES]);
    for (const type of REPORT_TYPES) {
      expect(reportTemplateConfigSchema(type)).toBe(REPORT_TEMPLATE_CONFIG_SCHEMAS[type]);
      expect(resolvedReportTemplateConfigSchema(type)).toBe(
        RESOLVED_REPORT_TEMPLATE_CONFIG_SCHEMAS[type],
      );
      expect(ok(reportTemplateConfigSchema(type), {}), type).toBe(true);
      expect(ok(reportTemplateConfigSchema(type), { 'unknown-key': true }), type).toBe(false);
    }
  });

  it('recurs only recurrable types, every 1 to 365 days (C71.2, M1)', () => {
    for (const type of REPORT_TYPES) {
      const recurring = { 'recurrence-interval-days': 30 };
      expect(ok(reportTemplateConfigSchema(type), recurring), type).toBe(
        REPORT_REGISTRY[type].recurrable,
      );
      expect(ok(reportTemplateConfigSchema(type), { 'recurrence-interval-days': null }), type).toBe(
        true,
      );
    }
    expect(ok(reportTemplateConfigSchema('watchlist'), { 'recurrence-interval-days': 0 })).toBe(
      false,
    );
    expect(ok(reportTemplateConfigSchema('watchlist'), { 'recurrence-interval-days': 366 })).toBe(
      false,
    );
    expect(ok(reportTemplateConfigSchema('watchlist'), { 'resume-delay-minutes': 1441 })).toBe(
      false,
    );
    expect(ok(reportTemplateConfigSchema('phone-number'), { 'pause-on-match': true })).toBe(false);
  });

  it('takes source ids, the presets as method sets and a custom preset in range (C79.1)', () => {
    const schema = reportTemplateConfigSchema('watchlist');
    expect(
      ok(schema, {
        'search-lists': ['ofac-sdn', 'eu-fsf'],
        'max-list-age-hours': 24,
        'name-matching': {
          preset: 'custom',
          'min-score': 0.75,
          'allow-nicknames': true,
          'typo-budget': 'low',
        },
        'birthdate-matching': 'exact_year',
        'birthdate-filter': 'strict',
        'country-fields': ['nationality'],
        'country-filter': 'off',
        'screen-weak-aliases': true,
      }),
    ).toBe(true);
    expect(ok(schema, { 'name-matching': { preset: 'custom', 'min-score': 0.6 } })).toBe(false);
    expect(ok(schema, { 'name-matching': { preset: 'strict', 'min-score': 0.9 } })).toBe(false);
    expect(ok(schema, { 'search-lists': ['ofac-sdn', 'ofac-sdn'] })).toBe(false);
    expect(ok(schema, { 'max-list-age-hours': 721 })).toBe(false);
    expect(ok(schema, { 'country-fields': ['registration'] })).toBe(false);
    // V01: the schema lets an empty list through so the publish rule answers watchlist_sources_empty.
    expect(ok(schema, { 'search-lists': [] })).toBe(true);
    expect(ok(watchlistSourceIdSchema, 'uk-sanctions-list')).toBe(true);
    expect(ok(watchlistSourceIdSchema, 'OFAC SDN')).toBe(false);
  });

  it('takes the per-type keys of C79.2, C80.5, C81.5 and C82', () => {
    expect(
      ok(reportTemplateConfigSchema('business-watchlist'), {
        'entity-kinds': ['entity', 'vessel'],
        'country-fields': ['registration'],
      }),
    ).toBe(true);
    expect(ok(reportTemplateConfigSchema('business-watchlist'), { 'entity-kinds': [] })).toBe(
      false,
    );
    expect(
      ok(reportTemplateConfigSchema('politically-exposed-person'), {
        'pep-classes': [1, 2, 3],
        'include-relatives': true,
        'default-country': 'GB',
        'keep-without-birthdate': false,
      }),
    ).toBe(true);
    expect(
      ok(reportTemplateConfigSchema('politically-exposed-person'), { 'pep-classes': [5] }),
    ).toBe(false);
    expect(
      ok(reportTemplateConfigSchema('adverse-media'), {
        categories: ['fraud', 'terrorism'],
        'max-article-age-days': 30,
        'allowed-countries': ['GB', 'IE'],
      }),
    ).toBe(true);
    expect(ok(reportTemplateConfigSchema('adverse-media'), { 'max-article-age-days': 91 })).toBe(
      false,
    );
    expect(ok(reportTemplateConfigSchema('adverse-media'), { 'dated-articles-only': true })).toBe(
      false,
    );
    expect(
      ok(reportTemplateConfigSchema('email-address'), {
        'min-domain-age-days': 7,
        'young-domain-days': 90,
      }),
    ).toBe(true);
    expect(ok(reportTemplateConfigSchema('address-lookup'), { 'send-addressee': true })).toBe(true);
    expect(
      ok(reportTemplateConfigSchema('crypto-address-watchlist'), { 'name-matching': {} }),
    ).toBe(false);
  });

  it('resolves a configuration with the core defaults, keeping what the version set', () => {
    for (const type of REPORT_TYPES) {
      const lists =
        REPORT_REGISTRY[type].sourceKind === null ? {} : { 'search-lists': ['ofac-sdn'] };
      const resolved = resolveReportTemplateConfig(type, lists);
      expect(ok(resolvedReportTemplateConfigSchema(type), resolved), type).toBe(true);
      expect(resolved, type).toEqual({ ...reportConfigDefaultValues(type), ...lists });
    }
    expect(
      resolveReportTemplateConfig('watchlist', {
        'search-lists': ['eu-fsf'],
        'recurrence-interval-days': 7,
      }),
    ).toMatchObject({
      'search-lists': ['eu-fsf'],
      'recurrence-interval-days': 7,
      'pause-on-match': false,
    });
    expect(() => resolveReportTemplateConfig('watchlist', {})).toThrow(z.ZodError);
  });
});

describe('report templates and versions (C71.1)', () => {
  it('report-template.json and report-template-version.json parse and re-serialize unchanged', () => {
    for (const [file, schema] of [
      ['api/report-template.json', reportTemplateDocumentSchema],
      ['api/report-template-version.json', reportTemplateVersionDocumentSchema],
    ] as const) {
      const raw = readFixture(file);
      const parsed = schema.parse(raw);
      expect(parsed, file).toEqual(raw);
      expect(z.encode(schema, parsed), file).toEqual(raw);
    }
  });

  it('refuses a configuration of another type, and a draft with a publication time', () => {
    const template = structuredClone(readFixture('api/report-template.json')) as {
      data: { attributes: Record<string, unknown> };
    };
    template.data.attributes['report-type'] = 'phone-number';
    expect(ok(reportTemplateDocumentSchema, template)).toBe(false);
    const version = structuredClone(readFixture('api/report-template-version.json')) as {
      data: { attributes: Record<string, unknown> };
    };
    version.data.attributes.status = 'draft';
    expect(ok(reportTemplateVersionDocumentSchema, version)).toBe(false);
  });

  it('names a version v<N>', () => {
    expect(reportTemplateVersionName(1)).toBe('v1');
    expect(reportTemplateVersionName(12)).toBe('v12');
    expect(() => reportTemplateVersionName(0)).toThrow(RangeError);
  });

  it('creates a template of a type with its version-1 configuration, and edits names and status', () => {
    expect(
      ok(createReportTemplateBodySchema, {
        data: {
          type: 'report-template',
          attributes: {
            name: 'Monthly watchlist',
            'report-type': 'watchlist',
            config: { 'recurrence-interval-days': 30 },
          },
        },
      }),
    ).toBe(true);
    expect(
      ok(createReportTemplateBodySchema, {
        data: {
          attributes: {
            name: 'Phone',
            'report-type': 'phone-number',
            config: { 'pause-on-match': true },
          },
        },
      }),
    ).toBe(false);
    expect(
      ok(createReportTemplateBodySchema, {
        data: { attributes: { name: 'Screening', 'report-type': 'screening' } },
      }),
    ).toBe(false);
    expect(
      ok(updateReportTemplateBodySchema, { data: { attributes: { status: 'archived' } } }),
    ).toBe(true);
    expect(ok(updateReportTemplateBodySchema, { data: { attributes: {} } })).toBe(false);
  });

  it('drafts a version for a template, its configuration checked by the template type at the service', () => {
    expect(
      ok(createReportTemplateVersionBodySchema, {
        data: {
          attributes: {
            'report-template-id': 'rptp_01M5CJXHG07XPHF3HRM6NREDH8',
            config: { 'search-lists': ['ofac-sdn'] },
          },
        },
      }),
    ).toBe(true);
    expect(
      ok(updateReportTemplateVersionBodySchema, { data: { attributes: { config: {} } } }),
    ).toBe(true);
    expect(ok(updateReportTemplateVersionBodySchema, { data: { attributes: {} } })).toBe(false);
    expect(ok(publishReportTemplateVersionBodySchema, undefined)).toBe(true);
    expect(
      ok(listReportTemplatesQuerySchema, { 'filter[report-type]': 'watchlist,phone-number' }),
    ).toBe(true);
    expect(
      ok(listReportTemplateVersionsQuerySchema, {
        'filter[report-template-id]': 'rptp_01M5CJXHG07XPHF3HRM6NREDH8',
        'filter[status]': 'draft',
      }),
    ).toBe(true);
  });

  it('builds the template and version resources with the resolved configuration', () => {
    const at = new Date('2026-10-27T09:00:00.000Z');
    const version = {
      id: 'rptpv_01M5CJXHG07XPHF3HRM6NREDH8',
      reportTemplateId: 'rptp_01M5CJXHG07XPHF3HRM6NREDH8',
      reportType: 'email-address' as const,
      versionNumber: 2,
      status: 'draft' as const,
      config: { 'min-domain-age-days': 10 },
      createdAt: at,
      publishedAt: null,
    };
    expect(buildReportTemplateVersionResource(version)).toMatchObject({
      type: 'report-template-version',
      attributes: {
        'version-number': 2,
        status: 'draft',
        'report-type': 'email-address',
        config: { 'min-domain-age-days': 10, 'young-domain-days': 365 },
        'published-at': null,
      },
      relationships: { 'report-template': { data: { id: version.reportTemplateId } } },
    });
    expect(
      buildReportTemplateResource({
        id: version.reportTemplateId,
        name: 'Default email address',
        reportType: 'email-address',
        status: 'active',
        createdAt: at,
        updatedAt: at,
        currentVersion: {
          id: version.id,
          versionNumber: 2,
          config: version.config,
          createdAt: at,
          publishedAt: at,
        },
      }),
    ).toMatchObject({
      type: 'report-template',
      attributes: { 'report-type': 'email-address', 'current-version': { 'version-number': 2 } },
    });
  });
});
