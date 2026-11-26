/**
 * Workflow 8A Stage 1b (X) (C126.4): what `foundation-8a` froze of the messages. The list key names
 * ids alone, beside the untouched OTP list. Synthetic values.
 */
import { SANDBOX_MESSAGE_KINDS, SANDBOX_SMS_SINK } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { sandboxSmsSinkKey } from '../providers/sms/sandbox.js';
import {
  SANDBOX_MESSAGE_LIST,
  sandboxMessageListKey,
} from './actions/messaging/sandbox-messages.js';

describe('the sandbox message lists (C126.4)', () => {
  it('keep 500 entries for 24 hours', () => {
    expect(SANDBOX_MESSAGE_LIST).toEqual({ maxEntries: 500, ttlSeconds: 86_400 });
  });

  it('hold one list per environment and kind', () => {
    expect(SANDBOX_MESSAGE_KINDS.map((kind) => sandboxMessageListKey('env_1', kind))).toEqual([
      'openverify:sandbox-messages:env_1:workflow-sms',
      'openverify:sandbox-messages:env_1:email',
      'openverify:sandbox-messages:env_1:slack',
    ]);
  });

  it('leave the OTP list as it was', () => {
    expect(sandboxSmsSinkKey('env_1')).toBe('openverify:sandbox-sms:env_1');
    expect(SANDBOX_SMS_SINK.maxEntries).toBe(100);
  });
});
