/**
 * C123.2, C123.5, C123.6: the Evaluate Code contract. Every constant is provisional with a basis,
 * only mapped properties reach the code, and the guest's own message is a sealed PII member of the
 * output, never a plaintext error (P18). Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EVALUATE_CODE_ACTION_KEY,
  EVALUATE_CODE_DETERMINISTIC_ERRORS,
  EVALUATE_CODE_ERROR_CODES,
  EVALUATE_CODE_ERROR_TYPES,
  EVALUATE_CODE_LIMITS,
  EVALUATE_CODE_RETURN_TYPES,
  evaluateCodeConfigSchema,
  evaluateCodeFailureSchema,
  evaluateCodeOutputSchema,
  evaluateCodeValueFits,
} from './evaluate-code.js';

const SOURCE = 'export default function (input) { return input.score > 1; }';
const config = (overrides: Record<string, unknown> = {}) => ({
  source: SOURCE,
  properties: { score: '{{ steps.calculate.output.value }}' },
  'return-type': 'boolean',
  ...overrides,
});
const SHA256 = 'a'.repeat(64);
const KIB = 1024;
const MIB = 1024 * KIB;

describe('the action key', () => {
  it('is the catalogue key', () => {
    expect(EVALUATE_CODE_ACTION_KEY).toBe('evaluate_code');
  });
});

describe('EVALUATE_CODE_LIMITS (C123.5)', () => {
  it.each([
    ['time-ms', 1_000],
    ['time-ms-ceiling', 5_000],
    ['memory-bytes', 32 * MIB],
    ['memory-bytes-ceiling', 64 * MIB],
    ['wasm-headroom-bytes', 16 * MIB],
    ['stack-bytes', 512 * KIB],
    ['source-bytes', 64 * KIB],
    ['input-bytes', 256 * KIB],
    ['input-depth', 32],
    ['output-bytes', 64 * KIB],
    ['output-depth', 32],
    ['properties', 32],
    ['kill-grace-ms', 250],
    ['child-heap-mb', 64],
    ['evaluations-per-child', 100],
    ['console-lines', 50],
    ['console-line-bytes', KIB],
    ['error-message-bytes', KIB],
  ])('states %s as %d', (name, value) => {
    expect(EVALUATE_CODE_LIMITS[name as keyof typeof EVALUATE_CODE_LIMITS].value).toBe(value);
  });

  it('marks every constant provisional, with its source', () => {
    for (const [name, limit] of Object.entries(EVALUATE_CODE_LIMITS)) {
      expect(limit.basis, name).toBe('provisional');
      expect(limit.source.length, name).toBeGreaterThan(0);
    }
  });

  it('keeps QuickJS’s stack below the build’s 5 MB C stack (C123.5)', () => {
    expect(EVALUATE_CODE_LIMITS['stack-bytes'].value).toBeLessThan(5 * MIB);
  });
});

describe('evaluateCodeConfigSchema (C123.2)', () => {
  it('takes a source, mapped properties and a return type', () => {
    expect(evaluateCodeConfigSchema.parse(config())).toEqual(config());
  });

  it.each(['boolean', 'number', 'string', 'object', 'none'])('takes return type %s', (type) => {
    expect(evaluateCodeConfigSchema.safeParse(config({ 'return-type': type })).success).toBe(true);
  });

  it('holds the five public return types', () => {
    expect(EVALUATE_CODE_RETURN_TYPES).toEqual(['boolean', 'number', 'string', 'object', 'none']);
  });

  it('takes literals beside paths, as JSON values', () => {
    const properties = { limit: 3, mode: 'strict', flags: ['a'], nested: { on: true }, none: null };
    expect(evaluateCodeConfigSchema.safeParse(config({ properties })).success).toBe(true);
  });

  it('refuses a source past 64 KiB, counted in bytes, not characters', () => {
    const accepted = `${SOURCE}//${'x'.repeat(64 * KIB - SOURCE.length - 2)}`;
    expect(evaluateCodeConfigSchema.safeParse(config({ source: accepted })).success).toBe(true);
    const wide = `${SOURCE}//${'é'.repeat(32 * KIB)}`;
    expect(evaluateCodeConfigSchema.safeParse(config({ source: wide })).success).toBe(false);
  });

  it('refuses a source that exports no default function', () => {
    expect(
      evaluateCodeConfigSchema.safeParse(config({ source: 'function run() {}' })).success,
    ).toBe(false);
  });

  it('refuses unknown members, an unknown return type and a missing property map', () => {
    expect(evaluateCodeConfigSchema.safeParse(config({ network: true })).success).toBe(false);
    expect(evaluateCodeConfigSchema.safeParse(config({ 'return-type': 'date' })).success).toBe(
      false,
    );
    expect(evaluateCodeConfigSchema.safeParse(config({ properties: undefined })).success).toBe(
      false,
    );
  });

  it('refuses more properties than the cap, and a name that is no identifier', () => {
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`p${String(index)}`, index]),
    );
    expect(evaluateCodeConfigSchema.safeParse(config({ properties: many })).success).toBe(false);
    expect(
      evaluateCodeConfigSchema.safeParse(config({ properties: { 'not a name': 1 } })).success,
    ).toBe(false);
    expect(
      evaluateCodeConfigSchema.safeParse(config({ properties: { __proto__x: 1, ok_1: 2 } }))
        .success,
    ).toBe(true);
  });

  it('takes per-step limits up to the install ceilings, and no further (C123.5)', () => {
    const limits = (value: Record<string, unknown>) =>
      evaluateCodeConfigSchema.safeParse(config({ limits: value })).success;
    expect(limits({ 'time-ms': 100, 'memory-bytes': 8 * MIB })).toBe(true);
    expect(limits({ 'time-ms': 5_000, 'memory-bytes': 64 * MIB })).toBe(true);
    expect(limits({ 'time-ms': 5_001 })).toBe(false);
    expect(limits({ 'memory-bytes': 64 * MIB + 1 })).toBe(false);
    expect(limits({ 'time-ms': 0 })).toBe(false);
    expect(limits({ 'stack-bytes': KIB })).toBe(false);
  });
});

describe('evaluateCodeValueFits (C123.2)', () => {
  it.each([
    ['boolean', true, true],
    ['boolean', 'true', false],
    ['boolean', null, false],
    ['number', 1.5, true],
    ['number', '1', false],
    ['number', Number.NaN, false],
    ['number', Number.POSITIVE_INFINITY, false],
    ['string', '', true],
    ['string', 1, false],
    ['object', { a: 1 }, true],
    ['object', [1], true],
    ['object', null, false],
    ['object', 'a', false],
    ['none', null, true],
    ['none', 0, false],
    ['none', false, false],
  ] as const)('%s with %j is %s', (type, value, expected) => {
    expect(evaluateCodeValueFits(type, value)).toBe(expected);
  });
});

describe('the outputs (C123.2, C123.6)', () => {
  it('holds the value and the source’s digest, the value PII by default', () => {
    const output = { value: { any: ['json'] }, 'source-sha256': SHA256 };
    expect(evaluateCodeOutputSchema.parse(output)).toEqual(output);
    expect(z.toJSONSchema(evaluateCodeOutputSchema).properties).toMatchObject({
      value: { pii: true },
    });
  });

  it('refuses another member, so a step smuggles nothing past the schema (C115.5)', () => {
    expect(
      evaluateCodeOutputSchema.safeParse({ value: 1, 'source-sha256': SHA256, extra: 1 }).success,
    ).toBe(false);
  });

  it('holds a failure’s code in the open and the guest’s message as PII (P18)', () => {
    const failure = {
      error: { code: 'runtime_error', message: 'synthetic guest text' },
      'source-sha256': SHA256,
    };
    expect(evaluateCodeFailureSchema.parse(failure)).toEqual(failure);
    const { properties } = z.toJSONSchema(evaluateCodeFailureSchema) as unknown as {
      properties: { error: { properties: { message: unknown; code: unknown } } };
    };
    expect(properties.error.properties.message).toMatchObject({ pii: true });
    expect(properties.error.properties.code).not.toMatchObject({ pii: true });
  });

  it('caps the guest’s message at 1 KiB in bytes', () => {
    const failure = (message: string) => ({
      error: { code: 'runtime_error', message },
      'source-sha256': SHA256,
    });
    expect(evaluateCodeFailureSchema.safeParse(failure('x'.repeat(KIB))).success).toBe(true);
    expect(evaluateCodeFailureSchema.safeParse(failure('é'.repeat(KIB))).success).toBe(false);
  });
});

describe('the errors (C123.6)', () => {
  it('holds the eight codes', () => {
    expect(EVALUATE_CODE_ERROR_CODES).toEqual([
      'timeout',
      'memory_limit',
      'stack_overflow',
      'invalid_output',
      'type_mismatch',
      'runtime_error',
      'sandbox_crashed',
      'code_disabled',
    ]);
  });

  it('types each as unknown-error, but type_mismatch and invalid_output as configuration-error', () => {
    for (const code of EVALUATE_CODE_ERROR_CODES) {
      expect(EVALUATE_CODE_ERROR_TYPES[code], code).toBe(
        code === 'type_mismatch' || code === 'invalid_output'
          ? 'configuration-error'
          : 'unknown-error',
      );
    }
  });

  it('marks what a retry cannot change, and leaves a crash and a wall-clock timeout out (C117.6)', () => {
    expect([...EVALUATE_CODE_DETERMINISTIC_ERRORS].sort()).toEqual(
      [
        'code_disabled',
        'invalid_output',
        'memory_limit',
        'runtime_error',
        'stack_overflow',
        'type_mismatch',
      ].sort(),
    );
  });
});
