/**
 * C62.8 (V04): the sandbox anchor `seed:dev` inserts: the deterministic Utopia CSCA (the same
 * bytes within a calendar year), its CRL current for 90 days and refreshed on every run, listed
 * by the enabled `openverify-sandbox` source, and never loaded for a production environment.
 */
import { createHash } from 'node:crypto';
import { loadTrustStore, hasNonSandboxTrustAnchor, trustStoreOverview } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { buildUtopiaCsca } from '@openverify/emrtd/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SANDBOX_TRUST_SOURCE, installSandboxTrustAnchor } from './sandbox.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const NOW = new Date('2026-10-23T08:00:00.000Z');
const DAY_MS = 86_400_000;

describe('installSandboxTrustAnchor (C62.8)', () => {
  it('lists the Utopia CSCA for sandbox environments only, with a 90-day CRL', async () => {
    const installed = await installSandboxTrustAnchor(database.db, { now: NOW });

    const csca = buildUtopiaCsca({ now: NOW });
    expect(installed).toEqual({
      anchorId: createHash('sha256').update(csca.der).digest('hex'),
      notBefore: csca.notBefore,
      notAfter: csca.notAfter,
      crlNextUpdate: new Date(NOW.getTime() + 90 * DAY_MS),
    });
    const sandbox = await loadTrustStore(database.db, { environmentKind: 'sandbox' });
    expect(sandbox.anchors).toMatchObject([
      { id: installed.anchorId, country: 'UT', sandboxOnly: true, withdrawn: false },
    ]);
    expect(sandbox.crls).toMatchObject([{ issuerCountry: 'UT', thisUpdate: NOW }]);
    expect((await loadTrustStore(database.db, { environmentKind: 'production' })).anchors).toEqual(
      [],
    );
    expect(await hasNonSandboxTrustAnchor(database.db)).toBe(false);
    const overview = await trustStoreOverview(database.db, NOW);
    expect(overview.sources.map((source) => [source.id, source.enabled, source.anchors])).toEqual([
      [SANDBOX_TRUST_SOURCE, true, 1],
    ]);
  });

  it('keeps the same anchor on a re-run and refreshes its CRL', async () => {
    const first = await installSandboxTrustAnchor(database.db, { now: NOW });
    const later = new Date(NOW.getTime() + 3 * DAY_MS);

    const second = await installSandboxTrustAnchor(database.db, { now: later });

    expect(second.anchorId).toBe(first.anchorId);
    expect(second.crlNextUpdate).toEqual(new Date(later.getTime() + 90 * DAY_MS));
    const { anchors, crls } = await loadTrustStore(database.db, { environmentKind: 'sandbox' });
    expect(anchors.map((anchor) => [anchor.id, anchor.withdrawn])).toEqual([
      [first.anchorId, false],
    ]);
    expect(crls).toMatchObject([{ thisUpdate: later }]);
  });
});
