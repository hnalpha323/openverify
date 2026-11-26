import { readFileSync } from 'node:fs';
import {
  IMPORTER_LIST_KINDS,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  type ListKind,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eventAttributesSchema } from './events.js';
import { idSchema, newId, type IdPrefix } from './ids.js';
import {
  IMPORTER_RESOURCE_SCHEMAS,
  PII_IMPORTER_ATTRIBUTES,
  buildImporterResource,
  createImporterBodySchema,
  importerEncodingSchema,
  importerErrorListDocumentSchema,
  importerErrorSchema,
} from './importers.js';
import {
  LIST_CREATE_BODY_SCHEMAS,
  LIST_ITEM_CREATE_BODY_SCHEMAS,
  LIST_ITEM_RESOURCE_SCHEMAS,
  LIST_RESOURCE_SCHEMAS,
  PII_LIST_ATTRIBUTES,
  buildListItemResource,
  buildListMatchResource,
  buildListResource,
  dismissListMatchBodySchema,
  listConfigSchema,
  listItemResourceSchema,
  listLimitsMeta,
  listMatchResourceSchema,
  listMatchResultSchema,
  listProbeSchema,
  listResourceDocumentSchema,
  listResourceSchema,
  matchListsBodySchema,
  matchListsResponseSchema,
  resolveListConfig,
  resolvedListConfigSchema,
  updateListBodySchema,
} from './lists.js';
import { signalDetailSchema } from './signals.js';
import { readFixture } from './test-support.js';

const AT = new Date('2026-10-31T12:00:00.000Z');
const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const ITEM = 'liea_01M5CK3190XEVBM5ZXA76E1JSN';
const INQUIRY = 'inq_01M5CK3190XEVBM5ZXA76E1JSN';
const ACCOUNT = 'acc_01M5CK3190XEVBM5ZXA76E1JSN';
const MATCH = 'lmt_01M5CK3190XEVBM5ZXA76E1JSN';
const SHA = 'a'.repeat(64);

const list = {
  id: LIST,
  kind: 'email-address',
  name: 'Synthetic blocked emails',
  status: 'active',
  archivedAt: null,
  createdAt: AT,
  updatedAt: AT,
  itemCount: 1,
  version: 2,
  itemRetentionDays: null,
  screenAtCompletion: true,
  attributes: {},
} as const;

const item = {
  id: ITEM,
  kind: 'email-address',
  listId: LIST,
  status: 'active',
  archivedAt: null,
  createdAt: AT,
  updatedAt: AT,
  redactedAt: null,
  matchCount: 0,
  creator: { type: 'user', id: 'usr_01M5CK3190XEVBM5ZXA76E1JSN' },
  attributes: { value: 'listed@example.org', 'match-type': 'email_address' },
} as const;

const match = {
  id: MATCH,
  status: 'open',
  source: 'otp.email-address',
  method: 'exact',
  tier: 'R',
  confidence: null,
  approximate: false,
  score: null,
  distanceMeters: null,
  listVersion: 2,
  matchedValue: 'listed@example.org',
  dismissedAt: null,
  reason: null,
  createdAt: AT,
  redactedAt: null,
  listKind: 'email-address',
  listId: LIST,
  listItemId: ITEM,
  inquiryId: INQUIRY,
  accountId: ACCOUNT,
} as const;

const refused = (schema: z.ZodType, value: unknown) => !schema.safeParse(value).success;

describe('the list resources (C97.1, C97.2)', () => {
  it('have one schema per kind, in kind order', () => {
    expect(LIST_RESOURCE_SCHEMAS.map((schema) => schema.shape.type.value)).toEqual(
      LIST_KINDS.map((kind) => `list/${kind}`),
    );
    expect(LIST_ITEM_RESOURCE_SCHEMAS.map((schema) => schema.shape.type.value)).toEqual(
      LIST_KINDS.map((kind) => `list-item/${kind}`),
    );
  });

  it('builds a list with its public attributes and ours', () => {
    expect(buildListResource(list)).toEqual({
      type: 'list/email-address',
      id: LIST,
      attributes: {
        name: 'Synthetic blocked emails',
        status: 'active',
        'archived-at': null,
        'created-at': '2026-10-31T12:00:00.000Z',
        'updated-at': '2026-10-31T12:00:00.000Z',
        'item-count': 1,
        version: 2,
        'item-retention-days': null,
        'screen-at-completion': true,
        purpose: 'block',
      },
    });
  });

  it.each([
    ['name', 'allow-fuzzy-name-first', true],
    ['phone-number', 'default-region', 'US'],
    ['field', 'field-key', 'loan_reference'],
    ['string', 'case-sensitive', false],
    ['government-id-number', 'use-for-compromised-ids', true],
  ])('gives %s lists their own member %s', (kind, member, value) => {
    const built = buildListResource({
      ...list,
      kind: kind as ListKind,
      attributes: { [member]: value },
    });
    expect((built.attributes as Readonly<Record<string, unknown>>)[member]).toBe(value);
    expect(() => buildListResource({ ...list, attributes: { [member]: value } })).toThrow();
  });

  it('serves its limits in the document meta, lower for a biometric list (C97.5)', () => {
    expect(listLimitsMeta('email-address')).toEqual({
      'active-lists-per-environment': 1000,
      'items-per-list': 1_000_000,
    });
    expect(listLimitsMeta('face')['items-per-list']).toBe(10_000);
    expect(
      listResourceDocumentSchema.safeParse({
        data: buildListResource(list),
        meta: listLimitsMeta('email-address'),
      }).success,
    ).toBe(true);
  });

  it('refuses a retention outside 1 to 3,650 days', () => {
    expect(() => buildListResource({ ...list, itemRetentionDays: 0 })).toThrow();
    expect(() => buildListResource({ ...list, itemRetentionDays: 3651 })).toThrow();
  });

  it('builds an item, linked to its list and its creator', () => {
    const built = buildListItemResource(item);
    expect(built).toMatchObject({
      type: 'list-item/email-address',
      id: ITEM,
      attributes: { value: 'listed@example.org', 'match-type': 'email_address', 'match-count': 0 },
      relationships: {
        list: { data: { type: 'list/email-address', id: LIST } },
        creator: { data: { type: 'user', id: 'usr_01M5CK3190XEVBM5ZXA76E1JSN' } },
      },
    });
  });

  it('names a workflow run as a creator (C121.1)', () => {
    const creator = { type: 'workflow-run' as const, id: 'wfr_01M5CJXHG07XPHF3HRM6NREDH8' };
    expect(buildListItemResource({ ...item, creator }).relationships.creator.data).toEqual(creator);
  });

  it('names an importer as a creator, and refuses another kind of id (C97.2)', () => {
    const creator = {
      type: 'importer/list-item/email-address',
      id: 'mprt_01M5CK3190XEVBM5ZXA76E1JSN',
    } as const;
    expect(buildListItemResource({ ...item, creator }).relationships.creator.data).toEqual(creator);
    expect(() =>
      buildListItemResource({ ...item, creator: { type: 'user', id: ACCOUNT } }),
    ).toThrow();
  });

  it('keeps a masked or redacted value parsing, and refuses an unknown member', () => {
    const masked = buildListItemResource({
      ...item,
      redactedAt: AT,
      attributes: { value: null, 'match-type': 'domain' },
    });
    expect(masked.attributes).toMatchObject({ value: null });
    expect(() =>
      buildListItemResource({ ...item, attributes: { ...item.attributes, note: 'x' } }),
    ).toThrow();
  });

  it('refuses an item id of another kind', () => {
    expect(() => buildListItemResource({ ...item, kind: 'phone-number' })).toThrow();
  });

  it('caps a geolocation item at 500 km and keeps the ranges of C97.1', () => {
    const geo = (attributes: Record<string, unknown>) => () =>
      buildListItemResource({
        ...item,
        kind: 'geolocation',
        id: 'ligl_01M5CK3190XEVBM5ZXA76E1JSN',
        attributes,
      });
    expect(geo({ latitude: -30, longitude: -140, 'radius-meters': 500_000 })).not.toThrow();
    expect(geo({ latitude: -30, longitude: -140, 'radius-meters': 500_001 })).toThrow();
    expect(geo({ latitude: 91, longitude: 0, 'radius-meters': 1 })).toThrow();
    expect(geo({ latitude: 0, longitude: 181, 'radius-meters': 1 })).toThrow();
    expect(geo({ latitude: 0, longitude: 0, 'radius-meters': 0 })).toThrow();
    // C97.1: the radius is 1 to 500,000 meters, so half a meter is refused by the schema.
    expect(geo({ latitude: 0, longitude: 0, 'radius-meters': 0.5 })).toThrow();
    expect(geo({ latitude: 0, longitude: 0, 'radius-meters': 1 })).not.toThrow();
  });
});

describe('the list and item bodies (C97.1)', () => {
  it('has a create body per kind, each strict', () => {
    expect(Object.keys(LIST_CREATE_BODY_SCHEMAS)).toEqual(LIST_KINDS);
    expect(Object.keys(LIST_ITEM_CREATE_BODY_SCHEMAS)).toEqual(LIST_KINDS);
    expect(
      refused(LIST_CREATE_BODY_SCHEMAS.string, {
        data: { attributes: { name: 'x', 'allow-fuzzy-name-first': true } },
      }),
    ).toBe(true);
  });

  it('requires a retention on a biometric list (C97.2, P08)', () => {
    expect(refused(LIST_CREATE_BODY_SCHEMAS.face, { data: { attributes: { name: 'x' } } })).toBe(
      true,
    );
    expect(
      LIST_CREATE_BODY_SCHEMAS.face.safeParse({
        data: { attributes: { name: 'x', 'item-retention-days': 30 } },
      }).success,
    ).toBe(true);
  });

  it('takes an inquiry, never a value, for a face or background item (C99.7)', () => {
    const body = (attributes: Record<string, unknown>) => ({
      data: { attributes: { 'list-id': LIST, ...attributes } },
    });
    expect(
      LIST_ITEM_CREATE_BODY_SCHEMAS.face.safeParse(body({ 'inquiry-id': INQUIRY })).success,
    ).toBe(true);
    expect(refused(LIST_ITEM_CREATE_BODY_SCHEMAS.face, body({ value: 'x' }))).toBe(true);
  });

  it('takes a fingerprint only in the 64-hex form a device resource serves (C94.4)', () => {
    const body = (value: string) => ({ data: { attributes: { 'list-id': LIST, value } } });
    const schema = LIST_ITEM_CREATE_BODY_SCHEMAS['browser-fingerprint'];
    expect(schema.safeParse(body(` ${SHA.toUpperCase()} `)).success).toBe(true);
    expect(refused(schema, body('short'))).toBe(true);
  });

  it('updates the four members of C97.1, and refuses an empty update', () => {
    const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });
    expect(updateListBodySchema.safeParse(body({ 'use-for-compromised-ids': true })).success).toBe(
      true,
    );
    expect(refused(updateListBodySchema, body({}))).toBe(true);
    expect(refused(updateListBodySchema, body({ 'allow-fuzzy-name-first': true }))).toBe(true);
  });
});

describe('matching (C99)', () => {
  it('caps the probes at 20, and takes no method-specific kind (C99.4, P25)', () => {
    const probes = (count: number) => ({
      data: {
        attributes: {
          probes: Array.from({ length: count }, () => ({
            kind: 'email-address',
            value: 'a@example.org',
          })),
        },
      },
    });
    expect(matchListsBodySchema.safeParse(probes(20)).success).toBe(true);
    expect(refused(matchListsBodySchema, probes(21))).toBe(true);
    expect(refused(matchListsBodySchema, probes(0))).toBe(true);
    expect(refused(listProbeSchema, { kind: 'face', 'inquiry-id': INQUIRY })).toBe(true);
    expect(refused(listProbeSchema, { kind: 'selfie-background', 'inquiry-id': INQUIRY })).toBe(
      true,
    );
  });

  it('answers what it could not read beside what it matched (H02)', () => {
    const answer = matchListsResponseSchema.parse({
      data: {
        type: 'list-match-result',
        attributes: {
          matches: [],
          unscreened: [{ 'list-id': LIST, reason: 'method_not_on_demand' }],
          'not-applicable': [{ 'list-id': LIST, reason: 'subject_has_no_value' }],
        },
      },
    });
    expect(answer.data.attributes.unscreened).toHaveLength(1);
    expect(
      refused(matchListsResponseSchema, {
        data: { type: 'list-match-result', attributes: { matches: [] } },
      }),
    ).toBe(true);
  });

  const result = {
    'list-id': LIST,
    'list-item': { type: 'list-item/email-address', id: ITEM },
    'list-version': 1,
    source: 'request',
    method: 'exact',
    tier: 'R',
    confidence: null,
    approximate: false,
    score: null,
    'distance-meters': null,
  };

  it('requires a confidence on an H-tier match, and refuses one on R (H15)', () => {
    expect(listMatchResultSchema.safeParse(result).success).toBe(true);
    expect(refused(listMatchResultSchema, { ...result, tier: 'H' })).toBe(true);
    expect(refused(listMatchResultSchema, { ...result, confidence: 0.8 })).toBe(true);
    expect(listMatchResultSchema.safeParse({ ...result, tier: 'H', confidence: 0.8 }).success).toBe(
      true,
    );
  });

  it('gives a fuzzy match its score and a radius match its distance (C99.1, C99.2)', () => {
    const fuzzy = { ...result, method: 'fuzzy_name', tier: 'H', confidence: 0.9 };
    expect(refused(listMatchResultSchema, fuzzy)).toBe(true);
    expect(listMatchResultSchema.safeParse({ ...fuzzy, score: 0.9 }).success).toBe(true);
    const radius = { ...result, method: 'radius', tier: 'H', confidence: 0.5, approximate: true };
    expect(refused(listMatchResultSchema, radius)).toBe(true);
    expect(listMatchResultSchema.safeParse({ ...radius, 'distance-meters': 1200 }).success).toBe(
      true,
    );
  });

  it('refuses a match item that does not fit its type', () => {
    expect(
      refused(listMatchResultSchema, {
        ...result,
        'list-item': { type: 'list-item/name', id: ITEM },
      }),
    ).toBe(true);
  });

  it('builds a match record with its list, item, inquiry and account', () => {
    expect(buildListMatchResource(match)).toMatchObject({
      type: 'list-match',
      id: MATCH,
      attributes: { status: 'open', 'matched-value': 'listed@example.org', reason: null },
      relationships: {
        list: { data: { type: 'list/email-address', id: LIST } },
        'list-item': { data: { type: 'list-item/email-address', id: ITEM } },
        inquiry: { data: { type: 'inquiry', id: INQUIRY } },
        account: { data: { type: 'account', id: ACCOUNT } },
      },
    });
  });

  it('ties a dismissal, its time and its reason together', () => {
    const dismissed = {
      ...match,
      status: 'dismissed',
      dismissedAt: AT,
      reason: 'Synthetic',
    } as const;
    expect(buildListMatchResource(dismissed).attributes.reason).toBe('Synthetic');
    expect(() => buildListMatchResource({ ...match, reason: 'Synthetic' })).toThrow();
    expect(() => buildListMatchResource({ ...dismissed, dismissedAt: null })).toThrow();
    expect(() => buildListMatchResource({ ...match, dismissedAt: AT })).toThrow();
  });

  it('caps a dismissal reason at 500 characters (C99.3)', () => {
    const body = (reason: string) => ({ data: { attributes: { reason } } });
    expect(dismissListMatchBodySchema.safeParse(body('x'.repeat(500))).success).toBe(true);
    expect(refused(dismissListMatchBodySchema, body('x'.repeat(501)))).toBe(true);
  });

  it('keeps a match with its item redacted', () => {
    expect(
      buildListMatchResource({ ...match, listItemId: null, matchedValue: null, redactedAt: AT })
        .relationships['list-item'].data,
    ).toBeNull();
  });

  it('parses through the union', () => {
    expect(listMatchResourceSchema.safeParse(buildListMatchResource(match)).success).toBe(true);
    expect(listResourceSchema.safeParse(buildListResource(list)).success).toBe(true);
    expect(listItemResourceSchema.safeParse(buildListItemResource(item)).success).toBe(true);
  });
});

describe('the list-match.created event (C99.3, C107.5)', () => {
  const event = (attributes: Record<string, unknown>) => ({
    name: 'list-match.created',
    payload: { data: buildListMatchResource({ ...match, ...attributes }) },
    'created-at': '2026-10-31T12:00:00.000Z',
  });

  it('carries no matched value and no reason: an event holds no list value', () => {
    expect(eventAttributesSchema.safeParse(event({ matchedValue: null })).success).toBe(true);
    expect(refused(eventAttributesSchema, event({}))).toBe(true);
    expect(
      refused(
        eventAttributesSchema,
        event({
          matchedValue: null,
          status: 'dismissed',
          dismissedAt: AT,
          reason: 'Synthetic reason',
        }),
      ),
    ).toBe(true);
  });

  it('stubs to its id once redacted', () => {
    expect(
      eventAttributesSchema.safeParse({
        name: 'list-match.created',
        payload: {
          data: {
            type: 'list-match',
            id: MATCH,
            attributes: { 'redacted-at': '2026-10-31T12:00:00.000Z' },
          },
        },
        'created-at': '2026-10-31T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('inquiry/list_match_count in signal-details (C99.4, H02)', () => {
  const detail = {
    tier: 'R',
    stage: 'ga',
    version: 1,
    'null-reason': 'list_unscreened',
    reasons: [],
    'computed-at': '2026-10-31T12:00:00.000Z',
  };

  it('names the screening and every list it could not read', () => {
    expect(
      signalDetailSchema.safeParse({
        ...detail,
        'list-screening': {
          status: 'partial',
          unscreened: [{ 'list-id': LIST, reason: 'list_items_pending' }],
          'not-applicable': [{ 'list-id': LIST, reason: 'subject_has_no_value' }],
          'review-cause': 'list_unscreened',
        },
      }).success,
    ).toBe(true);
  });

  it('refuses a reason outside the closed set (H11)', () => {
    expect(
      refused(signalDetailSchema, {
        ...detail,
        'list-screening': {
          status: 'partial',
          unscreened: [{ 'list-id': LIST, reason: 'no_match' }],
          'not-applicable': [],
          'review-cause': null,
        },
      }),
    ).toBe(true);
  });
});

describe('list-config (C99.5)', () => {
  it('defaults to every active list, with the rule off', () => {
    expect(resolveListConfig({})).toEqual({ screen: 'all', 'on-list-match': 'none' });
    expect(resolvedListConfigSchema.safeParse(resolveListConfig({})).success).toBe(true);
  });

  it('takes all, none, or up to 50 distinct lists', () => {
    expect(listConfigSchema.safeParse({ screen: 'none' }).success).toBe(true);
    expect(listConfigSchema.safeParse({ screen: [LIST] }).success).toBe(true);
    expect(refused(listConfigSchema, { screen: [LIST, LIST] })).toBe(true);
    const many = Array.from({ length: 51 }, () => newId('lst'));
    expect(refused(listConfigSchema, { screen: many })).toBe(true);
    expect(refused(listConfigSchema, { screen: 'some' })).toBe(true);
    expect(refused(listConfigSchema, { 'on-list-match': 'declined' })).toBe(true);
    expect(refused(listConfigSchema, { unknown: true })).toBe(true);
  });
});

describe('importers (C100)', () => {
  const importer = {
    id: 'mprt_01M5CK3190XEVBM5ZXA76E1JSN',
    kind: 'email-address',
    listId: LIST,
    status: 'ready',
    mode: 'all-or-nothing',
    successfulCount: 2,
    duplicateCount: 1,
    alreadyPresentCount: 1,
    errorCount: 0,
    rowCount: 4,
    encoding: 'utf-8',
    fileSha256: SHA,
    createdAt: AT,
    completedAt: AT,
  } as const;

  it('have one schema per kind with an importer', () => {
    expect(IMPORTER_RESOURCE_SCHEMAS.map((schema) => schema.shape.type.value)).toEqual(
      IMPORTER_LIST_KINDS.map((kind) => `importer/list-item/${kind}`),
    );
    expect(() => buildImporterResource({ ...importer, kind: 'face' })).toThrow();
  });

  it('builds the public counts and ours', () => {
    expect(buildImporterResource(importer)).toMatchObject({
      type: 'importer/list-item/email-address',
      attributes: {
        status: 'ready',
        'successful-count': 2,
        'duplicate-count': 1,
        'already-present-count': 1,
        'error-count': 0,
        'row-count': 4,
        mode: 'all-or-nothing',
        'file-sha256': SHA,
      },
      relationships: { list: { data: { type: 'list/email-address', id: LIST } } },
    });
  });

  it('completes exactly when it is no longer pending', () => {
    expect(() => buildImporterResource({ ...importer, status: 'pending' })).toThrow();
    expect(() => buildImporterResource({ ...importer, completedAt: null })).toThrow();
    expect(
      buildImporterResource({ ...importer, status: 'pending', completedAt: null }).attributes
        .status,
    ).toBe('pending');
  });

  it('takes base64 of at most 20 MB, marked PII (C100.1, F23)', () => {
    const body = (file: string) => ({ data: { attributes: { 'list-id': LIST, file } } });
    expect(createImporterBodySchema.safeParse(body('dmFsdWU=')).success).toBe(true);
    expect(refused(createImporterBodySchema, body('not base64!'))).toBe(true);
    expect(refused(createImporterBodySchema, body('A'.repeat(26_666_672)))).toBe(true);
    expect(PII_IMPORTER_ATTRIBUTES).toEqual(['file']);
  });

  it('refuses UTF-16, and takes a WHATWG label (C100.2, decision 31)', () => {
    expect(importerEncodingSchema.safeParse('windows-1252').success).toBe(true);
    for (const label of ['utf-16', 'UTF-16LE', 'utf16be', 'ucs-2', 'unicode']) {
      expect(refused(importerEncodingSchema, label), label).toBe(true);
    }
  });

  it('never carries a value in an error: a row, a column and a code (C100.4)', () => {
    expect(
      importerErrorSchema.safeParse({ row: 2, column: 'value', code: 'invalid_value' }).success,
    ).toBe(true);
    expect(
      importerErrorSchema.safeParse({ row: null, column: null, code: 'invalid_encoding' }).success,
    ).toBe(true);
    expect(
      refused(importerErrorSchema, {
        row: 2,
        column: 'value',
        code: 'invalid_value',
        value: 'synthetic',
      }),
    ).toBe(true);
    expect(refused(importerErrorSchema, { row: 2, column: 'a@b.c', code: 'invalid_value' })).toBe(
      true,
    );
    expect(refused(importerErrorSchema, { row: 2, column: 'value', code: 'other' })).toBe(true);
    expect(
      importerErrorListDocumentSchema.safeParse({ data: [], links: { next: null } }).success,
    ).toBe(true);
  });
});

describe('PII_LIST_ATTRIBUTES (C97.6, C107.5)', () => {
  it('names every item value, the probes and the dismissal reason, never the country', () => {
    expect([...PII_LIST_ATTRIBUTES].sort()).toEqual(
      [
        'field-value',
        'id-number',
        'latitude',
        'longitude',
        'matched-value',
        'matches',
        'name-first',
        'name-last',
        'probes',
        'radius-meters',
        'reason',
        'value',
      ].sort(),
    );
  });
});

describe('the public paths (C97.1, H18)', () => {
  const surface = readFileSync(
    new URL('../../../docs/research/persona-surface.md', import.meta.url),
    'utf8',
  );

  it('match the surface index for every public item path', () => {
    const paths = [...surface.matchAll(/^- `list-item\/([a-z-]+)`$/gm)].map((found) => found[1]);
    expect(paths.length).toBeGreaterThanOrEqual(11);
    const plurals = LIST_KINDS.map((kind) => LIST_KIND_REGISTRY[kind].plural);
    expect(plurals).toEqual(expect.arrayContaining(paths));
  });

  it('match the surface index for every public list and importer path', () => {
    const plurals = LIST_KINDS.map((kind) => LIST_KIND_REGISTRY[kind].plural);
    for (const [, path] of surface.matchAll(/^- `list\/([a-z-]+)`$/gm)) {
      expect(plurals).toContain(path);
    }
    for (const [, path] of surface.matchAll(/^- `importer\/list-item\/([a-z-]+)`$/gm)) {
      expect(plurals).toContain(path);
    }
  });
});

describe('the fixtures (C8)', () => {
  it('hold one item of every kind', () => {
    const { data } = readFixture('api/list-items.json') as { data: { type: string }[] };
    expect(data.map(({ type }) => type)).toEqual(LIST_KINDS.map((kind) => `list-item/${kind}`));
  });

  it('id schemas know every item prefix', () => {
    for (const kind of LIST_KINDS) {
      const prefix = LIST_KIND_REGISTRY[kind].itemPrefix as IdPrefix;
      expect(() => idSchema(prefix).parse(newId(prefix))).not.toThrow();
    }
  });
});
