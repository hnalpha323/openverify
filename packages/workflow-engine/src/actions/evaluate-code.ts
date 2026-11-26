/**
 * C123.2, C123.5, C123.6: the Evaluate Code contract, which the action (`api-egress`) and the runner
 * (`code-sandbox`) share. Only mapped properties reach the code, so personal data the code does not
 * use never enters it (ours), and the source's text is the one place operator text is executed.
 * Nothing here runs anything.
 *
 * The output is `{ value, source-sha256 }`, whose value is untyped, so it is PII by default and
 * masked fail closed (C120.6); the digest is what a decision record names (C123.8, C128.1). A failed
 * evaluation stores `{ error: { code, message } }` in the step's sealed output: the code is ours, and
 * the message is the guest's own text, which can carry inputs (P18), so it is PII too and never
 * reaches a plaintext column, an event, the journal or a log.
 *
 * A `{{secrets.<key>}}` in a property is refused at publish and at run time (C125.3), never here.
 */
import { workflowJsonSchema } from '@openverify/contracts';
import { z } from 'zod';

export const EVALUATE_CODE_ACTION_KEY = 'evaluate_code';

const KIB = 1024;
const MIB = 1024 * KIB;

const provisional = (value: number, source: string) =>
  Object.freeze({ value, basis: 'provisional' as const, source });

const NOTE = 'docs/research/phase8-actions-sandbox.md';

/**
 * C123.5: every limit is provisional, ours, chosen so one step stays small next to the engine's step
 * lease. A step may set `time-ms` and `memory-bytes` up to the install ceilings; the rest are fixed.
 */
export const EVALUATE_CODE_LIMITS = Object.freeze({
  'time-ms': provisional(1_000, `${NOTE} 1.8: the interrupt deadline; the kill is the bound`),
  'time-ms-ceiling': provisional(5_000, `${NOTE} 1.8`),
  'memory-bytes': provisional(32 * MIB, `${NOTE} 1.8: code transforms a few JSON values`),
  'memory-bytes-ceiling': provisional(64 * MIB, `${NOTE} 1.8`),
  'wasm-headroom-bytes': provisional(16 * MIB, `${NOTE} 1.8: the variant sets no maximum`),
  'stack-bytes': provisional(512 * KIB, `${NOTE} 1.8: below the build's 5 MB C stack`),
  'source-bytes': provisional(64 * KIB, `${NOTE} 1.8`),
  'input-bytes': provisional(256 * KIB, `${NOTE} 1.8`),
  'input-depth': provisional(32, `${NOTE} 1.8`),
  'output-bytes': provisional(64 * KIB, `${NOTE} 1.8`),
  'output-depth': provisional(32, `${NOTE} 1.8`),
  properties: provisional(32, 'C113.4: the cap on inputs, outputs and variables'),
  'kill-grace-ms': provisional(250, `${NOTE} 1.6: the kill after the step's limit`),
  'child-heap-mb': provisional(64, `${NOTE} 1.8: bounds the glue code's own allocations`),
  'evaluations-per-child': provisional(100, `${NOTE} 1.6`),
  'waiting-per-child': provisional(
    4,
    'Workflow 8D R005: four evaluations at the 5 s ceiling queue for 20 s, inside the 30 s margin',
  ),
  'console-lines': provisional(50, 'C123.4: the sandbox test run only'),
  'console-line-bytes': provisional(KIB, 'C123.4: the sandbox test run only'),
  'error-message-bytes': provisional(KIB, 'C123.6'),
});

/** C123.2: the public return types, a mismatch being a step error. */
export const EVALUATE_CODE_RETURN_TYPES = [
  'boolean',
  'number',
  'string',
  'object',
  'none',
] as const;
export const evaluateCodeReturnTypeSchema = z.enum(EVALUATE_CODE_RETURN_TYPES);
export type EvaluateCodeReturnType = z.infer<typeof evaluateCodeReturnTypeSchema>;

/** C123.6: the step errors of Evaluate Code. */
export const EVALUATE_CODE_ERROR_CODES = [
  'timeout',
  'memory_limit',
  'stack_overflow',
  'invalid_output',
  'type_mismatch',
  'runtime_error',
  'sandbox_crashed',
  'code_disabled',
] as const;
export const evaluateCodeErrorCodeSchema = z.enum(EVALUATE_CODE_ERROR_CODES);
export type EvaluateCodeErrorCode = z.infer<typeof evaluateCodeErrorCodeSchema>;

/** C123.6: the C120.2 error type of each; an output of the wrong shape is the author's to fix. */
export const EVALUATE_CODE_ERROR_TYPES = Object.freeze({
  timeout: 'unknown-error',
  memory_limit: 'unknown-error',
  stack_overflow: 'unknown-error',
  invalid_output: 'configuration-error',
  type_mismatch: 'configuration-error',
  runtime_error: 'unknown-error',
  sandbox_crashed: 'unknown-error',
  code_disabled: 'unknown-error',
} as const satisfies Record<EvaluateCodeErrorCode, string>);

/**
 * C117.6: the failures a retry cannot change. A crash is infrastructure, and a wall-clock timeout
 * can be load, so those two follow the step's `retry`.
 */
export const EVALUATE_CODE_DETERMINISTIC_ERRORS: ReadonlySet<EvaluateCodeErrorCode> = new Set([
  'memory_limit',
  'stack_overflow',
  'invalid_output',
  'type_mismatch',
  'runtime_error',
  'code_disabled',
]);

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

const bytesAtMost = (limit: number) => (text: string) => utf8Bytes(text) <= limit;

/** A property name the guest reads as `input.<name>`; never one that names the prototype chain. */
const PROPERTY_NAME = /^[a-z_]\w{0,63}$/i;
const REFUSED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const propertyNameSchema = z
  .string()
  .regex(PROPERTY_NAME, 'must be a name')
  .refine((name) => !REFUSED_PROPERTY_NAMES.has(name), 'must not name the prototype chain');

const stepLimit = (ceiling: number) => z.int().min(1).max(ceiling);

/**
 * C123.2: the step's `config`. A string in `properties` is a C115 template, so a path is
 * `{{ steps.calculate.output.value }}`; anything else is a literal.
 */
export const evaluateCodeConfigSchema = z.strictObject({
  /** `export default function (input) { … }`, parsed only inside the VM. */
  source: z
    .string()
    .min(1)
    .refine(bytesAtMost(EVALUATE_CODE_LIMITS['source-bytes'].value), 'must be at most 64 KiB')
    .refine((source) => /\bexport\s+default\b/.test(source), 'must export a default function'),
  properties: z
    .record(propertyNameSchema, workflowJsonSchema)
    .refine(
      (properties) => Object.keys(properties).length <= EVALUATE_CODE_LIMITS.properties.value,
      'must map at most 32 properties',
    ),
  'return-type': evaluateCodeReturnTypeSchema,
  /** C123.5: per step, up to the install ceilings. */
  limits: z
    .strictObject({
      'time-ms': stepLimit(EVALUATE_CODE_LIMITS['time-ms-ceiling'].value).optional(),
      'memory-bytes': stepLimit(EVALUATE_CODE_LIMITS['memory-bytes-ceiling'].value).optional(),
    })
    .optional(),
});
export type EvaluateCodeConfig = z.infer<typeof evaluateCodeConfigSchema>;

const sourceDigestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be a SHA-256 digest');

/** C123.2, C123.8: a finished evaluation. `value` is untyped, so it is masked fail closed. */
export const evaluateCodeOutputSchema = z.strictObject({
  value: workflowJsonSchema.meta({ pii: true }),
  'source-sha256': sourceDigestSchema.meta({ pii: false }),
});
export type EvaluateCodeOutput = z.infer<typeof evaluateCodeOutputSchema>;

/** C123.6: a failed evaluation, as the step's sealed output holds it. */
export const evaluateCodeFailureSchema = z.strictObject({
  error: z.strictObject({
    code: evaluateCodeErrorCodeSchema,
    /** The guest's own text, scrubbed of resolved secrets (P18); `null` for our own failures. */
    message: z
      .string()
      .refine(bytesAtMost(EVALUATE_CODE_LIMITS['error-message-bytes'].value), 'at most 1 KiB')
      .nullable()
      .meta({ pii: true }),
  }),
  'source-sha256': sourceDigestSchema.meta({ pii: false }),
});
export type EvaluateCodeFailure = z.infer<typeof evaluateCodeFailureSchema>;

/**
 * C123.2: whether a guest's JSON value fits its declared return type (`type_mismatch` otherwise).
 * `object` takes a JSON object or an array, as `typeof` does in the guest, and `none` only `null`,
 * which is what a function that returns nothing gives.
 */
export function evaluateCodeValueFits(returnType: EvaluateCodeReturnType, value: unknown): boolean {
  switch (returnType) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'object':
      return typeof value === 'object' && value !== null;
    case 'none':
      return value === null;
  }
}
