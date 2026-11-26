/**
 * C168.2 (Phase 9, Workflow 9B; decision 45): `require-mfa` is on for every organisation created from
 * Phase 9 on. Every creation path the inventory names goes through `createOrganization`, whose
 * omitted `requireMfa` takes the column default (`true`); only the dev seed and the test helpers
 * turn it off, explicitly. Existing organisations keep their value (the migration only changes the
 * default).
 *
 * Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { createOrganization, getOrganization } from '@openverify/db';
import { createTestDatabase, testId, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

/** The organisation-creation paths of docs/research/phase9-inventory.md, from apps/api. */
const CREATION_PATHS: readonly [string, 'default' | 'off'][] = [
  ['src/seed/dev-seed.ts', 'off'],
  ['../../packages/db/src/testing.ts', 'off'],
  ['src/routes/dashboard/dashboard.test-support.ts', 'off'],
  ['scripts/graph-benchmark.ts', 'default'],
  ['scripts/face-scan-benchmark.ts', 'default'],
];

describe('require-mfa on by default (C168.2)', () => {
  it('starts an organisation created without a value with require-mfa', async () => {
    const organization = await createOrganization(database.db, {
      id: testId('org'),
      name: 'Example Synthetic Org',
    });

    expect((await getOrganization(database.db, organization.id))?.requireMfa).toBe(true);
  });

  it.each(CREATION_PATHS)('%s creates organisations with require-mfa %s', (file, expected) => {
    const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
    // Workflow 11A Stage 1a (C): the test tenant writes its organisation with SQL (so upgrade tests
    // run on schemas before 0035's `connect_inbound`), naming `require_mfa` as the repository does.
    const calls = [
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      ...(source.match(/createOrganization\((?:[^()]|\([^()]*\))*\)/gs) ?? []),
      ...(source.match(/insert into organizations \(id, name, require_mfa\)[^`]*/gs) ?? []),
    ];

    expect(calls.length, file).toBeGreaterThan(0);
    for (const call of calls) {
      if (expected === 'off') {
        expect(call, file).toMatch(
          /requireMfa: (?:false|options\.requireMfa \?\? false)|\$\{options\.requireMfa \?\? false\}/,
        );
      } else {
        expect(call, file).not.toContain('requireMfa');
      }
    }
  });
});
