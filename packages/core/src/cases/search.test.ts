import { describe, expect, it } from 'vitest';
import { CASE_SEARCH_PROBLEMS, parseCaseSearchQuery, type CaseSearchParse } from './search.js';
import { CASE_SEARCH_ATTRIBUTES } from './vocabulary.js';

const SEARCHABLE = new Set(['tier', 'customer-ref']);
const CONTEXT = { isSearchableField: (key: string) => SEARCHABLE.has(key) };

const parse = (query: unknown): CaseSearchParse => parseCaseSearchQuery(query, CONTEXT);
const leaf = (attribute: string, operator: string, value: unknown) => ({
  attribute,
  operator,
  value,
});

const TEMPLATE = 'ctmpl_01JA0000000000000000000001';
const QUEUE = 'cqueue_01JA0000000000000000000001';
const USER = 'usr_01JA0000000000000000000001';
const KEY = 'key_01JA0000000000000000000001';
const RUN = 'wfr_01JA0000000000000000000001';
const ACCOUNT = 'acc_01JA0000000000000000000001';
const INQUIRY = 'inq_01JA0000000000000000000001';

const problemsOf = (result: CaseSearchParse) => (result.ok ? [] : result.problems);

describe('the query absent (C137.2)', () => {
  it('reads every case the reader can see', () => {
    expect(parse(undefined)).toEqual({ ok: true, predicate: null, fieldKeys: [] });
  });
});

describe('each attribute typed (C137.2)', () => {
  it('compares a timestamp with every operator, read as an instant', () => {
    for (const operator of ['eq', 'gt', 'gte', 'lt', 'lte'] as const) {
      expect(parse(leaf('created_at', operator, '2026-11-03T10:15:00+01:00'))).toEqual({
        ok: true,
        predicate: {
          kind: 'time',
          attribute: 'created_at',
          operator,
          value: new Date('2026-11-03T09:15:00.000Z'),
        },
        fieldKeys: [],
      });
    }
    for (const attribute of ['updated_at', 'resolved_at', 'sla_expires_at']) {
      expect(parse(leaf(attribute, 'lt', '2026-11-03T09:15:00.123Z'))).toMatchObject({
        ok: true,
        predicate: { kind: 'time', attribute, value: new Date('2026-11-03T09:15:00.123Z') },
      });
    }
  });

  it.each([
    'yesterday',
    '2026-11-03',
    '2026-02-30T00:00:00Z',
    '2026-11-03T25:00:00Z',
    '2026-11-03T10:00:00',
    '2026-11-03 10:00:00Z',
    '+002026-11-03T10:00:00Z',
    '',
    1_762_160_100_000,
    true,
  ])('refuses %o as a timestamp', (value) => {
    expect(problemsOf(parse(leaf('created_at', 'gte', value)))).toEqual([
      { code: 'search_value_invalid', pointer: '/query/value' },
    ]);
  });

  it('reads eq null as nothing held, on a nullable attribute only', () => {
    for (const attribute of [
      'resolved_at',
      'sla_expires_at',
      'resolution',
      'assignee',
      'case_queue',
      'case_queue_id',
      'resolver',
    ]) {
      expect(parse(leaf(attribute, 'eq', null))).toEqual({
        ok: true,
        predicate: { kind: 'missing', attribute },
        fieldKeys: [],
      });
    }
    for (const attribute of ['created_at', 'status', 'case_template_id', 'tag_id', 'inquiry_id']) {
      expect(problemsOf(parse(leaf(attribute, 'eq', null)))).toEqual([
        { code: 'search_value_invalid', pointer: '/query/value' },
      ]);
    }
    expect(problemsOf(parse(leaf('resolved_at', 'gt', null)))).toEqual([
      { code: 'search_value_invalid', pointer: '/query/value' },
    ]);
  });

  it.each([
    ['case_template_id', TEMPLATE],
    ['template', 'Know your customer'],
    ['status', 'pending'],
    ['state', 'end'],
    ['resolution', 'Declined'],
    ['assignee', USER],
    ['case_queue', 'Sanctions desk'],
    ['case_queue_id', QUEUE],
    ['resolver', USER],
    ['resolver', KEY],
    ['resolver', RUN],
  ])('compares %s for equality', (attribute, value) => {
    expect(parse(leaf(attribute, 'eq', value))).toEqual({
      ok: true,
      predicate: { kind: 'equals', attribute, value },
      fieldKeys: [],
    });
  });

  it.each([
    ['case_template_id', 'ctmplv_01JA0000000000000000000001'],
    ['case_template_id', 'ctmpl_lowercase'],
    ['template', ''],
    ['template', 'x'.repeat(81)],
    ['status', 'Pending'],
    ['state', 'resolved'],
    ['state', 'constructor'],
    ['resolution', 'x'.repeat(81)],
    ['assignee', 'reviewer@example.com'],
    ['assignee', KEY],
    ['case_queue_id', TEMPLATE],
    ['resolver', ACCOUNT],
    ['account_id', INQUIRY],
    ['inquiry_id', ACCOUNT],
    ['tag_id', 'a,b'],
    ['tag_id', '   '],
    ['status', 7],
    ['template', false],
  ])('refuses %s = %o', (attribute, value) => {
    expect(problemsOf(parse(leaf(attribute, 'eq', value)))).toEqual([
      { code: 'search_value_invalid', pointer: '/query/value' },
    ]);
  });

  it('reads a held account or inquiry as the case holding it', () => {
    expect(parse(leaf('account_id', 'eq', ACCOUNT))).toMatchObject({
      predicate: { kind: 'holds', attribute: 'account_id', value: ACCOUNT },
    });
    expect(parse(leaf('inquiry_id', 'eq', INQUIRY))).toMatchObject({
      predicate: { kind: 'holds', attribute: 'inquiry_id', value: INQUIRY },
    });
  });

  it('reads tag_id as a tag name, normalised', () => {
    expect(parse(leaf('tag_id', 'eq', '  Watch list́ '))).toMatchObject({
      ok: true,
      predicate: { kind: 'tagged', value: 'Watch list́'.normalize('NFC') },
    });
  });

  it('refuses an order on what has none', () => {
    for (const attribute of CASE_SEARCH_ATTRIBUTES.filter((name) => !name.endsWith('_at'))) {
      expect(problemsOf(parse(leaf(attribute, 'gt', 'x')))).toEqual([
        { code: 'search_operator_refused', pointer: '/query/operator' },
      ]);
    }
  });

  it('refuses an unknown attribute and an unknown operator', () => {
    expect(problemsOf(parse(leaf('name', 'eq', 'KYC-6')))).toEqual([
      { code: 'search_attribute_unknown', pointer: '/query/attribute' },
    ]);
    expect(problemsOf(parse(leaf('__proto__', 'eq', 'x')))).toEqual([
      { code: 'search_attribute_unknown', pointer: '/query/attribute' },
    ]);
    expect(problemsOf(parse(leaf('status', 'ne', 'open')))).toEqual([
      { code: 'search_operator_refused', pointer: '/query/operator' },
    ]);
  });
});

describe('searchable fields (C136.4, P25)', () => {
  it('reads a searchable field by equality and names its key', () => {
    expect(parse(leaf('fields.tier', 'eq', 'gold'))).toEqual({
      ok: true,
      predicate: { kind: 'field', key: 'tier', value: 'gold' },
      fieldKeys: ['tier'],
    });
    expect(parse(leaf('fields.tier', 'eq', 3))).toMatchObject({
      predicate: { kind: 'field', value: 3 },
    });
    expect(parse(leaf('fields.tier', 'eq', false))).toMatchObject({
      predicate: { kind: 'field', value: false },
    });
  });

  it('refuses a field nobody marked searchable, and a key no field can have', () => {
    for (const key of ['secret', 'Tier', '__proto__', 'constructor']) {
      expect(problemsOf(parse(leaf(`fields.${key}`, 'eq', 'x')))).toEqual([
        {
          code: ['secret', 'constructor'].includes(key)
            ? 'search_field_not_searchable'
            : 'search_attribute_unknown',
          pointer: '/query/attribute',
        },
      ]);
    }
  });

  it('compares a field for equality only, with a value', () => {
    expect(problemsOf(parse(leaf('fields.tier', 'gte', 'a')))).toEqual([
      { code: 'search_operator_refused', pointer: '/query/operator' },
    ]);
    expect(problemsOf(parse(leaf('fields.tier', 'eq', null)))).toEqual([
      { code: 'search_value_invalid', pointer: '/query/value' },
    ]);
    expect(problemsOf(parse(leaf('fields.tier', 'eq', Number.NaN)))).toEqual([
      { code: 'search_value_invalid', pointer: '/query/value' },
    ]);
    expect(problemsOf(parse(leaf('fields.tier', 'eq', 'x'.repeat(1025))))).toEqual([
      { code: 'search_value_invalid', pointer: '/query/value' },
    ]);
  });

  it('names every field the query reads, once, sorted', () => {
    const result = parse({
      or: [
        leaf('fields.tier', 'eq', 'gold'),
        { not: leaf('fields.customer-ref', 'eq', 'R-1') },
        { and: [leaf('fields.tier', 'eq', 'silver'), leaf('status', 'eq', 'open')] },
      ],
    });
    expect(result).toMatchObject({ ok: true, fieldKeys: ['customer-ref', 'tier'] });
  });
});

describe('the tree (C137.2): and, or, not, depth 2, 20 clauses', () => {
  it('builds the typed tree', () => {
    expect(
      parse({
        and: [
          leaf('state', 'eq', 'initial'),
          { or: [leaf('assignee', 'eq', null), leaf('assignee', 'eq', USER)] },
          { not: leaf('tag_id', 'eq', 'vip') },
        ],
      }),
    ).toEqual({
      ok: true,
      predicate: {
        kind: 'and',
        clauses: [
          { kind: 'equals', attribute: 'state', value: 'initial' },
          {
            kind: 'or',
            clauses: [
              { kind: 'missing', attribute: 'assignee' },
              { kind: 'equals', attribute: 'assignee', value: USER },
            ],
          },
          { kind: 'not', clause: { kind: 'tagged', value: 'vip' } },
        ],
      },
      fieldKeys: [],
    });
  });

  it('takes a group at the top and one level below it, and no deeper', () => {
    expect(parse({ not: { and: [leaf('status', 'eq', 'open')] } }).ok).toBe(true);
    expect(problemsOf(parse({ and: [{ or: [{ not: leaf('status', 'eq', 'open') }] }] }))).toEqual([
      { code: 'search_depth_exceeded', pointer: '/query/and/0/or/0' },
    ]);
  });

  it('never walks a body nested past the limit', () => {
    let deep: unknown = leaf('status', 'eq', 'open');
    for (let level = 0; level < 100_000; level += 1) {
      deep = { not: deep };
    }
    expect(problemsOf(parse(deep))).toEqual([
      { code: 'search_depth_exceeded', pointer: '/query/not/not' },
    ]);
  });

  it('takes 1 to 20 clauses in an and or an or', () => {
    const twenty = Array.from({ length: 20 }, () => leaf('status', 'eq', 'open'));
    expect(parse({ and: twenty }).ok).toBe(true);
    expect(problemsOf(parse({ or: [...twenty, leaf('status', 'eq', 'open')] }))).toEqual([
      { code: 'search_clauses_exceeded', pointer: '/query/or' },
    ]);
    expect(problemsOf(parse({ and: [] }))).toEqual([
      { code: 'search_shape_invalid', pointer: '/query/and' },
    ]);
  });

  it.each([
    [null, '/query'],
    ['status = open', '/query'],
    [[leaf('status', 'eq', 'open')], '/query'],
    [{ and: [leaf('status', 'eq', 'open')], or: [leaf('status', 'eq', 'open')] }, '/query'],
    [{ xor: [leaf('status', 'eq', 'open')] }, '/query'],
    [{ and: leaf('status', 'eq', 'open') }, '/query/and'],
    [{ attribute: 'status', operator: 'eq' }, '/query'],
    [{ attribute: 'status', operator: 'eq', value: 'open', extra: 1 }, '/query'],
    [{ attribute: 7, operator: 'eq', value: 'open' }, '/query/attribute'],
    [{ attribute: 'status', operator: ['eq'], value: 'open' }, '/query/operator'],
    [{ attribute: 'status', operator: 'eq', value: { $ne: 1 } }, '/query/value'],
  ])('refuses the shape %o at %s', (query, pointer) => {
    const result = parse(query);
    expect(result.ok).toBe(false);
    expect(problemsOf(result)[0]?.pointer).toBe(pointer);
  });

  it('refuses an object built on another prototype', () => {
    const forged = Object.assign(Object.create({ and: [] }) as object, {
      attribute: 'status',
      operator: 'eq',
      value: 'open',
    });
    expect(parse(forged).ok).toBe(true);
    const inherited = Object.create({
      attribute: 'status',
      operator: 'eq',
      value: 'open',
    }) as object;
    expect(problemsOf(parse(inherited))).toEqual([
      { code: 'search_shape_invalid', pointer: '/query' },
    ]);
  });

  it('reports every leaf at fault with its pointer, and never the value', () => {
    const result = parse({
      and: [
        leaf('status', 'eq', 'open'),
        leaf('fields.ssn', 'eq', '000-00-0000'),
        { or: [leaf('created_at', 'gt', 'not a time'), leaf('colour', 'eq', 'red')] },
      ],
    });
    expect(problemsOf(result)).toEqual([
      { code: 'search_field_not_searchable', pointer: '/query/and/1/attribute' },
      { code: 'search_value_invalid', pointer: '/query/and/2/or/0/value' },
      { code: 'search_attribute_unknown', pointer: '/query/and/2/or/1/attribute' },
    ]);
    expect(JSON.stringify(result)).not.toContain('000-00-0000');
    expect(JSON.stringify(result)).not.toContain('not a time');
  });

  it('stops listing at twenty problems', () => {
    const bad = Array.from({ length: 20 }, () => ({
      or: Array.from({ length: 20 }, () => leaf('colour', 'eq', 'red')),
    }));
    expect(problemsOf(parse({ and: bad }))).toHaveLength(20);
  });

  it('reads a query under another pointer', () => {
    expect(
      parseCaseSearchQuery(leaf('colour', 'eq', 'red'), CONTEXT, '/data/attributes/search/query'),
    ).toEqual({
      ok: false,
      problems: [
        { code: 'search_attribute_unknown', pointer: '/data/attributes/search/query/attribute' },
      ],
    });
  });

  it('names seven problem codes', () => {
    expect(CASE_SEARCH_PROBLEMS).toHaveLength(7);
  });
});
