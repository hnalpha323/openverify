import { inquiryStatusSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { idSchema } from './ids.js';
import {
  MAX_FILTER_VALUES,
  booleanFilterSchema,
  filterListSchema,
  filterTimestampSchema,
  filterValues,
  listQuerySchema,
} from './list-filters.js';

describe('comma-separated filter values (C9)', () => {
  const statuses = filterListSchema(inquiryStatusSchema);

  it('accept one value or several separated by commas (OR)', () => {
    expect(statuses.parse('completed')).toBe('completed');
    expect(statuses.parse('completed,failed')).toBe('completed,failed');
  });

  it.each([
    ['an empty value', ''],
    ['an empty item', 'completed,'],
    ['an unknown item', 'completed,done'],
    ['spaces around items', 'completed, failed'],
    ['too many items', Array.from({ length: MAX_FILTER_VALUES + 1 }, () => 'failed').join(',')],
  ])('reject %s', (_name, value) => {
    expect(statuses.safeParse(value).success).toBe(false);
  });

  it('split into typed values for the query', () => {
    expect(filterValues('completed,failed', inquiryStatusSchema)).toEqual(['completed', 'failed']);
    expect(filterValues(undefined, inquiryStatusSchema)).toBeUndefined();
    expect(() => filterValues('nope', inquiryStatusSchema)).toThrow(z.ZodError);
  });

  it('allow up to 100 values', () => {
    expect(MAX_FILTER_VALUES).toBe(100);
  });
});

describe('filter timestamps and booleans', () => {
  it('accept ISO-8601 date-times with Z or an offset', () => {
    expect(filterTimestampSchema.safeParse('2026-10-20T00:00:00Z').success).toBe(true);
    expect(filterTimestampSchema.safeParse('2026-10-20T02:00:00+02:00').success).toBe(true);
    expect(filterTimestampSchema.safeParse('2026-10-20').success).toBe(false);
  });

  it('accept true or false', () => {
    expect(booleanFilterSchema.parse('true')).toBe('true');
    expect(booleanFilterSchema.safeParse('yes').success).toBe(false);
  });
});

describe('listQuerySchema', () => {
  const schema = listQuerySchema('inq', {
    'filter[status]': filterListSchema(inquiryStatusSchema).optional(),
    'filter[account-id]': filterListSchema(idSchema('acc')).optional(),
  });

  it('adds cursor pagination and the created-at range to the filters', () => {
    expect(
      schema.parse({
        'page[after]': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
        'page[size]': '10',
        'filter[status]': 'pending',
        'filter[created-at-start]': '2026-10-01T00:00:00Z',
        'filter[created-at-end]': '2026-10-02T00:00:00Z',
      }),
    ).toEqual({
      'page[after]': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
      'page[size]': 10,
      'filter[status]': 'pending',
      'filter[created-at-start]': '2026-10-01T00:00:00Z',
      'filter[created-at-end]': '2026-10-02T00:00:00Z',
    });
    expect(schema.parse({})).toEqual({});
  });

  it('rejects unknown parameters and cursors of another resource', () => {
    expect(schema.safeParse({ 'filter[stauts]': 'pending' }).success).toBe(false);
    expect(schema.safeParse({ 'page[after]': 'acc_01M5CJXHG07XPHF3HRM6NREDH7' }).success).toBe(
      false,
    );
  });

  it('needs the range start before its (exclusive) end', () => {
    const result = schema.safeParse({
      'filter[created-at-start]': '2026-10-02T00:00:00Z',
      'filter[created-at-end]': '2026-10-02T02:00:00+02:00',
    });
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'filter[created-at-end]',
    ]);
    expect(schema.safeParse({ 'filter[created-at-start]': '2026-10-02T00:00:00Z' }).success).toBe(
      true,
    );
  });

  it('can leave out the created-at range', () => {
    const plain = listQuerySchema('key', {}, { createdAt: false });
    expect(plain.safeParse({ 'filter[created-at-start]': '2026-10-02T00:00:00Z' }).success).toBe(
      false,
    );
    expect(plain.parse({ 'page[size]': '5' })).toEqual({ 'page[size]': 5 });
  });
});
