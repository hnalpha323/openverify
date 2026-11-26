/**
 * Workflow 7A Stage 1b (H) (C96.1, C96.3; P15, V02, F30): the two shared hooks of device handoff,
 * replaced here by switchable spies (`flow-handoff` builds them).
 *
 * - `handoffReviewAfterTransitionInTx` is asked after every move `transitionInquiryInTx` applied,
 *   in its transaction. An answer of `needs_review` on a move into `completed` follows it with
 *   `completed -> needs_review` in the same transaction (a rejected handoff's finished
 *   verifications route the inquiry to review when it completes), with both moves' events.
 * - `handoffPublishProblems` runs when a template is created and when a version is published, with
 *   the flow and the environment; its first problem's code answers 422 with every pointer
 *   (`sms_not_configured`, `display_name_required`).
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandoffTransition } from './handoff/review.js';
import type { HandoffPublishContext } from './publish/handoff.js';
import { bearer, createInquiry, expectStatus } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

const control = vi.hoisted(() => ({
  review: false,
  refuse: false,
  transitions: [] as { from: string; to: string; status: string }[],
  publishes: [] as { kind: string; steps: number }[],
}));

vi.mock('./handoff/review.js', () => ({
  handoffReviewAfterTransitionInTx: (_tx: unknown, transition: HandoffTransition) => {
    control.transitions.push({
      from: transition.from,
      to: transition.to,
      status: transition.inquiry.status,
    });
    return Promise.resolve(control.review && transition.to === 'completed' ? 'needs_review' : null);
  },
}));

vi.mock('./publish/handoff.js', () => ({
  handoffPublishProblems: (ctx: HandoffPublishContext) => {
    control.publishes.push({ kind: ctx.environment.kind, steps: ctx.flow.steps.length });
    return Promise.resolve(
      control.refuse
        ? [
            {
              code: 'display_name_required',
              pointer: '/data/attributes/flow/steps/1',
              detail: 'needs the organization display name',
            },
          ]
        : [],
    );
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
  control.review = false;
  control.refuse = false;
  control.transitions.length = 0;
  control.publishes.length = 0;
});

const simulate = (id: string, types: readonly string[]) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${id}/perform-simulate-actions`,
    headers: bearer(api.token),
    payload: { meta: { actions: types.map((type) => ({ type })) } },
  });

async function statusOf(inquiryId: string): Promise<string | undefined> {
  const { rows } = await api.database.client.query<{ status: string }>(
    'select status from inquiries where id = $1',
    [inquiryId],
  );
  return rows[0]?.status;
}

const eventNames = (inquiryId: string) =>
  api.events.events
    .filter((event) => JSON.stringify(event.payload).includes(inquiryId))
    .map((event) => event.name);

describe('the rejected-handoff review hook (C96.3, V02)', () => {
  it('is asked after every applied move, and asks for nothing until built', async () => {
    const id = await createInquiry(api, {});

    expectStatus(await simulate(id, ['start_inquiry', 'complete_inquiry']), 200);

    expect(await statusOf(id)).toBe('completed');
    expect(control.transitions).toEqual([
      { from: 'created', to: 'pending', status: 'pending' },
      { from: 'pending', to: 'completed', status: 'completed' },
    ]);
  });

  it('follows a move into completed with completed -> needs_review when it answers so', async () => {
    const id = await createInquiry(api, {});
    control.review = true;

    expectStatus(await simulate(id, ['start_inquiry', 'complete_inquiry']), 200);

    expect(await statusOf(id)).toBe('needs_review');
    const names = eventNames(id);
    expect(names.indexOf('inquiry.marked-for-review')).toBeGreaterThan(
      names.indexOf('inquiry.completed'),
    );
    expect(names).toContain('inquiry.completed');
  });
});

describe('the handoff publish rules (C96.1, F30)', () => {
  const create = () =>
    api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiry-templates',
      headers: bearer(api.token),
      payload: {
        data: { type: 'inquiry-template', attributes: defaultInquiryTemplateAttributes() },
      },
    });

  it('run on create with the flow and the environment, and refuse nothing until built', async () => {
    expectStatus(await create(), 201);

    expect(control.publishes).toEqual([{ kind: 'sandbox', steps: 5 }]);
  });

  it("answer the first problem's code with every pointer", async () => {
    control.refuse = true;

    const response = await create();

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'display_name_required',
      errors: [{ pointer: '/data/attributes/flow/steps/1' }],
    });
  });
});
