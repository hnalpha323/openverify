/** What the graph rules share: the problem list, the step kinds, and the paths a condition reads. */
import type { FlowProblem } from '../schemas/problems.js';
import type { FlowV2Step } from '../schemas/steps.js';

export class Problems {
  readonly list: FlowProblem[] = [];

  error(pointer: string, code: string, detail: string): void {
    this.list.push({ pointer, code, detail, severity: 'error' });
  }

  warning(pointer: string, code: string, detail: string): void {
    this.list.push({ pointer, code, detail, severity: 'warning' });
  }
}

export const stepPointer = (index: number): string => `/steps/${String(index)}`;

/** The verification step types and, for each, core's verification type (C50.2). */
export const CORE_VERIFICATION_TYPES: Readonly<Record<string, string>> = Object.freeze({
  government_id: 'government_id',
  selfie: 'selfie',
  document: 'document',
  phone_otp: 'phone_number',
  email_otp: 'email_address',
  database: 'database',
  aamva: 'aamva',
  nfc: 'government_id_nfc',
  crypto_wallet: 'crypto_wallet',
  database_business: 'database_business',
  business_website: 'business_website',
});

export const isVerificationType = (type: string): boolean =>
  Object.hasOwn(CORE_VERIFICATION_TYPES, type);

/** Steps a person sees (C151.5): every type but a branch and an action. */
export const isPersonVisible = (step: FlowV2Step): boolean =>
  step.type !== 'branch' && step.type !== 'action';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every path a condition's `var` reads, in document order (structural; typing is separate). */
export function conditionPaths(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(conditionPaths);
  if (!isRecord(node)) return [];
  return Object.entries(node).flatMap(([operator, raw]) => {
    if (operator !== 'var') return conditionPaths(raw);
    const path: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
    return typeof path === 'string' ? [path] : [];
  });
}

/** The UTF-8 size of a value's JSON. */
export const jsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;
