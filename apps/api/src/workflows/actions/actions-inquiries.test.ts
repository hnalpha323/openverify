/**
 * Workflow 8A Stage 3 (`api-actions`; C127.1, C128, outcomes 6 and 19): the inquiry decisions, from
 * claim to completion on the real engine: each outcome, each refusal, the record a run writes, the
 * gates of a production decline, and a redacted subject reached through `inquiry.expired`. Synthetic.
 */
import {
  getInquiry,
  redactInquiryRecords,
  transitionInquiryStatus,
  type Inquiry,
} from '@openverify/db';
import { createTestInquiry, seedReport, seedReportTemplate, testId } from '@openverify/db/testing';
import type { InquiryStatus } from '@openverify/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definitionOf, edge, output } from '../engine/testing.js';
import { action, chain, createActionHarness, stepOf, type ActionHarness } from './testing.js';

let sandbox: ActionHarness;
let production: ActionHarness;

beforeAll(async () => {
  sandbox = await createActionHarness();
  production = await createActionHarness({ environmentKind: 'production' });
}, 120_000);

afterAll(async () => {
  await sandbox.close();
  await production.close();
});

const PATHS: Partial<Record<InquiryStatus, InquiryStatus[]>> = {
  created: [],
  completed: ['pending', 'completed'],
  failed: ['pending', 'failed'],
  needs_review: ['pending', 'completed', 'needs_review'],
  approved: ['pending', 'completed', 'approved'],
  declined: ['pending', 'completed', 'declined'],
  expired: ['expired'],
};

async function inquiryIn(harness: ActionHarness, status: InquiryStatus): Promise<Inquiry> {
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
  let from: InquiryStatus = 'created';
  for (const to of PATHS[status] ?? []) {
    await transitionInquiryStatus(harness.db, harness.environmentId, inquiry.id, { from, to });
    from = to;
  }
  return inquiry;
}

const decide = (key: string, inquiryId: string, more: Record<string, unknown> = {}) =>
  chain([action('decide', key, { 'inquiry-id': inquiryId, ...more })]);

const statusOf = async (harness: ActionHarness, id: string) =>
  (await getInquiry(harness.db, harness.environmentId, id))?.status;

const outputOf = async (harness: ActionHarness, runId: string) =>
  (await stepOf(harness, runId, 'decide')).errorCode;

describe('approve_inquiry (C127.1)', () => {
  it('approves, and writes a record naming the run', async () => {
    const inquiry = await inquiryIn(sandbox, 'completed');
    const run = await sandbox.run(decide('approve_inquiry', inquiry.id));
    expect(run.status).toBe('completed');
    expect(await statusOf(sandbox, inquiry.id)).toBe('approved');
    expect(await sandbox.decisions(inquiry.id)).toMatchObject([
      {
        kind: 'approve',
        actorType: 'workflow-run',
        actorId: run.id,
        run: { nodeId: 'decide' },
        solelyAutomated: true,
      },
    ]);
  });

  it('reads an inquiry already approved as no_change, with no record', async () => {
    const inquiry = await inquiryIn(sandbox, 'approved');
    const run = await sandbox.run(decide('approve_inquiry', inquiry.id));
    expect(run.status).toBe('completed');
    expect(await sandbox.decisions(inquiry.id)).toEqual([]);
  });

  it('reads an inquiry another actor declined as already_decided', async () => {
    const inquiry = await inquiryIn(sandbox, 'declined');
    const run = await sandbox.run(decide('approve_inquiry', inquiry.id));
    expect(run.status).toBe('completed');
    expect(await statusOf(sandbox, inquiry.id)).toBe('declined');
  });

  it('ends with invalid_transition from a status the machine refuses', async () => {
    const inquiry = await inquiryIn(sandbox, 'created');
    const run = await sandbox.run(decide('approve_inquiry', inquiry.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'invalid_transition' });
  });

  it('answers object_not_found for an inquiry of another environment (C121.6)', async () => {
    const other = await inquiryIn(production, 'completed');
    const run = await sandbox.run(decide('approve_inquiry', other.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'object_not_found' });
    expect(await statusOf(production, other.id)).toBe('completed');
  });

  it('refuses a review that an errored report caused (C127.1)', async () => {
    const inquiry = await inquiryIn(sandbox, 'needs_review');
    const template = await seedReportTemplate(sandbox.db, sandbox.environmentId);
    await seedReport(sandbox.db, sandbox.environmentId, {
      ...template,
      inquiryId: inquiry.id,
      status: 'errored',
    });
    const run = await sandbox.run(decide('approve_inquiry', inquiry.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'review_required' });
    expect(await statusOf(sandbox, inquiry.id)).toBe('needs_review');
  });

  it('approves a plain review with no such cause', async () => {
    const inquiry = await inquiryIn(sandbox, 'needs_review');
    expect((await sandbox.run(decide('approve_inquiry', inquiry.id))).status).toBe('completed');
  });
});

describe('a redacted subject (outcome 6)', () => {
  const redacted = async (status: InquiryStatus) => {
    const inquiry = await inquiryIn(sandbox, status);
    await redactInquiryRecords(sandbox.db, sandbox.environmentId, inquiry.id, { at: new Date() });
    return inquiry;
  };

  it.each(['approve_inquiry', 'decline_inquiry', 'mark_inquiry_for_review'])(
    '%s ends with subject_redacted and writes no record',
    async (key) => {
      const inquiry = await redacted('expired');
      const run = await sandbox.run(decide(key, inquiry.id));
      expect(run).toMatchObject({ status: 'errored', errorCode: 'subject_redacted' });
      expect(await sandbox.decisions(inquiry.id)).toEqual([]);
    },
  );
});

describe('decline_inquiry (C127.1, C128)', () => {
  const declared = {
    'decision-basis': 'contract',
    'contest-route': { contact: 'review@example.com' },
    'biometric-basis': 'substantial-public-interest',
  };

  it('declines in production with its basis, and says it was solely automated', async () => {
    const inquiry = await inquiryIn(production, 'completed');
    const run = await production.run(decide('decline_inquiry', inquiry.id, declared));
    expect(run.status).toBe('completed');
    expect(await statusOf(production, inquiry.id)).toBe('declined');
    expect(await production.decisions(inquiry.id)).toMatchObject([
      { kind: 'decline', solelyAutomated: true, decisionBasis: 'contract' },
    ]);
  });

  it('stops in production without a basis, and sends the inquiry to review (C128.3)', async () => {
    const inquiry = await inquiryIn(production, 'completed');
    const run = await production.run(decide('decline_inquiry', inquiry.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'decision_basis_missing' });
    expect(await statusOf(production, inquiry.id)).toBe('needs_review');
    expect(await production.decisions(inquiry.id)).toMatchObject([
      { kind: 'review', errorCode: 'decision_basis_missing' },
    ]);
  });

  it('declines in a sandbox without one', async () => {
    const inquiry = await inquiryIn(sandbox, 'completed');
    expect((await sandbox.run(decide('decline_inquiry', inquiry.id))).status).toBe('completed');
  });

  it('checks the consents of an explicit-consent decision (C128.4)', async () => {
    const inquiry = await inquiryIn(production, 'completed');
    const run = await production.run(
      decide('decline_inquiry', inquiry.id, {
        ...declared,
        'biometric-basis': 'explicit-consent',
      }),
    );
    expect(run).toMatchObject({ status: 'errored', errorCode: 'biometric_consent_missing' });
    expect(await statusOf(production, inquiry.id)).toBe('needs_review');
  });

  it('cannot decline while a person is reviewing (C128.6)', async () => {
    const inquiry = await inquiryIn(sandbox, 'needs_review');
    await sandbox.database.client.query(
      `insert into inquiry_decisions (id, environment_id, kind, subject_type, subject_id,
         actor_type, actor_id, human_review_pending)
       values ($1, $2, 'reopen', 'inquiry', $3, 'user', $4, true)`,
      [testId('idec'), sandbox.environmentId, inquiry.id, testId('usr')],
    );
    const run = await sandbox.run(decide('decline_inquiry', inquiry.id));
    expect(run).toMatchObject({ status: 'errored', errorCode: 'human_review_pending' });
    expect(await outputOf(sandbox, run.id)).toBe('human_review_pending');
  });
});

describe('mark_inquiry_for_review (C127.1)', () => {
  it('writes a review row, with its comment sealed', async () => {
    const inquiry = await inquiryIn(sandbox, 'completed');
    const run = await sandbox.run(
      decide('mark_inquiry_for_review', inquiry.id, { comment: 'A synthetic note' }),
    );
    expect(run.status).toBe('completed');
    expect(await sandbox.decisions(inquiry.id)).toMatchObject([
      { kind: 'review', comment: 'A synthetic note' },
    ]);
  });

  it('leaves a decided inquiry alone: no double transition (C127.11)', async () => {
    const inquiry = await inquiryIn(sandbox, 'needs_review');
    const run = await sandbox.run(decide('mark_inquiry_for_review', inquiry.id));
    expect(run.status).toBe('completed');
    expect(await sandbox.decisions(inquiry.id)).toEqual([]);
  });
});

describe('a defaulted Calculate in a decision’s evidence (C127.10, H21)', () => {
  it('names the step, so the record says a default fed the decision', async () => {
    const inquiry = await inquiryIn(sandbox, 'completed');
    const definition = chain([
      action('score', 'calculate', {
        operator: 'divide',
        operands: [1, 0],
        default: 0,
      }),
      action('decline', 'decline_inquiry', { 'inquiry-id': inquiry.id }),
    ]);

    const run = await sandbox.run(definition);

    expect(run.status).toBe('completed');
    const [decision] = await sandbox.decisions(inquiry.id);
    expect(decision?.evidence).toContainEqual(
      expect.objectContaining({ kind: 'step', name: 'score', status: 'defaulted' }),
    );
  });
});

describe('a decision on a catch-all route (Workflow 8C review R001)', () => {
  it('declines through the route that has no condition, and writes its record', async () => {
    const inquiry = await inquiryIn(sandbox, 'completed');
    const definition = definitionOf(
      [
        {
          id: 'choose',
          type: 'conditional',
          name: 'Choose',
          routes: [
            { key: 'never', label: 'Never', condition: { '===': [1, 2] } },
            { key: 'rest', label: 'The rest' },
          ],
        },
        action('approve', 'approve_inquiry', { 'inquiry-id': inquiry.id }),
        action('decline', 'decline_inquiry', { 'inquiry-id': inquiry.id }),
        output(),
      ],
      [
        edge('trigger', 'choose'),
        edge('choose', 'approve', 'route:never'),
        edge('choose', 'decline', 'route:rest'),
        edge('choose', 'output', 'else'),
        edge('approve', 'output'),
        edge('decline', 'output'),
      ],
    );

    const run = await sandbox.run(definition);

    expect((await stepOf(sandbox, run.id, 'decline')).errorCode).toBeNull();
    expect(run.status).toBe('completed');
    expect(await statusOf(sandbox, inquiry.id)).toBe('declined');
    const [decision] = await sandbox.decisions(inquiry.id);
    expect(decision).toMatchObject({ kind: 'decline', run: { nodeId: 'decline' } });
  });
});
