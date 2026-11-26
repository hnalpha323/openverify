/**
 * C208.3 (Phase 10, Workflow 10C; `api-nfc`): the sandbox test chip's test-only builder
 * (`@openverify/emrtd/testing`) is imported lazily and only behind the environment check. Building
 * the whole API, serving a production environment's session at an `nfc` step and asking a
 * production environment for a sandbox chip never load it; a sandbox environment's request does.
 *
 * This file imports nothing that imports the builder (the harness does not), and counts the
 * module's loads through a mock factory that hands back the real module.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, openFlowSession } from '../test-support/harness.js';
import { nfcSessionMembers } from './flow-views/nfc.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock('@openverify/emrtd/testing', async (original) => {
  loads.count += 1;
  return original();
});

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const VERIFICATION = 'ver_01M5CK3190XEVBM5ZXA76E1JSM';
const body = { 'challenge-id': 'chc_01M5CK3190XEVBM5ZXA76E1JSM' };

describe('the sandbox chip’s test-only builder (C208.3)', () => {
  it('is not loaded by building the API', () => {
    expect(loads.count).toBe(0);
  });

  it('is not loaded by a production environment: the route answers the generic 404', async () => {
    const production = await api.newTenant({ kind: 'production' });
    const { sessionToken } = await openFlowSession(api, { token: production.token });

    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${VERIFICATION}/sandbox-chip`,
      headers: bearer(sessionToken),
      payload: body,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).not.toHaveProperty('code');
    expect(loads.count).toBe(0);
  });

  it('is not loaded by a production session’s nfc view, or one of an unknown kind', async () => {
    const step = { id: 'chip', type: 'nfc', androidOnly: true } as const;
    const inquiry = {
      id: 'inq_x',
      environmentId: 'env_x',
      flowStepId: 'chip',
      flowState: 'active',
    };

    for (const environmentKind of ['production', null] as const) {
      const members = await nfcSessionMembers(api.database.db, {
        inquiry: inquiry as never,
        step,
        sessionId: null,
        environmentKind,
        verifications: [],
      });

      expect(members).toEqual({});
    }
    expect(loads.count).toBe(0);
  });

  it('is loaded once a sandbox environment asks for a chip', async () => {
    const { sessionToken } = await openFlowSession(api);

    // No such verification: C52.1 answers 404 before the builder is needed.
    const missing = await api.app.inject({
      method: 'POST',
      url: `/api/v1/flow/verifications/${VERIFICATION}/sandbox-chip`,
      headers: bearer(sessionToken),
      payload: body,
    });
    expect(missing.statusCode).toBe(404);
    expect(loads.count).toBe(0);

    const { sandboxUtopiaAnchorHeld } = await import('./sandbox-chip.js');
    expect(await sandboxUtopiaAnchorHeld(api.database.db, api.clock.now())).toBe(false);
    expect(loads.count).toBe(1);
  });
});
