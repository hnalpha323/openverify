/**
 * C123: Evaluate Code from claim to completion. Most cases script the runner's answer; the last suite
 * runs real children, so the guest's own text is seen going where the plan says and nowhere else.
 * Every value is synthetic, the SSN included.
 */
import { createHash } from 'node:crypto';
import { getWorkflowRun, openWorkflowStepValues } from '@openverify/db';
import {
  createCodeRunnerPool,
  type CodeEvaluation,
  type CodeEvaluationResult,
  type CodeRunner,
} from '@openverify/workflow-engine/code-runner';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RateLimiter } from '../../../ports.js';
import {
  createAllowAllRateLimiter,
  createDenyRateLimiter,
  fixedClock,
  type RecordingRateLimiter,
} from '../../../test-support/fakes.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  journalOf,
  start,
  stepOf,
  type EngineHarness,
} from '../../engine/testing.js';
import { EVALUATE_CODE_HANDLER } from './handler.js';

const SOURCE = 'export default function (input) { return input.a + 1; }';
const DIGEST = createHash('sha256').update(SOURCE).digest('hex');
const clock = fixedClock(new Date('2026-11-02T12:00:00.000Z'));

let harness: EngineHarness;
let limiter: RecordingRateLimiter;
let evaluations: CodeEvaluation[];
let answer: CodeEvaluationResult;

const scripted: CodeRunner = {
  evaluate(evaluation) {
    evaluations.push(evaluation);
    return Promise.resolve(answer);
  },
  close: () => Promise.resolve(),
};

function bind(egress: object | undefined, rateLimiter: RateLimiter = limiter): void {
  Object.assign(harness.deps.services, { egress, rateLimiter, clock });
}

const withRunner = (codeRunner: CodeRunner | null) => ({
  httpAllowLoopback: false,
  nat64Prefixes: [],
  codeEnabled: true,
  codeRunner,
});

beforeAll(async () => {
  harness = await createEngineHarness([EVALUATE_CODE_HANDLER]);
}, 120_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  harness.steps.jobs.length = 0;
  limiter = createAllowAllRateLimiter(clock);
  evaluations = [];
  answer = { ok: true, value: 2, console: [] };
  bind(withRunner(scripted));
});

const step = (config: Record<string, unknown> = {}, more: Record<string, unknown> = {}) =>
  action(
    'code',
    'evaluate_code',
    { source: SOURCE, properties: { a: 1 }, 'return-type': 'number', ...config },
    more,
  );

async function run(config: Record<string, unknown> = {}, more: Record<string, unknown> = {}) {
  const id = await start(harness, chain([step(config, more)]), {
    grant: { scopes: [], pii: true },
  });
  await drain(harness);
  const row = await stepOf(harness, id, 'code');
  return { id, step: row, values: openWorkflowStepValues(row) };
}

describe('an evaluation (C123.2)', () => {
  it('hands the mapped properties alone, and outputs the value and the source’s digest', async () => {
    const { step: row, values } = await run({
      properties: { a: '{{ trigger.status }}', b: 2 },
      limits: { 'time-ms': 500, 'memory-bytes': 1_000_000 },
    });

    expect(row.status).toBe('succeeded');
    expect(evaluations).toEqual([
      {
        environmentId: harness.environmentId,
        source: SOURCE,
        input: { a: 'completed', b: 2 },
        limits: { timeMs: 500, memoryBytes: 1_000_000 },
        captureConsole: false,
      },
    ]);
    expect(values.output).toEqual({ value: 2, 'source-sha256': DIGEST });
  });

  it('checks the value against the return type', async () => {
    answer = { ok: true, value: 'two', console: [] };

    const { step: row, values } = await run();

    expect(row.errorCode).toBe('type_mismatch');
    expect(row.errorType).toBe('configuration-error');
    expect(values.output).toEqual({
      error: { code: 'type_mismatch', message: null },
      'source-sha256': DIGEST,
    });
  });

  it.each([
    ['boolean', true],
    ['string', 'two'],
    ['object', { a: 1 }],
    ['object', [1]],
    ['none', null],
  ])('takes a %s', async (returnType, value) => {
    answer = { ok: true, value, console: [] };

    expect((await run({ 'return-type': returnType })).step.status).toBe('succeeded');
  });
});

describe('failures (C123.6)', () => {
  it.each(['memory_limit', 'stack_overflow', 'invalid_output', 'runtime_error'] as const)(
    '%s is deterministic: no retry, whatever the step asks',
    async (code) => {
      answer = { ok: false, code, message: 'guest words', console: [] };

      const { step: row, values } = await run({}, { retry: { 'intervals-seconds': [1] } });

      expect(row.errorCode).toBe(code);
      expect(evaluations).toHaveLength(1);
      expect(values.output).toEqual({
        error: { code, message: 'guest words' },
        'source-sha256': DIGEST,
      });
    },
  );

  it.each(['timeout', 'sandbox_crashed'] as const)('%s follows the step’s retry', async (code) => {
    answer = { ok: false, code, message: null, console: [] };

    const { step: row } = await run({}, { retry: { 'intervals-seconds': [60] } });

    expect(row.status).toBe('ready');
    expect(evaluations).toHaveLength(1);
  });

  it('errors a timeout with no retry left', async () => {
    answer = { ok: false, code: 'timeout', message: null, console: [] };

    const { step: row } = await run();

    expect(row.errorCode).toBe('timeout');
    expect(row.errorType).toBe('unknown-error');
  });

  it('cuts the guest’s words at 1 KiB, on a character', async () => {
    answer = { ok: false, code: 'runtime_error', message: 'é'.repeat(2_000), console: [] };

    const { values } = await run();

    const { message } = (values.output as { error: { message: string } }).error;
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(1_024);
    expect(message.endsWith('é')).toBe(true);
  });

  it('keeps the plaintext columns and the journal to the code', async () => {
    answer = { ok: false, code: 'runtime_error', message: 'canary-guest-words', console: [] };

    const { id, step: row } = await run();

    expect(JSON.stringify(row)).not.toContain('canary-guest-words');
    expect(JSON.stringify(await journalOf(harness, id))).not.toContain('canary-guest-words');
    const stored = await getWorkflowRun(harness.db, harness.environmentId, id);
    expect(stored?.errorCode).toBe('runtime_error');
  });
});

describe('availability (C123.7, C122.5)', () => {
  it('errors code_disabled when the install turned it off, reaching no runner', async () => {
    bind({ ...withRunner(scripted), codeEnabled: false });

    expect((await run()).step.errorCode).toBe('code_disabled');
    expect(evaluations).toEqual([]);
  });

  it('errors provider_not_configured with no runner', async () => {
    bind(withRunner(null));

    expect((await run()).step.errorCode).toBe('provider_not_configured');
  });

  it('reads as closed when a process passes no egress config at all', async () => {
    bind(undefined);

    expect((await run()).step.errorCode).toBe('provider_not_configured');
  });
});

describe('the budget (C143.3)', () => {
  it('counts each evaluation against the environment', async () => {
    await run();

    expect(limiter.calls).toEqual([
      {
        key: harness.environmentId,
        policy: { name: 'workflow-code', limit: 600, windowSeconds: 60 },
      },
    ]);
  });

  it('refuses past the budget', async () => {
    bind(withRunner(scripted), createDenyRateLimiter(30, clock));

    expect((await run()).step.errorCode).toBe('rate_limited');
    expect(evaluations).toEqual([]);
  });

  it('fails closed when the store is down', async () => {
    bind(withRunner(scripted), { consume: () => Promise.reject(new Error('down')) });

    expect((await run()).step.errorCode).toBe('rate_limited');
    expect(evaluations).toEqual([]);
  });
});

describe('a real child (C123.9, P18)', () => {
  const pool = createCodeRunnerPool({ size: 1 });
  const SSN = '078-05-1120';

  afterAll(() => pool.close());

  it('evaluates', async () => {
    bind(withRunner(pool));

    const { values } = await run();

    expect(values.output).toEqual({ value: 2, 'source-sha256': DIGEST });
  });

  it('keeps a guest error holding an SSN to the sealed output', async () => {
    bind(withRunner(pool));

    const {
      id,
      step: row,
      values,
    } = await run({
      source: `export default function () { throw new Error('${SSN}'); }`,
    });

    expect(row.errorCode).toBe('runtime_error');
    expect(JSON.stringify(values.output)).toContain(SSN);
    expect(JSON.stringify(row)).not.toContain(SSN);
    expect(JSON.stringify(await journalOf(harness, id))).not.toContain(SSN);
  });

  it('captures no console outside a test run: the guest has none', async () => {
    bind(withRunner(pool));

    const { step: row } = await run({
      source: `export default function () { console.log('x'); return 1; }`,
    });

    expect(row.errorCode).toBe('runtime_error');
  });
});
