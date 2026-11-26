/**
 * C123.5: a step can set the time and the memory up to the install's ceilings, and nothing else.
 * The WebAssembly maximum is the QuickJS limit plus the headroom, and an input the contract refuses
 * never reaches a child. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { EVALUATE_CODE_LIMITS } from '../actions/evaluate-code.js';
import {
  defaultPoolSize,
  evaluateRequestAllowed,
  prepareEvaluateRequest,
  requestLimitsAllowed,
  resolveEvaluationLimits,
} from './limits.js';
import { codeRunnerRequestSchema } from './protocol.js';

const KIB = 1024;
const MIB = 1024 * KIB;
const ID = '00000000-0000-4000-8000-000000000001';
const ENVIRONMENT = 'env_01M5CJXHG07XPHF3HRM6NREDH8';
const SOURCE = 'export default function (input) { return input.score; }';

const evaluation = {
  environmentId: ENVIRONMENT,
  source: SOURCE,
  input: { score: 1 },
};

describe('resolveEvaluationLimits (C123.5)', () => {
  it('holds the defaults when a step sets none', () => {
    expect(resolveEvaluationLimits()).toEqual({
      'time-ms': 1_000,
      'memory-bytes': 32 * MIB,
      'wasm-maximum-bytes': 48 * MIB,
      'stack-bytes': 512 * KIB,
    });
  });

  it('takes a step lower, and the WebAssembly maximum follows the memory', () => {
    expect(resolveEvaluationLimits({ timeMs: 50, memoryBytes: 2 * MIB })).toMatchObject({
      'time-ms': 50,
      'memory-bytes': 2 * MIB,
      'wasm-maximum-bytes': 18 * MIB,
    });
  });

  it('takes a step up to the ceiling and never past it', () => {
    expect(resolveEvaluationLimits({ timeMs: 5_000, memoryBytes: 64 * MIB })).toMatchObject({
      'time-ms': 5_000,
      'memory-bytes': 64 * MIB,
      'wasm-maximum-bytes': 80 * MIB,
    });
    expect(resolveEvaluationLimits({ timeMs: 60_000, memoryBytes: 1024 * MIB })).toMatchObject({
      'time-ms': 5_000,
      'memory-bytes': 64 * MIB,
      'wasm-maximum-bytes': 80 * MIB,
    });
  });
});

describe('requestLimitsAllowed (the socket form reads limits off a frame)', () => {
  it('takes what resolveEvaluationLimits gives', () => {
    expect(requestLimitsAllowed(resolveEvaluationLimits())).toBe(true);
    expect(
      requestLimitsAllowed(resolveEvaluationLimits({ timeMs: 5_000, memoryBytes: 64 * MIB })),
    ).toBe(true);
  });

  it.each([
    ['time-ms', 5_001],
    ['memory-bytes', 64 * MIB + 1],
    ['wasm-maximum-bytes', 80 * MIB + 1],
    ['stack-bytes', 512 * KIB + 1],
  ])('refuses %s past its ceiling', (name, value) => {
    expect(requestLimitsAllowed({ ...resolveEvaluationLimits(), [name]: value })).toBe(false);
  });

  it('refuses a WebAssembly maximum that does not hold the headroom', () => {
    const limits = resolveEvaluationLimits({ memoryBytes: 64 * MIB });
    expect(requestLimitsAllowed({ ...limits, 'wasm-maximum-bytes': 64 * MIB })).toBe(false);
  });
});

describe('evaluateRequestAllowed (the container reads a request off a frame)', () => {
  const request = () => {
    const prepared = prepareEvaluateRequest(evaluation, ID);
    if (prepared === null) throw new Error('the request was refused');
    return prepared;
  };

  it('takes what prepareEvaluateRequest gives', () => {
    expect(evaluateRequestAllowed(request())).toBe(true);
  });

  it.each([
    ['a source past 64 KiB', { source: 'x'.repeat(64 * KIB + 1) }],
    ['an input past 256 KiB', { input: `"${'x'.repeat(256 * KIB)}"` }],
    ['an input past depth 32', { input: `${'['.repeat(33)}${']'.repeat(33)}` }],
    ['limits past a ceiling', { limits: { ...resolveEvaluationLimits(), 'time-ms': 5_001 } }],
  ])('refuses %s', (_name, change) => {
    expect(evaluateRequestAllowed({ ...request(), ...change })).toBe(false);
  });
});

describe('prepareEvaluateRequest', () => {
  it('builds a request the frozen schema takes, with the input as JSON text', () => {
    const request = prepareEvaluateRequest(evaluation, ID);
    expect(codeRunnerRequestSchema.parse(request)).toEqual({
      kind: 'evaluate',
      id: ID,
      'environment-id': ENVIRONMENT,
      source: SOURCE,
      input: '{"score":1}',
      limits: resolveEvaluationLimits(),
      console: false,
    });
  });

  it('asks for the console only when a test run does (C120.7)', () => {
    expect(prepareEvaluateRequest({ ...evaluation, captureConsole: true }, ID)?.console).toBe(true);
  });

  it('takes the source and the input at their caps', () => {
    const source = `export default function () {} //${'x'.repeat(64 * KIB - 32)}`;
    expect(Buffer.byteLength(source)).toBeLessThanOrEqual(64 * KIB);
    const input = { text: 'x'.repeat(256 * KIB - 16) };
    expect(prepareEvaluateRequest({ ...evaluation, source, input }, ID)).not.toBeNull();
  });

  it.each([
    ['an empty source', { source: '' }],
    [
      'a source past 64 KiB',
      { source: 'x'.repeat(EVALUATE_CODE_LIMITS['source-bytes'].value + 1) },
    ],
    [
      'a source past 64 KiB in bytes',
      { source: 'é'.repeat(EVALUATE_CODE_LIMITS['source-bytes'].value / 2 + 1) },
    ],
    ['an input past 256 KiB', { input: { text: 'x'.repeat(256 * KIB) } }],
    ['an environment that is no id', { environmentId: 'other' }],
  ])('refuses %s', (_name, change) => {
    expect(prepareEvaluateRequest({ ...evaluation, ...change }, ID)).toBeNull();
  });

  it('refuses an input past depth 32', () => {
    let nested: unknown = 1;
    for (let depth = 0; depth < 32; depth += 1) nested = [nested];
    expect(prepareEvaluateRequest({ ...evaluation, input: { nested } }, ID)).toBeNull();
    let within: unknown = 1;
    for (let depth = 0; depth < 31; depth += 1) within = [within];
    expect(prepareEvaluateRequest({ ...evaluation, input: { within } }, ID)).not.toBeNull();
  });

  it('refuses an input JSON cannot hold, and never throws', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(prepareEvaluateRequest({ ...evaluation, input: cyclic }, ID)).toBeNull();
    expect(prepareEvaluateRequest({ ...evaluation, input: { big: 1n } }, ID)).toBeNull();
  });
});

describe('defaultPoolSize (C123.5)', () => {
  it('leaves one CPU, and never reads below one', () => {
    expect(defaultPoolSize(12)).toBe(11);
    expect(defaultPoolSize(2)).toBe(1);
    expect(defaultPoolSize(1)).toBe(1);
    expect(defaultPoolSize()).toBeGreaterThanOrEqual(1);
  });
});
