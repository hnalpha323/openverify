/**
 * C55.11: what `POST /api/v1/sandbox/sms-messages/search` answers: the codes the sandbox SMS sender
 * kept for one number in the caller's sandbox environment, newest first. The number is read as
 * E.164 with the separators people type removed, and looked up by its blind index only; a value
 * that is no number has no codes.
 */
import { toTimestamp, type SandboxSmsSearchResponse } from '@openverify/contracts';
import { otpDestinationIndex } from '@openverify/db';
import { readSandboxSmsSink } from '../../providers/sms/sandbox.js';
import type { ApiDependencies } from '../context.js';

const SEPARATORS = /[\s().-]/gu;
const E164 = /^\+[1-9]\d{6,14}$/u;

/** The sink's codes for `phoneNumber` in `environmentId`. */
export async function searchSandboxSmsSink(
  deps: ApiDependencies,
  environmentId: string,
  phoneNumber: string,
): Promise<SandboxSmsSearchResponse> {
  const e164 = phoneNumber.replace(SEPARATORS, '');
  if (!E164.test(e164)) {
    return { data: [] };
  }
  const destinationIndex = otpDestinationIndex(deps.blindIndexKey, {
    environmentId,
    channel: 'sms',
    destination: e164,
  });
  const entries = await readSandboxSmsSink(deps.cache, environmentId, destinationIndex);
  return {
    data: entries.map((entry) => ({ code: entry.code, 'sent-at': toTimestamp(entry.sentAt) })),
  };
}
