/**
 * C73.4: the sealed report columns (`reports.query`, `reports.result`, `report_actions.details`,
 * `report_matches.snapshot`) are listed for the KEK rewrap, and `kek:rewrap` re-wraps each of them,
 * `report_actions` included through its append-only trigger's rewrap case (C73.2). Synthetic
 * values only.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { openJson, type Sealed } from '../sealed.js';
import {
  createTestDatabase,
  createTestTenant,
  seedReport,
  seedReportAction,
  seedReportMatch,
  seedReportRun,
  seedReportTemplate,
  type TestDatabase,
} from '../testing.js';
import { REWRAP_TABLES, rewrapAll } from './key-rotation.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const oldKeyring = createKeyring(oldKek);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: oldKeyring });
}, 60_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const REPORT_COLUMNS = [
  'report_actions.details:row',
  'report_matches.snapshot:row',
  'reports.query:row',
  'reports.result:row',
];

describe('C73.4: the sealed report columns', () => {
  it('are listed for the rewrap, under their seal names', () => {
    expect(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}:${c.aad}`)).toEqual(
      expect.arrayContaining(REPORT_COLUMNS),
    );
    expect(REWRAP_TABLES).toEqual(
      expect.arrayContaining(['reports', 'report_actions', 'report_matches']),
    );
    expect(SEALED).toMatchObject({
      reportQuery: 'reports.query',
      reportResult: 'reports.result',
      reportActionDetails: 'report_actions.details',
      reportMatchSnapshot: 'report_matches.snapshot',
    });
  });

  it('are re-wrapped by kek:rewrap, so the new KEK alone opens them', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const { templateId, versionId } = await seedReportTemplate(database.db, env);
    const reportId = await seedReport(database.db, env, {
      templateId,
      versionId,
      result: { 'email-domain': 'synthetic.example' },
    });
    const runId = await seedReportRun(database.db, env, { reportId });
    const matchId = await seedReportMatch(database.db, env, { reportId, runId });
    const actionId = await seedReportAction(database.db, env, { reportId });

    await rewrapAll(database.db, { keyring: createKeyring(newKek, [oldKek]) });

    const newOnly = createKeyring(newKek);
    const read = async (table: string, column: string, id: string) => {
      const rows = await database.client.query<{ value: Sealed }>(
        `select "${column}" as value from "${table}" where id = $1`,
        [id],
      );
      const value = rows.rows[0]?.value;
      return value === undefined ? undefined : openJson(`${table}.${column}`, id, value, newOnly);
    };
    expect(await read('reports', 'query', reportId)).toEqual({
      'name-first': 'Avery',
      'name-last': 'Synthetic',
    });
    expect(await read('reports', 'result', reportId)).toEqual({
      'email-domain': 'synthetic.example',
    });
    expect(await read('report_matches', 'snapshot', matchId)).toEqual({
      'entry-key': 'openverify-sandbox:SYN-1',
    });
    expect(await read('report_actions', 'details', actionId)).toEqual({
      reason: 'Synthetic reason',
    });
  });
});
