/**
 * Workflow 8A Stage 3 (`api-actions`; C128.1, C128.6, C128.7, C143.6; V10, V22, V25): the decision
 * record through the routes: what an approve, a decline, a mark-for-review and a reopen each write,
 * the guard while human review is open, comment redaction by subject, the reads under their scopes
 * and masks, the event's `meta.decision`, and the contest route of the flow. Synthetic values.
 */
import {
  getInquiry,
  listInquiryDecisions,
  redactInquiryRecords,
  transitionInquiryStatus,
} from '@openverify/db';
import {
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
} from '@openverify/db/testing';
import type { InquiryStatus } from '@openverify/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createInquiry, seedVerification } from '../../test-support/harness.js';
import { findInquiry } from '../inquiries.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { recordInquiryDecisionInTx } from './record.js';
import { flowDecisionContestRouteOf } from './contest-route.js';
import { redactDecisionCommentsInTx } from './redaction.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const PATHS: Partial<Record<InquiryStatus, InquiryStatus[]>> = {
  completed: ['pending', 'completed'],
  needs_review: ['pending', 'completed', 'needs_review'],
};

async function inquiryIn(status: InquiryStatus): Promise<string> {
  const id = await createInquiry(api, { token: api.token });
  let from: InquiryStatus = 'created';
  for (const to of PATHS[status] ?? []) {
    await transitionInquiryStatus(api.database.db, api.environmentId, id, { from, to });
    from = to;
  }
  return id;
}

const post = (url: string, payload: unknown, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: bearer(token),
    payload: payload as Record<string, unknown>,
  });

const get = (url: string, token = api.token) =>
  api.app.inject({ url: `/api/v1${url}`, headers: bearer(token) });

const decisionsOf = async (id: string) =>
  (await listInquiryDecisions(api.database.db, api.environmentId, id, { size: 100 })).items;

const statusOf = async (id: string) =>
  (await getInquiry(api.database.db, api.environmentId, id))?.status;

describe('the record of an API decision (C128.1)', () => {
  it('records a decline with what the caller declared, its comment sealed', async () => {
    const id = await inquiryIn('completed');
    const response = await post(`/inquiries/${id}/decline`, {
      meta: { 'solely-automated': false, comment: 'A synthetic reason' },
    });
    expect(response.statusCode).toBe(200);
    const [decision] = await decisionsOf(id);
    expect(decision).toMatchObject({
      kind: 'decline',
      subjectType: 'inquiry',
      subjectId: id,
      actorType: 'api-key',
      solelyAutomated: false,
      comment: 'A synthetic reason',
      humanReviewPending: false,
    });
  });

  it('holds `null` when the caller declares nothing (C128.2)', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/approve`, {});
    expect((await decisionsOf(id))[0]).toMatchObject({ kind: 'approve', solelyAutomated: null });
  });

  it('writes a `review` row for a mark-for-review (V17)', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/mark-for-review`, { meta: { comment: 'Look closer' } });
    expect((await decisionsOf(id))[0]).toMatchObject({ kind: 'review', comment: 'Look closer' });
  });

  it('puts its decision on `inquiry.declined` (P40)', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, { meta: { 'solely-automated': true } });
    const [decision] = await decisionsOf(id);
    const declined = api.events
      .named('inquiry.declined')
      .find((event) => JSON.stringify(event.payload).includes(id));
    expect(declined?.payload).toMatchObject({
      meta: {
        decision: {
          id: decision?.id,
          'solely-automated': true,
          'decision-basis': null,
          'contest-route': null,
        },
      },
    });
  });

  it('answers what the move needs, and an id of its own when one is given', async () => {
    const id = await inquiryIn('completed');
    const decisionId = api.deps.ids.newId('idec');
    const inquiry = await findInquiry(api.database.db, api.environmentId, id);
    const meta = await api.database.db.transaction((tx) =>
      recordInquiryDecisionInTx(tx, api.deps, {
        inquiry,
        kind: 'decline',
        actor: { type: 'workflow-run', id: testId('wfr') },
        decision: {
          id: decisionId,
          run: {
            solelyAutomated: true,
            decisionBasis: 'contract',
            contestRoute: { url: 'https://contest.example.com/review' },
          },
        },
      }),
    );
    expect(meta).toEqual({
      id: decisionId,
      'solely-automated': true,
      'decision-basis': 'contract',
      'contest-route': { url: 'https://contest.example.com/review' },
    });
  });
});

describe('the evidence of a decision (C128.1, H13)', () => {
  it('names a verification and its checks as codes, and what was pending', async () => {
    const id = await inquiryIn('completed');
    const { id: verificationId } = await seedVerification(api, api.environmentId, id, {
      status: 'passed',
      checks: [{ name: 'id_blur_detection', status: 'passed' }],
    });
    const template = await seedReportTemplate(api.database.db, api.environmentId);
    await seedReport(api.database.db, api.environmentId, {
      ...template,
      inquiryId: id,
      status: 'pending',
    });
    await post(`/inquiries/${id}/decline`, {});
    const [decision] = await decisionsOf(id);
    expect(decision?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'verification', id: verificationId, status: 'passed' }),
        expect.objectContaining({
          kind: 'check',
          name: 'id_blur_detection',
          status: 'passed',
          tier: 'R',
        }),
      ]),
    );
    expect(decision?.pendingEvidence).toEqual([
      expect.objectContaining({ kind: 'report', name: null }),
    ]);
  });
});

describe('the reopen of a decline (C128.6)', () => {
  const reopen = (id: string, token: string) =>
    post(`/inquiries/${id}/reopen`, { meta: { comment: 'A person will review it' } }, token);

  it('is a user’s act: a key answers 403', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, {});
    expect((await reopen(id, api.token)).statusCode).toBe(403);
    expect(await statusOf(id)).toBe('declined');
  });

  it('opens human review, and a run or a key cannot decline until a user decides', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, {});
    const user = api.newUserToken(api.environmentId, {
      permissions: ['inquiries:read', 'inquiries:write'],
    });
    const response = await reopen(id, user);
    expect(response.statusCode).toBe(200);
    expect(await statusOf(id)).toBe('needs_review');
    expect((await decisionsOf(id))[0]).toMatchObject({
      kind: 'reopen',
      humanReviewPending: true,
      comment: 'A person will review it',
    });
    const refused = await post(`/inquiries/${id}/decline`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('human_review_pending');
    expect(await statusOf(id)).toBe('needs_review');
  });

  it('closes when a user decides, who may decline again', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, {});
    const user = api.newUserToken(api.environmentId, {
      permissions: ['inquiries:read', 'inquiries:write'],
    });
    await reopen(id, user);
    const response = await post(`/inquiries/${id}/decline`, {}, user);
    expect(response.statusCode).toBe(200);
    const decisions = await decisionsOf(id);
    expect(decisions.filter(({ humanReviewPending }) => humanReviewPending)).toEqual([]);
    expect(decisions.map(({ kind }) => kind).sort()).toEqual(['decline', 'decline', 'reopen']);
  });

  it('answers 410 for a redacted inquiry, reached through its expiry (outcome 6)', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, {});
    await redactInquiryRecords(api.database.db, api.environmentId, id, { at: new Date() });
    const user = api.newUserToken(api.environmentId, {
      permissions: ['inquiries:read', 'inquiries:write'],
    });
    expect((await reopen(id, user)).statusCode).toBe(410);
  });

  it('answers 409 for an inquiry that was not declined', async () => {
    const id = await inquiryIn('completed');
    const user = api.newUserToken(api.environmentId, {
      permissions: ['inquiries:read', 'inquiries:write'],
    });
    expect((await reopen(id, user)).statusCode).toBe(409);
  });
});

describe('GET /decisions (C128.1, V10)', () => {
  it('needs filter[subject-id]', async () => {
    const response = await get('/decisions');
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('filter_required');
  });

  it('needs the subject’s read scope, before anything else', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/approve`, {});
    const token = await api.newApiKey(api.environmentId, { scopes: ['accounts:read'] });
    expect((await get(`/decisions?filter[subject-id]=${id}`, token)).statusCode).toBe(403);
  });

  it('reads a transaction’s decisions under `transactions:read`', async () => {
    const type = await seedTransactionType(api.database.db, api.environmentId);
    const { id } = await seedTransaction(api.database.db, api.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    const refused = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });
    expect((await get(`/decisions?filter[subject-id]=${id}`, refused)).statusCode).toBe(403);
    const token = await api.newApiKey(api.environmentId, { scopes: ['transactions:read'] });
    expect((await get(`/decisions?filter[subject-id]=${id}`, token)).statusCode).toBe(200);
  });

  it('lists a subject newest first, and masks a comment without PII visibility', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, { meta: { comment: 'A synthetic reason' } });
    const open = await get(`/decisions?filter[subject-id]=${id}`);
    expect(open.statusCode).toBe(200);
    expect(open.json()).toMatchObject({
      data: [
        {
          type: 'decision',
          attributes: { kind: 'decline', comment: 'A synthetic reason' },
          relationships: { subject: { data: { type: 'inquiry', id } } },
        },
      ],
      links: { next: null },
    });
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['inquiries:read'],
      piiMasked: true,
    });
    const read = await get(`/decisions?filter[subject-id]=${id}`, masked);
    expect(read.json()).toMatchObject({ data: [{ attributes: { comment: null } }] });
  });
});

describe('the `decisions` include (C128.1, C143.6)', () => {
  it('serves under `inquiries:read`, masked by the caller', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, { meta: { comment: 'A synthetic reason' } });
    const open = await get(`/inquiries/${id}?include=decisions`);
    expect(open.json()).toMatchObject({
      included: [{ type: 'decision', attributes: { comment: 'A synthetic reason' } }],
    });
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['inquiries:read'],
      piiMasked: true,
    });
    const read = await get(`/inquiries/${id}?include=decisions`, masked);
    expect(read.json()).toMatchObject({ included: [{ attributes: { comment: null } }] });
  });
});

describe('comment redaction (C128.1; P35, V25)', () => {
  it('nulls the comment and keeps the codes', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, { meta: { comment: 'A synthetic reason' } });
    await api.database.db.transaction((tx) =>
      redactDecisionCommentsInTx(tx, {
        environmentId: api.environmentId,
        subjectIds: [id],
        at: new Date(),
      }),
    );
    expect((await decisionsOf(id))[0]).toMatchObject({ kind: 'decline', comment: null });
  });
});

describe('the contest route of the flow (C128.7)', () => {
  it('reads the newest decline’s route, with its host, and never the case template', async () => {
    const id = await inquiryIn('completed');
    const inquiry = await findInquiry(api.database.db, api.environmentId, id);
    await api.database.db.transaction((tx) =>
      recordInquiryDecisionInTx(tx, api.deps, {
        inquiry,
        kind: 'decline',
        actor: { type: 'workflow-run', id: testId('wfr') },
        decision: {
          run: {
            contestRoute: {
              url: 'https://contest.example.com/review',
              contact: 'review@example.com',
              'case-template-id': 'ctmpl_01M5CK16P0D13FXHZSS4TCFBVH',
            },
          },
        },
      }),
    );
    expect(await flowDecisionContestRouteOf(api.database.db, api.environmentId, id)).toEqual({
      url: 'https://contest.example.com/review',
      host: 'contest.example.com',
      contact: 'review@example.com',
    });
  });

  it('answers null for a decline that names no route', async () => {
    const id = await inquiryIn('completed');
    await post(`/inquiries/${id}/decline`, {});
    expect(await flowDecisionContestRouteOf(api.database.db, api.environmentId, id)).toBeNull();
  });
});
