/**
 * C250.7 (Workflow 11B, platform-ops; Workflow 7A's C96.3): when the store behind the
 * per-environment handoff send budget does not answer, the send fails closed (503
 * `handoff_send_limited`, as before) and the registered counter `handoff_send_budget_unavailable`
 * is logged with the environment id, the only label; a budget that is merely spent (429) is not a
 * store failure and logs nothing. Every value is synthetic.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { updateEnvironmentSettings } from '@openverify/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { metrics } from '../../metrics-registry.js';
import type { RateLimiter } from '../../ports.js';
import { createInquiryTestApi } from '../inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  resumeInquiry,
} from '../../test-support/harness.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A limiter whose send-budget bucket throws (the store is down) or refuses (the budget is spent). */
function budgetLimiter(mode: 'refuse' | 'throw'): RateLimiter {
  return {
    consume(key, policy) {
      if (key.endsWith('|handoff-sends')) {
        if (mode === 'throw') {
          return Promise.reject(new Error('the limiter store is down'));
        }
        return Promise.resolve({
          allowed: false,
          limit: policy.limit,
          remaining: 0,
          resetAt: new Date('2030-01-01T00:00:00.000Z'),
          retryAfterSeconds: 60,
        });
      }
      return Promise.resolve({
        allowed: true,
        limit: policy.limit,
        remaining: policy.limit,
        resetAt: new Date('2030-01-01T00:00:00.000Z'),
        retryAfterSeconds: 0,
      });
    },
  };
}

function handoffTemplate() {
  const attributes = defaultInquiryTemplateAttributes();
  const [consent, ...rest] = attributes.flow.steps;
  if (consent === undefined) {
    throw new Error('the default template has no consent step');
  }
  attributes.flow.steps = [
    consent,
    {
      id: 'device_handoff',
      type: 'device_handoff',
      methods: ['qr', 'email'],
      confirmationCode: true,
    } as never,
    ...rest,
  ];
  return attributes;
}

describe('the handoff send budget store failure metric (C250.7, C96.3)', () => {
  it('counts a send refused because the budget store did not answer, and not a spent budget', async () => {
    const emitted = vi.spyOn(metrics, 'emit');
    for (const [mode, status] of [
      ['refuse', 429],
      ['throw', 503],
    ] as const) {
      const harness = await createInquiryTestApi({ rateLimiter: budgetLimiter(mode) });
      try {
        await updateEnvironmentSettings(harness.database.db, harness.environmentId, {
          'organization-display-name': 'Example Verification Ltd',
        });
        const templateId = await createTemplate(harness, harness.token, handoffTemplate());
        const token = await resumeInquiry(harness, await createInquiry(harness, { templateId }));
        const response = await harness.app.inject({
          method: 'POST',
          url: '/api/v1/flow/handoffs',
          headers: bearer(token),
          payload: { method: 'email', destination: 'person@example.com' },
        });
        expect(response.statusCode).toBe(status);

        const counted = emitted.mock.calls.filter(
          ([, name]) => name === 'handoff_send_budget_unavailable',
        );
        expect(counted.map(([, , value, labels]) => ({ value, labels }))).toEqual(
          mode === 'throw' ? [{ value: 1, labels: { environmentId: harness.environmentId } }] : [],
        );
      } finally {
        await harness.close();
      }
    }
  });
});
