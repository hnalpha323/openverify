/**
 * C62.7 against Postgres 17 (Testcontainers): the trust store's writer (`applyTrustSync`) holds
 * the source's advisory lock (and each CRL issuer's) for its whole transaction, so two syncs of
 * one source serialize: a sync waits for another that holds the lock; an older list racing a
 * newer one never ends up as the source's list (it is refused, or the newer one replaces it); two
 * CRLs of one issuer racing leave the higher `cRLNumber`. Certificates and CRLs are synthetic
 * bytes: the repository stores what the sync verified.
 */
import { createHash } from 'node:crypto';
import {
  applyTrustSync,
  createDatabase,
  loadTrustStore,
  runMigrations,
  syncTrustAnchorSources,
  trustStoreOverview,
  type Database,
  type TrustAnchorInput,
  type TrustCrlInput,
} from '@openverify/db';
import { createIntegrationPool, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WAIT_MS = 1_500;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const T1 = new Date('2026-09-01T08:00:00.000Z');
const T2 = new Date('2026-10-01T08:00:00.000Z');

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 10 });
  db = createDatabase(pool);
  await runMigrations(db);
}, 180_000);

afterAll(async () => {
  await ifSet(pool)?.end();
  await container?.stop();
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function anchor(name: string): TrustAnchorInput {
  const certificate = new Uint8Array(Buffer.from(`synthetic certificate ${name}`));
  return {
    sha256: sha256(certificate),
    certificate,
    country: 'DE',
    subjectDn: `C=DE, CN=Synthetic ${name}`,
    ski: createHash('sha1').update(name).digest('hex'),
    aki: null,
    notBefore: new Date('2020-01-01T00:00:00.000Z'),
    notAfter: new Date('2035-01-01T00:00:00.000Z'),
    isLink: false,
  };
}

function crl(name: string, crlNumber: string, issuerKeyId: string): TrustCrlInput {
  const der = new Uint8Array(Buffer.from(`synthetic crl ${name}`));
  return {
    sha256: sha256(der),
    der,
    issuerCountry: 'DE',
    issuerKeyId,
    thisUpdate: new Date('2026-10-19T00:00:00.000Z'),
    nextUpdate: new Date('2026-11-19T00:00:00.000Z'),
    crlNumber,
    url: null,
  };
}

async function settlesWithin(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  const watched = promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.race([watched, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  return settled;
}

describe('C62.7: concurrent syncs of one source', () => {
  it('a sync waits for another that holds the source’s advisory lock', async () => {
    await syncTrustAnchorSources(db, [{ id: 'lock-de', enabled: true }]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'openverify/trust-anchor-source/lock-de',
      ]);
      const running = applyTrustSync(db, {
        sourceId: 'lock-de',
        list: { sha256: 'a'.repeat(64), signingTime: T2, anchors: [anchor('lock')] },
        crls: [],
        now: NOW,
      });

      const waited = !(await settlesWithin(running));
      await client.query('COMMIT');

      expect(waited).toBe(true);
      expect(await running).toMatchObject({ outcome: 'accepted', anchorsSeen: 1 });
    } finally {
      client.release();
    }
  });

  it('an older list racing a newer one never ends up as the source’s list', async () => {
    await syncTrustAnchorSources(db, [{ id: 'race-de', enabled: true }]);
    const kept = anchor('race-kept');
    const dropped = anchor('race-dropped');

    const results = await Promise.all([
      applyTrustSync(db, {
        sourceId: 'race-de',
        list: { sha256: 'b'.repeat(64), signingTime: T2, anchors: [kept] },
        crls: [],
        now: NOW,
      }),
      applyTrustSync(db, {
        sourceId: 'race-de',
        list: { sha256: 'c'.repeat(64), signingTime: T1, anchors: [kept, dropped] },
        crls: [],
        now: NOW,
      }),
    ]);

    expect(results.map((result) => result.outcome)).toContain('accepted');
    const source = (await trustStoreOverview(db, NOW)).sources.find(
      (candidate) => candidate.id === 'race-de',
    );
    expect(source).toMatchObject({ listSigningTime: T2, listSha256: 'b'.repeat(64), anchors: 1 });
    const { anchors } = await loadTrustStore(db, { environmentKind: 'production' });
    // Refused, it was never stored; applied first, the newer list withdrew it.
    expect(anchors.filter((stored) => stored.id === dropped.sha256 && !stored.withdrawn)).toEqual(
      [],
    );
    expect(anchors.find((stored) => stored.id === kept.sha256)?.withdrawn).toBe(false);
  });

  it('two CRLs of one issuer racing leave the higher cRLNumber', async () => {
    await syncTrustAnchorSources(db, [
      { id: 'crl-a', enabled: true },
      { id: 'crl-b', enabled: true },
    ]);
    const key = createHash('sha1').update('crl-issuer').digest('hex');
    const higher = crl('forty-one', '41', key);
    const lower = crl('forty', '40', key);

    await Promise.all([
      applyTrustSync(db, { sourceId: 'crl-a', list: null, crls: [higher], now: NOW }),
      applyTrustSync(db, { sourceId: 'crl-b', list: null, crls: [lower], now: NOW }),
    ]);

    const { crls } = await loadTrustStore(db, { environmentKind: 'production' });
    expect(
      crls.filter((stored) => stored.issuerKeyId === key).map((stored) => sha256(stored.der)),
    ).toEqual([higher.sha256]);
  });
});
