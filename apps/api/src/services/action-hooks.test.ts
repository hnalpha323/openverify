/**
 * Workflow 8A Stage 1b (A): the smaller hooks. `setTransactionReviewerInTx` on a status change and
 * nothing else (C127.7, V27), the `decisions` include through its builder (C128.1, C143.6), the flow's
 * `decision-contest-route` for a declined inquiry only (C128.7), the columns served through their
 * resources (Stage 1a amendment 52), and a decision comment masked at every exit (C143.5). The hooks
 * are recording fakes here; their behaviour is `api-actions`'. Synthetic values.
 */
import {
  buildDecisionResource,
  newId,
  PII_DECISION_ATTRIBUTES,
  type FlowDecisionContestRoute,
} from '@openverify/contracts';
import { getInquiry, transitionInquiryStatus } from '@openverify/db';
import { seedList, seedTransaction, seedTransactionType } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MASKED_ATTRIBUTES } from '../auth/pii.js';
import { bearer, createInquiry, resumeInquiry } from '../test-support/harness.js';
import { maskPersonalData } from './api-logs.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

const hooks = vi.hoisted(() => ({ reviewer: vi.fn(), include: vi.fn(), route: vi.fn() }));
vi.mock('../workflows/actions/transactions/reviewer.js', () => ({
  setTransactionReviewerInTx: hooks.reviewer,
}));
vi.mock('./decisions/resources.js', () => ({ includedDecisionsFor: hooks.include }));
vi.mock('./decisions/contest-route.js', () => ({ flowDecisionContestRouteOf: hooks.route }));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  hooks.reviewer.mockReset().mockResolvedValue(undefined);
  hooks.include.mockReset().mockResolvedValue([]);
  hooks.route.mockReset().mockResolvedValue(null);
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

const attributes = (members: Record<string, unknown>) => ({ data: { attributes: members } });

const flowSession = async (token: string) =>
  (await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(token) })).json<Record<string, unknown>>();

describe('setTransactionReviewerInTx (C127.7, V27)', () => {
  async function transaction() {
    const type = await seedTransactionType(api.database.db, api.environmentId);
    return seedTransaction(api.database.db, api.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
  }

  it('runs on a status change, in its transaction, with the actor', async () => {
    const { id } = await transaction();

    const response = await call(
      'PATCH',
      `/transactions/${id}`,
      attributes({ status: 'approved' }),
    );

    expect(response.statusCode).toBe(200);
    expect(hooks.reviewer).toHaveBeenCalledTimes(1);
    expect(hooks.reviewer.mock.calls[0]?.[0]).not.toBe(api.database.db);
    expect(hooks.reviewer.mock.calls[0]?.[1]).toMatchObject({
      environmentId: api.environmentId,
      transactionId: id,
      actor: { type: 'api-key' },
    });
  });

  it('does not run for a change that leaves the status alone', async () => {
    const { id } = await transaction();

    await call('PATCH', `/transactions/${id}`, attributes({ 'reference-id': 'synthetic' }));

    expect(hooks.reviewer).not.toHaveBeenCalled();
  });

  it('serves the reviewer the row holds', async () => {
    const { id } = await transaction();
    const reviewer = newId('wfr');
    await api.database.client.query(
      `update transactions set reviewer_type = 'workflow-run', reviewer_id = $1 where id = $2`,
      [reviewer, id],
    );

    const response = await call('GET', `/transactions/${id}`);

    expect(response.json()).toMatchObject({
      data: { relationships: { reviewer: { data: { type: 'workflow-run', id: reviewer } } } },
    });
  });
});

describe('the decisions include (C128.1, C143.6)', () => {
  const decision = (inquiryId: string) =>
    buildDecisionResource({
      id: newId('idec'),
      kind: 'decline',
      subject: { type: 'inquiry', id: inquiryId },
      actor: { type: 'api-key', id: newId('key') },
      run: null,
      solelyAutomated: null,
      humanStep: null,
      evidence: [],
      pendingEvidence: [],
      decisionBasis: null,
      contestRoute: null,
      biometricBasis: null,
      comment: null,
      needsReview: false,
      humanReviewPending: false,
      errorCode: null,
      testRunId: null,
      createdAt: new Date('2026-11-02T00:00:00.000Z'),
    });

  it('reads its builder, under `inquiries:read` alone', async () => {
    const id = await createInquiry(api, { token: api.token });
    const resource = decision(id);
    hooks.include.mockResolvedValue([resource]);

    const response = await call('GET', `/inquiries/${id}?include=decisions`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ included: [resource] });
    expect(hooks.include.mock.calls[0]?.slice(1, 3)).toEqual([api.environmentId, id]);
  });

  it('is not read unless it is asked for', async () => {
    const id = await createInquiry(api, { token: api.token });

    await call('GET', `/inquiries/${id}`);

    expect(hooks.include).not.toHaveBeenCalled();
  });
});

describe('decision-contest-route (C128.7, P40)', () => {
  const route: FlowDecisionContestRoute = {
    url: 'https://example.com/contest',
    host: 'example.com',
    contact: null,
  };

  async function sessionOf(to: readonly ('completed' | 'declined')[]) {
    const id = await createInquiry(api, { token: api.token });
    const session = await resumeInquiry(api, id);
    const statuses = ['created', 'pending', ...to] as const;
    for (let index = 1; index < statuses.length; index += 1) {
      const [from, next] = [statuses[index - 1], statuses[index]];
      if (from !== undefined && next !== undefined) {
        await transitionInquiryStatus(api.database.db, api.environmentId, id, { from, to: next });
      }
    }
    expect(await getInquiry(api.database.db, api.environmentId, id)).toMatchObject({
      status: to.at(-1) ?? 'pending',
    });
    return { id, session };
  }

  it('reaches the person on a declined inquiry', async () => {
    hooks.route.mockResolvedValue(route);
    const { id, session } = await sessionOf(['completed', 'declined']);

    const answer = await flowSession(session);

    expect(answer['decision-contest-route']).toEqual(route);
    expect(hooks.route.mock.calls[0]?.slice(1)).toEqual([api.environmentId, id]);
  });

  it('stays out of every other inquiry, and is not even read', async () => {
    hooks.route.mockResolvedValue(route);
    const { session } = await sessionOf([]);

    const answer = await flowSession(session);

    expect(answer).not.toHaveProperty('decision-contest-route');
    expect(hooks.route).not.toHaveBeenCalled();
  });

  it('is left out of a decline that holds none', async () => {
    const { session } = await sessionOf(['completed', 'declined']);

    expect(await flowSession(session)).not.toHaveProperty('decision-contest-route');
  });
});

describe('what each resource now serves (Stage 1a amendment 52)', () => {
  const route = { url: 'https://example.com/contest' };

  it('stores and serves a list purpose, `block` by default', async () => {
    const created = await call('POST', '/list/email-addresses', attributes({ name: 'Blocked' }));
    const allowed = await call(
      'POST',
      '/list/email-addresses',
      attributes({ name: 'Allowed', purpose: 'allow' }),
    );
    const { data } = created.json<{ data: { id: string } }>();
    const patched = await call(
      'PATCH',
      `/lists/${data.id}`,
      attributes({ purpose: 'watch' }),
    );

    expect(created.json()).toMatchObject({ data: { attributes: { purpose: 'block' } } });
    expect(allowed.json()).toMatchObject({ data: { attributes: { purpose: 'allow' } } });
    expect(patched.json()).toMatchObject({ data: { attributes: { purpose: 'watch' } } });
  });

  it('stores and serves a transaction type’s adverse statuses and contest route', async () => {
    const created = await call(
      'POST',
      '/transaction-types',
      attributes({
        name: 'Payout',
        statuses: ['created', 'held', 'blocked'],
        'adverse-statuses': ['blocked'],
        'contest-route': route,
      }),
    );
    const { data } = created.json<{ data: { id: string } }>();
    const patched = await call(
      'PATCH',
      `/transaction-types/${data.id}`,
      attributes({ 'adverse-statuses': ['held', 'blocked'], 'contest-route': null }),
    );

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      data: { attributes: { 'adverse-statuses': ['blocked'], 'contest-route': route } },
    });
    expect(patched.json()).toMatchObject({
      data: { attributes: { 'adverse-statuses': ['held', 'blocked'], 'contest-route': null } },
    });
  });

  it('refuses an adverse status the type does not have (amendment 52)', async () => {
    const created = await call(
      'POST',
      '/transaction-types',
      attributes({ name: 'Payout', 'adverse-statuses': ['frozen'] }),
    );
    const type = await seedTransactionType(api.database.db, api.environmentId);
    const patched = await call(
      'PATCH',
      `/transaction-types/${type.id}`,
      attributes({ 'adverse-statuses': ['frozen'] }),
    );

    expect(created.statusCode).toBe(422);
    expect(patched.statusCode).toBe(422);
    expect(patched.json()).toMatchObject({
      errors: [{ pointer: '/data/attributes/adverse-statuses/0' }],
    });
  });

  it('stores and serves an account type’s contest route', async () => {
    const created = await call(
      'POST',
      '/account-types',
      attributes({ name: `Business ${newId('acctp')}`, 'contest-route': route }),
    );
    const { data } = created.json<{ data: { id: string } }>();
    const patched = await call(
      'PATCH',
      `/account-types/${data.id}`,
      attributes({ 'contest-route': null }),
    );

    expect(created.json()).toMatchObject({ data: { attributes: { 'contest-route': route } } });
    expect(patched.json()).toMatchObject({ data: { attributes: { 'contest-route': null } } });
  });

  it('serves a device’s trust mark', async () => {
    const list = await seedList(api.database.db, api.environmentId);
    expect(list.id).toBeDefined();
    const deviceId = newId('dev');
    const at = new Date('2026-11-02T00:00:00.000Z');
    const userId = newId('usr');
    await api.database.client.query(
      `insert into devices (id, environment_id, platform, collector_version, device_fingerprint,
         key_id, first_seen_at, last_seen_at, trusted_at, trusted_by_type, trusted_by_id,
         trust_reason)
       values ($1, $2, 'android', 1, $3, 'AAAAAAAAAAA', $4, $4, $4, 'user', $5, 'manual_review')`,
      [deviceId, api.environmentId, 'a'.repeat(64), at.toISOString(), userId],
    );

    const response = await call('GET', `/devices/${deviceId}`);

    expect(response.json()).toMatchObject({
      data: {
        attributes: {
          'trusted-at': at.toISOString(),
          'trusted-by': { type: 'user', id: userId },
          'trust-reason': 'manual_review',
        },
      },
    });
  });
});

describe('a decision comment is masked at every exit (C143.5)', () => {
  it('is in the masked attributes', () => {
    expect(MASKED_ATTRIBUTES).toEqual(expect.arrayContaining([...PII_DECISION_ATTRIBUTES]));
  });

  it('is nulled in a stored response', () => {
    const masked = maskPersonalData({
      data: { type: 'decision', id: 'idec_1', attributes: { kind: 'decline', comment: 'Synthetic' } },
    });

    expect(masked).toEqual({
      data: { type: 'decision', id: 'idec_1', attributes: { kind: 'decline', comment: null } },
    });
  });

  it('is nulled in a stored request body, under `meta` (P21)', () => {
    expect(maskPersonalData({ meta: { comment: 'Synthetic', 'solely-automated': true } })).toEqual({
      meta: { comment: null, 'solely-automated': true },
    });
  });
});
