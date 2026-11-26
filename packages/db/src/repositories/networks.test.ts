/**
 * A session's network evaluation (plan C91.1, C91.3, C93.2; Workflow 7A, owner `api-network`): the
 * `networks` row and the session's own facts, written once in the start's transaction, the address
 * and the location sealed for their rows. Every address and ASN is from the documentation ranges.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from '../testing.js';
import { getInquirySession } from './inquiry-sessions.js';
import {
  firstInquiryNetwork,
  listSessionNetworks,
  recordSessionNetworkEvaluation,
  type NetworkEvaluationWrite,
  type NetworkFacts,
} from './networks.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const T = new Date('2026-10-30T08:00:00.000Z');

async function seedSession() {
  const { environment } = await createTestTenant(database.db);
  const { inquiry } = await createTestInquiry(database.db, environment.id);
  const sessionId = testId('iqse');
  await database.client.query(
    `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
       values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [sessionId, environment.id, inquiry.id, randomBytes(32).toString('hex')],
  );
  return { environmentId: environment.id, sessionId };
}

const FACTS: NetworkFacts = {
  isTor: false,
  isDatacenter: true,
  isVpn: null,
  isProxy: null,
  hostingAsn: true,
  hostingAsnConfidence: 0.5,
  privacyRelay: null,
  threatLevel: 'medium',
  countryCode: 'ZZ',
  countryName: 'Example Land',
  location: { regionCode: 'ZZ-01', regionName: 'Example Region', latitude: -30, longitude: -140 },
  asn: 64502,
  organization: 'Example Sandbox Network',
  serviceType: 'datacenter',
  proxyType: null,
  ipConnectionType: 'datacenter',
};

function write(sessionId: string, overrides: Partial<NetworkEvaluationWrite> = {}) {
  return {
    id: testId('net'),
    inquirySessionId: sessionId,
    ip: '203.0.113.7',
    clientAddressSource: 'trusted-list',
    evaluatedAt: T,
    facts: FACTS,
    reasons: [
      { field: 'is-vpn', reason: 'not_in_known_ranges' },
      { field: 'country-code', reason: 'approximate' },
    ],
    sources: [
      {
        kind: 'sync',
        'source-id': 'openverify-sandbox-network',
        'sync-id': '7',
        'published-at': T.toISOString(),
        sha256: 'a'.repeat(64),
      },
    ],
    ...overrides,
  } satisfies NetworkEvaluationWrite;
}

describe('recordSessionNetworkEvaluation', () => {
  it('writes the network row and the session facts once, the address and the point sealed', async () => {
    const session = await seedSession();
    const evaluation = write(session.sessionId);
    const network = await database.db.transaction((tx) =>
      recordSessionNetworkEvaluation(tx, session.environmentId, evaluation),
    );
    expect(network).toMatchObject({
      id: evaluation.id,
      environmentId: session.environmentId,
      inquirySessionId: session.sessionId,
      ip: '203.0.113.7',
      location: FACTS.location,
      serviceProvider: 'Example Sandbox Network',
      serviceType: 'datacenter',
      proxyType: null,
      threatLevel: 'medium',
      countryCode: 'ZZ',
      countryName: 'Example Land',
      asn: 64502,
      hostingAsn: true,
      hostingAsnConfidence: 0.5,
      privacyRelay: null,
      clientAddressSource: 'trusted-list',
      evaluatedAt: T,
      reasons: evaluation.reasons,
      sources: evaluation.sources,
    });
    const raw = await database.client.query<{ ip: string; location: string }>(
      'select ip, location from networks where id = $1',
      [evaluation.id],
    );
    expect(raw.rows[0]?.ip.startsWith('ov1')).toBe(true);
    expect(raw.rows[0]?.location).not.toContain('Example Region');

    const stored = await getInquirySession(database.db, session.environmentId, session.sessionId);
    expect(stored).toMatchObject({
      networkEvaluatedAt: T,
      isTor: false,
      isDatacenter: true,
      isVpn: null,
      isProxy: null,
      hostingAsn: true,
      threatLevel: 'medium',
      countryCode: 'ZZ',
      countryName: 'Example Land',
      location: FACTS.location,
      ipConnectionType: 'datacenter',
      networkOrganization: 'Example Sandbox Network',
    });

    // The facts are frozen: a second evaluation of the session writes nothing.
    const again = await recordSessionNetworkEvaluation(database.db, session.environmentId, {
      ...write(session.sessionId),
      facts: { ...FACTS, threatLevel: 'high', countryCode: 'XA' },
    });
    expect(again).toBeNull();
    const after = await getInquirySession(database.db, session.environmentId, session.sessionId);
    expect(after).toMatchObject({ threatLevel: 'medium', countryCode: 'ZZ' });
    expect(
      await listSessionNetworks(database.db, session.environmentId, [session.sessionId]),
    ).toHaveLength(1);
  });

  it('stores an unevaluated threat level as unknown on the network and null on the session', async () => {
    const session = await seedSession();
    const network = await recordSessionNetworkEvaluation(database.db, session.environmentId, {
      ...write(session.sessionId),
      facts: {
        ...FACTS,
        isTor: null,
        isDatacenter: null,
        hostingAsn: null,
        hostingAsnConfidence: null,
        threatLevel: null,
        location: null,
        serviceType: null,
        ipConnectionType: null,
      },
    });
    expect(network).toMatchObject({ threatLevel: 'unknown', location: null, hostingAsn: null });
    const stored = await getInquirySession(database.db, session.environmentId, session.sessionId);
    expect(stored).toMatchObject({ threatLevel: null, location: null, isTor: null });
  });
});

describe('listSessionNetworks', () => {
  it('reads the networks of the sessions asked for, in this environment only', async () => {
    const first = await seedSession();
    const second = await seedSession();
    await recordSessionNetworkEvaluation(database.db, first.environmentId, write(first.sessionId));
    await recordSessionNetworkEvaluation(
      database.db,
      second.environmentId,
      write(second.sessionId, { ip: '2001:db8::7' }),
    );
    const mine = await listSessionNetworks(database.db, first.environmentId, [
      first.sessionId,
      second.sessionId,
    ]);
    expect(mine.map((network) => [network.inquirySessionId, network.ip])).toEqual([
      [first.sessionId, '203.0.113.7'],
    ]);
    expect(await listSessionNetworks(database.db, first.environmentId, [])).toEqual([]);
  });
});

describe('firstInquiryNetwork', () => {
  it('reads the first evaluated network of the inquiry’s sessions, ties broken by id', async () => {
    const first = await seedSession();
    const { rows } = await database.client.query<{ inquiry_id: string }>(
      'select inquiry_id from inquiry_sessions where id = $1',
      [first.sessionId],
    );
    const inquiryId = rows[0]?.inquiry_id ?? '';
    expect(await firstInquiryNetwork(database.db, first.environmentId, inquiryId)).toBeNull();
    const second = testId('iqse');
    await database.client.query(
      `insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
         values ($1, $2, $3, $4, now() + interval '1 hour')`,
      [second, first.environmentId, inquiryId, randomBytes(32).toString('hex')],
    );
    await recordSessionNetworkEvaluation(database.db, first.environmentId, {
      ...write(second, { ip: '198.51.100.9' }),
      evaluatedAt: new Date('2026-10-30T09:00:00Z'),
    });
    await recordSessionNetworkEvaluation(database.db, first.environmentId, {
      ...write(first.sessionId, { ip: '203.0.113.9' }),
      evaluatedAt: new Date('2026-10-30T10:00:00Z'),
    });
    const network = await firstInquiryNetwork(database.db, first.environmentId, inquiryId);
    expect(network).toMatchObject({ inquirySessionId: second, ip: '198.51.100.9' });
    const other = await createTestTenant(database.db);
    expect(await firstInquiryNetwork(database.db, other.environment.id, inquiryId)).toBeNull();
  });
});
