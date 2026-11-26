/**
 * C99.5 (Workflow 7B, `api-lists`; V21): the `list-config` publish rules: a named list of a kind the
 * environment does not collect is refused, with a pointer per list, and a named list this
 * environment does not hold is refused too. Synthetic values.
 */
import { updateEnvironmentSettings, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiDependencies } from '../context.js';
import { listConfigPublishProblems } from './list-config.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
const deps = {} as ApiDependencies;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const problems = (screen: 'all' | 'none' | string[], id = environmentId) =>
  listConfigPublishProblems({
    deps,
    db,
    environment: { id, kind: 'sandbox' },
    listConfig: { screen },
  });

describe('listConfigPublishProblems (C99.5)', () => {
  it('refuses nothing for all, none, or no member', async () => {
    expect(await problems('all')).toEqual([]);
    expect(await problems('none')).toEqual([]);
    expect(
      await listConfigPublishProblems({
        deps,
        db,
        environment: { id: environmentId, kind: 'sandbox' },
        listConfig: {},
      }),
    ).toEqual([]);
  });

  it('takes a named list of a kind the environment collects, an archived one too', async () => {
    const strings = await seedList(db, environmentId, { kind: 'string' });
    const archived = await seedList(db, environmentId, { kind: 'string', status: 'archived' });
    const faces = await seedList(db, environmentId, { kind: 'face' });
    expect(await problems([strings.id, archived.id, faces.id])).toEqual([]);
  });

  it('refuses a named list of a kind not collected, pointing at its position (V21)', async () => {
    const strings = await seedList(db, environmentId, { kind: 'string' });
    const prints = await seedList(db, environmentId, { kind: 'browser-fingerprint' });
    const points = await seedList(db, environmentId, { kind: 'geolocation' });

    expect(await problems([strings.id, prints.id, points.id])).toEqual([
      {
        code: 'kind_not_collected',
        detail: expect.stringContaining('browser-fingerprint') as string,
        pointer: '/data/attributes/list-config/screen/1',
      },
      {
        code: 'kind_not_collected',
        detail: expect.stringContaining('geolocation') as string,
        pointer: '/data/attributes/list-config/screen/2',
      },
    ]);
  });

  it('takes a fingerprint list once recognition is on', async () => {
    const { environment } = await createTestTenant(db);
    await updateEnvironmentSettings(db, environment.id, {
      'signal-collection': {
        'session-integrity': 'on',
        'device-recognition': 'exempt',
        'device-recognition-basis': 'A recorded basis',
      },
    });
    const prints = await seedList(db, environment.id, { kind: 'device-fingerprint' });
    expect(await problems([prints.id], environment.id)).toEqual([]);
  });

  it('refuses a list this environment does not hold', async () => {
    const other = (await createTestTenant(db)).environment.id;
    const elsewhere = await seedList(db, other, { kind: 'string' });
    expect(await problems([elsewhere.id])).toEqual([
      {
        code: 'list_kind_mismatch',
        detail: 'Names a list this environment does not hold.',
        pointer: '/data/attributes/list-config/screen/0',
      },
    ]);
  });
});
