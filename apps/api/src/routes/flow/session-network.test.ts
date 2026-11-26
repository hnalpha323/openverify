/**
 * C93.2 (Workflow 7A Stage 1b (N), F15): the first successful flow call of a session evaluates its
 * address, through `evaluateSessionNetworkInTx` (`api-network`), in the transaction that records
 * the start, once; the call that loses `markInquirySessionStarted` evaluates nothing. The hook is
 * replaced here by a spy that reads the session through the transaction it is given. Every address
 * is from the documentation ranges.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '@openverify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionNetworkDeps, SessionToEvaluate } from '../../network/evaluate.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus, openFlowSession } from '../../test-support/harness.js';

interface Call {
  deps: SessionNetworkDeps;
  session: SessionToEvaluate;
  client: { ip: string };
  at: Date;
  /** `started_at` of the session as the transaction sees it. */
  startedInTx: boolean;
}

const calls = vi.hoisted(() => [] as Call[]);
const failNext = vi.hoisted(() => ({ value: false }));
vi.mock('../../network/evaluate.js', () => ({
  evaluateSessionNetworkInTx: async (
    tx: Db,
    deps: SessionNetworkDeps,
    session: SessionToEvaluate,
    client: { ip: string },
    at: Date,
  ) => {
    const seen = (await tx.execute(
      sql`select started_at is not null as started from inquiry_sessions where id = ${session.id}`,
    )) as { rows: { started?: boolean }[] };
    calls.push({ deps, session, client, at, startedInTx: seen.rows[0]?.started === true });
    if (failNext.value) {
      failNext.value = false;
      throw new TypeError('synthetic evaluation failure');
    }
    return null;
  },
}));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  calls.length = 0;
  failNext.value = false;
});

const SESSION = '/api/v1/flow/session';

async function started(inquiryId: string): Promise<boolean[]> {
  const { rows } = await api.database.client.query<{ started: boolean }>(
    'select started_at is not null as started from inquiry_sessions where inquiry_id = $1',
    [inquiryId],
  );
  return rows.map((row) => row.started);
}

describe('the session start evaluates the address (C93.2)', () => {
  it('once, in the transaction that records the start, with the network deps and the address', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const call = () =>
      api.app.inject({ url: SESSION, headers: bearer(sessionToken), remoteAddress: '192.0.2.10' });

    expectStatus(await call(), 200);
    expectStatus(await call(), 200);

    expect(calls).toHaveLength(1);
    const [first] = calls;
    expect(first?.deps).toBe(api.deps.network);
    expect(first?.session).toMatchObject({ environmentId: api.environmentId, inquiryId });
    expect(first?.session.id).toMatch(/^iqse_/);
    expect(first?.client).toEqual({ ip: '192.0.2.10' });
    expect(first?.at).toEqual(api.clock.now());
    expect(first?.startedInTx).toBe(true);
  });

  it('rolls the start back with a failed evaluation, so the next call starts and evaluates again', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    failNext.value = true;

    const failed = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });

    expect(failed.statusCode).toBe(500);
    expect(await started(inquiryId)).toEqual([false]);
    expectStatus(await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }), 200);
    expect(calls).toHaveLength(2);
    expect(await started(inquiryId)).toEqual([true]);
  });

  it('evaluates nothing for a session that does not start', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/perform-simulate-actions`,
        headers: bearer(api.token),
        payload: { meta: { actions: [{ type: 'expire_inquiry' }] } },
      }),
      200,
    );

    await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });

    expect(calls).toEqual([]);
  });
});
