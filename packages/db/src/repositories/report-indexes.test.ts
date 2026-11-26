/**
 * C73.4 (P10, H18, F13; Workflow 6A Stage 3, `api-reports`): `rebuildReportIndexes`, the report
 * half of `blind-index:rebuild`: every unredacted report's crypto index and every unredacted
 * match's entry index and evidence hash recomputed under a new key from stored values only (the
 * sealed result's canonical address, the sealed snapshot's entry key and evidence input), never
 * today's list. Redacted rows are skipped. Synthetic values only.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  reportCryptoAddressIndex,
  reportMatchEntryIndex,
  reportMatchEvidenceHash,
} from '../blind-index.js';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportMatch,
  seedReportRun,
  seedReportTemplate,
  type TestDatabase,
} from '../testing.js';
import { listReportMatches } from './report-matches.js';
import { getReport, rebuildReportIndexes } from './reports.js';

let database: TestDatabase;
let environmentId: string;
const OLD_KEY = new Uint8Array(32).fill(0x11);
const NEW_KEY = new Uint8Array(32).fill(0x22);
const ADDRESS = `0x${'ab'.repeat(20)}`;
const ENTRY = 'openverify-sandbox:SBX-IDX-1';
const EVIDENCE = JSON.stringify([ENTRY, 'c'.repeat(64), 'Avery Synthetic', ['Avery', 'Synthetic']]);

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function seeded(options: { redacted?: boolean } = {}) {
  const { templateId, versionId } = await seedReportTemplate(database.db, environmentId, {
    reportType: 'crypto-address-watchlist',
    config: { 'search-lists': ['openverify-sandbox'] },
  });
  const reportId = await seedReport(database.db, environmentId, {
    templateId,
    versionId,
    reportType: 'crypto-address-watchlist',
    status: 'ready',
    query: options.redacted === true ? null : { 'crypto-address': ADDRESS },
    result: options.redacted === true ? null : { 'canonical-address': ADDRESS },
    cryptoAddressIndex:
      options.redacted === true
        ? null
        : reportCryptoAddressIndex(OLD_KEY, { environmentId, address: ADDRESS }),
    redactedAt: options.redacted === true ? new Date() : null,
  });
  const runId = await seedReportRun(database.db, environmentId, { reportId, status: 'ready' });
  const matchId = await seedReportMatch(database.db, environmentId, {
    reportId,
    runId,
    entryIndex:
      options.redacted === true
        ? null
        : reportMatchEntryIndex(OLD_KEY, { environmentId, entryKey: ENTRY }),
    evidenceHash:
      options.redacted === true
        ? null
        : reportMatchEvidenceHash(OLD_KEY, { environmentId, parts: [EVIDENCE] }),
    snapshot: options.redacted === true ? null : { 'entry-key': ENTRY, 'evidence-input': EVIDENCE },
  });
  return { reportId, matchId };
}

describe('rebuildReportIndexes (C73.4)', () => {
  it('recomputes every index under the new key from stored values, skips redacted rows and is idempotent', async () => {
    const live = await seeded();
    const redacted = await seeded({ redacted: true });
    const first = await rebuildReportIndexes(database.db, NEW_KEY, { batchSize: 1 });
    expect(first.reports.updated).toBe(1);
    expect(first.matches.updated).toBe(1);
    expect(first.reports.scanned).toBeGreaterThanOrEqual(1);
    expect((await getReport(database.db, environmentId, live.reportId))?.cryptoAddressIndex).toBe(
      reportCryptoAddressIndex(NEW_KEY, { environmentId, address: ADDRESS }),
    );
    const [match] = await listReportMatches(database.db, environmentId, live.reportId);
    expect(match?.entryIndex).toBe(
      reportMatchEntryIndex(NEW_KEY, { environmentId, entryKey: ENTRY }),
    );
    expect(match?.evidenceHash).toBe(
      reportMatchEvidenceHash(NEW_KEY, { environmentId, parts: [EVIDENCE] }),
    );
    const [untouched] = await listReportMatches(database.db, environmentId, redacted.reportId);
    expect(untouched).toMatchObject({ entryIndex: null, evidenceHash: null, snapshot: null });
    const second = await rebuildReportIndexes(database.db, NEW_KEY);
    expect(second.reports.updated).toBe(0);
    expect(second.matches.updated).toBe(0);
  });

  it('refuses a key that is not 32 bytes before reading anything', async () => {
    await expect(rebuildReportIndexes(database.db, new Uint8Array(8))).rejects.toThrow();
    const rows = await database.db.execute(sql`select count(*)::int as n from reports`);
    expect((rows as unknown as { rows: { n: number }[] }).rows[0]?.n).toBeGreaterThan(0);
  });
});
