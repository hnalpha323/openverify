/**
 * C62.10, C54.2: `GET /api/v1/dashboard/trust-anchors`, behind `settings:read`, serves the
 * install-wide trust store as its frozen schema says: each source with its last sync, the anchors
 * per country (sandbox-only ones apart), the withdrawn anchors, each CRL's freshness, the sandbox
 * anchors seed:dev inserts, and whether a production anchor exists. Its sync outcomes are the
 * audit table's. Certificates and CRLs here are synthetic bytes.
 */
import { createHash } from 'node:crypto';
import { TRUST_ANCHOR_SYNC_OUTCOMES, dashboardTrustAnchorsSchema } from '@openverify/contracts';
import {
  TRUST_ANCHOR_SYNC_OUTCOME_VALUES,
  applyTrustSync,
  syncTrustAnchorSources,
  type TrustAnchorInput,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installSandboxTrustAnchor } from '../../trust-anchors/sandbox.js';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function setup(
  roles: Parameters<DashboardHarness['operator']>[1],
  on: TestDatabase = database,
) {
  const api = await createDashboardHarness(on);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, roles);
  return { api, token: await api.signIn(operator.email) };
}

/** The harness clock (`T0`): the store is judged at it. */
const NOW = new Date('2026-10-20T12:00:00.000Z');

function anchor(name: string, overrides: Partial<TrustAnchorInput> = {}): TrustAnchorInput {
  const certificate = new Uint8Array(Buffer.from(`synthetic csca ${name}`));
  return {
    sha256: createHash('sha256').update(certificate).digest('hex'),
    certificate,
    country: 'DE',
    subjectDn: `C=DE, O=OpenVerify Test, CN=Synthetic ${name}`,
    ski: createHash('sha1').update(name).digest('hex'),
    aki: null,
    notBefore: new Date('2020-01-01T00:00:00.000Z'),
    notAfter: new Date('2031-03-01T00:00:00.000Z'),
    isLink: false,
    ...overrides,
  };
}

describe('GET /trust-anchors (C62.10)', () => {
  it('serves the trust store in its frozen schema, with settings:read', async () => {
    const { api, token } = await setup({ roles: ['viewer'] });
    const db = api.database.db;
    await syncTrustAnchorSources(db, [
      { id: 'bsi-de', enabled: true },
      { id: 'npkd-nl', enabled: false },
    ]);
    const kept = anchor('kept');
    const gone = anchor('gone');
    await applyTrustSync(db, {
      sourceId: 'bsi-de',
      list: {
        sha256: 'a'.repeat(64),
        signingTime: new Date('2026-09-01T08:00:00.000Z'),
        anchors: [kept, gone],
      },
      crls: [],
      now: new Date('2026-10-01T03:00:00.000Z'),
    });
    await applyTrustSync(db, {
      sourceId: 'bsi-de',
      list: {
        sha256: 'b'.repeat(64),
        signingTime: new Date('2026-10-01T08:30:00.000Z'),
        anchors: [kept],
      },
      crls: [
        {
          sha256: 'c'.repeat(64),
          der: new Uint8Array(Buffer.from('synthetic crl')),
          issuerCountry: 'DE',
          issuerKeyId: kept.ski,
          thisUpdate: new Date('2026-10-19T00:00:00.000Z'),
          nextUpdate: new Date('2026-11-20T00:00:00.000Z'),
          crlNumber: '40',
          url: 'http://crl.example.test/de.crl',
        },
      ],
      now: new Date('2026-10-20T03:00:00.000Z'),
    });
    const sandbox = await installSandboxTrustAnchor(db, { now: NOW });

    const response = await api.call('GET', '/trust-anchors', { token });

    expect(response.statusCode).toBe(200);
    const body = dashboardTrustAnchorsSchema.parse(response.json());
    expect(body).toEqual({
      'generated-at': NOW.toISOString(),
      'has-production-anchor': true,
      settings: { 'refresh-enabled': false, 'icao-crls-allowed': false },
      sources: [
        {
          id: 'bsi-de',
          enabled: true,
          'last-synced-at': '2026-10-20T03:00:00.000Z',
          'list-signing-time': '2026-10-01T08:30:00.000Z',
          'list-sha256': 'b'.repeat(64),
          anchors: 1,
          'last-sync': {
            outcome: 'accepted',
            reason: null,
            'anchors-seen': 1,
            'anchors-withdrawn': 1,
            'crls-updated': 1,
            'created-at': expect.any(String) as string,
          },
        },
        {
          id: 'npkd-nl',
          enabled: false,
          'last-synced-at': null,
          'list-signing-time': null,
          'list-sha256': null,
          anchors: 0,
          'last-sync': null,
        },
        {
          id: 'openverify-sandbox',
          enabled: true,
          'last-synced-at': NOW.toISOString(),
          'list-signing-time': NOW.toISOString(),
          'list-sha256': sandbox.anchorId,
          anchors: 1,
          'last-sync': {
            outcome: 'accepted',
            reason: null,
            'anchors-seen': 1,
            'anchors-withdrawn': 0,
            'crls-updated': 1,
            'created-at': expect.any(String) as string,
          },
        },
      ],
      countries: [
        {
          country: 'DE',
          anchors: 1,
          'link-certificates': 0,
          'withdrawn-anchors': 1,
          'next-expiry': '2031-03-01T00:00:00.000Z',
        },
      ],
      'withdrawn-anchors': [
        {
          id: gone.sha256,
          country: 'DE',
          'subject-dn': gone.subjectDn,
          'withdrawn-at': '2026-10-20T03:00:00.000Z',
        },
      ],
      crls: [
        {
          'issuer-country': 'DE',
          'issuer-key-id': kept.ski,
          'this-update': '2026-10-19T00:00:00.000Z',
          'next-update': '2026-11-20T00:00:00.000Z',
          'fetched-at': '2026-10-20T03:00:00.000Z',
          freshness: 'current',
        },
        {
          'issuer-country': 'UT',
          'issuer-key-id': expect.stringMatching(/^[0-9a-f]+$/u) as string,
          'this-update': NOW.toISOString(),
          'next-update': sandbox.crlNextUpdate.toISOString(),
          'fetched-at': NOW.toISOString(),
          freshness: 'current',
        },
      ],
      'sandbox-anchors': [
        {
          id: sandbox.anchorId,
          country: 'UT',
          'not-before': sandbox.notBefore.toISOString(),
          'not-after': sandbox.notAfter.toISOString(),
          'crl-next-update': sandbox.crlNextUpdate.toISOString(),
        },
      ],
    });
  });

  it('serves an empty store', async () => {
    // The trust store is install-wide: a database of its own holds none.
    const empty = await createTestDatabase();
    const { api, token } = await setup({ roles: ['viewer'] }, empty);

    const response = await api.call('GET', '/trust-anchors', { token });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      'generated-at': NOW.toISOString(),
      'has-production-anchor': false,
      settings: { 'refresh-enabled': false, 'icao-crls-allowed': false },
      sources: [],
      countries: [],
      'withdrawn-anchors': [],
      crls: [],
      'sandbox-anchors': [],
    });
    await api.close();
    harnesses.splice(harnesses.indexOf(api), 1);
    await empty.close();
  });

  // Workflow 5C review K13: the settings the API process reads, which compose gives it as it
  // gives the worker (OPENVERIFY_TRUST_ANCHOR_REFRESH, OPENVERIFY_NFC_ALLOW_ICAO_CRLS).
  it('reports whether the store is refreshed and ICAO PKD CRLs are allowed, as the API reads them', async () => {
    const empty = await createTestDatabase();
    const api = await createDashboardHarness(empty, {
      nfc: { trustAnchorRefresh: true, allowIcaoCrls: true },
    });
    harnesses.push(api);
    const organization = await api.organization();
    const operator = await api.operator(organization, { roles: ['viewer'] });
    const token = await api.signIn(operator.email);

    const response = await api.call('GET', '/trust-anchors', { token });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      settings: { 'refresh-enabled': true, 'icao-crls-allowed': true },
    });
    await api.close();
    harnesses.splice(harnesses.indexOf(api), 1);
    await empty.close();
  });

  it('needs settings:read', async () => {
    const { api, token } = await setup({ roles: ['reviewer'] });

    expect((await api.call('GET', '/trust-anchors', { token })).statusCode).toBe(403);
  });

  it('needs a signed-in operator', async () => {
    const { api } = await setup({ roles: ['viewer'] });

    expect((await api.call('GET', '/trust-anchors')).statusCode).toBe(401);
  });

  it('serves the sync outcomes the audit table records', () => {
    expect(TRUST_ANCHOR_SYNC_OUTCOMES).toEqual(TRUST_ANCHOR_SYNC_OUTCOME_VALUES);
  });
});
