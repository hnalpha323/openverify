/**
 * Workflow 7A (S) (C90.8, C91.7, P19): the signal settings and the three retention steps of the
 * C16 pass. Each environment's window comes from its settings; the defaults apply in code.
 * Every address is from the documentation ranges and every value is synthetic.
 */
import { graphKindCode } from '@openverify/core';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  openSessionSignalBodies,
  seedDevice,
  seedGraphAttribute,
  seedNetwork,
  seedSessionSignalBody,
  testId,
  type TestDatabase,
} from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  createAccount,
  createInquirySession,
  DEFAULT_SIGNAL_SETTINGS,
  deleteExpiredDevices,
  getInquirySession,
  markInquirySessionStarted,
  nullExpiredAddresses,
  nullExpiredSignalComponents,
  recordInquirySessionConsent,
  resolveSignalSettings,
  updateEnvironmentSettings,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const NOW = new Date('2027-01-01T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** A tenant with an inquiry and a started, consented session from 203.0.113.70. */
async function seedSession(settings: Parameters<typeof updateEnvironmentSettings>[2] = {}) {
  const { environment } = await createTestTenant(database.db);
  const env = environment.id;
  await updateEnvironmentSettings(database.db, env, settings);
  const { inquiry } = await createTestInquiry(database.db, env);
  const session = await createInquirySession(database.db, env, {
    id: testId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${testId('iqse')}`),
    expiresAt: new Date(NOW.getTime() + 3_600_000),
  });
  await markInquirySessionStarted(database.db, env, session.id, {
    ip: '203.0.113.70',
    userAgent: 'Synthetic/1.0',
  });
  await recordInquirySessionConsent(database.db, env, session.id, {
    acceptedAt: NOW,
    textKeys: ['consent.processing'],
    locale: 'en',
    ip: '203.0.113.70',
    userAgent: 'Synthetic/1.0',
  });
  return { env, sessionId: session.id };
}

async function ageSession(sessionId: string, at: Date) {
  await database.db.execute(
    sql`update inquiry_sessions set created_at = ${at.toISOString()}::timestamptz
         where id = ${sessionId}`,
  );
}

describe('the signal settings (C90.8, C91.7)', () => {
  it('apply their defaults in code: integrity on, recognition off, components 30 days, devices 365', () => {
    expect(DEFAULT_SIGNAL_SETTINGS).toEqual({
      'signal-collection': {
        'session-integrity': 'on',
        'device-recognition': 'off',
        'device-recognition-basis': null,
      },
      'expose-signals': true,
      'signal-component-retention-days': 30,
      'ip-retention-days': null,
      'device-retention-days': 365,
    });
    expect(resolveSignalSettings({})).toEqual(DEFAULT_SIGNAL_SETTINGS);
  });

  it('take what the environment set, key by key', () => {
    expect(
      resolveSignalSettings({
        'signal-collection': {
          'session-integrity': 'off',
          'device-recognition': 'exempt',
          'device-recognition-basis': 'Synthetic basis',
        },
        'expose-signals': false,
        'ip-retention-days': 7,
      }),
    ).toEqual({
      'signal-collection': {
        'session-integrity': 'off',
        'device-recognition': 'exempt',
        'device-recognition-basis': 'Synthetic basis',
      },
      'expose-signals': false,
      'signal-component-retention-days': 30,
      'ip-retention-days': 7,
      'device-retention-days': 365,
    });
  });
});

describe('nullExpiredSignalComponents (C91.7, P19)', () => {
  it('nulls the components past the window and keeps the behaviour aggregates', async () => {
    const { env, sessionId } = await seedSession();
    await seedSessionSignalBody(database.db, env, {
      inquirySessionId: sessionId,
      sequence: 0,
      components: { integrity: { webdriver: false } },
      behaviour: { 'paste-count': 1 },
      createdAt: daysAgo(31),
    });
    await seedSessionSignalBody(database.db, env, {
      inquirySessionId: sessionId,
      sequence: 1,
      components: { integrity: { webdriver: false } },
      behaviour: { 'paste-count': 2 },
      createdAt: daysAgo(29),
    });

    expect(await nullExpiredSignalComponents(database.db, { now: NOW })).toBe(1);

    expect(await openSessionSignalBodies(database.db, env, sessionId)).toEqual([
      { sequence: 0, components: null, behaviour: { 'paste-count': 1 } },
      {
        sequence: 1,
        components: { integrity: { webdriver: false } },
        behaviour: { 'paste-count': 2 },
      },
    ]);
    expect(await nullExpiredSignalComponents(database.db, { now: NOW })).toBe(0);
  });

  it('follows each environment’s own window', async () => {
    const { env, sessionId } = await seedSession({ 'signal-component-retention-days': 3 });
    await seedSessionSignalBody(database.db, env, {
      inquirySessionId: sessionId,
      createdAt: daysAgo(4),
    });

    expect(await nullExpiredSignalComponents(database.db, { now: NOW })).toBe(1);
    expect((await openSessionSignalBodies(database.db, env, sessionId))[0]?.components).toBeNull();
  });
});

describe('nullExpiredAddresses (C91.7)', () => {
  it('keeps every address while ip-retention-days is unset (the inquiry’s retention)', async () => {
    const { env, sessionId } = await seedSession();
    await ageSession(sessionId, daysAgo(3_000));

    await nullExpiredAddresses(database.db, { now: NOW });

    expect(await getInquirySession(database.db, env, sessionId)).toMatchObject({
      ip: '203.0.113.70',
    });
  });

  it('nulls the session address, its consent address and its networks’ addresses past the window, keeping the derived facts', async () => {
    const { env, sessionId } = await seedSession({ 'ip-retention-days': 7 });
    const network = await seedNetwork(database.db, env, {
      inquirySessionId: sessionId,
      ip: '203.0.113.70',
      asn: 64_502,
      countryCode: 'ZZ',
    });
    await ageSession(sessionId, daysAgo(8));
    await database.db.execute(
      sql`update networks set created_at = ${daysAgo(8).toISOString()}::timestamptz
           where id = ${network.id}`,
    );
    const fresh = await seedSession({ 'ip-retention-days': 7 });
    await ageSession(fresh.sessionId, daysAgo(6));

    expect(await nullExpiredAddresses(database.db, { now: NOW })).toBe(2);

    const session = await getInquirySession(database.db, env, sessionId);
    expect(session).toMatchObject({ ip: null, userAgent: 'Synthetic/1.0', countryCode: 'ZZ' });
    expect(session?.consent).toMatchObject({ ip: null, userAgent: 'Synthetic/1.0' });
    const row = await database.db.execute(
      sql`select ip, asn::int as asn, country_code from networks where id = ${network.id}`,
    );
    expect((row as unknown as { rows: unknown[] }).rows).toEqual([
      { ip: null, asn: 64_502, country_code: 'ZZ' },
    ]);
    expect(await getInquirySession(database.db, fresh.env, fresh.sessionId)).toMatchObject({
      ip: '203.0.113.70',
    });
    expect(await nullExpiredAddresses(database.db, { now: NOW })).toBe(0);
  });
});

describe('nullExpiredAddresses and the ip_address graph rows (C91.7, C101.2)', () => {
  const IP_ADDRESS = graphKindCode('ip_address');

  async function seedIpRow(env: string, sessionId: string, age: Date, kind = IP_ADDRESS) {
    const account = await createAccount(database.db, env, { id: testId('acc') });
    const session = await getInquirySession(database.db, env, sessionId);
    const { valueKey } = await seedGraphAttribute(database.db, env, {
      accountId: account.id,
      kind,
      source: { type: 'inquiry-session', id: sessionId },
      inquiryId: session?.inquiryId ?? null,
    });
    await database.db.execute(
      sql`update graph_attributes
             set first_seen_at = ${age.toISOString()}::timestamptz,
                 last_seen_at = ${age.toISOString()}::timestamptz
           where value_key = ${valueKey}`,
    );
    return valueKey;
  }

  async function graphRow(valueKey: string): Promise<boolean> {
    const found = await database.db.execute(
      sql`select 1 from graph_attributes where value_key = ${valueKey}`,
    );
    return (found as unknown as { rows: unknown[] }).rows.length > 0;
  }

  it('deletes the ip_address rows past the window, and every other row stays', async () => {
    const { env, sessionId } = await seedSession({ 'ip-retention-days': 7 });
    await ageSession(sessionId, daysAgo(1));
    const expired = await seedIpRow(env, sessionId, daysAgo(8));
    const fresh = await seedIpRow(env, sessionId, daysAgo(6));
    const otherKind = await seedIpRow(env, sessionId, daysAgo(8), graphKindCode('postal_code'));

    expect(await nullExpiredAddresses(database.db, { now: NOW })).toBe(1);

    expect(await graphRow(expired)).toBe(false);
    expect(await graphRow(fresh)).toBe(true);
    expect(await graphRow(otherKind)).toBe(true);
  });

  it('keeps them while ip-retention-days is unset', async () => {
    const { env, sessionId } = await seedSession();
    const kept = await seedIpRow(env, sessionId, daysAgo(3_000));

    await nullExpiredAddresses(database.db, { now: NOW });

    expect(await graphRow(kept)).toBe(true);
  });

  it('takes a batch at a time, so the C16 pass drains them', async () => {
    const { env, sessionId } = await seedSession({ 'ip-retention-days': 7 });
    await ageSession(sessionId, daysAgo(1));
    await seedIpRow(env, sessionId, daysAgo(9));
    await seedIpRow(env, sessionId, daysAgo(8));

    expect(await nullExpiredAddresses(database.db, { now: NOW, limit: 1 })).toBe(1);
    expect(await nullExpiredAddresses(database.db, { now: NOW, limit: 1 })).toBe(1);
    expect(await nullExpiredAddresses(database.db, { now: NOW, limit: 1 })).toBe(0);
  });
});

describe('deleteExpiredDevices (C91.7)', () => {
  it('deletes devices unseen past the window, with their links; the session keeps its facts', async () => {
    const { env, sessionId } = await seedSession();
    const stale = await seedDevice(database.db, env, {
      lastSeenAt: daysAgo(366),
      sessionIds: [sessionId],
    });
    const seen = await seedDevice(database.db, env, { lastSeenAt: daysAgo(364) });
    const short = await seedSession({ 'device-retention-days': 10 });
    const shortStale = await seedDevice(database.db, short.env, { lastSeenAt: daysAgo(11) });

    expect(await deleteExpiredDevices(database.db, { now: NOW })).toBe(2);

    const left = await database.db.execute(
      sql`select id from devices where id in (${stale.id}, ${seen.id}, ${shortStale.id})`,
    );
    expect((left as unknown as { rows: unknown[] }).rows).toEqual([{ id: seen.id }]);
    const links = await database.db.execute(
      sql`select count(*)::int as count from session_devices where inquiry_session_id = ${sessionId}`,
    );
    expect((links as unknown as { rows: unknown[] }).rows).toEqual([{ count: 0 }]);
    expect(await getInquirySession(database.db, env, sessionId)).toMatchObject({
      ip: '203.0.113.70',
    });
  });
});
