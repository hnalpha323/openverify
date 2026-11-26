import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { actionBodySchema, emptyActionBodySchema, optionalActionBodySchema } from './actions.js';

describe('action bodies (C9)', () => {
  it('wrap required meta in { meta }', () => {
    const schema = actionBodySchema(z.strictObject({ reason: z.string() }));
    expect(schema.parse({ meta: { reason: 'x' } })).toEqual({ meta: { reason: 'x' } });
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
    expect(schema.safeParse({ meta: { reason: 'x' }, data: {} }).success).toBe(false);
  });

  it('make the body optional when every meta member is optional', () => {
    const schema = optionalActionBodySchema(z.strictObject({ seconds: z.int().optional() }));
    expect(schema.parse(undefined)).toBeUndefined();
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ meta: {} })).toEqual({ meta: {} });
    expect(schema.parse({ meta: { seconds: 5 } })).toEqual({ meta: { seconds: 5 } });
    expect(schema.safeParse({ meta: { other: 1 } }).success).toBe(false);
  });

  it('accept no meta members for plain actions such as approve', () => {
    expect(emptyActionBodySchema.parse(undefined)).toBeUndefined();
    expect(emptyActionBodySchema.parse({ meta: {} })).toEqual({ meta: {} });
    expect(emptyActionBodySchema.safeParse({ meta: { comment: 'x' } }).success).toBe(false);
  });
});
