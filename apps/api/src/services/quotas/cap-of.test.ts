/**
 * C251.2 (Workflow 11B, `quotas`): the cap admission reads, from the environment's stored settings,
 * at most the install ceiling (PGlite with every migration).
 */
import { updateEnvironmentSettings, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCapOf } from './cap-of.js';

let database: TestDatabase;
let db: Db;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('createCapOf (C251.2)', () => {
  it('is the default for an environment that set nothing, at most the ceiling', async () => {
    const { environment } = await createTestTenant(db);
    expect(await createCapOf({ ceiling: 50 })(db, environment.id, 'report-run')).toBe(50);
    expect(await createCapOf({ ceiling: 7 })(db, environment.id, 'report-run')).toBe(7);
  });

  it('reads the environment’s own lower cap, and clamps a stored value above the ceiling', async () => {
    const { environment } = await createTestTenant(db);
    await updateEnvironmentSettings(db, environment.id, {
      'queue-in-flight-caps': { 'report-run': 3, 'list-screen': 900 },
    });
    const capOf = createCapOf({ ceiling: 50 });
    expect(await capOf(db, environment.id, 'report-run')).toBe(3);
    expect(await capOf(db, environment.id, 'list-screen')).toBe(50);
    expect(await capOf(db, environment.id, 'graph-query')).toBe(50);
  });

  it('admits nothing for an environment that no longer exists', async () => {
    expect(await createCapOf({ ceiling: 50 })(db, testId('env'), 'report-run')).toBe(0);
  });
});
