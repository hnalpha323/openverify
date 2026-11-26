/**
 * C123.3, C123.5, C123.6, C123.9: the pool, with real children. The real entry runs under the real
 * flags; `testing/fake-child.mjs` is a compromised child under the same flags, on the same pipes.
 * Each time limit here is a timer of the parent's, so a wall-clock bound holds whatever the load.
 * Every value is synthetic.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { EVALUATE_CODE_LIMITS } from '../actions/evaluate-code.js';
import { FrameReader, encodeFrame, parseFrame } from './frames.js';
import { childArgumentsOf, resolveRunnerPaths } from './paths.js';
import { prepareEvaluateRequest } from './limits.js';
import {
  createPool,
  type ChildPlan,
  type CodeRunnerPool,
  type PoolEvent,
  type PoolInternals,
} from './pool.js';
import {
  CODE_RUNNER_PROTOCOL_VERSION,
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
  type CodeRunnerFailureReason,
} from './protocol.js';
import type { CodeEvaluation, CodeEvaluationResult, CodeRunner } from './runner.js';

const KIB = 1024;
const MIB = 1024 * KIB;
const ID = '00000000-0000-4000-8000-000000000001';
const ENVIRONMENT = 'env_01M5CJXHG07XPHF3HRM6NREDH8';
const OTHER_ENVIRONMENT = 'env_01M5CJXHG07XPHF3HRM6NREDH9';
const GENEROUS_MS = 5_000;
const FAKE_CHILD = fileURLToPath(new URL('./testing/fake-child.mjs', import.meta.url));

const body = (text: string) => `export default function (input) {${text}}`;

const evaluation = (text: string, change: Partial<CodeEvaluation> = {}): CodeEvaluation => ({
  environmentId: ENVIRONMENT,
  source: body(text),
  input: {},
  limits: { timeMs: GENEROUS_MS },
  ...change,
});

const runners: CodeRunner[] = [];
const events: PoolEvent[] = [];

const eventsOf = (type: PoolEvent['type']) => events.filter((event) => event.type === type);

function pool(size = 1, internals: PoolInternals = {}): CodeRunnerPool {
  const runner = createPool({ size }, { observe: (event) => events.push(event), ...internals });
  runners.push(runner);
  return runner;
}

const fakePlan = (mode: string, ...args: string[]): ChildPlan => {
  const paths = resolveRunnerPaths(FAKE_CHILD);
  return { args: [...childArgumentsOf(paths), mode, ...args], label: paths.label };
};

const fake = async (mode: string, internals: PoolInternals = {}) =>
  pool(1, { plan: fakePlan(mode), ...internals }).evaluate(evaluation('return 1;'));

const crashed = (reason: CodeRunnerFailureReason): CodeEvaluationResult => ({
  ok: false,
  code: 'sandbox_crashed',
  message: null,
  console: [],
  reason,
});

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.close()));
  events.length = 0;
});

describe('a real child (C123.3)', () => {
  it('answers an evaluation', async () => {
    const result = await pool().evaluate(
      evaluation('return { sum: input.a + 1 };', { input: { a: 1 } }),
    );
    expect(result).toEqual({ ok: true, value: { sum: 2 }, console: [] });
  });

  it('serves more evaluations from the same child', async () => {
    const runner = pool();
    await runner.evaluate(evaluation('return 1;'));
    await runner.evaluate(evaluation('return 2;'));
    expect(eventsOf('spawned')).toHaveLength(1);
  });

  it('carries the console of a test run, and none otherwise', async () => {
    const runner = pool();
    const logged = 'try { console.log("line"); } catch { return "none"; } return "logged";';
    expect(await runner.evaluate(evaluation(logged, { captureConsole: true }))).toEqual({
      ok: true,
      value: 'logged',
      console: ['line'],
    });
    expect(await runner.evaluate(evaluation(logged))).toEqual({
      ok: true,
      value: 'none',
      console: [],
    });
  });

  it('takes the source and the input at their caps', async () => {
    const source = `export default function (input) { return input.text.length; } //${'x'.repeat(64 * KIB - 80)}`;
    const text = 'é'.repeat(128 * KIB - 16);
    const result = await pool().evaluate(evaluation('', { source, input: { text } }));
    expect(result).toEqual({ ok: true, value: text.length, console: [] });
  });

  it('carries the largest output through one frame, escapes included', async () => {
    const quotes = 2;
    const result = await pool().evaluate(
      evaluation(`return "\\n".repeat(${String((64 * KIB - quotes) / 2)});`),
    );
    expect(result).toMatchObject({ ok: true });
  });
});

describe('the child entry on its pipes (C123.3, P16)', () => {
  interface Dialled {
    child: ChildProcess;
    requests: Writable;
    responses: Readable;
    exit: Promise<number | null>;
  }

  const paths = () => resolveRunnerPaths();

  const dial = async (): Promise<Dialled> => {
    const child = spawn(process.execPath, childArgumentsOf(paths()), {
      env: {},
      stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
    const requests = child.stdio[3] as Writable;
    const responses = child.stdio[4] as Readable;
    requests.on('error', () => undefined);
    const exit = new Promise<number | null>((resolve) => {
      child.once('exit', resolve);
    });
    const reader = new FrameReader(RESPONSE_FRAME_MAX_BYTES);
    await new Promise<void>((resolve) => {
      responses.once('data', (chunk: Buffer) => {
        expect(parseFrame(reader.push(chunk)[0] ?? Buffer.alloc(0), 2)).toEqual({
          kind: 'ready',
          protocol: CODE_RUNNER_PROTOCOL_VERSION,
          variant: paths().label,
        });
        resolve();
      });
    });
    return { child, requests, responses, exit };
  };

  const header = (length: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(length);
    return bytes;
  };

  it('refuses a request past its cap before buffering it, by its exit', async () => {
    const { requests, exit } = await dial();
    requests.write(header(REQUEST_FRAME_MAX_BYTES + 1));
    expect(await exit).toBe(64);
  });

  it('refuses an empty frame', async () => {
    const { requests, exit } = await dial();
    requests.write(header(0));
    expect(await exit).toBe(64);
  });

  it.each([
    ['text that is no JSON', '{'],
    ['a kind it does not know', '{"kind":"eval"}'],
    [
      'a request with no limits',
      '{"kind":"evaluate","id":"x","source":"s","input":"1","console":false}',
    ],
  ])('refuses %s', async (_name, text) => {
    const { requests, exit } = await dial();
    requests.write(Buffer.concat([header(Buffer.byteLength(text)), Buffer.from(text)]));
    expect(await exit).toBe(64);
  });

  it('leaves on shutdown', async () => {
    const { requests, exit } = await dial();
    requests.write(encodeFrame({ kind: 'shutdown' }, REQUEST_FRAME_MAX_BYTES));
    expect(await exit).toBe(0);
  });

  it('leaves when its parent goes', async () => {
    const { requests, exit } = await dial();
    requests.destroy();
    expect(await exit).toBe(0);
  });
});

describe('the sandbox (C123.9)', () => {
  it('ends an infinite loop with a timeout, and recycles the child', async () => {
    const runner = pool();
    const started = Date.now();
    const result = await runner.evaluate(evaluation('for (;;) {}', { limits: { timeMs: 50 } }));
    expect(result).toEqual({ ok: false, code: 'timeout', message: null, console: [] });
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(await runner.evaluate(evaluation('return 1;'))).toMatchObject({ ok: true });
    expect(eventsOf('spawned')).toHaveLength(2);
  });

  it('ends catastrophic backtracking', async () => {
    const result = await pool().evaluate(
      evaluation('return /(a+)+$/.test("a".repeat(40) + "b");', { limits: { timeMs: 50 } }),
    );
    expect(result).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('ends a long native call through the interrupt or the kill', async () => {
    const result = await pool().evaluate(
      evaluation('const a = new Array(200000).fill(3.5); for (;;) a.sort();', {
        limits: { timeMs: 1, memoryBytes: 64 * MIB },
      }),
    );
    expect(result).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('kills a child that ignores its deadline, at the limit plus 250 ms', async () => {
    const delays: number[] = [];
    const schedule = (run: () => void, delayMs: number) => {
      delays.push(delayMs);
      const timer = setTimeout(run, delayMs);
      return () => {
        clearTimeout(timer);
      };
    };
    const started = Date.now();
    const result = await pool(1, { plan: fakePlan('spin'), schedule }).evaluate(
      evaluation('return 1;', { limits: { timeMs: 30 } }),
    );
    expect(result).toEqual({ ok: false, code: 'timeout', message: null, console: [] });
    expect(delays).toContain(30 + EVALUATE_CODE_LIMITS['kill-grace-ms'].value);
    expect(Date.now() - started).toBeGreaterThanOrEqual(275);
    expect(eventsOf('killed')).toHaveLength(1);
  });

  it('dies by SIGKILL, whatever the guest does', async () => {
    await pool(1, { plan: fakePlan('spin') }).evaluate(
      evaluation('return 1;', { limits: { timeMs: 1 } }),
    );
    await expect.poll(() => eventsOf('exited')).toHaveLength(1);
    expect(eventsOf('exited')[0]).toMatchObject({ signal: 'SIGKILL' });
  });

  it('gives memory_limit past the QuickJS limit, and recycles the child', async () => {
    const runner = pool();
    const result = await runner.evaluate(
      evaluation('const a = []; for (;;) a.push("x".repeat(65536) + a.length);', {
        limits: { timeMs: GENEROUS_MS, memoryBytes: 2 * MIB },
      }),
    );
    expect(result).toEqual({ ok: false, code: 'memory_limit', message: null, console: [] });
    await runner.evaluate(evaluation('return 1;'));
    expect(eventsOf('spawned')).toHaveLength(2);
  });

  it('gives stack_overflow on deep recursion, and the next evaluation is unaffected', async () => {
    const runner = pool();
    const result = await runner.evaluate(
      evaluation('function r(n) { return r(n + 1) + 1; } return r(0);'),
    );
    expect(result).toEqual({ ok: false, code: 'stack_overflow', message: null, console: [] });
    expect(await runner.evaluate(evaluation('return 1;'))).toMatchObject({ ok: true, value: 1 });
  });

  it('holds no require, process, fetch or timers on globalThis', async () => {
    const names = ['require', 'process', 'fetch', 'setTimeout', 'setInterval', 'console'];
    const result = await pool().evaluate(
      evaluation(
        `return ${JSON.stringify(names)}.filter((n) => typeof globalThis[n] !== "undefined");`,
      ),
    );
    expect(result).toEqual({ ok: true, value: [], console: [] });
  });

  it('survives a frame header announcing 1 GiB, with the worker memory unchanged', async () => {
    const before = process.memoryUsage();
    const result = await fake('header-1gib');
    const after = process.memoryUsage();
    expect(result).toEqual(crashed('frame_too_large'));
    expect(after.arrayBuffers - before.arrayBuffers).toBeLessThan(16 * MIB);
    expect(after.heapUsed - before.heapUsed).toBeLessThan(64 * MIB);
    expect(eventsOf('killed')).toHaveLength(1);
  });

  it.each<[string, string, CodeRunnerFailureReason]>([
    ['text that is not JSON', 'not-json', 'frame_malformed'],
    ['bytes that are not UTF-8', 'not-utf8', 'frame_malformed'],
    ['a frame nested past the depth', 'too-deep', 'frame_malformed'],
    ['an empty frame', 'empty-frame', 'frame_malformed'],
    ['a kind we do not know', 'wrong-kind', 'frame_malformed'],
    ['a member we do not know', 'extra-member', 'frame_malformed'],
    ['a code only the parent decides', 'parent-code', 'frame_malformed'],
    ['the socket form’s crash frame', 'crashed', 'frame_malformed'],
    ['a console line past 1 KiB', 'long-console-line', 'frame_malformed'],
    ['an answer to another request', 'wrong-id', 'frame_unexpected'],
    ['a second handshake', 'second-ready', 'frame_unexpected'],
    ['a 51st console line', 'console-flood', 'frame_unexpected'],
  ])('refuses %s and kills the child', async (_name, mode, reason) => {
    expect(await fake(mode)).toEqual(crashed(reason));
    expect(eventsOf('killed')).toHaveLength(1);
  });

  it('kills a child that writes after its answer', async () => {
    const runner = pool(1, { plan: fakePlan('frame-after-answer') });
    expect(await runner.evaluate(evaluation('return 1;'))).toMatchObject({ ok: true });
    await expect.poll(() => eventsOf('killed')).toHaveLength(1);
  });

  it('kills a child that answers twice', async () => {
    const runner = pool(1, { plan: fakePlan('answer-twice') });
    expect(await runner.evaluate(evaluation('return 1;'))).toMatchObject({ ok: true });
    await expect.poll(() => eventsOf('killed')).toHaveLength(1);
  });

  it('never lets a __proto__ key out of a frame reach an object prototype', async () => {
    const result = await fake('polluted');
    expect(result).toMatchObject({ ok: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(Object.getPrototypeOf((result as { value: object }).value)).toBe(Object.prototype);
  });

  it('caps a guest message at 1 KiB again in the parent', async () => {
    const result = await fake('long-message');
    expect(result).toMatchObject({ ok: false, code: 'runtime_error' });
    const { message } = result as { message: string };
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(KIB);
  });

  describe('with a canary in the parent', () => {
    const CANARY = 'CANARY-PARENT-c19e04b7-synthetic';
    let directory: string;
    let file: string;

    beforeAll(() => {
      process.env.OPENVERIFY_TEST_CANARY = CANARY;
      directory = mkdtempSync(join(tmpdir(), 'code-runner-'));
      file = join(directory, 'secret.txt');
      writeFileSync(file, CANARY);
    });

    afterAll(() => {
      delete process.env.OPENVERIFY_TEST_CANARY;
      rmSync(directory, { recursive: true, force: true });
    });

    it('holds nothing of the parent in the child, and the flags refuse the rest', async () => {
      const result = await pool(1, { plan: fakePlan('probe', file) }).evaluate(
        evaluation('return 1;'),
      );
      expect(result).toMatchObject({
        ok: true,
        value: {
          env: [],
          ipc: 'undefined',
          read: 'ERR_ACCESS_DENIED',
          write: 'ERR_ACCESS_DENIED',
          spawn: 'ERR_ACCESS_DENIED',
          worker: 'ERR_ACCESS_DENIED',
          addon: 'ERR_DLOPEN_DISABLED',
          permission: false,
        },
      });
    });

    it('never reaches the canary from the guest', async () => {
      const guest = `const seen = [];
        for (const name of Object.getOwnPropertyNames(globalThis)) seen.push(name);
        for (const name of ["process", "std", "os", "require", "env", "environ"]) {
          seen.push(typeof globalThis[name]);
        }
        return seen.join(" ");`;
      const result = await pool().evaluate(evaluation(guest));
      expect(JSON.stringify(result)).not.toContain(CANARY);
      expect(result).toMatchObject({ ok: true });
      expect((result as { value: string }).value).not.toMatch(/process|environ|require/);
    });
  });

  it('finds no canary of an earlier evaluation in the same child', async () => {
    const CANARY = 'CANARY-GUEST-5ab1d3e0-synthetic';
    const runner = pool();
    await runner.evaluate(evaluation(`globalThis.kept = "${CANARY}".repeat(2000); return 1;`));
    const scan = `const bytes = new Uint8Array(new ArrayBuffer(4 * 1024 * 1024));
      const wanted = "${CANARY}";
      const first = wanted.charCodeAt(0);
      // A native search reads every byte at no cost per byte, so the guest's clock holds under load.
      for (let i = bytes.indexOf(first); i !== -1; i = bytes.indexOf(first, i + 1)) {
        let j = 0;
        while (j < wanted.length && bytes[i + j] === wanted.charCodeAt(j)) j += 1;
        if (j === wanted.length) return true;
      }
      return typeof globalThis.kept;`;
    expect(await runner.evaluate(evaluation(scan))).toEqual({
      ok: true,
      value: 'undefined',
      console: [],
    });
    expect(eventsOf('spawned')).toHaveLength(1);
  });

  it('holds a guest’s words in the message alone, never in a code or a reason (P18)', async () => {
    const SSN = '078-05-1120';
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    onTestFinished(() => {
      stdout.mockRestore();
      stderr.mockRestore();
    });
    const result = await pool().evaluate(
      evaluation('throw new Error("the number is " + input.ssn);', { input: { ssn: SSN } }),
    );
    expect(result).toEqual({
      ok: false,
      code: 'runtime_error',
      message: `the number is ${SSN}`,
      console: [],
    });
    expect(JSON.stringify({ ...result, message: null })).not.toContain(SSN);
    expect(JSON.stringify(events)).not.toContain(SSN);
    for (const write of [stdout, stderr]) {
      expect(JSON.stringify(write.mock.calls)).not.toContain(SSN);
    }
  });

  it('starts a recycled child clean', async () => {
    const runner = pool();
    await runner.evaluate(
      evaluation('globalThis.kept = 1; for (;;) {}', { limits: { timeMs: 20 } }),
    );
    expect(await runner.evaluate(evaluation('return typeof globalThis.kept;'))).toEqual({
      ok: true,
      value: 'undefined',
      console: [],
    });
    expect(eventsOf('spawned')).toHaveLength(2);
    await expect.poll(() => eventsOf('exited')).toHaveLength(1);
  });
});

describe('the handshake (C123.3)', () => {
  it.each<[string, string, CodeRunnerFailureReason]>([
    ['another variant', 'wrong-variant', 'handshake_refused'],
    ['another protocol', 'wrong-protocol', 'frame_malformed'],
    ['an exit', 'exit-at-start', 'child_exited'],
    ['a frame other than ready', 'value-at-start', 'frame_unexpected'],
    ['bytes that are no frame', 'garbage-at-start', 'frame_too_large'],
  ])('answers sandbox_crashed for %s', async (_name, mode, reason) => {
    expect(await fake(mode)).toEqual(crashed(reason));
  });

  it('gives up on a child that never says ready', async () => {
    expect(await fake('no-ready', { startTimeoutMs: 50 })).toEqual(crashed('handshake_timeout'));
    expect(eventsOf('killed')).toHaveLength(1);
  });

  it('says so when the process cannot start', async () => {
    const plan: ChildPlan = { args: ['--no-such-flag-of-node'], label: 'none' };
    const result = await pool(1, { plan }).evaluate(evaluation('return 1;'));
    expect(result).toEqual(crashed('child_exited'));
  });

  it('says so when the program is missing', async () => {
    const plan: ChildPlan = { command: '/nonexistent/node', args: [], label: 'none' };
    const result = await pool(1, { plan }).evaluate(evaluation('return 1;'));
    expect(result).toEqual(crashed('spawn_failed'));
  });

  it('starts a new child after a failed one', async () => {
    const runner = pool(1, { plan: fakePlan('exit') });
    expect(await runner.evaluate(evaluation('return 1;'))).toEqual(crashed('child_exited'));
    expect(await runner.evaluate(evaluation('return 1;'))).toEqual(crashed('child_exited'));
    expect(eventsOf('spawned')).toHaveLength(2);
  });
});

describe('recycling (C123.3, P15)', () => {
  it('holds a child to one environment', async () => {
    const runner = pool();
    await runner.evaluate(evaluation('return 1;'));
    await runner.evaluate(evaluation('return 1;'));
    expect(eventsOf('spawned')).toHaveLength(1);
    await runner.evaluate(evaluation('return 1;', { environmentId: OTHER_ENVIRONMENT }));
    expect(eventsOf('spawned')).toHaveLength(2);
    await runner.evaluate(evaluation('return 1;'));
    expect(eventsOf('spawned')).toHaveLength(3);
  });

  it('uses a second slot rather than recycle a child another environment holds', async () => {
    const runner = pool(2);
    await runner.evaluate(evaluation('return 1;'));
    await runner.evaluate(evaluation('return 1;', { environmentId: OTHER_ENVIRONMENT }));
    await runner.evaluate(evaluation('return 1;'));
    await runner.evaluate(evaluation('return 1;', { environmentId: OTHER_ENVIRONMENT }));
    expect(eventsOf('spawned')).toHaveLength(2);
  });

  it('serves its hundred evaluations, each holding memory, then recycles', async () => {
    const runner = pool();
    const guest = 'globalThis.held = "x".repeat(4 * 1024 * 1024) + input.turn; return held.length;';
    for (let turn = 0; turn < 101; turn += 1) {
      const result = await runner.evaluate(evaluation(guest, { input: { turn } }));
      expect(result).toMatchObject({ ok: true });
    }
    expect(eventsOf('spawned')).toHaveLength(2);
  });

  it('recycles a child after its evaluations', async () => {
    expect(EVALUATE_CODE_LIMITS['evaluations-per-child'].value).toBe(100);
    const runner = pool(1, { evaluationsPerChild: 2 });
    for (let index = 0; index < 5; index += 1) await runner.evaluate(evaluation('return 1;'));
    expect(eventsOf('spawned')).toHaveLength(3);
  });

  it('kills a recycled child that ignores the shutdown', async () => {
    const runner = pool(1, { plan: fakePlan('ignore-shutdown'), evaluationsPerChild: 1 });
    await runner.evaluate(evaluation('return 1;'));
    await expect.poll(() => eventsOf('killed')).toHaveLength(1);
    await expect.poll(() => eventsOf('exited')).toHaveLength(1);
    expect(eventsOf('exited')[0]).toMatchObject({ signal: 'SIGKILL' });
  });

  it('replaces a child that died while idle', async () => {
    const runner = pool();
    await runner.evaluate(evaluation('return 1;'));
    const [spawned] = eventsOf('spawned') as unknown as [{ pid: number }];
    process.kill(spawned.pid, 'SIGKILL');
    await expect.poll(() => eventsOf('exited')).toHaveLength(1);
    expect(await runner.evaluate(evaluation('return 1;'))).toMatchObject({ ok: true });
    expect(eventsOf('spawned')).toHaveLength(2);
  });
});

describe('the queue', () => {
  it('runs one evaluation per child at a time, in order', async () => {
    const runner = pool();
    const results = await Promise.all(
      [1, 2, 3].map((value) => runner.evaluate(evaluation(`return ${String(value)};`))),
    );
    expect(results.map((result) => (result as { value: number }).value)).toEqual([1, 2, 3]);
    expect(eventsOf('spawned')).toHaveLength(1);
  });

  it('runs up to its size at once', async () => {
    const runner = pool(2);
    await Promise.all([
      runner.evaluate(evaluation('return 1;')),
      runner.evaluate(evaluation('return 2;')),
    ]);
    expect(eventsOf('spawned')).toHaveLength(2);
  });

  it('serves a waiting environment when another finishes', async () => {
    const runner = pool();
    const results = await Promise.all([
      runner.evaluate(evaluation('return 1;')),
      runner.evaluate(evaluation('return 2;', { environmentId: OTHER_ENVIRONMENT })),
    ]);
    expect(results).toMatchObject([{ ok: true }, { ok: true }]);
    expect(eventsOf('spawned')).toHaveLength(2);
  });

  it('refuses what the contract refuses, without a child', async () => {
    const result = await pool().evaluate(evaluation('return 1;', { environmentId: 'other' }));
    expect(result).toEqual({
      ok: false,
      code: 'runtime_error',
      message: null,
      console: [],
      reason: 'input_refused',
    });
    expect(eventsOf('spawned')).toHaveLength(0);
  });
});

describe('submit', () => {
  it('refuses a frame no child may receive, and goes on', async () => {
    const runner = pool();
    const request = prepareEvaluateRequest(evaluation('return 1;'), ID);
    if (request === null) throw new Error('the request was refused');
    const oversized = { ...request, source: 'x'.repeat(2 * MIB) };
    expect(await runner.submit(oversized)).toEqual(crashed('frame_too_large'));
    expect(await runner.evaluate(evaluation('return 2;'))).toMatchObject({ ok: true });
  });
});

describe('close', () => {
  it('answers what is running and what waits, and ends every child', async () => {
    const runner = pool(1, { plan: fakePlan('silent') });
    const running = runner.evaluate(evaluation('return 1;'));
    const waiting = runner.evaluate(evaluation('return 2;'));
    await expect.poll(() => eventsOf('spawned')).toHaveLength(1);
    await runner.close();
    expect(await running).toEqual(crashed('runner_closed'));
    expect(await waiting).toEqual(crashed('runner_closed'));
    expect(eventsOf('exited')).toHaveLength(1);
  });

  it('answers an evaluation that comes after it', async () => {
    const runner = pool();
    await runner.close();
    expect(await runner.evaluate(evaluation('return 1;'))).toEqual(crashed('runner_closed'));
  });

  it('can be called twice', async () => {
    const runner = pool();
    await runner.evaluate(evaluation('return 1;'));
    await runner.close();
    await expect(runner.close()).resolves.toBeUndefined();
  });
});

describe('backpressure (Workflow 8D R005)', () => {
  const SHORT = { limits: { timeMs: 200 } };
  const request = (n: number) => {
    const prepared = prepareEvaluateRequest(
      evaluation('return 1;', SHORT),
      `00000000-0000-4000-8000-00000000010${String(n)}`,
    );
    if (prepared === null) throw new Error('the request was refused');
    return prepared;
  };

  it('answers runner_busy at once past its waiting list, and starts nothing for it', async () => {
    const runner = pool(1, { plan: fakePlan('silent'), maxWaiting: 1 });
    const settled: string[] = [];
    const running = runner.submit(request(1)).then(() => settled.push('running'));
    const waiting = runner.submit(request(2)).then(() => settled.push('waiting'));

    expect(await runner.submit(request(3))).toEqual(crashed('runner_busy'));

    expect(settled).toEqual([]);
    await runner.close();
    await Promise.all([running, waiting]);
  });

  it('drops a waiting evaluation whose caller went away, before any child takes it', async () => {
    const runner = pool(1, { plan: fakePlan('silent') });
    const running = runner.submit(request(1));
    const caller = new AbortController();
    const waiting = runner.submit(request(2), caller.signal);

    caller.abort();

    expect(await waiting).toEqual(crashed('socket_closed'));
    expect(eventsOf('spawned')).toHaveLength(1);
    await runner.close();
    await running;
  });

  it('answers at once for a caller already gone', async () => {
    const runner = pool(1, { plan: fakePlan('silent') });
    const caller = new AbortController();
    caller.abort();

    expect(await runner.submit(request(1), caller.signal)).toEqual(crashed('socket_closed'));
    expect(eventsOf('spawned')).toHaveLength(0);
  });
});
