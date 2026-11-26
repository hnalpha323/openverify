/**
 * C123.3 (P16): the code runner's protocol, frozen by `contracts-8a`. The child has no Node IPC
 * channel: `stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']`, requests on fd 3 and responses
 * on fd 4, never `serialization: 'advanced'`. The container's Unix socket carries the same frames.
 *
 * A frame is a 4-byte big-endian length, then that many bytes of UTF-8 JSON. Whoever reads a frame
 * checks its length against the cap **before buffering a byte**; on a violation the parent kills
 * the child and the step is `sandbox_crashed`. The parent parses a frame with a depth-limited
 * parser, then with these schemas, because a compromised child can send anything. `code-sandbox`
 * builds the reader, the writer and the dependency-free child, which reads this contract by hand.
 *
 * The cap on a response is the 64 KiB output plus one envelope, so the guest's JSON travels as a
 * JSON value inside the frame, never as a string, whose escapes would inflate it past the cap. A
 * request's source and input are strings, so their cap allows every character escaped (`\u00XX`).
 *
 * The child reads `environment-id` never: it is there for the socket form, whose pool serves one
 * environment per child (P15). No frame holds a secret, a stack from the host or a host handle.
 */
import { idSchema } from '@openverify/contracts';
import { z } from 'zod';
import { EVALUATE_CODE_LIMITS, type EvaluateCodeErrorCode } from '../actions/evaluate-code.js';

export const CODE_RUNNER_PROTOCOL_VERSION = 1;

/** The big-endian length before each frame. */
export const FRAME_HEADER_BYTES = 4;

/** What a frame holds around its payload. */
export const FRAME_ENVELOPE_BYTES = 1024;

/** The most one character of a JSON string can take, `\u00XX`. */
const JSON_ESCAPE_FACTOR = 6;

export const RESPONSE_FRAME_MAX_BYTES =
  EVALUATE_CODE_LIMITS['output-bytes'].value + FRAME_ENVELOPE_BYTES;

export const REQUEST_FRAME_MAX_BYTES =
  JSON_ESCAPE_FACTOR *
    (EVALUATE_CODE_LIMITS['source-bytes'].value + EVALUATE_CODE_LIMITS['input-bytes'].value) +
  FRAME_ENVELOPE_BYTES;

/** The errors the child reports; the parent decides the others of C123.6. */
export const CHILD_REPORTED_ERROR_CODES = [
  'timeout',
  'memory_limit',
  'stack_overflow',
  'invalid_output',
  'runtime_error',
] as const satisfies readonly EvaluateCodeErrorCode[];

/**
 * Why the runner, not the guest, ended an evaluation: a fixed code, safe to log, holding nothing a
 * guest wrote. Each is `sandbox_crashed`, but for `input_refused`, which is `runtime_error`.
 */
export const CODE_RUNNER_FAILURE_REASONS = [
  'input_refused',
  'spawn_failed',
  'child_exited',
  'handshake_refused',
  'handshake_timeout',
  'frame_too_large',
  'frame_malformed',
  'frame_unexpected',
  'runner_closed',
  'socket_unavailable',
  'socket_closed',
  'socket_timeout',
  /** R005: the pool's waiting list is full; nothing ran, so a retry may find room. */
  'runner_busy',
] as const;
export type CodeRunnerFailureReason = (typeof CODE_RUNNER_FAILURE_REASONS)[number];

const bytesAtMost = (limit: number) => (text: string) =>
  new TextEncoder().encode(text).length <= limit;

const positive = () => z.int().min(1);

/** C123.3, C123.5: what the child applies to one evaluation. */
export const evaluationLimitsSchema = z.strictObject({
  'time-ms': positive(),
  'memory-bytes': positive(),
  /** The `maximum` of the fresh `WebAssembly.Memory`: the QuickJS limit plus the headroom. */
  'wasm-maximum-bytes': positive(),
  'stack-bytes': positive(),
});
export type EvaluationLimits = z.infer<typeof evaluationLimitsSchema>;

const evaluateRequestSchema = z.strictObject({
  kind: z.literal('evaluate'),
  id: z.uuid(),
  /** Read by the socket form's pool, never by the child (P15). */
  'environment-id': idSchema('env'),
  source: z.string().min(1),
  /** JSON text, parsed inside the VM (C123.4). */
  input: z.string().min(1),
  limits: evaluationLimitsSchema,
  /** Only the sandbox test run captures `console` (C120.7, C123.4). */
  console: z.boolean(),
});

const shutdownRequestSchema = z.strictObject({ kind: z.literal('shutdown') });

export const codeRunnerRequestSchema = z.discriminatedUnion('kind', [
  evaluateRequestSchema,
  shutdownRequestSchema,
]);
export type CodeRunnerRequest = z.infer<typeof codeRunnerRequestSchema>;

/** The startup handshake: a child that loaded another variant, or none, never serves. */
const readyResponseSchema = z.strictObject({
  kind: z.literal('ready'),
  protocol: z.literal(CODE_RUNNER_PROTOCOL_VERSION),
  /** `<package>@<version>` of the variant it loaded. */
  variant: z.string().min(1).max(128),
});

const valueResponseSchema = z.strictObject({
  kind: z.literal('value'),
  id: z.uuid(),
  value: z.json(),
});

const consoleResponseSchema = z.strictObject({
  kind: z.literal('console'),
  id: z.uuid(),
  line: z.string().refine(bytesAtMost(EVALUATE_CODE_LIMITS['console-line-bytes'].value)),
});

const errorResponseSchema = z.strictObject({
  kind: z.literal('error'),
  id: z.uuid(),
  code: z.enum(CHILD_REPORTED_ERROR_CODES),
  /** The guest's own text (P18), capped by the parent again; `null` when there is none. */
  message: z.string().nullable(),
});

export const codeRunnerResponseSchema = z.discriminatedUnion('kind', [
  readyResponseSchema,
  valueResponseSchema,
  consoleResponseSchema,
  errorResponseSchema,
]);
export type CodeRunnerResponse = z.infer<typeof codeRunnerResponseSchema>;

/**
 * The container's frames: a child's, plus what its pool decided, which a child may never say. The
 * pool's parent refuses this frame from a child, so the extra kind widens nothing there.
 */
const crashedResponseSchema = z.strictObject({
  kind: z.literal('crashed'),
  id: z.uuid(),
  reason: z.enum(CODE_RUNNER_FAILURE_REASONS),
});

export const codeRunnerSocketResponseSchema = z.discriminatedUnion('kind', [
  readyResponseSchema,
  valueResponseSchema,
  consoleResponseSchema,
  errorResponseSchema,
  crashedResponseSchema,
]);
export type CodeRunnerSocketResponse = z.infer<typeof codeRunnerSocketResponseSchema>;
