/**
 * C62.7, C62.8, C62.10: the trust store's writes (`api-nfc`): the sources follow the manifest; a
 * verified list is applied in one transaction (refused when older than the source's last, its
 * anchors' memberships marked seen, every other membership of the source withdrawn); CRLs are
 * stored only when current and never with a `cRLNumber` below the stored one; every outcome is
 * audited; and the console's overview. Certificates and CRLs here are synthetic bytes: the
 * repository stores what the sync verified, and verifying is the sync's job.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import {
  createdAtClock,
  createTestDatabase,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  applyTrustSync,
  hasNonSandboxTrustAnchor,
  loadTrustStore,
  recordTrustAnchorSync,
  syncTrustAnchorSources,
  trustAnchorSourceOf,
  trustStoreOverview,
  type TrustAnchorInput,
  type TrustCrlInput,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

beforeEach(async () => {
  // The trust store is install-wide: each test starts from an empty one.
  await database.db.execute(
    sql`truncate trust_anchor_syncs, trust_crls, trust_anchor_memberships, trust_anchors, trust_anchor_sources`,
  );
});

afterAll(async () => {
  await database.close();
});

const T1 = new Date('2026-10-01T08:00:00.000Z');
const T2 = new Date('2026-10-15T08:00:00.000Z');
const NOW = new Date('2026-10-23T08:00:00.000Z');
const LATER = new Date('2026-10-24T08:00:00.000Z');

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function anchor(name: string, overrides: Partial<TrustAnchorInput> = {}): TrustAnchorInput {
  const certificate = new Uint8Array(Buffer.from(`synthetic certificate ${name}`));
  return {
    sha256: sha256(certificate),
    certificate,
    country: 'DE',
    subjectDn: `C=DE, O=OpenVerify Test, CN=Synthetic CSCA ${name}`,
    ski: createHash('sha1').update(name).digest('hex'),
    aki: null,
    notBefore: new Date('2020-01-01T00:00:00.000Z'),
    notAfter: new Date('2035-01-01T00:00:00.000Z'),
    isLink: false,
    ...overrides,
  };
}

function crl(name: string, overrides: Partial<TrustCrlInput> = {}): TrustCrlInput {
  const der = new Uint8Array(Buffer.from(`synthetic crl ${name}`));
  return {
    sha256: sha256(der),
    der,
    issuerCountry: 'DE',
    issuerKeyId: createHash('sha1').update('one').digest('hex'),
    thisUpdate: new Date('2026-10-20T00:00:00.000Z'),
    nextUpdate: new Date('2026-11-20T00:00:00.000Z'),
    crlNumber: '40',
    url: 'http://crl.example.test/csca.crl',
    ...overrides,
  };
}

const ONE = anchor('one');
const TWO = anchor('two');
const LINK = anchor('link', { aki: createHash('sha1').update('one').digest('hex'), isLink: true });

async function syncs() {
  const rows = await database.db.execute(
    sql`select source_id, outcome, reason, list_sha256, anchors_seen, anchors_withdrawn, crls_updated from trust_anchor_syncs order by id`,
  );
  return rows.rows;
}

async function store(kind: 'sandbox' | 'production' = 'production') {
  const loaded = await loadTrustStore(database.db, { environmentKind: kind });
  return {
    anchors: loaded.anchors.map((loadedAnchor) => [loadedAnchor.id, loadedAnchor.withdrawn]),
    crls: loaded.crls.map((loadedCrl) => sha256(loadedCrl.der)),
  };
}

describe('syncTrustAnchorSources (C62.7)', () => {
  it('creates the manifest sources and follows their enabled flag', async () => {
    await syncTrustAnchorSources(database.db, [
      { id: 'bsi-de', enabled: true },
      { id: 'npkd-nl', enabled: false },
    ]);
    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: false }]);

    const rows = await database.db.execute(
      sql`select id, enabled from trust_anchor_sources order by id`,
    );
    expect(rows.rows).toEqual([
      { id: 'bsi-de', enabled: false },
      { id: 'npkd-nl', enabled: false },
    ]);
  });
});

describe('applyTrustSync (C62.7)', () => {
  it('accepts a first list: anchors, current memberships, the source and the audit row', async () => {
    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: true }]);

    const result = await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'a'.repeat(64), signingTime: T1, anchors: [ONE, TWO, LINK] },
      crls: [crl('one')],
      now: NOW,
    });

    expect(result).toEqual({
      outcome: 'accepted',
      reason: null,
      anchorsSeen: 3,
      anchorsWithdrawn: 0,
      crlsUpdated: 1,
      crlsRefused: [],
    });
    expect(await store()).toEqual({
      anchors: [ONE, TWO, LINK]
        .map((listed) => [listed.sha256, false] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
      crls: [crl('one').sha256],
    });
    const source = await database.db.execute(
      sql`select last_signing_time = ${T1.toISOString()}::timestamptz as signed, last_list_sha256, last_synced_at = ${NOW.toISOString()}::timestamptz as synced from trust_anchor_sources where id = 'bsi-de'`,
    );
    expect(source.rows).toEqual([{ signed: true, last_list_sha256: 'a'.repeat(64), synced: true }]);
    expect(await syncs()).toEqual([
      {
        source_id: 'bsi-de',
        outcome: 'accepted',
        reason: null,
        list_sha256: 'a'.repeat(64),
        anchors_seen: 3,
        anchors_withdrawn: 0,
        crls_updated: 1,
      },
    ]);
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(true);
    expect(await trustAnchorSourceOf(database.db, ONE.sha256)).toBe('bsi-de');
  });

  it('withdraws what a newer list no longer carries, and re-lists what comes back', async () => {
    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: true }]);
    await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'a'.repeat(64), signingTime: T1, anchors: [ONE, TWO] },
      crls: [],
      now: NOW,
    });

    const withdrawn = await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'b'.repeat(64), signingTime: T2, anchors: [ONE] },
      crls: [],
      now: LATER,
    });

    expect(withdrawn).toMatchObject({ outcome: 'accepted', anchorsSeen: 1, anchorsWithdrawn: 1 });
    expect(new Map((await store()).anchors as [string, boolean][]).get(TWO.sha256)).toBe(true);
    expect(await trustAnchorSourceOf(database.db, TWO.sha256)).toBeNull();

    const relisted = await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'c'.repeat(64), signingTime: T2, anchors: [ONE, TWO] },
      crls: [],
      now: LATER,
    });
    expect(relisted).toMatchObject({ outcome: 'accepted', anchorsWithdrawn: 0 });
    expect(new Map((await store()).anchors as [string, boolean][]).get(TWO.sha256)).toBe(false);
  });

  it('refuses a list older than the source last accepted (rollback), changing nothing', async () => {
    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: true }]);
    await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'b'.repeat(64), signingTime: T2, anchors: [ONE, TWO] },
      crls: [],
      now: NOW,
    });

    const refused = await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'a'.repeat(64), signingTime: T1, anchors: [ONE] },
      crls: [crl('one')],
      now: LATER,
    });

    expect(refused).toEqual({
      outcome: 'refused',
      reason: 'list_signing_time_rollback',
      anchorsSeen: 0,
      anchorsWithdrawn: 0,
      crlsUpdated: 0,
      crlsRefused: [],
    });
    expect((await store()).anchors.every(([, isWithdrawn]) => isWithdrawn === false)).toBe(true);
    expect((await store()).crls).toEqual([]);
    expect((await syncs()).at(-1)).toEqual({
      source_id: 'bsi-de',
      outcome: 'refused',
      reason: 'list_signing_time_rollback',
      list_sha256: 'a'.repeat(64),
      anchors_seen: 0,
      anchors_withdrawn: 0,
      crls_updated: 0,
    });
  });

  it('refuses a source the store does not hold', async () => {
    expect(
      await applyTrustSync(database.db, {
        sourceId: 'bsi-de',
        list: { sha256: 'a'.repeat(64), signingTime: T1, anchors: [ONE] },
        crls: [],
        now: NOW,
      }),
    ).toMatchObject({ outcome: 'refused', reason: 'source_unknown' });
    expect(await store()).toEqual({ anchors: [], crls: [] });
  });

  it('withdraws an anchor only when no enabled source lists it any more', async () => {
    await syncTrustAnchorSources(database.db, [
      { id: 'bsi-de', enabled: true },
      { id: 'npkd-nl', enabled: true },
    ]);
    for (const sourceId of ['bsi-de', 'npkd-nl']) {
      await applyTrustSync(database.db, {
        sourceId,
        list: { sha256: 'a'.repeat(64), signingTime: T1, anchors: [ONE] },
        crls: [],
        now: NOW,
      });
    }
    await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'b'.repeat(64), signingTime: T2, anchors: [] },
      crls: [],
      now: LATER,
    });
    expect((await store()).anchors).toEqual([[ONE.sha256, false]]);
    expect(await trustAnchorSourceOf(database.db, ONE.sha256)).toBe('npkd-nl');

    await syncTrustAnchorSources(database.db, [{ id: 'npkd-nl', enabled: false }]);
    expect((await store()).anchors).toEqual([[ONE.sha256, true]]);
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(false);
  });

  it('stores current CRLs, drops older ones of the issuer, refuses a lower cRLNumber or a stale one', async () => {
    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: true }]);
    await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'a'.repeat(64), signingTime: T1, anchors: [ONE] },
      crls: [crl('forty')],
      now: NOW,
    });

    const newer = await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: null,
      crls: [
        crl('forty-one', { crlNumber: '41', thisUpdate: new Date('2026-10-22T00:00:00.000Z') }),
      ],
      now: NOW,
    });
    expect(newer).toMatchObject({ outcome: 'accepted', crlsUpdated: 1, anchorsSeen: 0 });
    expect((await store()).crls).toEqual([crl('forty-one').sha256]);

    const lower = await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: null,
      crls: [
        crl('thirty-nine', { crlNumber: '39' }),
        crl('stale', {
          crlNumber: '50',
          issuerKeyId: 'c0ffee',
          thisUpdate: new Date('2026-09-01T00:00:00.000Z'),
          nextUpdate: new Date('2026-10-01T00:00:00.000Z'),
        }),
      ],
      now: NOW,
    });
    expect(lower).toEqual({
      outcome: 'accepted',
      reason: null,
      anchorsSeen: 0,
      anchorsWithdrawn: 0,
      crlsUpdated: 0,
      crlsRefused: [
        {
          issuerCountry: 'DE',
          issuerKeyId: crl('one').issuerKeyId,
          reason: 'crl_number_rollback',
        },
        { issuerCountry: 'DE', issuerKeyId: 'c0ffee', reason: 'crl_not_current' },
      ],
    });
    expect((await store()).crls).toEqual([crl('forty-one').sha256]);
    expect((await syncs()).slice(-3).map((row) => [row.outcome, row.reason])).toEqual([
      ['refused', 'crl_number_rollback'],
      ['refused', 'crl_not_current'],
      ['accepted', null],
    ]);
  });

  it('keeps a seeded anchor sandbox-only, out of the production store', async () => {
    await syncTrustAnchorSources(database.db, [{ id: 'openverify-sandbox', enabled: true }]);
    const utopia = anchor('utopia', { country: 'UT', sandboxOnly: true });

    await applyTrustSync(database.db, {
      sourceId: 'openverify-sandbox',
      list: { sha256: utopia.sha256, signingTime: NOW, anchors: [utopia] },
      crls: [crl('utopia', { issuerCountry: 'UT', issuerKeyId: utopia.ski })],
      now: NOW,
    });

    expect((await store('production')).anchors).toEqual([]);
    expect((await store('sandbox')).anchors).toEqual([[utopia.sha256, false]]);
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(false);
  });
});

describe('recordTrustAnchorSync (C62.7)', () => {
  it('audits a sync that did not reach the store', async () => {
    await syncTrustAnchorSources(database.db, [{ id: 'bsi-de', enabled: true }]);

    await recordTrustAnchorSync(database.db, {
      sourceId: 'bsi-de',
      outcome: 'refused',
      reason: 'signature_invalid',
      listSha256: 'd'.repeat(64),
    });
    await recordTrustAnchorSync(database.db, {
      sourceId: null,
      outcome: 'failed',
      reason: 'fetch_failed',
    });

    expect(await syncs()).toEqual([
      {
        source_id: 'bsi-de',
        outcome: 'refused',
        reason: 'signature_invalid',
        list_sha256: 'd'.repeat(64),
        anchors_seen: 0,
        anchors_withdrawn: 0,
        crls_updated: 0,
      },
      {
        source_id: null,
        outcome: 'failed',
        reason: 'fetch_failed',
        list_sha256: null,
        anchors_seen: 0,
        anchors_withdrawn: 0,
        crls_updated: 0,
      },
    ]);
  });
});

describe('trustStoreOverview (C62.10)', () => {
  it('summarises sources, countries, withdrawn anchors, CRLs and the sandbox anchors', async () => {
    onTestFinished(wallClockStepsBack());
    await syncTrustAnchorSources(database.db, [
      { id: 'bsi-de', enabled: true },
      { id: 'npkd-nl', enabled: false },
      { id: 'openverify-sandbox', enabled: true },
    ]);
    const french = anchor('fr', {
      country: 'FR',
      notAfter: new Date('2033-06-15T00:00:00.000Z'),
    });
    // Each source's last sync is its newest row, so each sync row is stamped as it is written.
    const clock = createdAtClock(database.db);
    const stampLastSync = async () => {
      const [row] = (
        await database.db.execute<{ id: number }>(sql`select max(id) as id from trust_anchor_syncs`)
      ).rows;
      await clock.at('trust_anchor_syncs', row?.id ?? 0);
    };
    await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'a'.repeat(64), signingTime: T1, anchors: [ONE, TWO, LINK, french] },
      crls: [],
      now: NOW,
    });
    await stampLastSync();
    await applyTrustSync(database.db, {
      sourceId: 'bsi-de',
      list: { sha256: 'b'.repeat(64), signingTime: T2, anchors: [ONE, LINK, french] },
      crls: [
        crl('de'),
        crl('fr', {
          issuerCountry: 'FR',
          issuerKeyId: french.ski,
          thisUpdate: new Date('2026-10-01T00:00:00.000Z'),
          nextUpdate: new Date('2026-10-24T09:00:00.000Z'),
        }),
      ],
      now: LATER,
    });
    await stampLastSync();
    const utopia = anchor('utopia', {
      country: 'UT',
      sandboxOnly: true,
      notBefore: new Date('2025-01-01T00:00:00.000Z'),
      notAfter: new Date('2041-01-01T00:00:00.000Z'),
    });
    const utopiaCrl = crl('utopia', {
      issuerCountry: 'UT',
      issuerKeyId: utopia.ski,
      thisUpdate: NOW,
      nextUpdate: new Date('2027-01-21T08:00:00.000Z'),
      crlNumber: '20384',
    });
    await applyTrustSync(database.db, {
      sourceId: 'openverify-sandbox',
      list: { sha256: utopia.sha256, signingTime: NOW, anchors: [utopia] },
      crls: [utopiaCrl],
      now: NOW,
    });
    await stampLastSync();

    const overview = await trustStoreOverview(database.db, new Date('2026-10-24T10:00:00.000Z'));

    expect(overview).toEqual({
      hasProductionAnchor: true,
      sources: [
        {
          id: 'bsi-de',
          enabled: true,
          lastSyncedAt: LATER,
          listSigningTime: T2,
          listSha256: 'b'.repeat(64),
          anchors: 3,
          lastSync: {
            outcome: 'accepted',
            reason: null,
            anchorsSeen: 3,
            anchorsWithdrawn: 1,
            crlsUpdated: 2,
            createdAt: expect.any(Date) as Date,
          },
        },
        {
          id: 'npkd-nl',
          enabled: false,
          lastSyncedAt: null,
          listSigningTime: null,
          listSha256: null,
          anchors: 0,
          lastSync: null,
        },
        {
          id: 'openverify-sandbox',
          enabled: true,
          lastSyncedAt: NOW,
          listSigningTime: NOW,
          listSha256: utopia.sha256,
          anchors: 1,
          lastSync: {
            outcome: 'accepted',
            reason: null,
            anchorsSeen: 1,
            anchorsWithdrawn: 0,
            crlsUpdated: 1,
            createdAt: expect.any(Date) as Date,
          },
        },
      ],
      countries: [
        {
          country: 'DE',
          anchors: 2,
          linkCertificates: 1,
          withdrawnAnchors: 1,
          nextExpiry: new Date('2035-01-01T00:00:00.000Z'),
        },
        {
          country: 'FR',
          anchors: 1,
          linkCertificates: 0,
          withdrawnAnchors: 0,
          nextExpiry: new Date('2033-06-15T00:00:00.000Z'),
        },
      ],
      withdrawnAnchors: [
        { id: TWO.sha256, country: 'DE', subjectDn: TWO.subjectDn, withdrawnAt: LATER },
      ],
      crls: [
        {
          issuerCountry: 'DE',
          issuerKeyId: crl('de').issuerKeyId,
          thisUpdate: crl('de').thisUpdate,
          nextUpdate: crl('de').nextUpdate,
          fetchedAt: expect.any(Date) as Date,
          freshness: 'current',
        },
        {
          issuerCountry: 'FR',
          issuerKeyId: french.ski,
          thisUpdate: new Date('2026-10-01T00:00:00.000Z'),
          nextUpdate: new Date('2026-10-24T09:00:00.000Z'),
          fetchedAt: expect.any(Date) as Date,
          freshness: 'expired',
        },
        {
          issuerCountry: 'UT',
          issuerKeyId: utopia.ski,
          thisUpdate: NOW,
          nextUpdate: new Date('2027-01-21T08:00:00.000Z'),
          fetchedAt: expect.any(Date) as Date,
          freshness: 'current',
        },
      ],
      sandboxAnchors: [
        {
          id: utopia.sha256,
          country: 'UT',
          notBefore: utopia.notBefore,
          notAfter: utopia.notAfter,
          crlNextUpdate: new Date('2027-01-21T08:00:00.000Z'),
        },
      ],
    });
  });

  it('is empty for an empty store', async () => {
    expect(await trustStoreOverview(database.db, NOW)).toEqual({
      hasProductionAnchor: false,
      sources: [],
      countries: [],
      withdrawnAnchors: [],
      crls: [],
      sandboxAnchors: [],
    });
  });
});
