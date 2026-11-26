/**
 * C123.3-C123.6: the child's evaluator, run in this process so a test can read each WebAssembly
 * memory it used; `pool.test.ts` runs the same file as the real child. Only JSON crosses the
 * boundary, no host function is exposed, and each evaluation gets a fresh instance and memory.
 * Every value is synthetic.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveEvaluationLimits } from './limits.js';
import { childConfigOf, resolveRunnerPaths } from './paths.js';
import type { EvaluationLimits } from './protocol.js';

type Outcome =
  { kind: 'value'; value: unknown } | { kind: 'error'; code: string; message: string | null };

interface Evaluator {
  label: string;
  evaluate(request: {
    id: string;
    source: string;
    input: string;
    limits: EvaluationLimits;
    console: boolean;
  }): Promise<{ outcome: Outcome; console: string[] }>;
}

interface ChildModule {
  createEvaluator(config: unknown): Promise<Evaluator>;
}

const ID = '00000000-0000-4000-8000-000000000001';
const KIB = 1024;
const MIB = 1024 * KIB;

/** The base configuration's lib holds no WebAssembly types. */
interface WasmMemory {
  buffer: ArrayBuffer;
  grow(pages: number): number;
}
const wasm = (globalThis as unknown as { WebAssembly: { Memory: new () => WasmMemory } })
  .WebAssembly;

const entry = new URL('../../bin/code-runner-child.mjs', import.meta.url).href;
let evaluator: Evaluator;

beforeAll(async () => {
  const child = (await import(/* @vite-ignore */ entry)) as ChildModule;
  evaluator = await child.createEvaluator(childConfigOf(resolveRunnerPaths()));
});

const evaluate = (
  body: string,
  options: { input?: string; timeMs?: number; memoryBytes?: number; console?: boolean } = {},
) =>
  evaluator.evaluate({
    id: ID,
    source: body.includes('export default') ? body : `export default function (input) {${body}}`,
    input: options.input ?? '{}',
    limits: resolveEvaluationLimits({
      timeMs: options.timeMs ?? 5_000,
      memoryBytes: options.memoryBytes ?? 8 * MIB,
    }),
    console: options.console ?? false,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a finished evaluation', () => {
  it('names the variant it loaded', () => {
    expect(evaluator.label).toBe('@jitl/quickjs-wasmfile-release-sync@0.32.0');
  });

  it('gets the input parsed inside the VM and returns JSON', async () => {
    const { outcome } = await evaluate('return { sum: input.a + input.b, list: [input.a] };', {
      input: '{"a":1,"b":2}',
    });
    expect(outcome).toEqual({ kind: 'value', value: { sum: 3, list: [1] } });
  });

  it.each([
    ['true', true],
    ['1.5', 1.5],
    ['"text"', 'text'],
    ['null', null],
    ['[1]', [1]],
  ])('returns %s', async (literal, value) => {
    expect((await evaluate(`return ${literal};`)).outcome).toEqual({ kind: 'value', value });
  });

  it('reads a function that returns nothing as null', async () => {
    expect((await evaluate('')).outcome).toEqual({ kind: 'value', value: null });
  });

  it('settles an async function and a top-level await', async () => {
    expect(
      (await evaluate('export default async function () { return await Promise.resolve(2); }'))
        .outcome,
    ).toEqual({ kind: 'value', value: 2 });
    expect(
      (
        await evaluate(
          'const x = await Promise.resolve(3); export default function () { return x; }',
        )
      ).outcome,
    ).toEqual({ kind: 'value', value: 3 });
  });
});

describe('a guest error (C123.6)', () => {
  it('reports the guest message as a runtime_error, for the sealed output only', async () => {
    expect(
      (await evaluate('throw new TypeError("synthetic " + input.a);', { input: '{"a":1}' }))
        .outcome,
    ).toEqual({ kind: 'error', code: 'runtime_error', message: 'synthetic 1' });
  });

  it('caps the message at 1 KiB of UTF-8', async () => {
    const { outcome } = await evaluate('throw new Error("é".repeat(5000));');
    expect(outcome).toMatchObject({ kind: 'error', code: 'runtime_error' });
    const { message } = outcome as { message: string };
    expect(Buffer.byteLength(message)).toBeLessThanOrEqual(KIB);
    expect(message.length).toBeGreaterThan(400);
  });

  it('reads a thrown value that is no Error', async () => {
    expect((await evaluate('throw "plain text";')).outcome).toEqual({
      kind: 'error',
      code: 'runtime_error',
      message: 'plain text',
    });
  });

  it('survives a thrown value whose getters throw or loop', async () => {
    const throwing = await evaluate(
      'throw { get name() { throw 1; }, get message() { throw 2; } };',
    );
    expect(throwing.outcome).toMatchObject({ kind: 'error', code: 'runtime_error' });
    const looping = await evaluate('throw { get message() { for (;;) {} } };', { timeMs: 200 });
    expect(looping.outcome).toMatchObject({ kind: 'error', code: 'runtime_error' });
  });

  it('reads a syntax error, and a rejected promise, as a runtime_error', async () => {
    expect((await evaluate('export default function ( {')).outcome).toMatchObject({
      kind: 'error',
      code: 'runtime_error',
    });
    expect(
      (await evaluate('export default async function () { throw new Error("no"); }')).outcome,
    ).toEqual({ kind: 'error', code: 'runtime_error', message: 'no' });
    expect(
      (await evaluate('await Promise.reject(new Error("no")); export default () => 1;')).outcome,
    ).toEqual({ kind: 'error', code: 'runtime_error', message: 'no' });
  });

  it('refuses a module with no default function, with our own words', async () => {
    expect((await evaluate('export default 1;')).outcome).toEqual({
      kind: 'error',
      code: 'runtime_error',
      message: 'the module has no default function',
    });
  });

  it('has no module loader', async () => {
    expect(
      (await evaluate('import x from "node:fs"; export default function () { return 1; }')).outcome,
    ).toMatchObject({ kind: 'error', code: 'runtime_error' });
    expect(
      (await evaluate('export default async function () { return await import("node:fs"); }'))
        .outcome,
    ).toMatchObject({ kind: 'error', code: 'runtime_error' });
  });
});

describe('an output JSON cannot hold (C123.2, C123.5)', () => {
  it.each([
    ['a function', 'return function () {};'],
    ['a symbol', 'return Symbol("x");'],
    ['a BigInt', 'return 1n;'],
    ['a cycle', 'const a = {}; a.self = a; return a;'],
    ['a toJSON that throws', 'return { toJSON() { throw new Error("no"); } };'],
    ['a promise that never settles', 'return new Promise(() => {});'],
  ])('refuses %s as invalid_output', async (_name, body) => {
    expect((await evaluate(body)).outcome).toMatchObject({ kind: 'error', code: 'invalid_output' });
  });

  it('takes 64 KiB and refuses a byte more, in bytes', async () => {
    const quotes = 2;
    expect(
      (await evaluate(`return "x".repeat(${String(64 * KIB - quotes)});`)).outcome,
    ).toMatchObject({ kind: 'value' });
    expect(
      (await evaluate(`return "x".repeat(${String(64 * KIB - quotes + 1)});`)).outcome,
    ).toMatchObject({ kind: 'error', code: 'invalid_output' });
    expect((await evaluate(`return "é".repeat(${String(40 * KIB)});`)).outcome).toMatchObject({
      kind: 'error',
      code: 'invalid_output',
    });
  });

  it('takes depth 32 and refuses depth 33', async () => {
    const nest = (depth: number) =>
      `let v = 1; for (let i = 0; i < ${String(depth)}; i++) v = [v]; return v;`;
    expect((await evaluate(nest(32))).outcome).toMatchObject({ kind: 'value' });
    expect((await evaluate(nest(33))).outcome).toMatchObject({
      kind: 'error',
      code: 'invalid_output',
    });
  });

  it('keeps a __proto__ key as data', async () => {
    const { outcome } = await evaluate('return JSON.parse(\'{"__proto__":{"polluted":true}}\');');
    expect(outcome).toMatchObject({ kind: 'value' });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('the limits (C123.5, C123.9)', () => {
  it('ends an infinite loop with a timeout', async () => {
    expect((await evaluate('for (;;) {}', { timeMs: 50 })).outcome).toEqual({
      kind: 'error',
      code: 'timeout',
      message: null,
    });
  });

  it('cannot catch the timeout', async () => {
    const body = 'for (;;) { try { for (;;) {} } catch (e) {} finally { continue; } }';
    expect((await evaluate(body, { timeMs: 50 })).outcome).toMatchObject({ code: 'timeout' });
  });

  it('ends catastrophic backtracking', async () => {
    const body = 'return /(a+)+$/.test("a".repeat(40) + "b");';
    expect((await evaluate(body, { timeMs: 50 })).outcome).toMatchObject({ code: 'timeout' });
  });

  it('never answers past the limit, though the guest ended between two interrupt checks', async () => {
    const body = 'const a = new Array(200000).fill(3.5); a.sort(); return a.length;';
    expect((await evaluate(body, { timeMs: 1, memoryBytes: 64 * MIB })).outcome).toMatchObject({
      code: 'timeout',
    });
  });

  it('starts the clock at the guest: a slow start of the harness is no crash', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
    expect((await evaluate('return 1;', { timeMs: 1, console: true })).outcome).toEqual({
      kind: 'error',
      code: 'timeout',
      message: null,
    });
  });

  it('gives memory_limit below what the input needs, never a crash', async () => {
    const outcome = await evaluate('return 1;', { memoryBytes: 1, console: true });
    expect(outcome.outcome).toEqual({ kind: 'error', code: 'memory_limit', message: null });
  });

  it('reads back an output that fills the limit', async () => {
    const body = `const held = []; let room = true;
      while (room) { try { held.push("x".repeat(1024)); } catch { room = false; } }
      held.length = 0;
      return "é".repeat(100);`;
    expect((await evaluate(body, { memoryBytes: 2 * MIB })).outcome).toMatchObject({
      kind: 'value',
    });
  });

  it('reads a thrown null as the guest’s own, away from the limit', async () => {
    expect((await evaluate('throw null;')).outcome).toEqual({
      kind: 'error',
      code: 'runtime_error',
      message: 'null',
    });
  });

  it('ends a loop of promise jobs', async () => {
    const body =
      'export default function () { const f = () => Promise.resolve().then(f); return f(); }';
    expect((await evaluate(body, { timeMs: 50 })).outcome).toMatchObject({ code: 'timeout' });
  });

  it('never reads a guest error that says "interrupted" as a timeout', async () => {
    expect((await evaluate('throw new InternalError("interrupted");')).outcome).toEqual({
      kind: 'error',
      code: 'runtime_error',
      message: 'interrupted',
    });
  });

  it.each([
    ['strings', 'const a = []; for (;;) a.push("x".repeat(65536) + a.length);'],
    ['an ArrayBuffer past the limit', 'return new ArrayBuffer(1024 * 1024 * 1024).byteLength;'],
    ['arrays', 'const a = []; for (;;) a.push(new Array(10000).fill(0));'],
  ])('gives memory_limit for %s', async (_name, body) => {
    expect((await evaluate(body, { memoryBytes: 2 * MIB })).outcome).toEqual({
      kind: 'error',
      code: 'memory_limit',
      message: null,
    });
  });

  it('still answers when the guest keeps every byte it took', async () => {
    const body = `globalThis.held = [];
      try { for (;;) held.push("x".repeat(65536) + held.length); } catch (e) {}
      throw new InternalError("out of memory");`;
    expect((await evaluate(body, { memoryBytes: 2 * MIB })).outcome).toMatchObject({
      code: 'memory_limit',
    });
  });

  it('never grows the WebAssembly memory past its maximum', async () => {
    const memories = vi.spyOn(wasm, 'Memory');
    await evaluate('const a = []; for (;;) a.push("x".repeat(65536) + a.length);', {
      memoryBytes: MIB,
    });
    const [memory] = memories.mock.instances.slice(-1) as [WasmMemory];
    const limit = resolveEvaluationLimits({ memoryBytes: MIB })['wasm-maximum-bytes'];
    expect(memory.buffer.byteLength).toBeLessThanOrEqual(limit);
    const pagesLeft = Math.ceil((limit - memory.buffer.byteLength) / 65_536);
    expect(() => memory.grow(pagesLeft + 1)).toThrow(RangeError);
  });

  it.each([
    ['small frames', 'function r(n) { return r(n + 1) + 1; } return r(0);'],
    [
      'a guest that catches once',
      'function r(a, b, c, d, e, f, g, h) { return r(a + 1) + 1; } try { return r(0); } catch (e) { throw e; }',
    ],
  ])('gives stack_overflow for %s, and the next evaluation is unaffected', async (_name, body) => {
    expect((await evaluate(body)).outcome).toEqual({
      kind: 'error',
      code: 'stack_overflow',
      message: null,
    });
    expect((await evaluate('return 1;')).outcome).toEqual({ kind: 'value', value: 1 });
  });
});

describe('what the guest gets (C123.4, C123.9)', () => {
  it('has no require, process, fetch, timers, console or WebAssembly', async () => {
    const names = [
      'require',
      'process',
      'fetch',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'console',
      'WebAssembly',
      'Buffer',
      'module',
      'XMLHttpRequest',
    ];
    const { outcome } = await evaluate(
      `return ${JSON.stringify(names)}.filter((name) => typeof globalThis[name] !== "undefined");`,
    );
    expect(outcome).toEqual({ kind: 'value', value: [] });
  });

  it('gets a console only when a test run asks for one, capped at 50 lines of 1 KiB', async () => {
    const body = `console.log("first", 1, { a: 1 });
      console.error("second");
      console.warn("é".repeat(5000));
      for (let i = 0; i < 100; i++) console.log("line " + i);
      return 1;`;
    const { console: lines, outcome } = await evaluate(body, { console: true });
    expect(outcome).toEqual({ kind: 'value', value: 1 });
    expect(lines).toHaveLength(50);
    expect(lines[0]).toBe('first 1 {"a":1}');
    expect(lines[1]).toBe('second');
    expect(Buffer.byteLength(lines[2] ?? '')).toBeLessThanOrEqual(KIB);
    expect(lines[49]).toBe('line 46');
  });

  it('keeps the lines of a guest that failed', async () => {
    const { console: lines, outcome } = await evaluate('console.log("seen"); for (;;) {}', {
      console: true,
      timeMs: 50,
    });
    expect(outcome).toMatchObject({ code: 'timeout' });
    expect(lines).toEqual(['seen']);
  });

  it('captures nothing in a production run', async () => {
    const { console: lines, outcome } = await evaluate(
      'try { console.log("x"); } catch (e) { return e.name; }',
    );
    expect(outcome).toEqual({ kind: 'value', value: 'ReferenceError' });
    expect(lines).toEqual([]);
  });

  it('cannot break the harness by replacing JSON', async () => {
    const { outcome } = await evaluate(
      'JSON.stringify = () => "not json"; JSON.parse = () => 1; return { kept: true };',
    );
    expect(outcome).toEqual({ kind: 'value', value: { kept: true } });
  });
});

describe('a fresh instance per evaluation (C123.3, P15)', () => {
  const CANARY = 'CANARY-7f3a91e2-synthetic';

  const holds = (memory: WasmMemory, text: string): boolean =>
    Buffer.from(memory.buffer).includes(text, 0, 'utf8');

  it('gives each evaluation its own memory, which holds nothing of the last', async () => {
    const memories = vi.spyOn(wasm, 'Memory');
    const first = await evaluate(`globalThis.kept = "${CANARY}".repeat(1000); return kept.length;`);
    expect(first.outcome).toMatchObject({ kind: 'value' });
    const second = await evaluate('return typeof globalThis.kept;');
    expect(second.outcome).toEqual({ kind: 'value', value: 'undefined' });

    const [firstMemory, secondMemory] = memories.mock.instances.slice(-2) as [
      WasmMemory,
      WasmMemory,
    ];
    expect(memories.mock.instances.length).toBeGreaterThanOrEqual(2);
    expect(firstMemory).not.toBe(secondMemory);
    expect(holds(firstMemory, CANARY)).toBe(true);
    expect(holds(secondMemory, CANARY)).toBe(false);
  });

  it('never finds an earlier canary through a large ArrayBuffer scan', async () => {
    await evaluate(`globalThis.kept = "${CANARY}".repeat(1000); return 1;`);
    const body = `const bytes = new Uint8Array(new ArrayBuffer(1024 * 1024));
      const wanted = "${CANARY}";
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== wanted.charCodeAt(0)) continue;
        let j = 0;
        while (j < wanted.length && bytes[i + j] === wanted.charCodeAt(j)) j += 1;
        if (j === wanted.length) return true;
      }
      return false;`;
    expect((await evaluate(body)).outcome).toEqual({ kind: 'value', value: false });
  });
});
