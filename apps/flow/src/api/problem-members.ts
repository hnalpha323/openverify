/**
 * What a flow API problem says beyond its status: its `code` (C52.7) and the extension members
 * some codes carry (`attempts-remaining`, `resend-available-at`). Unknown members are kept by
 * `problemSchema` and read here defensively: a member of the wrong shape counts as absent.
 */
import { FlowApiError } from './flow-api-error';

/** The problem's `code`, when the server answered with one. */
export function problemCode(error: unknown): string | undefined {
  return error instanceof FlowApiError && error.kind === 'http' ? error.problem?.code : undefined;
}

function member(error: unknown, name: string): unknown {
  return error instanceof FlowApiError
    ? (error.problem as Record<string, unknown> | null)?.[name]
    : undefined;
}

/** A whole number member, such as `attempts-remaining`. */
export function countMember(error: unknown, name: string): number | null {
  const value = member(error, name);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A timestamp member, such as `resend-available-at`, in milliseconds since the epoch. */
export function timeMember(error: unknown, name: string): number | null {
  const value = member(error, name);
  const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? null : time;
}

/** A 409: the server state changed under the client (C3), so a plain retry cannot help. */
export function isConflict(error: unknown): boolean {
  return error instanceof FlowApiError && error.kind === 'http' && error.status === 409;
}
