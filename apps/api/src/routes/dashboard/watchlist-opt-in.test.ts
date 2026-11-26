/**
 * C254.1 (Workflow 11B, ingestion-11b; Q10 pending, rule 19; Stage 1a amendment 51): the UN list's
 * opt-in routes, `POST` and `DELETE /api/v1/dashboard/watchlist-sources/:sourceId/opt-in`, through
 * the dashboard harness, which (as the API today) passes no install switch: the switch
 * `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` is false, so every opt-in and withdrawal answers 409
 * `watchlist_source_locked`, nothing is stored or audited, and `un-sc` stays "cannot be enabled in
 * this release" as Phase 6 left it. The unlocked behaviour (the acknowledgement held to the
 * manifest's terms, the step-up, the user and time audited) is `watchlists/un-opt-in.test.ts`'.
 * Every value is synthetic.
 */
import { getEnvironment } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { userSessions } from '@openverify/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { watchlistManifest } from '../../watchlists/manifest.js';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

let database: TestDatabase;
let harness: DashboardHarness;

beforeAll(async () => {
  database = await createTestDatabase();
  harness = await createDashboardHarness(database);
}, 60_000);

afterAll(async () => {
  await harness.close();
  await database.close();
});

const UN_TERMS = watchlistManifest().sources.find((source) => source.id === 'un-sc')?.terms.url;
const payload = { acknowledgement: { 'terms-url': UN_TERMS, accepted: true } };

const auditCount = async (environmentId: string): Promise<number> => {
  const result = (await database.db.execute(
    sql`select count(*)::int as n from audit_logs
         where environment_id = ${environmentId} and action like 'watchlist-source.%'`,
  )) as unknown as { rows: { n: number }[] };
  return result.rows[0]?.n ?? 0;
};

describe('the UN opt-in routes, locked (C254.1)', () => {
  it('answers 409 watchlist_source_locked to an admin opting in or withdrawing, storing and auditing nothing', async () => {
    const organization = await harness.organization();
    const { email } = await harness.operator(organization, { roles: ['admin'] });
    const token = await harness.signIn(email);

    const optIn = await harness.call('POST', '/watchlist-sources/un-sc/opt-in', { token, payload });
    expect(optIn.statusCode, optIn.body).toBe(409);
    expect(optIn.json()).toMatchObject({ code: 'watchlist_source_locked', status: 409 });
    expect(optIn.headers['content-type']).toMatch(/^application\/problem\+json/);

    const withdraw = await harness.call('DELETE', '/watchlist-sources/un-sc/opt-in', { token });
    expect(withdraw.statusCode, withdraw.body).toBe(409);
    expect(withdraw.json()).toMatchObject({ code: 'watchlist_source_locked' });

    const environment = await getEnvironment(database.db, organization.sandboxId);
    expect(environment?.settings['watchlist-un-opt-in']).toBeUndefined();
    expect(await auditCount(organization.sandboxId)).toBe(0);
  });

  it('needs a session, the settings scopes, and an opt-in source', async () => {
    const organization = await harness.organization();
    expect(
      (await harness.call('POST', '/watchlist-sources/un-sc/opt-in', { payload })).statusCode,
    ).toBe(401);

    const viewer = await harness.operator(organization, { roles: ['viewer'] });
    const viewerToken = await harness.signIn(viewer.email);
    const refused = await harness.call('POST', '/watchlist-sources/un-sc/opt-in', {
      token: viewerToken,
      payload,
    });
    expect(refused.statusCode, refused.body).toBe(403);

    const admin = await harness.operator(organization, { roles: ['admin'] });
    const token = await harness.signIn(admin.email);
    expect(
      (await harness.call('POST', '/watchlist-sources/ofac-sdn/opt-in', { token, payload }))
        .statusCode,
    ).toBe(400);
    expect(await auditCount(organization.sandboxId)).toBe(0);
  });
});

/**
 * Q10 granted (2026-11-21; KP11-31): the switch reaches the routes through the dashboard admin
 * options (as the container passes `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED`), so an environment
 * admin opts in with the acknowledgement and the step-up, audited, and withdraws.
 */
describe('the UN opt-in routes, unlocked by the install switch (C254.1, Q10 granted)', () => {
  let unlocked: DashboardHarness;

  beforeAll(async () => {
    unlocked = await createDashboardHarness(database, { watchlistUnOptInAllowed: true });
  });

  afterAll(async () => {
    await unlocked.close();
  });

  async function admin(stepUp: boolean) {
    const organization = await unlocked.organization();
    const { email } = await unlocked.operator(organization, { roles: ['admin'] });
    const token = await unlocked.signIn(email);
    if (stepUp) {
      await database.db
        .update(userSessions)
        .set({ mfaVerifiedAt: unlocked.clock.now() })
        .where(eq(userSessions.environmentId, organization.sandboxId));
    }
    return { organization, token };
  }

  it('answers 403 step_up_required without a recent second factor, storing nothing', async () => {
    const { organization, token } = await admin(false);
    const response = await unlocked.call('POST', '/watchlist-sources/un-sc/opt-in', {
      token,
      payload,
    });
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ code: 'step_up_required' });
    const environment = await getEnvironment(database.db, organization.sandboxId);
    expect(environment?.settings['watchlist-un-opt-in']).toBeUndefined();
  });

  it("records a stepped-up admin's acknowledgement, audited, and withdraws it, audited", async () => {
    const { organization, token } = await admin(true);
    const optIn = await unlocked.call('POST', '/watchlist-sources/un-sc/opt-in', {
      token,
      payload,
    });
    expect(optIn.statusCode, optIn.body).toBe(200);
    expect(optIn.json()).toMatchObject({ 'source-id': 'un-sc', 'terms-url': UN_TERMS });
    const stored = await getEnvironment(database.db, organization.sandboxId);
    expect(stored?.settings['watchlist-un-opt-in']).toMatchObject({ 'source-id': 'un-sc' });
    expect(
      (await unlocked.audit(organization.sandboxId, 'watchlist-source.opt-in-accepted')).length,
    ).toBe(1);

    const withdraw = await unlocked.call('DELETE', '/watchlist-sources/un-sc/opt-in', { token });
    expect(withdraw.statusCode, withdraw.body).toBe(204);
    const after = await getEnvironment(database.db, organization.sandboxId);
    expect(after?.settings['watchlist-un-opt-in']).toBeNull();
    expect(
      (await unlocked.audit(organization.sandboxId, 'watchlist-source.opt-in-withdrawn')).length,
    ).toBe(1);
  });

  it('still refuses the acknowledgement of other terms', async () => {
    const { token } = await admin(true);
    const response = await unlocked.call('POST', '/watchlist-sources/un-sc/opt-in', {
      token,
      payload: { acknowledgement: { 'terms-url': 'https://example.com/terms', accepted: true } },
    });
    expect(response.statusCode, response.body).toBe(422);
  });
});
