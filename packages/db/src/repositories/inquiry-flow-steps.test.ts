/**
 * C151.1 (Workflow 9A, api-flow-engine): the step record and the inquiry's position. Entries get
 * the inquiry's next `seq` (1, 2, ...), stay open until their exit is recorded once, and are read
 * oldest first; the position, the `flow-outcome`, the first device and the expiry are moved on the
 * inquiry's own row, in its environment only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '../testing.js';
import {
  appendInquiryFlowStepInTx,
  exitInquiryFlowStepInTx,
  getInquiry,
  listInquiryFlowSteps,
  setInquiryExpiresAtInTx,
  setInquiryFirstDeviceInTx,
  setInquiryFlowOutcomeInTx,
  setInquiryFlowPositionInTx,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const AT = new Date('2026-11-04T10:00:00.000Z');
const LATER = new Date('2026-11-04T10:00:05.000Z');

async function newInquiry() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id };
}

describe('the step record', () => {
  it('appends entries with the next seq, open until their exit, oldest first', async () => {
    const { environmentId, inquiryId } = await newInquiry();
    const first = await appendInquiryFlowStepInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'consent',
      stepType: 'consent',
      enteredAt: AT,
    });
    const second = await appendInquiryFlowStepInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'id_card',
      stepType: 'government_id',
      enteredAt: LATER,
      notes: ['position_backfilled'],
    });
    expect(first).toMatchObject({ seq: 1, stepId: 'consent', exitedAt: null, exitPort: null });
    expect(second).toMatchObject({ seq: 2, notes: ['position_backfilled'], sensitive: false });

    const exited = await exitInquiryFlowStepInTx(database.db, environmentId, inquiryId, 1, {
      exitedAt: LATER,
      exitPort: 'next',
      outcome: 'recorded',
      sensitive: false,
      notes: ['on-null-review'],
    });
    expect(exited).toMatchObject({
      seq: 1,
      exitPort: 'next',
      outcome: 'recorded',
      exitedAt: LATER,
      notes: ['on-null-review'],
    });
    // An exit is recorded once.
    await expect(
      exitInquiryFlowStepInTx(database.db, environmentId, inquiryId, 1, {
        exitedAt: LATER,
        exitPort: 'else',
        outcome: null,
        sensitive: true,
      }),
    ).resolves.toBeNull();

    const record = await listInquiryFlowSteps(database.db, environmentId, inquiryId);
    expect(record.map((entry) => [entry.seq, entry.stepId, entry.exitPort])).toEqual([
      [1, 'consent', 'next'],
      [2, 'id_card', null],
    ]);
  });

  it('keeps the existing notes and adds the exit notes, with the waited time and the mark', async () => {
    const { environmentId, inquiryId } = await newInquiry();
    await appendInquiryFlowStepInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'route',
      stepType: 'branch',
      enteredAt: AT,
      notes: ['waited_for_facts'],
    });
    const exited = await exitInquiryFlowStepInTx(database.db, environmentId, inquiryId, 1, {
      exitedAt: LATER,
      exitPort: 'route:minor',
      outcome: null,
      waitedMs: 5_000,
      sensitive: true,
      notes: ['review-class-null'],
    });
    expect(exited).toMatchObject({
      waitedMs: 5_000,
      sensitive: true,
      notes: ['waited_for_facts', 'review-class-null'],
    });
  });

  it('reads and writes an inquiry only in its own environment', async () => {
    const { environmentId, inquiryId } = await newInquiry();
    const other = await createTestTenant(database.db);
    await appendInquiryFlowStepInTx(database.db, environmentId, {
      inquiryId,
      stepId: 'consent',
      stepType: 'consent',
      enteredAt: AT,
    });
    expect(await listInquiryFlowSteps(database.db, other.environment.id, inquiryId)).toEqual([]);
    await expect(
      exitInquiryFlowStepInTx(database.db, other.environment.id, inquiryId, 1, {
        exitedAt: LATER,
        exitPort: 'next',
        outcome: null,
        sensitive: false,
      }),
    ).resolves.toBeNull();
  });
});

describe('the position on the inquiry', () => {
  it('moves the position and keeps the outcome, the first device once and the expiry', async () => {
    const { environmentId, inquiryId } = await newInquiry();
    expect(
      await setInquiryFlowPositionInTx(database.db, environmentId, inquiryId, {
        stepId: 'id_card',
        state: 'active',
        previousStepId: 'consent',
        specVersion: 1,
      }),
    ).toBe(true);
    expect(
      await setInquiryFlowOutcomeInTx(database.db, environmentId, inquiryId, {
        verificationTypesOnPath: ['government-id'],
        fallbacksTaken: [],
        flags: [],
      }),
    ).toBe(true);
    expect(
      await setInquiryFirstDeviceInTx(database.db, environmentId, inquiryId, {
        deviceKind: 'mobile-web',
        platform: 'web',
      }),
    ).toBe(true);
    // Written once: a later session never replaces the first one's facts.
    expect(
      await setInquiryFirstDeviceInTx(database.db, environmentId, inquiryId, {
        deviceKind: 'native',
        platform: 'android',
      }),
    ).toBe(false);
    expect(await setInquiryExpiresAtInTx(database.db, environmentId, inquiryId, LATER)).toBe(true);

    expect(await getInquiry(database.db, environmentId, inquiryId)).toMatchObject({
      flowStepId: 'id_card',
      flowState: 'active',
      flowPreviousStepId: 'consent',
      flowSpecVersion: 1,
      flowOutcome: { verificationTypesOnPath: ['government-id'], fallbacksTaken: [], flags: [] },
      firstDeviceKind: 'mobile-web',
      firstPlatform: 'web',
      expiresAt: LATER,
    });
  });

  it('changes nothing in another environment', async () => {
    const { inquiryId } = await newInquiry();
    const other = await createTestTenant(database.db);
    const position = {
      stepId: 'consent',
      state: 'active',
      previousStepId: null,
      specVersion: 2,
    } as const;
    expect(
      await setInquiryFlowPositionInTx(database.db, other.environment.id, inquiryId, position),
    ).toBe(false);
    expect(
      await setInquiryFlowOutcomeInTx(database.db, other.environment.id, inquiryId, {
        verificationTypesOnPath: [],
        fallbacksTaken: [],
        flags: [],
      }),
    ).toBe(false);
    expect(await setInquiryExpiresAtInTx(database.db, other.environment.id, inquiryId, LATER)).toBe(
      false,
    );
  });
});
