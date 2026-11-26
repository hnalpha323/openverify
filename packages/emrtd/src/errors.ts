/**
 * The errors `@openverify/emrtd` throws. A message names the step that failed, never a byte of
 * chip data, a certificate or a key (C53.8).
 */

/**
 * Thrown by a function whose implementation has not landed yet. Workflow 5B Stage 1
 * (`contracts-5b`) fixed the names and types; `emrtd` (Stage 2) replaces each body. A stub never
 * returns a verdict: no caller can mistake it for a verified chip (ADR 0002 §3a).
 */
export class EmrtdNotImplementedError extends Error {
  override name = 'EmrtdNotImplementedError';
  readonly feature: string;

  constructor(feature: string, argumentCount = 0) {
    super(
      `${feature} is not implemented yet (owner: emrtd, Workflow 5B Stage 2; ${String(argumentCount)} arguments)`,
    );
    this.feature = feature;
  }
}

/**
 * Why chip data could not be read or verified at all (C62.1): malformed or oversized ASN.1, a key
 * or curve outside the bounds, an unsupported algorithm, or the time budget spent. The NFC
 * evaluators map each code to their reasons; none of them is ever a pass.
 */
export const EMRTD_ERROR_CODES = [
  'chip_data_malformed',
  'limit_exceeded',
  'algorithm_unsupported',
  'time_budget_exceeded',
] as const;
export type EmrtdErrorCode = (typeof EMRTD_ERROR_CODES)[number];

export class EmrtdError extends Error {
  override name = 'EmrtdError';
  readonly code: EmrtdErrorCode;

  constructor(code: EmrtdErrorCode, step: string) {
    super(`${step}: ${code}`);
    this.code = code;
  }
}

/** The body of a stub until `emrtd` builds it; it names the call, never its arguments. */
export function notImplemented(feature: string, ...args: unknown[]): never {
  throw new EmrtdNotImplementedError(feature, args.length);
}
