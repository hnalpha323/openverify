import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';

/**
 * apps/api builds /openapi.json from these schemas (fastify-type-provider-zod). Each must
 * convert without falling back to an "any" placeholder.
 */
const schemas = Object.entries(contracts as Record<string, unknown>).filter(
  (entry): entry is [string, z.ZodType] =>
    entry[0].endsWith('Schema') && entry[1] instanceof z.ZodType,
);

describe('exported zod schemas', () => {
  it('are numerous enough to be the whole contract', () => {
    expect(schemas.length).toBeGreaterThan(50);
  });

  it.each(schemas)('%s converts to JSON Schema for both input and output', (_name, schema) => {
    expect(() => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' })).not.toThrow();
    expect(() => z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw' })).not.toThrow();
  });
});
