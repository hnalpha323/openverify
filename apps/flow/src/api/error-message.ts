/**
 * Maps a failed request to the message the user sees. Server `detail` text is never shown:
 * it is English-only and written for developers.
 */
import { FlowApiError } from './flow-api-client';

export type ErrorMessageKey =
  | 'errors.network'
  | 'errors.timeout'
  | 'errors.unauthorized'
  | 'errors.conflict'
  | 'errors.tooLarge'
  | 'errors.unsupportedImage'
  | 'errors.notAccepted'
  | 'errors.rateLimited'
  | 'errors.server'
  | 'errors.unexpected';

const BY_STATUS: ReadonlyMap<number, ErrorMessageKey> = new Map([
  // The session token is unknown, expired or revoked, or the inquiry is gone.
  [401, 'errors.unauthorized'],
  [403, 'errors.unauthorized'],
  [404, 'errors.unauthorized'],
  [410, 'errors.unauthorized'],
  // The inquiry moved on (another tab, or consent missing before an upload).
  [409, 'errors.conflict'],
  [413, 'errors.tooLarge'],
  [415, 'errors.unsupportedImage'],
  [422, 'errors.unsupportedImage'],
  [429, 'errors.rateLimited'],
]);

export function errorMessageKey(error: unknown): ErrorMessageKey {
  if (!(error instanceof FlowApiError)) {
    return 'errors.unexpected';
  }
  if (error.kind === 'network') {
    return 'errors.network';
  }
  if (error.kind === 'timeout') {
    return 'errors.timeout';
  }
  if (error.kind !== 'http' || error.status === null) {
    return 'errors.unexpected';
  }
  if (error.status >= 500) {
    return 'errors.server';
  }
  return BY_STATUS.get(error.status) ?? 'errors.unexpected';
}

/**
 * The message of a failed request on a screen where the user typed or pasted something (a phone
 * number, an email address, a code, a wallet address, a form): a 400 or 422 the screen has no
 * words of its own for is about what was entered, never about a photo (C64.1).
 */
export function entryErrorMessageKey(error: unknown): ErrorMessageKey {
  if (
    error instanceof FlowApiError &&
    error.kind === 'http' &&
    (error.status === 400 || error.status === 422)
  ) {
    return 'errors.notAccepted';
  }
  return errorMessageKey(error);
}
