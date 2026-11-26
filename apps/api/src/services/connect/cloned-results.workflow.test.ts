/**
 * C235.7(b) (Workflow 11A, `api-redeem` checkpoint 3; review H02): a workflow that routes on a
 * verification's status cannot approve on a clone C235.4 does not count. Phase 8's `fetch_object`
 * answers `object_not_found` for it (foundation-11a's hook, `verificationCountsInWorkflows`), so the
 * approving branch never runs; the same workflow on a verification the destination ran, or on a
 * clone the version's `accept-cloned-results` counts, takes the branch.
 *
 * Synthetic rows only (rule 9).
 */
import { newId } from '@openverify/contracts';
import { createVerification, listAllWorkflowRunSteps, setVerificationStatus } from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createActionHarness, type ActionHarness } from '../../workflows/actions/testing.js';
import { action, definitionOf, drain, edge, output } from '../../workflows/engine/testing.js';

let harness: ActionHarness;

beforeAll(async () => {
  harness = await createActionHarness();
}, 120_000);

afterAll(async () => {
  await harness.close();
});

const CLONE = {
  kind: 'connect-clone',
  'share-token-id': 'cnst_01M5CN0000000000000011A310',
  'source-organization-name': 'Example Partner',
  'source-environment-kind': 'sandbox',
  'source-created-at': '2026-11-01T10:00:00.000Z',
  'source-status': 'passed',
  'cloned-at': '2026-11-02T10:00:00.000Z',
};

/** `got` fetches the verification, `choose` routes on `passed`, `approve` runs on a pass. */
const approveOnPass = (verificationId: string) =>
  definitionOf(
    [
      action('got', 'fetch_object', {
        'object-type': 'verification',
        'object-id': verificationId,
      }),
      {
        id: 'choose',
        type: 'conditional',
        name: 'Choose',
        routes: [
          {
            key: 'hit',
            label: 'Passed',
            condition: { '===': [{ var: 'steps.got.output.object.status' }, 'passed'] },
          },
        ],
      },
      action('approve', 'calculate', { operator: 'add', operands: [1, 1] }),
      output(),
    ],
    [
      edge('trigger', 'got'),
      edge('got', 'choose'),
      edge('choose', 'approve', 'route:hit'),
      edge('choose', 'output', 'else'),
      edge('approve', 'output'),
    ],
  );

async function passedVerification(
  clone: boolean,
  accept: Record<string, unknown> | null,
): Promise<string> {
  const { inquiry } = await createTestInquiry(harness.db, harness.environmentId);
  if (accept !== null) {
    await harness.db.execute(sql`update inquiry_template_versions
      set settings = jsonb_build_object('accept-cloned-results', ${JSON.stringify(accept)}::jsonb)
      where id = ${inquiry.inquiryTemplateVersionId}`);
  }
  const id = newId('ver');
  await createVerification(harness.db, harness.environmentId, {
    id,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  await setVerificationStatus(harness.db, harness.environmentId, id, { to: 'submitted' });
  // The source decided just now, so a listed clone is fresh at the run's clock.
  await setVerificationStatus(harness.db, harness.environmentId, id, {
    to: 'passed',
    at: harness.services.clock.now(),
  });
  if (clone) {
    await harness.db.execute(
      sql`update verifications set provenance = ${JSON.stringify(CLONE)}::jsonb where id = ${id}`,
    );
  }
  return id;
}

const ACCEPT = { 'verification-types': ['government-id'], 'max-age-days': 30 };

describe('a workflow routing on a verification’s status (C235.7(b))', () => {
  it.each([
    ['a verification the destination ran: the approving branch runs', false, null, true],
    [
      'a clone while accept-cloned-results is off: the fetch fails, nothing approves',
      true,
      null,
      false,
    ],
    ['a clone the version counts: the approving branch runs', true, ACCEPT, true],
  ] as const)('%s', async (_name, clone, accept, approves) => {
    const verificationId = await passedVerification(clone, accept);
    const run = await harness.run(approveOnPass(verificationId));
    await drain(harness);
    const steps = await listAllWorkflowRunSteps(harness.db, harness.environmentId, run.id);
    const approve = steps.find(({ nodeId }) => nodeId === 'approve');
    expect(approve?.status === 'succeeded').toBe(approves);
    if (!approves) {
      // fetch_object's `object_not_found` fails the step (the run journals it as an execution error).
      expect(steps.find(({ nodeId }) => nodeId === 'got')?.status).toBe('failed');
    }
  });
});
