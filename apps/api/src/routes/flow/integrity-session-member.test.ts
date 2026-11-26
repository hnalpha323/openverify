/**
 * Workflow 10B Stage 1b (I) (C211.3; `foundation-10b`): `getFlowSession` asks the `integrity` member's
 * hook (`services/device-integrity/session-member.ts`, `api-integrity`'s) on every session read, with
 * the session's ids, its environment kind and its collection tiers, and serves what the hook answers.
 * The hook is replaced here, so this file proves the call site; the member's rule is `api-integrity`'s.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { integritySessionMember } from '../../services/device-integrity/session-member.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus, openFlowSession } from '../../test-support/harness.js';

vi.mock('../../services/device-integrity/session-member.js', () => ({
  integritySessionMember: vi.fn(() => Promise.resolve({ request: true })),
}));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

describe("GET /api/v1/flow/session: the integrity member's hook (C211.3)", () => {
  it("serves the member the hook answers, asked with the session's ids, kind and tiers", async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const hook = vi.mocked(integritySessionMember);
    hook.mockClear();

    const body = expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
      200,
    );

    expect(body).toMatchObject({ integrity: { request: true } });
    expect(hook).toHaveBeenCalledTimes(1);
    const [, input] = hook.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      environmentId: api.environmentId,
      environmentKind: 'sandbox',
      inquiryId,
      signals: null,
    });
    expect(input?.sessionId).toMatch(/^iqse_/);
  });

  it('leaves the member out when the hook answers null', async () => {
    const { sessionToken } = await openFlowSession(api);
    vi.mocked(integritySessionMember).mockResolvedValueOnce(null);

    const body = expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
      200,
    );

    expect(body).not.toHaveProperty('integrity');
  });
});
