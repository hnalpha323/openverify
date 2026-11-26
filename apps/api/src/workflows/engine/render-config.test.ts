/**
 * C113.8, C123.2: the source of an Evaluate Code step is code, never a template. The engine renders
 * every other member of a config, so a source longer than a template's cap or holding `{{` must reach
 * the handler as it was written.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ActionHandler } from './action-port.js';
import {
  action,
  chain,
  createEngineHarness,
  drain,
  runOf,
  start,
  stepOf,
  type EngineHarness,
} from './testing.js';

const seen: { config: Record<string, unknown> }[] = [];

const code: ActionHandler = {
  key: 'evaluate_code',
  version: 1,
  shape: 'outside',
  execute: (context) => {
    seen.push({ config: context.config });
    return Promise.resolve({
      kind: 'succeeded',
      output: { value: 1, 'source-sha256': 'a'.repeat(64) },
    });
  },
};

let harness: EngineHarness;

beforeAll(async () => {
  harness = await createEngineHarness([code]);
});

afterAll(async () => {
  await harness.close();
});

async function runSource(source: string, properties: Record<string, unknown> = {}) {
  const definition = chain([
    action('code', 'evaluate_code', { source, properties, 'return-type': 'number' }),
  ]);
  const runId = await start(harness, definition, {
    inputs: { reference: 'synthetic-reference' },
  });
  await drain(harness);
  return { run: await runOf(harness, runId), step: await stepOf(harness, runId, 'code') };
}

describe('renderConfig (C113.8, C123.2)', () => {
  it('leaves a source past the template cap as it was written', async () => {
    const source = `export default function () { return 1; /*${'x'.repeat(40_000)}*/ }`;

    const { run, step } = await runSource(source);

    expect(step.errorCode).toBeNull();
    expect(run.status).toBe('completed');
    expect(seen.at(-1)?.config.source).toBe(source);
  });

  it('leaves `{{` in a source alone, and never fills it in', async () => {
    const source = "export default function () { return '{{ inputs.reference }}'.length; }";

    const { run } = await runSource(source);

    expect(run.status).toBe('completed');
    expect(seen.at(-1)?.config.source).toBe(source);
  });

  it('still renders the properties', async () => {
    const { run } = await runSource('export default function (input) { return 1; }', {
      reference: '{{ inputs.reference }}',
    });

    expect(run.status).toBe('completed');
    expect(seen.at(-1)?.config.properties).toEqual({ reference: 'synthetic-reference' });
  });
});
