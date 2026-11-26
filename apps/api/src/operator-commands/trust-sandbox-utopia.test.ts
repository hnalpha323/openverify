/**
 * C208.1 (decision 69; review F27; Phase 10, Workflow 10C; `api-nfc`): `trust:sandbox-utopia`
 * installs or refreshes the sandbox-only Utopia test anchor through `applyTrustSync` to the
 * `openverify-sandbox` source. It names what it did in one line of codes and dates, and a
 * production environment's loader never sees the anchor. (In production mode, against Postgres:
 * `services/sandbox-chip.integration.test.ts`.)
 */
import { loadTrustStore, trustAnchorSourceOf, type Db } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runTrustSandboxUtopia } from './trust-sandbox-utopia.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const LATER = new Date('2026-11-20T12:00:00.000Z');

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function run(now: Date) {
  const lines: string[] = [];
  const result = await runTrustSandboxUtopia({
    db,
    clock: { now: () => now },
    out: (line) => lines.push(line),
  });
  return { result, lines };
}

describe('trust:sandbox-utopia (C208.1)', () => {
  it('installs the anchor where the store has none, and says so in one line', async () => {
    expect((await loadTrustStore(db, { environmentKind: 'sandbox' })).anchors).toEqual([]);

    const { result, lines } = await run(NOW);

    expect(result.outcome).toBe('installed');
    expect(lines).toEqual([
      'trust:sandbox-utopia installed source=openverify-sandbox crl-next-update=2027-02-08T12:00:00.000Z',
    ]);
    const { anchors, crls } = await loadTrustStore(db, { environmentKind: 'sandbox' });
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ country: 'UT', sandboxOnly: true, withdrawn: false });
    expect(crls).toHaveLength(1);
    expect(await trustAnchorSourceOf(db, anchors[0]?.id ?? '')).toBe('openverify-sandbox');
  });

  it('is never visible to a production environment’s loader', async () => {
    expect((await loadTrustStore(db, { environmentKind: 'production' })).anchors).toEqual([]);
  });

  it('refreshes the anchor’s CRL on a later run, keeping the one anchor', async () => {
    const { result, lines } = await run(LATER);

    expect(result.outcome).toBe('refreshed');
    expect(lines).toEqual([
      'trust:sandbox-utopia refreshed source=openverify-sandbox crl-next-update=2027-02-18T12:00:00.000Z',
    ]);
    const { anchors, crls } = await loadTrustStore(db, { environmentKind: 'sandbox' });
    expect(anchors).toHaveLength(1);
    expect(crls.map((crl) => crl.nextUpdate?.toISOString())).toContain('2027-02-18T12:00:00.000Z');
  });

  it('installs again once the source was disabled, re-enabling it', async () => {
    await db.execute(sql`update trust_anchor_sources set enabled = false`);
    expect(
      (await loadTrustStore(db, { environmentKind: 'sandbox' })).anchors.map(
        (anchor) => anchor.withdrawn,
      ),
    ).toEqual([true]);

    const { result } = await run(LATER);

    expect(result.outcome).toBe('installed');
    expect(
      (await loadTrustStore(db, { environmentKind: 'sandbox' })).anchors.map(
        (anchor) => anchor.withdrawn,
      ),
    ).toEqual([false]);
  });

  it('prints nothing but the outcome line: no certificate, key or name', async () => {
    const { lines } = await run(LATER);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^trust:sandbox-utopia (installed|refreshed) source=openverify-sandbox crl-next-update=\S+$/,
    );
  });
});
