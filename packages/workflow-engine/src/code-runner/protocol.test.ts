/**
 * C123.3 (P16): the code-runner's framing. There is no Node IPC channel: our own frames on fds 3
 * and 4, each a 4-byte length prefix checked against a cap before a byte is buffered. A response is
 * bounded by the output limit plus one envelope, because the guest's JSON is carried as a value and
 * never as an escaped string. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';
import {
  CHILD_REPORTED_ERROR_CODES,
  CODE_RUNNER_FAILURE_REASONS,
  CODE_RUNNER_PROTOCOL_VERSION,
  FRAME_ENVELOPE_BYTES,
  FRAME_HEADER_BYTES,
  REQUEST_FRAME_MAX_BYTES,
  RESPONSE_FRAME_MAX_BYTES,
  codeRunnerRequestSchema,
  codeRunnerResponseSchema,
  codeRunnerSocketResponseSchema,
} from './protocol.js';

const KIB = 1024;
const ID = '00000000-0000-4000-8000-000000000001';
const LIMITS = {
  'time-ms': 1_000,
  'memory-bytes': 32 * KIB * KIB,
  'wasm-maximum-bytes': 48 * KIB * KIB,
  'stack-bytes': 512 * KIB,
};
const evaluate = {
  kind: 'evaluate',
  id: ID,
  'environment-id': 'env_01M5CJXHG07XPHF3HRM6NREDH8',
  source: 'export default function (input) { return 1; }',
  input: '{"score":1}',
  limits: LIMITS,
  console: false,
};

describe('the frame constants (C123.3)', () => {
  it('holds version 1, a 4-byte header and a 1 KiB envelope', () => {
    expect(CODE_RUNNER_PROTOCOL_VERSION).toBe(1);
    expect(FRAME_HEADER_BYTES).toBe(4);
    expect(FRAME_ENVELOPE_BYTES).toBe(KIB);
  });

  it('caps a response at the 64 KiB output plus the envelope', () => {
    expect(RESPONSE_FRAME_MAX_BYTES).toBe(64 * KIB + KIB);
  });

  it('caps a request at the source and input with every character escaped, plus the envelope', () => {
    expect(REQUEST_FRAME_MAX_BYTES).toBe(6 * (64 * KIB + 256 * KIB) + KIB);
  });
});

describe('codeRunnerRequestSchema', () => {
  it('takes an evaluation and a shutdown', () => {
    expect(codeRunnerRequestSchema.parse(evaluate)).toEqual(evaluate);
    expect(codeRunnerRequestSchema.parse({ kind: 'shutdown' })).toEqual({ kind: 'shutdown' });
  });

  it('carries the input as JSON text, parsed inside the VM (C123.4)', () => {
    expect(codeRunnerRequestSchema.safeParse({ ...evaluate, input: { score: 1 } }).success).toBe(
      false,
    );
  });

  it('refuses any other member: a frame holds no secret and no host handle', () => {
    expect(codeRunnerRequestSchema.safeParse({ ...evaluate, secrets: {} }).success).toBe(false);
    expect(codeRunnerRequestSchema.safeParse({ kind: 'eval' }).success).toBe(false);
  });
});

describe('codeRunnerResponseSchema', () => {
  it('takes the startup handshake, naming the protocol and the variant', () => {
    const ready = {
      kind: 'ready',
      protocol: 1,
      variant: '@jitl/quickjs-wasmfile-release-sync@0.32.0',
    };
    expect(codeRunnerResponseSchema.parse(ready)).toEqual(ready);
  });

  it('takes a value as JSON, a console line and an error', () => {
    for (const frame of [
      { kind: 'value', id: ID, value: { any: ['json', 1, null] } },
      { kind: 'value', id: ID, value: null },
      { kind: 'console', id: ID, line: 'synthetic line' },
      { kind: 'error', id: ID, code: 'runtime_error', message: 'synthetic guest text' },
      { kind: 'error', id: ID, code: 'timeout', message: null },
    ]) {
      expect(codeRunnerResponseSchema.parse(frame)).toEqual(frame);
    }
  });

  it('caps a console line at 1 KiB in bytes', () => {
    const line = (text: string) => ({ kind: 'console', id: ID, line: text });
    expect(codeRunnerResponseSchema.safeParse(line('x'.repeat(KIB))).success).toBe(true);
    expect(codeRunnerResponseSchema.safeParse(line('é'.repeat(KIB))).success).toBe(false);
  });

  it('refuses an error the child cannot report: the parent decides those', () => {
    for (const code of ['type_mismatch', 'sandbox_crashed', 'code_disabled']) {
      expect(
        codeRunnerResponseSchema.safeParse({ kind: 'error', id: ID, code, message: null }).success,
      ).toBe(false);
    }
    expect(CHILD_REPORTED_ERROR_CODES).toEqual([
      'timeout',
      'memory_limit',
      'stack_overflow',
      'invalid_output',
      'runtime_error',
    ]);
  });

  it('refuses a frame with another member: a guest cannot add one', () => {
    expect(
      codeRunnerResponseSchema.safeParse({ kind: 'value', id: ID, value: 1, stack: 'x' }).success,
    ).toBe(false);
  });
});

describe('codeRunnerSocketResponseSchema (the container, C123.3)', () => {
  const crashed = { kind: 'crashed', id: ID, reason: 'child_exited' };

  it('takes what its pool decided, which a child may never say', () => {
    expect(codeRunnerSocketResponseSchema.parse(crashed)).toEqual(crashed);
    expect(codeRunnerResponseSchema.safeParse(crashed).success).toBe(false);
  });

  it('takes every child frame', () => {
    const ready = { kind: 'ready', protocol: 1, variant: 'variant@1.0.0' };
    expect(codeRunnerSocketResponseSchema.parse(ready)).toEqual(ready);
  });

  it('names a reason from the list, a code and never a word of a guest', () => {
    expect(CODE_RUNNER_FAILURE_REASONS).toContain('frame_too_large');
    expect(
      codeRunnerSocketResponseSchema.safeParse({ ...crashed, reason: 'free text' }).success,
    ).toBe(false);
  });
});
