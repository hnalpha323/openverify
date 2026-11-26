/**
 * C70.4 (F10): `eventFilterSubjects` hands report payloads to `resolveReportFilterSubjects` (the
 * `api-reports` hook, a recording fake here) and marks what it answers strict; a verification
 * without an inquiry keeps C14's rule. Synthetic values only.
 */
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventFilterSubjects, toEventSubject } from './subject.js';

const hooks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../services/reports/filter-subjects.js', () => ({
  resolveReportFilterSubjects: hooks.resolve,
}));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const env = 'env_01JB0000000000000000000001';
const report = { data: { type: 'report/watchlist', id: 'rep_01JB0000000000000000000001' } };
const verification = {
  data: { type: 'verification/selfie', id: 'ver_01JB0000000000000000000001', relationships: {} },
};

describe('C70.4: report events have strict filter subjects', () => {
  it('resolves report payloads through the hook and marks them strict', async () => {
    hooks.resolve.mockResolvedValueOnce([{ accountTypeId: 'acctp_01JB0000000000000000000001' }]);

    const subjects = await eventFilterSubjects(database.db, env, [verification, report]);

    expect(hooks.resolve).toHaveBeenCalledWith(database.db, env, [report]);
    expect(subjects).toEqual([
      {},
      { accountTypeId: 'acctp_01JB0000000000000000000001', strict: true },
    ]);
    expect(toEventSubject(subjects[1])).toEqual({
      accountTypeId: 'acctp_01JB0000000000000000000001',
      strict: true,
    });
    expect(toEventSubject(subjects[0])).toEqual({});
  });
});
