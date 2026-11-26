/**
 * C151.14 (review F08; Workflow 9A, api-flow-engine, checkpoint "outcome"): an inquiry with no
 * position pinned to a flow-spec 1 version (every inquiry at the migration, and the test factories)
 * is positioned once, on its next flow request, by replaying the migrated flow from `entry` over its
 * stored facts, recorded with the note `position_backfilled`, so it keeps the verifications it has
 * done. One test per factory path: `createTestInquiry` of `@openverify/db/testing` and the API
 * harness's `createInquiry` (`POST /inquiries`). Every value is synthetic.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import {
  getInquiry,
  listInquiryFlowSteps,
  lockInquiry,
  transitionInquiryStatus,
} from '@openverify/db';
import { createTestInquiry } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  resumeInquiry,
  seedVerification,
} from '../test-support/harness.js';
import { positionFlowInTx } from './position.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const CONSENT_BODY = {
  accepted: true,
  'text-keys': ['consent.biometric', 'consent.processing', 'notice.session-integrity'],
  locale: 'en',
};

async function position(inquiryId: string): Promise<void> {
  const advance = await api.database.db.transaction(async (tx) => {
    await lockInquiry(tx, api.environmentId, inquiryId);
    return positionFlowInTx(tx, api.deps, { environmentId: api.environmentId, inquiryId });
  });
  await api.deps.events.dispatch(advance.staged);
}

const recordOf = async (inquiryId: string) =>
  (await listInquiryFlowSteps(api.database.db, api.environmentId, inquiryId)).map((entry) => ({
    stepId: entry.stepId,
    exitPort: entry.exitPort,
    notes: entry.notes,
  }));

describe('the backfill of a v1 inquiry (C151.14)', () => {
  it('replays an inquiry of createTestInquiry that passed its ID before the engine existed', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId, {
      flow: defaultInquiryTemplateAttributes().flow,
    });
    await transitionInquiryStatus(api.database.db, api.environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    await seedVerification(api, api.environmentId, inquiry.id, {
      type: 'government_id',
      status: 'passed',
    });
    await position(inquiry.id);
    const stored = await getInquiry(api.database.db, api.environmentId, inquiry.id);
    // No consent was recorded, so the replay stops at the consent step: the ID is kept and passed
    // over once the person consents.
    expect(stored).toMatchObject({ flowStepId: 'consent', flowSpecVersion: 1, status: 'pending' });
    expect(await recordOf(inquiry.id)).toEqual([
      { stepId: 'consent', exitPort: null, notes: ['position_backfilled'] },
    ]);
  });

  it('positions an inquiry of the harness on its consent, and replays past its passed ID', async () => {
    const inquiryId = await createInquiry(api);
    await seedVerification(api, api.environmentId, inquiryId, {
      type: 'government_id',
      status: 'passed',
    });
    const token = await resumeInquiry(api, inquiryId);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/consent',
        headers: bearer(token),
        payload: CONSENT_BODY,
      }),
      201,
    );
    expect(await getInquiry(api.database.db, api.environmentId, inquiryId)).toMatchObject({
      flowStepId: 'selfie',
      flowPreviousStepId: 'government_id',
      flowSpecVersion: 1,
    });
    const entries = await recordOf(inquiryId);
    expect(entries.map((entry) => [entry.stepId, entry.exitPort])).toEqual([
      ['consent', 'next'],
      ['government_id', 'next'],
      // The default flow's v1 transitions, migrated into a branch (C147.10).
      ['government_id-routes', 'else'],
      ['selfie', null],
    ]);
    expect(entries[0]?.notes).toEqual(['position_backfilled']);
  });

  it('positions a fresh harness inquiry at entry with no backfill note', async () => {
    const inquiryId = await createInquiry(api);
    await position(inquiryId);
    expect(await recordOf(inquiryId)).toEqual([{ stepId: 'consent', exitPort: null, notes: [] }]);
  });
});
