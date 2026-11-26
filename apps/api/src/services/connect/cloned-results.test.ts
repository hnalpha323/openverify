/**
 * C235.4, C235.7 (Workflow 11A, `api-redeem` checkpoint 3; review H02, H07): what a cloned
 * verification counts for at the destination, read through the hooks `foundation-11a` placed.
 *
 * - Off (the default): no clone counts, and a cloned inquiry goes to review.
 * - On: a clone counts only when its type is listed, it passed, its source decided less than
 *   `max-age-days` before the destination's decision (not the redemption) and its destination-side
 *   consent was not withdrawn by then; a cloned failure never counts and routes the inquiry to review.
 * - The decision record names the token and `relied-on-cloned` when a counted clone exists.
 * - Every `inquiry.*` read and event of a copy carries `provenance` (C235.7(a)).
 *
 * Synthetic rows only (rule 9).
 */
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createVerification,
  getInquiry,
  getInquiryDecision,
  listInquiryVerifications,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
  type Inquiry,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import type { Flow } from '@openverify/flow-spec';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../../jobs/testing.js';
import { ulidIdGenerator } from '../../ports.js';
import { createRecordingEventPublisher, fixedClock } from '../../test-support/fakes.js';
import { recordInquiryDecisionInTx } from '../decisions/record.js';
import { inquiryResourceOf } from '../inquiries.js';
import { settleInquiry } from '../inquiry-settlement.js';
import {
  acceptClonedResultsOf,
  clonedInquiryReview,
  clonedRelianceOf,
  clonedVerdictOf,
  countedVerifications,
  servedProvenance,
  verificationCountsInWorkflows,
  withInquiryProvenance,
} from './cloned-results.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

/** The value, or a failed test when it is missing. */
function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('the test expected a value');
  }
  return value;
}

const DAY = 86_400_000;
const NOW = new Date('2026-11-12T10:00:00.000Z');
const TOKEN = 'cnst_01M5CN0000000000000011A300';

const cloneProvenance = (more: Record<string, unknown> = {}) => ({
  kind: 'connect-clone',
  'share-token-id': TOKEN,
  'source-organization-name': 'Example Partner',
  'source-environment-kind': 'sandbox',
  'source-created-at': '2026-11-01T10:00:00.000Z',
  'source-status': 'passed',
  'cloned-at': '2026-11-02T10:00:00.000Z',
  ...more,
});

/** A government ID only flow (the default without the selfie step). */
function governmentIdFlow(): { flow: Flow; config: Record<string, unknown> } {
  const attributes = defaultInquiryTemplateAttributes();
  const flow: Flow = {
    ...attributes.flow,
    steps: attributes.flow.steps.filter((step) => step.type !== 'selfie'),
  };
  const config: Record<string, unknown> = { ...attributes['verification-config'] };
  delete config.selfie;
  return { flow, config };
}

async function inquiryWith(accept: unknown): Promise<{ inquiry: Inquiry; flow: Flow }> {
  const { flow, config } = governmentIdFlow();
  const { inquiry } = await createTestInquiry(db, environmentId, {
    flow,
    verificationConfig: config,
  });
  if (accept !== undefined) {
    await db.execute(sql`update inquiry_template_versions
      set settings = jsonb_build_object('accept-cloned-results', ${JSON.stringify(accept)}::jsonb)
      where id = ${inquiry.inquiryTemplateVersionId}`);
  }
  return { inquiry, flow };
}

const ACCEPT_ID = { 'verification-types': ['government-id'], 'max-age-days': 30 };

async function verification(
  inquiryId: string,
  options: {
    status?: 'passed' | 'failed';
    type?: 'government_id' | 'email_address';
    provenance?: Record<string, unknown> | null;
    decidedAt?: Date;
  } = {},
): Promise<string> {
  const id = newId('ver');
  await createVerification(db, environmentId, {
    id,
    inquiryId,
    type: options.type ?? 'government_id',
  });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, id, {
    to: options.status ?? 'passed',
    at: options.decidedAt ?? new Date(NOW.getTime() - 2 * DAY),
  });
  if (options.provenance !== undefined && options.provenance !== null) {
    await db.execute(
      sql`update verifications set provenance = ${JSON.stringify(options.provenance)}::jsonb
        where id = ${id}`,
    );
  }
  return id;
}

const counted = async (inquiry: Inquiry, now = NOW) =>
  (
    await countedVerifications(
      db,
      inquiry,
      await listInquiryVerifications(db, environmentId, inquiry.id),
      now,
    )
  ).map(({ id }) => id);

describe('the version setting (C235.3)', () => {
  it('is off when absent, null or unreadable, and read as stored otherwise', async () => {
    expect(await acceptClonedResultsOf(db, (await inquiryWith(undefined)).inquiry)).toBeNull();
    expect(await acceptClonedResultsOf(db, (await inquiryWith(null)).inquiry)).toBeNull();
    expect(
      await acceptClonedResultsOf(db, (await inquiryWith({ 'max-age-days': 0 })).inquiry),
    ).toBeNull();
    expect(await acceptClonedResultsOf(db, (await inquiryWith(ACCEPT_ID)).inquiry)).toEqual(
      ACCEPT_ID,
    );
  });
});

describe('countedVerifications (C235.4)', () => {
  it('counts no clone while the setting is off, and every verification the destination ran', async () => {
    const { inquiry } = await inquiryWith(undefined);
    const own = await verification(inquiry.id);
    await verification(inquiry.id, { provenance: cloneProvenance() });
    expect(await counted(inquiry)).toEqual([own]);
  });

  it('counts a fresh, listed, passed clone while the setting is on', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    const clone = await verification(inquiry.id, { provenance: cloneProvenance() });
    expect(await counted(inquiry)).toEqual([clone]);
  });

  it('does not count a clone of a type the setting does not list', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    await verification(inquiry.id, { type: 'email_address', provenance: cloneProvenance() });
    expect(await counted(inquiry)).toEqual([]);
  });

  it('measures the age at the destination’s decision, not at the redemption (review H07)', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    const decidedAt = new Date(NOW.getTime() - 29 * DAY);
    const clone = await verification(inquiry.id, { provenance: cloneProvenance(), decidedAt });
    expect(await counted(inquiry, NOW)).toEqual([clone]);
    expect(await counted(inquiry, new Date(NOW.getTime() + DAY))).toEqual([]);
  });

  it('stops counting a clone from its destination consent’s withdrawal (C237.6 (2))', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    const withdrawnAt = new Date(NOW.getTime() - DAY).toISOString();
    await verification(inquiry.id, {
      provenance: cloneProvenance({ 'consent-withdrawn-at': withdrawnAt }),
    });
    expect(await counted(inquiry)).toEqual([]);
    expect(await counted(inquiry, new Date(NOW.getTime() - 2 * DAY))).toHaveLength(1);
  });

  it('never counts a cloned failure', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    await verification(inquiry.id, { status: 'failed', provenance: cloneProvenance() });
    expect(await counted(inquiry)).toEqual([]);
  });

  it('falls back to the source’s creation time when the clone kept no decision time', () => {
    const verdict = clonedVerdictOf(
      { 'verification-types': ['government-id'], 'max-age-days': 5 },
      {
        type: 'government_id',
        status: 'passed',
        completedAt: null,
        provenance: cloneProvenance({ 'source-created-at': '2026-11-01T10:00:00.000Z' }),
      },
      NOW,
    );
    expect(verdict).toEqual({ use: 'ignore', reason: 'too_old' });
  });
});

describe('a cloned inquiry’s outcome (C235.4)', () => {
  it('is the destination’s alone for an inquiry without a clone', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    await verification(inquiry.id);
    expect(await clonedInquiryReview(db, inquiry, NOW)).toBeNull();
  });

  it('is review while the setting is off, whatever the source’s status', async () => {
    const { inquiry } = await inquiryWith(undefined);
    await verification(inquiry.id, { provenance: cloneProvenance() });
    expect(await clonedInquiryReview(db, inquiry, NOW)).toEqual({
      status: 'needs_review',
      reason: 'accept_cloned_results_off',
    });
  });

  it('is review on a fresh, listed cloned failure, never a decline (review H07)', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    await verification(inquiry.id, { status: 'failed', provenance: cloneProvenance() });
    expect(await clonedInquiryReview(db, inquiry, NOW)).toEqual({
      status: 'needs_review',
      reason: 'cloned_failure',
    });
  });

  it('is the destination’s rules with a counted pass', async () => {
    const { inquiry } = await inquiryWith(ACCEPT_ID);
    await verification(inquiry.id, { provenance: cloneProvenance() });
    expect(await clonedInquiryReview(db, inquiry, NOW)).toEqual({ status: 'destination_rules' });
  });
});

describe('the settlement with the setting on (C235.4, through foundation-11a’s hook)', () => {
  it('completes on a counted cloned pass, and not while the setting is off', async () => {
    const deps = {
      db,
      events: createRecordingEventPublisher(),
      clock: fixedClock(NOW),
      logger: createCapturingLogger(),
    };
    for (const [accept, expected] of [
      [ACCEPT_ID, 'completed'],
      [undefined, 'pending'],
    ] as const) {
      const { inquiry, flow } = await inquiryWith(accept);
      await transitionInquiryStatus(db, environmentId, inquiry.id, {
        from: 'created',
        to: 'pending',
      });
      await verification(inquiry.id, { provenance: cloneProvenance() });
      await expect(settleInquiry(deps, environmentId, inquiry.id, flow)).resolves.toBe(expected);
    }
  });
});

describe('Phase 8’s reads of a clone (C235.7(b))', () => {
  it('see a clone only when C235.4 counts it, at the time given', async () => {
    const off = await inquiryWith(undefined);
    const on = await inquiryWith(ACCEPT_ID);
    const offClone = await verification(off.inquiry.id, { provenance: cloneProvenance() });
    const onClone = await verification(on.inquiry.id, { provenance: cloneProvenance() });
    const own = await verification(off.inquiry.id);
    const rows = await listInquiryVerifications(db, environmentId, off.inquiry.id);
    const onRows = await listInquiryVerifications(db, environmentId, on.inquiry.id);
    const row = (id: string) => must([...rows, ...onRows].find((candidate) => candidate.id === id));
    expect(await verificationCountsInWorkflows(db, row(own), NOW)).toBe(true);
    expect(await verificationCountsInWorkflows(db, row(offClone), NOW)).toBe(false);
    expect(await verificationCountsInWorkflows(db, row(onClone), NOW)).toBe(true);
    expect(
      await verificationCountsInWorkflows(db, row(onClone), new Date(NOW.getTime() + 60 * DAY)),
    ).toBe(false);
  });
});

describe('the decision record names a counted clone (C235.4; Phase 8 C128.1)', () => {
  it('reads the reliance', async () => {
    const on = await inquiryWith(ACCEPT_ID);
    await verification(on.inquiry.id, { provenance: cloneProvenance() });
    expect(await clonedRelianceOf(db, on.inquiry, NOW)).toEqual({
      reliedOnCloned: true,
      shareTokenId: TOKEN,
    });
    const off = await inquiryWith(undefined);
    await verification(off.inquiry.id, { provenance: cloneProvenance() });
    expect(await clonedRelianceOf(db, off.inquiry, NOW)).toEqual({
      reliedOnCloned: false,
      shareTokenId: null,
    });
  });

  it.each([
    [ACCEPT_ID, true, TOKEN],
    [undefined, false, null],
  ])('writes relied-on-cloned and the share token (setting %j)', async (accept, relied, token) => {
    const { inquiry } = await inquiryWith(accept);
    await verification(inquiry.id, { provenance: cloneProvenance() });
    const id = newId('idec');
    await db.transaction(async (tx) => {
      await recordInquiryDecisionInTx(
        tx,
        { ids: ulidIdGenerator, clock: fixedClock(NOW) },
        {
          inquiry: must(await getInquiry(tx, environmentId, inquiry.id)),
          kind: 'approve',
          actor: { type: 'user', id: 'usr_01M5CN0000000000000011A301' },
          decision: { id },
        },
      );
    });
    const stored = await getInquiryDecision(db, environmentId, id);
    expect(stored).toMatchObject({ reliedOnCloned: relied, shareTokenId: token });
  });
});

describe('provenance on inquiry reads and events (C235.7(a))', () => {
  it('serves a copy’s provenance and nothing on any other inquiry', async () => {
    const { inquiry } = await inquiryWith(undefined);
    const plain = await inquiryResourceOf(db, environmentId, inquiry);
    expect(plain.attributes).not.toHaveProperty('provenance');
    await db.execute(sql`update inquiries set provenance = ${JSON.stringify(cloneProvenance())}::jsonb
      where id = ${inquiry.id}`);
    const copy = must(await getInquiry(db, environmentId, inquiry.id));
    const served = await inquiryResourceOf(db, environmentId, copy);
    expect(served.attributes.provenance).toEqual(cloneProvenance());
    expect(withInquiryProvenance(plain, copy).attributes.provenance).toEqual(cloneProvenance());
    expect(withInquiryProvenance(plain, inquiry)).toBe(plain);
  });

  it('serves no provenance that does not parse (fails closed to absent)', () => {
    expect(servedProvenance(null)).toBeUndefined();
    expect(servedProvenance({ kind: 'connect-clone' })).toBeUndefined();
    expect(servedProvenance(cloneProvenance())).toEqual(cloneProvenance());
  });
});
