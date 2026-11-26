/**
 * C69-C75, C79-C82: the report resources, their bodies and history, and the C70.3 PII marks.
 * The golden fixtures (`contracts/fixtures/api/report-*.json`) are synthetic.
 */
import { REPORT_REGISTRY, REPORT_TYPES, type ReportType } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  PHONE_RISK_REASONS,
  PII_REPORT_ATTRIBUTES,
  REPORT_NOTICES,
  REPORT_RESOURCE_SCHEMAS,
  REPORT_SYNC_LIMITS,
  REPORT_UNAVAILABLE_REASONS,
  buildReportActionResource,
  buildReportResource,
  buildReportRunResource,
  createReportBodySchema,
  dashboardReportDocumentSchema,
  dismissReportBodySchema,
  listReportsQuerySchema,
  reportDocumentSchema,
  reportHistoryDocumentSchema,
  reportHistoryQuerySchema,
  reportListDocumentSchema,
  reviewReportBodySchema,
  runReportBodySchema,
  type ReportRecord,
} from './reports.js';
import { readFixture } from './test-support.js';

type Json = Record<string, unknown>;

/** A match id (`rpm_`), the public `record-token` of a review. */
const MATCH = 'rpm_01M5CJXHG07XPHF3HRM6NREDH8';

const fixture = (type: ReportType): { data: Json & { attributes: Json } } =>
  readFixture(`api/report-${type}.json`) as { data: Json & { attributes: Json } };

const SHARED_ATTRIBUTES = [
  'status',
  'created-at',
  'completed-at',
  'redacted-at',
  'report-template-version-name',
  'has-match',
  'is-continuous',
  'is-recurring',
  'tags',
  'query',
  'origin',
  'errors',
  'unavailable-fields',
  'coverage',
  'next-run-at',
  'paused-at',
  'paused-reason',
  'sources',
  'query-sources',
  'matcher-version',
  'provider',
  'thresholds',
  'notices',
];

const PLAIN_TYPES = REPORT_TYPES.filter((type) => REPORT_REGISTRY[type].review === 'none');

/** A copy of a report document with its attributes changed. */
function withAttributes(type: ReportType, change: (attributes: Json) => void) {
  const document = structuredClone(fixture(type));
  change(document.data.attributes);
  return document;
}

describe('report resources (C70.2)', () => {
  it('has one schema per type, in REPORT_TYPES order, each accepting only its own golden fixture', () => {
    expect(REPORT_RESOURCE_SCHEMAS).toHaveLength(REPORT_TYPES.length);
    REPORT_TYPES.forEach((type, index) => {
      const schema = REPORT_RESOURCE_SCHEMAS[index];
      expect(schema?.safeParse(fixture(type).data).success, type).toBe(true);
      const other = REPORT_TYPES.at((index + 1) % REPORT_TYPES.length) ?? type;
      expect(schema?.safeParse(fixture(other).data).success, `${type} vs ${other}`).toBe(false);
    });
  });

  it.each(REPORT_TYPES)('report-%s.json parses and re-serializes unchanged', (type) => {
    const raw = fixture(type);
    const parsed = reportDocumentSchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect(z.encode(reportDocumentSchema, parsed)).toEqual(raw);
    expect(raw.data).toMatchObject({
      type: `report/${type}`,
      id: expect.stringMatching(/^rep_/) as unknown,
    });
    for (const name of SHARED_ATTRIBUTES) {
      expect(raw.data.attributes, `${type} ${name}`).toHaveProperty([name]);
    }
  });

  it('serves the relationships of the public schema, and the golden reports belong to no transaction (C105.7)', () => {
    for (const type of REPORT_TYPES) {
      const relationships = fixture(type).data.relationships as Json;
      expect(Object.keys(relationships).sort(), type).toEqual(
        [
          'account',
          'accounts',
          'inquiry',
          'report-template',
          'report-template-version',
          'transaction',
        ].sort(),
      );
      expect(relationships.transaction).toEqual({ data: null });
    }
    const transaction = withAttributes('watchlist', () => undefined);
    (transaction.data.relationships as Json).transaction = {
      data: { type: 'transaction', id: 'txn_01M5CJXHG07XPHF3HRM6NREDH7' },
    };
    expect(reportDocumentSchema.safeParse(transaction).success).toBe(true);
  });

  it('is errored exactly when it carries errors, and never answers "no match" with them (C69.3, C69.4)', () => {
    const erroredWithout = withAttributes('watchlist', (attributes) => {
      attributes.status = 'errored';
    });
    expect(reportDocumentSchema.safeParse(erroredWithout).success).toBe(false);
    const readyWith = withAttributes('watchlist', (attributes) => {
      attributes.errors = [{ code: 'list_stale', source: 'ofac-sdn' }];
    });
    expect(reportDocumentSchema.safeParse(readyWith).success).toBe(false);
    const partial = withAttributes('watchlist', (attributes) => {
      // H01: a stale source beside a hit keeps the hit and errors.
      attributes.status = 'errored';
      attributes.errors = [{ code: 'list_stale', source: 'eu-fsf' }];
    });
    expect(reportDocumentSchema.safeParse(partial).success).toBe(true);
    const unknownCode = withAttributes('watchlist', (attributes) => {
      attributes.status = 'errored';
      attributes.errors = [{ code: 'not_screened' }];
    });
    expect(reportDocumentSchema.safeParse(unknownCode).success).toBe(false);
  });

  it('reads has-match from the open matches, and is never matched for a type without review (C70.2, C75.8)', () => {
    const noOpen = withAttributes('watchlist', (attributes) => {
      (attributes.matches as Json[])[0] = {
        ...(attributes.matches as Json[])[0],
        status: 'dismissed',
        'review-status': 'false_positive',
      };
    });
    expect(reportDocumentSchema.safeParse(noOpen).success).toBe(false);
    const masked = withAttributes('watchlist', (attributes) => {
      attributes.matches = null;
    });
    expect(reportDocumentSchema.safeParse(masked).success).toBe(true);
    for (const type of PLAIN_TYPES) {
      const matched = withAttributes(type, (attributes) => {
        attributes['has-match'] = true;
      });
      expect(reportDocumentSchema.safeParse(matched).success, type).toBe(false);
    }
  });

  it.each(REPORT_TYPES)(
    '%s parses with every PII attribute masked, the query member-wise',
    (type) => {
      const masked = withAttributes(type, (attributes) => {
        for (const name of PII_REPORT_ATTRIBUTES) {
          if (name in attributes) {
            attributes[name] = name === 'query' ? attributes[name] : null;
          }
        }
        attributes.query = Object.fromEntries(
          Object.keys(attributes.query as Json).map((key) => [key, null]),
        );
      });
      expect(reportDocumentSchema.safeParse(masked).success).toBe(true);
    },
  );

  it.each(REPORT_TYPES)('%s parses once redacted: every PII attribute null (C73.5)', (type) => {
    const redacted = withAttributes(type, (attributes) => {
      for (const name of PII_REPORT_ATTRIBUTES) {
        if (name in attributes) {
          attributes[name] = null;
        }
      }
      attributes['redacted-at'] = '2026-10-28T09:00:00.000Z';
      attributes['next-run-at'] = null;
      attributes['is-recurring'] = false;
    });
    expect(reportDocumentSchema.safeParse(redacted).success).toBe(true);
  });

  it('says what the business watchlist did not search: null lists with list_not_configured, and no 50% rule (C79.2, H15)', () => {
    const { attributes } = fixture('business-watchlist').data;
    expect(attributes).toMatchObject({
      'fitness-probity-list': null,
      'warning-list': null,
      'lists-searched': ['openverify-sandbox'],
      notices: ['no_ownership_screening'],
    });
    expect(attributes['unavailable-fields']).toEqual([
      { field: 'fitness-probity-list', reason: 'list_not_configured' },
      { field: 'warning-list', reason: 'list_not_configured' },
    ]);
    const empty = withAttributes('business-watchlist', (changed) => {
      changed['warning-list'] = [];
    });
    expect(reportDocumentSchema.safeParse(empty).success).toBe(false);
  });

  it('caps an adverse-media confidence at 0.6 and states the coverage limits (C81.3, C81.5, H13)', () => {
    for (const type of ['adverse-media', 'business-adverse-media'] as const) {
      const { attributes } = fixture(type).data;
      expect(attributes.coverage).toEqual({
        complete: false,
        limits: ['title_only', 'window_90_days', 'lexicon_languages'],
      });
      const overconfident = withAttributes(type, (changed) => {
        (changed.articles as Json[])[0] = { ...(changed.articles as Json[])[0], confidence: 0.9 };
      });
      expect(reportDocumentSchema.safeParse(overconfident).success, type).toBe(false);
      const longTitle = withAttributes(type, (changed) => {
        (changed.articles as Json[])[0] = {
          ...(changed.articles as Json[])[0],
          title: 'x'.repeat(201),
        };
      });
      expect(reportDocumentSchema.safeParse(longTitle).success, type).toBe(false);
    }
  });

  it('never synthesises a phone risk score, and serves the undetermined plan type as null (C82.2, H08)', () => {
    const scored = withAttributes('phone-number', (attributes) => {
      attributes['phone-risk-score'] = 420;
    });
    expect(reportDocumentSchema.safeParse(scored).success).toBe(false);
    const other = withAttributes('phone-number', (attributes) => {
      attributes['phone-type'] = 'FIXED_LINE_OR_MOBILE';
    });
    expect(reportDocumentSchema.safeParse(other).success).toBe(false);
  });

  it('names a reason for every provider line type the risk table reads, other_line_type without a level (owner decision 14)', () => {
    expect(PHONE_RISK_REASONS).toEqual([
      'invalid_number',
      'high_risk_type',
      'voip',
      'prepaid',
      'payphone',
      'personal_number',
      'low_risk_type',
      'line_type_undetermined',
      'other_line_type',
      'sim_swap_24h',
      'sim_swap_7d',
      'ported_30d',
    ]);
    const prepaid = withAttributes('phone-number', (attributes) => {
      attributes['phone-type'] = 'PREPAID';
      attributes['phone-risk-reasons'] = ['prepaid'];
    });
    expect(reportDocumentSchema.safeParse(prepaid).success).toBe(true);
  });

  it('carries the list memberships of an entry on a non-blocking list, and a relative’s PEP class, as optional evidence (owner decision 9)', () => {
    const MEMBERSHIPS = [{ list: 'Synthetic Sectoral List', program: 'SYNTHETIC-SECTORAL' }];
    const firstEntity = (attributes: Json, member: string) => {
      const [holder = {}] = attributes[member] as Json[];
      return (holder.entities as Json[] | undefined)?.[0] ?? holder;
    };
    for (const [type, member] of [
      ['watchlist', 'matched-lists'],
      ['business-watchlist', 'matched-lists'],
      ['crypto-address-watchlist', 'result'],
    ] as const) {
      const listed = withAttributes(type, (attributes) => {
        firstEntity(attributes, member)['list-memberships'] = MEMBERSHIPS;
      });
      expect(reportDocumentSchema.safeParse(listed).success, type).toBe(true);
      const unprogrammed = withAttributes(type, (attributes) => {
        firstEntity(attributes, member)['list-memberships'] = [
          { list: 'Synthetic Sectoral List', program: null },
        ];
      });
      expect(reportDocumentSchema.safeParse(unprogrammed).success, type).toBe(true);
      // Absent, never empty: an entry on no other list carries no member.
      const empty = withAttributes(type, (attributes) => {
        firstEntity(attributes, member)['list-memberships'] = [];
      });
      expect(reportDocumentSchema.safeParse(empty).success, type).toBe(false);
      expect(reportDocumentSchema.safeParse(fixture(type)).success, type).toBe(true);
    }
    const relative = withAttributes('politically-exposed-person', (attributes) => {
      const entity = firstEntity(attributes, 'result');
      entity['pep-type'] = 'relative';
      entity.positions = [];
      entity['relative-of-class'] = 1;
    });
    expect(reportDocumentSchema.safeParse(relative).success).toBe(true);
    for (const [pepType, value] of [
      ['relative', 5],
      ['relative', 0],
      ['pep', 1],
    ] as const) {
      const refused = withAttributes('politically-exposed-person', (attributes) => {
        const entity = firstEntity(attributes, 'result');
        entity['pep-type'] = pepType;
        entity['relative-of-class'] = value;
      });
      expect(reportDocumentSchema.safeParse(refused).success, `${pepType} ${String(value)}`).toBe(
        false,
      );
    }
  });

  it('lists the unavailable-field reasons and notices it uses', () => {
    expect(REPORT_UNAVAILABLE_REASONS).toEqual([
      'provider_not_configured',
      'not_confirmed',
      'not_linked',
      'line_type_undetermined',
      'unsupported_country',
      'list_not_configured',
      'undetermined',
      'execution_error',
      'no_adapter',
      'no_documented_method',
      // C106.1 (Phase 7): the network reasons of the ip-address report.
      'list_stale',
      'list_unavailable',
      'ipv6_not_covered',
      'address_not_public',
      'not_in_known_ranges',
      'not_in_provider_data',
      'client_address_untrusted',
    ]);
    expect(REPORT_NOTICES).toEqual([
      'no_ownership_screening',
      'pep_coverage_uneven',
      'media_coverage_limited',
    ]);
    for (const type of REPORT_TYPES) {
      for (const entry of fixture(type).data.attributes['unavailable-fields'] as Json[]) {
        expect(REPORT_UNAVAILABLE_REASONS, type).toContain(entry.reason);
      }
    }
  });

  it('lists reports in a list document', () => {
    const list = { data: REPORT_TYPES.map((type) => fixture(type).data), links: { next: null } };
    expect(reportListDocumentSchema.parse(list)).toEqual(list);
  });
});

describe('buildReportResource', () => {
  const record: ReportRecord = {
    id: 'rep_01M5CJXHG07XPHF3HRM6NREDH8',
    type: 'phone-number',
    status: 'pending',
    origin: 'inquiry_completion',
    reportTemplateId: 'rptp_01M5CJXHG07XPHF3HRM6NREDH8',
    reportTemplateVersionId: 'rptpv_01M5CJXHG07XPHF3HRM6NREDH8',
    versionNumber: 3,
    inquiryId: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
    accountId: null,
    accountIds: [],
    query: { 'phone-number': '+12025550100' },
    querySources: { 'phone-number': 'otp_confirmed' },
    hasMatch: false,
    completedRunCount: 0,
    tags: [],
    errors: [],
    unavailableFields: [],
    coverage: null,
    nextRunAt: null,
    pausedAt: null,
    pausedReason: null,
    sources: [],
    matcherVersion: null,
    provider: null,
    thresholds: null,
    notices: [],
    attributes: {},
    createdAt: new Date('2026-10-27T09:00:00.000Z'),
    completedAt: null,
    redactedAt: null,
  };

  it('builds a pending report pinned to its version, linked to its inquiry only (C84.2)', () => {
    const resource = buildReportResource(record);
    expect(resource).toMatchObject({
      type: 'report/phone-number',
      id: record.id,
      attributes: {
        status: 'pending',
        'report-template-version-name': 'v3',
        'is-continuous': false,
        'is-recurring': false,
        'query-sources': { 'phone-number': 'otp_confirmed' },
      },
      relationships: {
        inquiry: { data: { type: 'inquiry', id: record.inquiryId } },
        account: { data: null },
        accounts: { data: [] },
        transaction: { data: null },
      },
    });
  });

  it('builds a pending report of every type before its first run, the ip-address type included (C106.1)', () => {
    for (const type of REPORT_TYPES) {
      expect(() => buildReportResource({ ...record, type, query: {} }), type).not.toThrow();
    }
    // Before the first run nothing is flagged and no field has details (integration-7a: the empty
    // attributes once gave the ip-address type a list for both, which the API answered with a 500).
    expect(
      buildReportResource({ ...record, type: 'ip-address', query: { 'ip-address': '192.0.2.10' } })
        .attributes,
    ).toMatchObject({ flagged: false, 'field-details': {}, 'tor-exit-node': null });
  });

  it('is continuous after more than one completed run and recurring while a run is scheduled and not paused (M7)', () => {
    const next = new Date('2026-11-27T09:00:00.000Z');
    expect(
      buildReportResource({ ...record, type: 'phone-number', completedRunCount: 2 }),
    ).toMatchObject({ attributes: { 'is-continuous': true, 'is-recurring': false } });
    const monitored = {
      ...record,
      type: 'watchlist' as const,
      query: { term: 'Avery Quillfeather' },
      querySources: { term: 'request' as const },
      nextRunAt: next,
      coverage: { complete: true, limits: [] },
      matcherVersion: 'openverify-watchlist/0.1.0+keys.1',
      attributes: { 'matched-lists': [], 'ignore-list': [], matches: [] },
    };
    expect(buildReportResource(monitored)).toMatchObject({ attributes: { 'is-recurring': true } });
    expect(
      buildReportResource({ ...monitored, pausedAt: next, pausedReason: 'operator' }),
    ).toMatchObject({ attributes: { 'is-recurring': false, 'paused-reason': 'operator' } });
  });

  it('refuses a record its type does not fit', () => {
    expect(() => buildReportResource({ ...record, hasMatch: true })).toThrow(z.ZodError);
  });
});

describe('POST /api/v1/reports body (C72.1, H22)', () => {
  const body = (type: ReportType, extra: Json = {}, meta?: Json) => ({
    data: {
      type: `report/${type}`,
      attributes: {
        'report-template-id': 'rptp_01M5CJXHG07XPHF3HRM6NREDH8',
        query: fixture(type).data.attributes.query,
        ...extra,
      },
    },
    ...(meta === undefined ? {} : { meta }),
  });

  it.each(REPORT_TYPES)('takes the public %s request shape', (type) => {
    expect(createReportBodySchema.safeParse(body(type)).success).toBe(true);
  });

  it('takes account-id, our inquiry-id and the public meta options', () => {
    expect(
      createReportBodySchema.safeParse(
        body(
          'watchlist',
          {
            'account-id': 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8',
            'inquiry-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
          },
          {
            'auto-create-account': false,
            'auto-create-account-type-id': 'acctp_01M5CJXHZMQ72CZPQ5Y3XGC48W',
            'auto-create-account-reference-id': 'customer-1001',
            'processing-mode': 'sync',
          },
        ),
      ).success,
    ).toBe(true);
    expect(REPORT_SYNC_LIMITS).toEqual({ waitSeconds: 10, maxWaitingPerEnvironment: 20 });
  });

  it('refuses the deprecated reference-id, an unknown meta, and a query of another type', () => {
    expect(
      createReportBodySchema.safeParse(body('watchlist', { 'reference-id': 'customer-1001' }))
        .success,
    ).toBe(false);
    expect(
      createReportBodySchema.safeParse(body('watchlist', {}, { 'request-flags': ['x'] })).success,
    ).toBe(false);
    const mixed = body('watchlist');
    mixed.data.attributes.query = fixture('email-address').data.attributes.query;
    expect(createReportBodySchema.safeParse(mixed).success).toBe(false);
    expect(
      createReportBodySchema.safeParse({ data: { type: 'report/screening', attributes: {} } })
        .success,
    ).toBe(false);
  });
});

describe('the list query (C72.1, C69.4)', () => {
  it('filters by template, status, has-match, account, inquiry, reference id, tag and type', () => {
    expect(
      listReportsQuerySchema.safeParse({
        'filter[report-template-id]': 'rptp_01M5CJXHG07XPHF3HRM6NREDH8',
        'filter[status]': 'ready,errored',
        'filter[has-match]': 'false',
        'filter[account-id]': 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8',
        'filter[inquiry-id]': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
        'filter[reference-id]': 'customer-1001',
        'filter[tag]': 'onboarding',
        'filter[type]': 'report/watchlist,report/phone-number',
        'page[size]': '25',
      }).success,
    ).toBe(true);
    expect(listReportsQuerySchema.safeParse({ 'filter[type]': 'report/screening' }).success).toBe(
      false,
    );
    expect(
      listReportsQuerySchema.safeParse({ 'page[after]': 'inq_01M5CJXHG07XPHF3HRM6NREDH7' }).success,
    ).toBe(false);
  });
});

describe('dismiss and review bodies under data.attributes (C75.2, C75.5, P04)', () => {
  const dismiss = (attributes: Json) => ({ data: { attributes } });

  it('needs a dismissal reason of 1 to 500 characters, and an entity for a single article', () => {
    expect(dismissReportBodySchema.safeParse(dismiss({ reason: 'Not the subject' })).success).toBe(
      true,
    );
    expect(
      dismissReportBodySchema.safeParse(
        dismiss({ reason: 'Other person', 'dismiss-type': 'media', 'entity-id': 'article:7f0c' }),
      ).success,
    ).toBe(true);
    expect(dismissReportBodySchema.safeParse(dismiss({ reason: '' })).success).toBe(false);
    expect(dismissReportBodySchema.safeParse(dismiss({ reason: 'x'.repeat(501) })).success).toBe(
      false,
    );
    expect(
      dismissReportBodySchema.safeParse(dismiss({ reason: 'One article', 'dismiss-type': 'media' }))
        .success,
    ).toBe(false);
    expect(dismissReportBodySchema.safeParse({ meta: { reason: 'Not the subject' } }).success).toBe(
      false,
    );
  });

  it('reviews one record by its token or every open record, a false positive with a comment', () => {
    const review = (attributes: Json) => reviewReportBodySchema.safeParse(dismiss(attributes));
    expect(
      review({
        'review-type': 'record',
        'record-token': MATCH,
        'review-status': 'true_positive',
        'risk-level': 'material',
        comment: 'Confirmed against the passport',
        'notify-on-change': true,
      }).success,
    ).toBe(true);
    expect(review({ 'review-type': 'all_records', 'review-status': 'indeterminate' }).success).toBe(
      true,
    );
    expect(review({ 'review-type': 'record', 'review-status': 'pending' }).success).toBe(false);
    expect(
      review({
        'review-type': 'all_records',
        'record-token': MATCH,
        'review-status': 'pending',
      }).success,
    ).toBe(false);
    expect(
      review({ 'review-type': 'all_records', 'review-status': 'false_positive' }).success,
    ).toBe(false);
    expect(
      review({
        'review-type': 'all_records',
        'review-status': 'false_positive',
        comment: 'x'.repeat(1001),
      }).success,
    ).toBe(false);
  });

  it('takes pause, resume and run without a body', () => {
    expect(runReportBodySchema.safeParse(undefined).success).toBe(true);
    expect(runReportBodySchema.safeParse({ meta: {} }).success).toBe(true);
    expect(runReportBodySchema.safeParse({ meta: { now: true } }).success).toBe(false);
  });
});

describe('history (C74.2)', () => {
  it('report-history.json lists actions and runs newest first, reason and comment nullable', () => {
    const raw = readFixture('api/report-history.json');
    const parsed = reportHistoryDocumentSchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect((raw as { data: Json[] }).data.map((entry) => entry.type)).toEqual([
      'report-action',
      'report-run',
    ]);
    const masked = structuredClone(raw) as { data: { attributes: Json }[] };
    if (masked.data[0] !== undefined) {
      masked.data[0].attributes.comment = null;
    }
    expect(reportHistoryDocumentSchema.safeParse(masked).success).toBe(true);
  });

  it('pages after a run or an action', () => {
    expect(
      reportHistoryQuerySchema.safeParse({ 'page[after]': 'ract_01M5CJXHG07XPHF3HRM6NREDH8' })
        .success,
    ).toBe(true);
    expect(
      reportHistoryQuerySchema.safeParse({ 'page[after]': 'rpr_01M5CJXHG07XPHF3HRM6NREDH8' })
        .success,
    ).toBe(true);
    expect(
      reportHistoryQuerySchema.safeParse({ 'page[after]': 'rep_01M5CJXHG07XPHF3HRM6NREDH8' })
        .success,
    ).toBe(false);
  });

  it('builds runs and actions, the actor a user, a key or the system', () => {
    const at = new Date('2026-10-27T09:00:00.000Z');
    expect(
      buildReportRunResource({
        id: 'rpr_01M5CJXHG07XPHF3HRM6NREDH8',
        reportId: 'rep_01M5CJXHG07XPHF3HRM6NREDH8',
        reportType: 'watchlist',
        runType: 'list_update',
        status: 'errored',
        scheduledFor: at,
        startedAt: at,
        completedAt: at,
        matchCount: 0,
        newMatchCount: 0,
        notes: ['recurring_limit'],
        errors: [{ code: 'list_stale', source: 'eu-fsf' }],
        coverage: { complete: true, limits: [] },
        createdAt: at,
      }),
    ).toMatchObject({
      type: 'report-run',
      attributes: { 'run-type': 'list_update', notes: ['recurring_limit'] },
      relationships: { report: { data: { type: 'report/watchlist' } } },
    });
    for (const actor of [
      'system',
      'usr_01M5CJXHG03PHEQZPRWAH2RXM5',
      'key_01M5CJXHG0RVK7X4H9941FSM5K',
      // C121.1: a run's report action or redaction names the run (owner decision 12 after 6B).
      'wfr_01M5CJXHG07XPHF3HRM6NREDH8',
    ]) {
      expect(
        buildReportActionResource({
          id: 'ract_01M5CJXHG07XPHF3HRM6NREDH8',
          reportId: 'rep_01M5CJXHG07XPHF3HRM6NREDH8',
          reportType: 'watchlist',
          actionType: 'pause',
          actor,
          reason: null,
          comment: null,
          matchIds: [],
          reviewStatus: null,
          riskLevel: null,
          createdAt: at,
        }),
      ).toMatchObject({ attributes: { actor } });
    }
    expect(() =>
      buildReportActionResource({
        id: 'ract_01M5CJXHG07XPHF3HRM6NREDH8',
        reportId: 'rep_01M5CJXHG07XPHF3HRM6NREDH8',
        reportType: 'watchlist',
        actionType: 'pause',
        actor: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
        reason: null,
        comment: null,
        matchIds: [],
        reviewStatus: null,
        riskLevel: null,
        createdAt: at,
      }),
    ).toThrow(z.ZodError);
  });
});

describe('the dashboard report document (C72.3)', () => {
  it('includes the runs and actions', () => {
    const history = readFixture('api/report-history.json') as { data: unknown[] };
    const document = { data: fixture('watchlist').data, included: history.data };
    expect(dashboardReportDocumentSchema.parse(document)).toEqual(document);
  });
});

describe('PII_REPORT_ATTRIBUTES (C70.3)', () => {
  it('lists every attribute the report resources and bodies mark PII, once', () => {
    expect([...PII_REPORT_ATTRIBUTES].sort()).toEqual(
      [
        'query',
        'matched-lists',
        'ignore-list',
        'matches',
        'sanction-list',
        'fitness-probity-list',
        'warning-list',
        'result',
        'exposure',
        'articles',
        'email-domain',
        'email-domain-typo-suggestion',
        'resolved-street-1',
        'resolved-street-2',
        'resolved-city',
        'resolved-subdivision',
        'resolved-postal-code',
        'resolved-country-code',
        'metadata-latitude',
        'metadata-longitude',
        // C106.1 (Phase 7): the ip-address report's city, region and point.
        'city',
        'region',
        'latitude',
        'longitude',
        'reason',
        'comment',
        'entity-id',
      ].sort(),
    );
    expect(Object.isFrozen(PII_REPORT_ATTRIBUTES)).toBe(true);
  });

  it('leaves the non-PII answers readable to a masked viewer (P15)', () => {
    for (const name of [
      'status',
      'has-match',
      'coverage',
      'errors',
      'unavailable-fields',
      'email-domain-kind',
      'email-reputation',
      'phone-type',
      'sources',
    ]) {
      expect(PII_REPORT_ATTRIBUTES, name).not.toContain(name);
    }
  });
});
