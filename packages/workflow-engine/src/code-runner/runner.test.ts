/** C123.3: the runner's two forms stay behind the frozen interface. */
import { describe, expect, it } from 'vitest';
import { connectCodeRunner, createCodeRunnerPool } from './runner.js';

const ENVIRONMENT = 'env_01M5CJXHG07XPHF3HRM6NREDH8';

describe('createCodeRunnerPool', () => {
  it('evaluates through a real child', async () => {
    const runner = createCodeRunnerPool({ size: 1 });
    const result = await runner.evaluate({
      environmentId: ENVIRONMENT,
      source: 'export default function (input) { return input.score + 1; }',
      input: { score: 1 },
      limits: { timeMs: 5_000 },
    });
    await runner.close();
    expect(result).toEqual({ ok: true, value: 2, console: [] });
  });
});

describe('connectCodeRunner', () => {
  it('always answers, here with no server there', async () => {
    const runner = connectCodeRunner('/nonexistent/code-runner.sock');
    const result = await runner.evaluate({
      environmentId: ENVIRONMENT,
      source: 'export default function () { return 1; }',
      input: {},
    });
    await runner.close();
    expect(result).toEqual({
      ok: false,
      code: 'sandbox_crashed',
      message: null,
      console: [],
      reason: 'socket_unavailable',
    });
  });
});
