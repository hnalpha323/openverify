/**
 * Workflow 11A Stage 1b (R) (`foundation-11a`; C235.4, C235.7; review H02): the hooks through which a
 * cloned verification or check reaches the decision path, Phase 8's condition reads and Phase 9's
 * analytics, each calling `services/connect/cloned-results.ts` (`api-redeem`'s), whose stub answers
 * "not counted" for every clone:
 *
 * - the flow engine (`loadEngine`), the session members (`flowSessionMembers`) and the settlement of an
 *   unpositioned inquiry read only the verifications that count (`countedVerifications`): a clone that
 *   does not count is absent, and every other verification is read as today;
 * - `fetch_object` of a verification answers `object_not_found` for a clone that does not count
 *   (`verificationCountsInWorkflows`);
 * - the analytics rollups leave out every cloned verification and check (a predicate in the rollup
 *   SQL, `rollup-sql.ts`), so a clone never enters a pass rate or a failure distribution.
 *
 * Today no row has a provenance, so every one of them reads as before (the suites around them stay
 * green); a seeded clone shows that each hook is in place.
 */
import { readFileSync } from 'node:fs';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import {
  createVerification,
  getInquiry,
  setVerificationStatus,
  transitionInquiryStatus,
  type Db,
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
import { createRecordingEventPublisher, fixedClock } from '../../test-support/fakes.js';
import { computeCohortRollups } from '../analytics/rollup-sql.js';
import {
  seedAnalyticsInquiry,
  seedAnalyticsTenant,
  seedAnalyticsVerification,
} from '../analytics/testing.js';
import { settleInquiry } from '../inquiry-settlement.js';

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

const CLONE = {
  kind: 'connect-clone',
  'share-token-id': 'cnst_01M5CN0000000000000011A200',
  'source-organization-name': 'Example Partner',
  'source-environment-kind': 'sandbox',
  'source-created-at': '2026-11-01T10:00:00.000Z',
  'source-status': 'passed',
  'cloned-at': '2026-11-02T10:00:00.000Z',
};

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

async function passedGovernmentId(inquiryId: string, cloned: boolean): Promise<string> {
  const id = newId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type: 'government_id' });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, id, { to: 'passed' });
  if (cloned) {
    await db.execute(
      sql`update verifications set provenance = ${JSON.stringify(CLONE)}::jsonb where id = ${id}`,
    );
  }
  return id;
}

const deps = () => ({
  db,
  events: createRecordingEventPublisher(),
  clock: fixedClock(),
  logger: createCapturingLogger(),
});

describe('the settlement of an unpositioned inquiry (C235.4)', () => {
  it('completes on a verification it ran, as today', async () => {
    const { flow, config } = governmentIdFlow();
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow,
      verificationConfig: config,
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    await passedGovernmentId(inquiry.id, false);

    await expect(settleInquiry(deps(), environmentId, inquiry.id, flow)).resolves.toBe('completed');
  });

  it('does not complete on a cloned pass that does not count', async () => {
    const { flow, config } = governmentIdFlow();
    const { inquiry } = await createTestInquiry(db, environmentId, {
      flow,
      verificationConfig: config,
    });
    await transitionInquiryStatus(db, environmentId, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    await passedGovernmentId(inquiry.id, true);

    await expect(settleInquiry(deps(), environmentId, inquiry.id, flow)).resolves.toBe('pending');
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('pending');
  });
});

describe('the cloned-results functions’ stub (api-redeem builds the verdict)', () => {
  it('keeps every verification without a clone provenance, and drops a clone that does not count', async () => {
    const modulePath = './cloned-results.js';
    const hooks = (await import(/* @vite-ignore */ modulePath)) as {
      isClonedVerification(row: { provenance?: unknown }): boolean;
      countedVerifications<T extends { provenance?: unknown }>(
        db: Db,
        inquiry: { environmentId: string; inquiryTemplateVersionId: string },
        rows: readonly T[],
        now: Date,
      ): Promise<T[]>;
      verificationCountsInWorkflows(db: Db, row: { provenance?: unknown }): Promise<boolean>;
    };
    const plain = { id: 'a', provenance: null };
    const hydrated = { id: 'b', provenance: { kind: 'connect-hydrate' } };
    const clone = { id: 'c', provenance: CLONE };
    expect(hooks.isClonedVerification(clone)).toBe(true);
    expect(hooks.isClonedVerification(hydrated)).toBe(false);
    expect(
      (
        await hooks.countedVerifications(
          db,
          { environmentId, inquiryTemplateVersionId: 'itmplv_x' },
          [plain, hydrated, clone],
          new Date(),
        )
      ).map((row) => row.id),
    ).toEqual(['a', 'b']);
    expect(await hooks.verificationCountsInWorkflows(db, plain)).toBe(true);
    expect(await hooks.verificationCountsInWorkflows(db, clone)).toBe(false);
  });
});

describe('the analytics rollups leave clones out (C235.7(c))', () => {
  it('counts the verification and the checks it ran, never the clone beside them', async () => {
    const tenant = await seedAnalyticsTenant(db);
    const createdAt = new Date('2026-11-02T10:00:00Z');
    const inquiryId = await seedAnalyticsInquiry(db, tenant, { createdAt, status: 'completed' });
    for (const cloned of [false, true]) {
      await seedAnalyticsVerification(db, tenant, inquiryId, {
        type: 'government_id',
        status: 'passed',
        createdAt,
        checks: [{ name: 'id_expired', status: 'passed' }],
      });
      if (cloned) {
        await db.execute(sql`update verifications set provenance = ${JSON.stringify(CLONE)}::jsonb
          where inquiry_id = ${inquiryId} and provenance is null
            and id = (select id from verifications where inquiry_id = ${inquiryId}
              order by created_at desc, id desc limit 1)`);
        await db.execute(sql`update verification_checks set connect_provenance = ${JSON.stringify(CLONE)}::jsonb
          where verification_id in (select id from verifications where provenance is not null
            and inquiry_id = ${inquiryId})`);
      }
    }
    const rollups = await computeCohortRollups(
      db,
      {
        environmentId: tenant.environmentId,
        timeZone: 'UTC',
        selection: { kind: 'inquiry', inquiryId },
        source: 'facts',
      } as never,
      'all',
    );
    const passed = rollups.verification.reduce(
      (sum, row) => sum + (row as { passed: number }).passed,
      0,
    );
    const checks = rollups.check.reduce((sum, row) => sum + row.count, 0);
    expect(passed).toBe(1);
    expect(checks).toBe(1);
  });
});

describe('every hook is in place (one call each, in the shared files)', () => {
  it.each([
    ['flow-engine/engine.ts', 'countedVerifications('],
    ['flow-engine/session.ts', 'countedVerifications('],
    ['services/inquiry-settlement.ts', 'countedVerifications('],
    ['workflows/actions/objects/table.ts', 'verificationCountsInWorkflows('],
    ['services/analytics/rollup-sql.ts', 'notClonedVerification('],
    ['services/analytics/rollup-sql.ts', 'notClonedCheck('],
  ])('%s calls %s', (file, call) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    expect(source).toContain(call);
    expect(source).toContain('connect/cloned-results.js');
  });
});
