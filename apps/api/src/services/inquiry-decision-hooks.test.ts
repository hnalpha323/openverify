/**
 * Workflow 8A Stage 1b (A) (C128.1, C128.6; F16, V22): what `applyInquiryAction` owes the decision
 * record: a record of every approve, decline and mark-for-review, none for an expiry, a simulated
 * decision or a refused transition; the guard before every decline, which can stop it; the record's
 * facts on `inquiry.declined`; and the `reopen` edge, a user's act alone on an unredacted inquiry.
 * The hooks are recording fakes here; their behaviour is `api-actions`' to test. Synthetic values.
 */
import { newId, type AuditActor, type DecisionMeta } from '@openverify/contracts';
import type { InquiryStatus } from '@openverify/core';
import { getInquiry, redactInquiryRecords, transitionInquiryStatus } from '@openverify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNMASKED } from '../auth/pii.js';
import { ForbiddenError, RedactedError } from '../errors.js';
import { bearer, createInquiry } from '../test-support/harness.js';
import {
  applyInquiryAction,
  findInquiry,
  performInquiryAction,
  type Acting,
} from './inquiries.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

const hooks = vi.hoisted(() => ({ record: vi.fn(), guard: vi.fn() }));
vi.mock('./decisions/record.js', () => ({ recordInquiryDecisionInTx: hooks.record }));
vi.mock('./decisions/guard.js', () => ({ inquiryDecisionGuardInTx: hooks.guard }));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  hooks.record.mockReset().mockResolvedValue(null);
  hooks.guard.mockReset().mockResolvedValue(undefined);
});

const USER: AuditActor = { type: 'user', id: newId('usr') };
const KEY: AuditActor = { type: 'api-key', id: newId('key') };

const actingAs = (actor: AuditActor = USER): Acting => ({
  ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
  actor,
  mask: UNMASKED,
  environmentKind: 'sandbox',
});

const PATHS: Partial<Record<InquiryStatus, InquiryStatus[]>> = {
  completed: ['pending', 'completed'],
  needs_review: ['pending', 'completed', 'needs_review'],
  declined: ['pending', 'failed', 'declined'],
  approved: ['pending', 'completed', 'approved'],
  created: [],
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

const statusOf = async (id: string) =>
  (await getInquiry(api.database.db, api.environmentId, id))?.status;

const reopen = (id: string, actor?: AuditActor) =>
  api.database.db.transaction(async (tx) =>
    applyInquiryAction(
      tx,
      api.deps,
      actingAs(actor),
      await findInquiry(tx, api.environmentId, id),
      'needs_review',
      { reopen: true, decision: { comment: 'Reviewed by a person' } },
    ),
  );

describe('the decision record (C128.1)', () => {
  it.each([
    ['approved', 'approve'],
    ['declined', 'decline'],
    ['needs_review', 'review'],
  ] as const)('records a move to %s as %s', async (to, kind) => {
    const id = await inquiryIn('completed');

    await performInquiryAction(api.deps, actingAs(KEY), id, to);

    expect(hooks.record).toHaveBeenCalledTimes(1);
    const [, , record] = hooks.record.mock.calls[0] as [unknown, unknown, Record<string, unknown>];
    expect(record).toMatchObject({ kind, actor: KEY, decision: {} });
    expect(record.inquiry).toMatchObject({ id, status: 'completed' });
  });

  it('passes on what the caller says of its decision', async () => {
    const id = await inquiryIn('completed');

    await performInquiryAction(api.deps, actingAs(), id, 'approved', {
      solelyAutomated: true,
      comment: 'Synthetic comment',
    });

    expect(hooks.record.mock.calls[0]?.[2]).toMatchObject({
      decision: { solelyAutomated: true, comment: 'Synthetic comment' },
    });
  });

  it('records nothing for an expiry, which is nobody\'s decision', async () => {
    const id = await inquiryIn('created');

    await performInquiryAction(api.deps, actingAs(), id, 'expired');

    expect(hooks.record).not.toHaveBeenCalled();
  });

  it('records nothing for a simulated decision (decision 77)', async () => {
    const id = await inquiryIn('completed');

    await api.database.db.transaction(async (tx) =>
      applyInquiryAction(
        tx,
        api.deps,
        actingAs(),
        await findInquiry(tx, api.environmentId, id),
        'declined',
        { simulated: true },
      ),
    );

    expect(hooks.record).not.toHaveBeenCalled();
  });

  it('records nothing for a transition the state machine refuses', async () => {
    const id = await inquiryIn('approved');

    await expect(performInquiryAction(api.deps, actingAs(), id, 'declined')).rejects.toThrow(
      'cannot move from approved to declined',
    );

    expect(hooks.record).not.toHaveBeenCalled();
    expect(hooks.guard).not.toHaveBeenCalled();
  });

  it('rolls the record back with a transition that fails after it', async () => {
    const id = await inquiryIn('completed');
    hooks.record.mockRejectedValueOnce(new Error('the record could not be written'));

    await expect(performInquiryAction(api.deps, actingAs(), id, 'declined')).rejects.toThrow(
      'the record could not be written',
    );

    expect(await statusOf(id)).toBe('completed');
  });

  it('puts the record on `inquiry.declined`, and nowhere else (C128.1, P40)', async () => {
    const id = await inquiryIn('completed');
    const meta: DecisionMeta = {
      id: newId('idec'),
      'solely-automated': null,
      'decision-basis': null,
      'contest-route': null,
    };
    hooks.record.mockResolvedValueOnce(meta);

    await performInquiryAction(api.deps, actingAs(), id, 'declined');

    const declined = api.events
      .named('inquiry.declined')
      .filter((event) => event.payload.data.id === id);
    expect(declined.map((event) => event.payload.meta)).toEqual([{ decision: meta }]);
    const moved = api.events
      .named('inquiry.transitioned')
      .filter((event) => event.payload.data.id === id);
    expect(moved.map((event) => event.payload.meta)).toEqual([
      { from: 'completed', to: 'declined' },
    ]);
  });

  it('leaves `meta` off a decline with no record, as a simulated one has', async () => {
    const id = await inquiryIn('completed');

    await performInquiryAction(api.deps, actingAs(), id, 'declined');

    const [declined] = api.events
      .named('inquiry.declined')
      .filter((event) => event.payload.data.id === id);
    expect(declined?.payload).not.toHaveProperty('meta');
  });
});

describe('the guard of human review (C128.6, V22)', () => {
  it('runs before every decline', async () => {
    const id = await inquiryIn('needs_review');

    await performInquiryAction(api.deps, actingAs(KEY), id, 'declined');

    expect(hooks.guard).toHaveBeenCalledTimes(1);
    expect(hooks.guard.mock.calls[0]?.[1]).toEqual({
      environmentId: api.environmentId,
      inquiryId: id,
      actor: KEY,
    });
  });

  it('runs before a simulated decline too', async () => {
    const id = await inquiryIn('completed');

    await api.database.db.transaction(async (tx) =>
      applyInquiryAction(
        tx,
        api.deps,
        actingAs(KEY),
        await findInquiry(tx, api.environmentId, id),
        'declined',
        { simulated: true },
      ),
    );

    expect(hooks.guard).toHaveBeenCalledTimes(1);
  });

  it.each(['approved', 'needs_review'] as const)('leaves a move to %s alone', async (to) => {
    const id = await inquiryIn('completed');

    await performInquiryAction(api.deps, actingAs(KEY), id, to);

    expect(hooks.guard).not.toHaveBeenCalled();
  });

  it('stops the decline, with nothing recorded and nothing moved', async () => {
    const id = await inquiryIn('needs_review');
    hooks.guard.mockRejectedValueOnce(new Error('human review pending'));

    await expect(performInquiryAction(api.deps, actingAs(KEY), id, 'declined')).rejects.toThrow(
      'human review pending',
    );

    expect(hooks.record).not.toHaveBeenCalled();
    expect(await statusOf(id)).toBe('needs_review');
  });
});

describe('the reopen edge (C128.6)', () => {
  it('moves a declined inquiry back to review, recorded, with its own event', async () => {
    const id = await inquiryIn('declined');

    const { inquiry, staged } = await reopen(id);
    await api.events.dispatch(staged);

    expect(inquiry.status).toBe('needs_review');
    expect(await statusOf(id)).toBe('needs_review');
    expect(hooks.record.mock.calls[0]?.[2]).toMatchObject({
      kind: 'reopen',
      actor: USER,
      decision: { comment: 'Reviewed by a person' },
    });
    const about = (name: string) =>
      api.events
        .named(name as 'inquiry.reopened')
        .filter((event) => event.payload.data.id === id);
    expect(about('inquiry.reopened')).toHaveLength(1);
    expect(about('inquiry.marked-for-review')).toEqual([]);
    expect(api.audit.entries.map((entry) => entry.action)).toContain('inquiry.reopened');
  });

  it('refuses an API key, whatever scopes it holds', async () => {
    const id = await inquiryIn('declined');

    await expect(reopen(id, KEY)).rejects.toThrow(ForbiddenError);

    expect(await statusOf(id)).toBe('declined');
    expect(hooks.record).not.toHaveBeenCalled();
  });

  it('refuses a run: only a person reopens', async () => {
    const id = await inquiryIn('declined');

    await expect(reopen(id, { type: 'workflow-run', id: newId('wfr') })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('answers 410 for a redacted inquiry, which the conditional update does not cover', async () => {
    const id = await inquiryIn('declined');
    await redactInquiryRecords(api.database.db, api.environmentId, id, { at: new Date() });

    await expect(reopen(id)).rejects.toThrow(RedactedError);

    expect(await statusOf(id)).toBe('declined');
  });

  it.each(['completed', 'approved', 'needs_review'] as const)(
    'refuses an inquiry that is %s',
    async (status) => {
      const id = await inquiryIn(status);

      await expect(reopen(id)).rejects.toThrow('cannot move');
    },
  );

  it('stays closed to the mark-for-review route', async () => {
    const id = await inquiryIn('declined');

    await expect(performInquiryAction(api.deps, actingAs(), id, 'needs_review')).rejects.toThrow(
      'cannot move from declined to needs_review',
    );
  });
});

describe('the routes say what the caller declared', () => {
  const post = (id: string, action: string, payload: Record<string, unknown>) =>
    api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${id}/${action}`,
      headers: bearer(api.token),
      payload,
    });

  it.each([
    ['approve', { 'solely-automated': false, comment: 'Synthetic' }],
    ['decline', { 'solely-automated': true, comment: 'Synthetic' }],
    ['mark-for-review', { comment: 'Synthetic' }],
  ] as const)('%s passes its meta on', async (action, meta) => {
    const id = await inquiryIn('completed');

    const response = await post(id, action, { meta });

    expect(response.statusCode).toBe(200);
    expect(hooks.record.mock.calls[0]?.[2]).toMatchObject({
      decision: {
        comment: meta.comment,
        ...('solely-automated' in meta ? { solelyAutomated: meta['solely-automated'] } : {}),
      },
    });
  });
});
