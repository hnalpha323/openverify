import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  hasDistinctValues,
  listDocumentSchema,
  pageSizeSchema,
  requestDocumentSchema,
  resourceIdentifierSchema,
  resourceSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toManyRelationshipSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';

const widget = resourceSchema('widget', 'inq', z.strictObject({ name: z.string() }));
const id = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const verificationId = 'ver_01M5CK16P0D13FXHZSS4TCFBVH';

describe('timestamps', () => {
  it('are ISO-8601 UTC strings', () => {
    expect(timestampSchema.safeParse('2026-10-20T12:00:00.000Z').success).toBe(true);
    expect(timestampSchema.safeParse('2026-10-20T12:00:00Z').success).toBe(true);
    expect(timestampSchema.safeParse('2026-10-20T14:00:00+02:00').success).toBe(false);
    expect(timestampSchema.safeParse('2026-10-20').success).toBe(false);
    expect(timestampSchema.safeParse(1792497600).success).toBe(false);
  });

  it('serialize dates in UTC with milliseconds', () => {
    expect(toTimestamp(new Date(Date.UTC(2026, 9, 20, 12)))).toBe('2026-10-20T12:00:00.000Z');
  });

  it('reject invalid dates', () => {
    expect(() => toTimestamp(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('resource objects', () => {
  it('carry a literal type, a prefixed id and attributes', () => {
    const value = { type: 'widget', id, attributes: { name: 'w' } };
    expect(widget.parse(value)).toEqual(value);
  });

  it.each([
    ['another type', { type: 'gadget', id, attributes: { name: 'w' } }],
    ['another id prefix', { type: 'widget', id: verificationId, attributes: { name: 'w' } }],
    ['unknown members', { type: 'widget', id, attributes: { name: 'w' }, links: {} }],
    ['missing attributes', { type: 'widget', id }],
  ])('reject %s', (_name, value) => {
    expect(widget.safeParse(value).success).toBe(false);
  });

  it('may carry relationships', () => {
    const schema = resourceWithRelationshipsSchema(
      'widget',
      'inq',
      z.strictObject({}),
      z.strictObject({
        owner: toOneRelationshipSchema(resourceIdentifierSchema('verification/selfie', 'ver')),
        parts: toManyRelationshipSchema(resourceIdentifierSchema('verification/selfie', 'ver')),
      }),
    );
    const value = {
      type: 'widget',
      id,
      attributes: {},
      relationships: {
        owner: { data: { type: 'verification/selfie', id: verificationId } },
        parts: { data: [] },
      },
    };
    expect(schema.parse(value)).toEqual(value);
    expect(
      schema.safeParse({
        ...value,
        relationships: { ...value.relationships, owner: { data: { type: 'inquiry', id } } },
      }).success,
    ).toBe(false);
  });
});

describe('documents', () => {
  it('wrap a single resource in data', () => {
    const document = { data: { type: 'widget', id, attributes: { name: 'w' } } };
    expect(singleDocumentSchema(widget).parse(document)).toEqual(document);
    expect(singleDocumentSchema(widget).safeParse({ ...document, meta: {} }).success).toBe(false);
  });

  it('wrap lists in data with a next-page link', () => {
    const schema = listDocumentSchema(widget);
    const document = {
      data: [{ type: 'widget', id, attributes: { name: 'w' } }],
      links: { next: `/api/v1/widgets?page[after]=${id}` },
    };
    expect(schema.parse(document)).toEqual(document);
    expect(schema.parse({ data: [], links: { next: null } })).toEqual({
      data: [],
      links: { next: null },
    });
    expect(schema.safeParse({ data: [] }).success).toBe(false);
  });

  it('wrap request attributes, with an optional matching type', () => {
    const schema = requestDocumentSchema('widget', z.strictObject({ name: z.string() }));
    expect(schema.parse({ data: { attributes: { name: 'w' } } })).toEqual({
      data: { attributes: { name: 'w' } },
    });
    expect(schema.safeParse({ data: { type: 'widget', attributes: { name: 'w' } } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ data: { type: 'gadget', attributes: { name: 'w' } } }).success).toBe(
      false,
    );
    expect(schema.safeParse({ data: { id, attributes: { name: 'w' } } }).success).toBe(false);
    expect(schema.safeParse({ name: 'w' }).success).toBe(false);
  });
});

describe('pagination', () => {
  it('allows at most 100 items per page and defaults to 25', () => {
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });

  it('coerces page[size] from the query string', () => {
    expect(pageSizeSchema.parse('100')).toBe(100);
    expect(pageSizeSchema.parse('1')).toBe(1);
    for (const value of ['0', '101', '2.5', 'ten', '']) {
      expect(pageSizeSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('value helpers', () => {
  it('serialize a missing date as null', () => {
    expect(toNullableTimestamp(null)).toBeNull();
    expect(toNullableTimestamp(new Date(Date.UTC(2026, 9, 20, 12)))).toBe(
      '2026-10-20T12:00:00.000Z',
    );
  });

  it('tell whether a list repeats a value', () => {
    expect(hasDistinctValues(['a', 'b'])).toBe(true);
    expect(hasDistinctValues(['a', 'a'])).toBe(false);
    expect(hasDistinctValues([])).toBe(true);
  });
});
