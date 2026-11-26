/**
 * Workflow 7B Stage 1b (G) (C101.3, P05): the session start calls the graph indexer at the call site
 * 7A reserved, after the device fields, in the start's transaction. The network evaluation is
 * replaced here by a stub that answers a network or `null`, and the indexer by a spy.
 *
 * - With a network evaluated, the indexer gets the inquiry's account, the session as the source and
 *   the address with the network's id.
 * - `null` (nothing evaluated: an address that does not parse, an evaluation that failed) reads as no
 *   address: the indexer is not called, and the session starts.
 * - An indexer that throws never rolls the start back: it runs in a savepoint.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '@openverify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphAttributesInput, GraphIndexSource } from '../../services/graph/indexing.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus, openFlowSession } from '../../test-support/harness.js';

interface IndexCall {
  environmentId: string;
  accountId: string;
  source: GraphIndexSource;
  attributes: GraphAttributesInput;
  startedInTx: boolean;
}

const calls = vi.hoisted(() => [] as IndexCall[]);
const control = vi.hoisted(() => ({ network: true, fail: false }));

vi.mock('../../network/evaluate.js', () => ({
  evaluateSessionNetworkInTx: () =>
    Promise.resolve(control.network ? { networkId: 'net_01M5CK16P0D13FXHZSS4TCFBVH' } : null),
}));

vi.mock('../../services/graph/indexing.js', () => ({
  indexAccountAttributesInTx: async (
    tx: Db,
    environmentId: string,
    accountId: string,
    source: GraphIndexSource,
    attributes: GraphAttributesInput,
  ) => {
    const id = (source as { id: string }).id;
    const seen = (await tx.execute(
      sql`select started_at is not null as started from inquiry_sessions where id = ${id}`,
    )) as { rows: { started?: boolean }[] };
    calls.push({
      environmentId,
      accountId,
      source,
      attributes,
      startedInTx: seen.rows[0]?.started === true,
    });
    if (control.fail) {
      // A failed statement aborts the transaction it runs in, unless that is a savepoint.
      await tx.execute(sql`select 1 / 0`);
    }
    return 1;
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
  control.network = true;
  control.fail = false;
});

const SESSION = '/api/v1/flow/session';

async function started(inquiryId: string): Promise<boolean[]> {
  const { rows } = await api.database.client.query<{ started: boolean }>(
    'select started_at is not null as started from inquiry_sessions where inquiry_id = $1',
    [inquiryId],
  );
  return rows.map((row) => row.started);
}

async function accountOf(inquiryId: string): Promise<string | undefined> {
  const { rows } = await api.database.client.query<{ account_id: string }>(
    'select account_id from inquiries where id = $1',
    [inquiryId],
  );
  return rows[0]?.account_id;
}

describe('the session start indexes the address (C101.3)', () => {
  it('once, in the start’s transaction, with the account, the session and the network', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const call = () =>
      api.app.inject({ url: SESSION, headers: bearer(sessionToken), remoteAddress: '192.0.2.10' });

    expectStatus(await call(), 200);
    expectStatus(await call(), 200);

    expect(calls).toHaveLength(1);
    const [first] = calls;
    expect(first?.environmentId).toBe(api.environmentId);
    expect(first?.accountId).toBe(await accountOf(inquiryId));
    expect(first?.source).toMatchObject({ type: 'inquiry-session', inquiryId });
    expect((first?.source as { id: string }).id).toMatch(/^iqse_/);
    expect(first?.attributes).toEqual({
      kind: 'session-address',
      ip: '192.0.2.10',
      networkId: 'net_01M5CK16P0D13FXHZSS4TCFBVH',
    });
    expect(first?.startedInTx).toBe(true);
  });

  it('reads an evaluation that wrote nothing as no address: no call, and the session starts', async () => {
    control.network = false;
    const { inquiryId, sessionToken } = await openFlowSession(api);

    expectStatus(await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }), 200);

    expect(calls).toEqual([]);
    expect(await started(inquiryId)).toEqual([true]);
  });

  it('never rolls the start back when the indexer fails', async () => {
    control.fail = true;
    const { inquiryId, sessionToken } = await openFlowSession(api);

    expectStatus(await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }), 200);

    expect(calls).toHaveLength(1);
    expect(await started(inquiryId)).toEqual([true]);
  });
});
