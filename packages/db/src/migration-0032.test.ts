/**
 * Migration 0032 (Workflow 9D, `fix-api`, K9-24; S4B-14), upgrading a database at 0031 on PGlite:
 * - `analytics_rollup_state.closed_through`: the last local day the rollup closed, so a raised settle
 *   window never reopens it (AA6); every existing state's open days are recomputed by the next pass
 *   (`outcomes_as_of` cleared), so they gain the rows below at once;
 * - the reserved start `$start` as `analytics_transition_daily.from_step_id`, so the entry step gets
 *   a transition into it (AL6);
 * - `verification_type` and `requirement` on `analytics_check_reason_daily` (AL7): an earlier reason
 *   row takes them from its check's results of the same day, version and source when they name one
 *   type and requirement; a row they cannot attribute is removed, never guessed;
 * - the webhooks' `updated_at` stays when an update sets `failure_alert_notified_at` alone (KW2).
 *
 * Every value is synthetic.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import { PGLITE_EXTENSIONS, createTestTenant, testId } from './testing.js';

let upgraded: PGlite;
let environmentId: string;
const template = testId('itmpl');
const version = testId('itmplv');
const webhookId = testId('wbh');
const EARLIER = '2026-01-02T03:04:05.000Z';

const key = `$1, '2026-01-05', 'UTC', 'facts', '${template}', '${version}'`;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const earlier = drizzle({ client: upgraded, schema });
  await runMigrations(earlier, { upTo: '0031_phase9b' });
  const { environment } = await createTestTenant(earlier);
  environmentId = environment.id;
  await upgraded.query(
    `insert into analytics_rollup_state (environment_id, rolled_up_through, outcomes_as_of, time_zone)
     values ($1, '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z', 'UTC')`,
    [environmentId],
  );
  // `id_expired` ran one way only; `name_match` both required and not required on that day.
  for (const [type, check, requirement] of [
    ['government_id', 'id_expired', 'required'],
    ['government_id', 'name_match', 'required'],
    ['government_id', 'name_match', 'not_required'],
  ] as const) {
    await upgraded.query(
      `insert into analytics_check_daily (environment_id, day, time_zone, source, inquiry_template_id,
         inquiry_template_version_id, verification_type, check_name, requirement, status, count)
       values (${key}, $2, $3, $4, 'failed', 2)`,
      [environmentId, type, check, requirement],
    );
  }
  for (const check of ['id_expired', 'name_match']) {
    await upgraded.query(
      `insert into analytics_check_reason_daily (environment_id, day, time_zone, source,
         inquiry_template_id, inquiry_template_version_id, check_name, reason, count)
       values (${key}, $2, 'expired', 2)`,
      [environmentId, check],
    );
  }
  await upgraded.query(
    `insert into webhooks (id, environment_id, url, enabled_events, secret, secret_last4, updated_at)
     values ($1, $2, 'https://hooks.example.test/earlier', '{inquiry.completed}', 'synthetic', 'etic', $3)`,
    [webhookId, environmentId, EARLIER],
  );
  await runMigrations(earlier);
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await upgraded.close();
});

describe('migration 0032: applies on top of 0031 (Workflow 9D)', () => {
  it('is the migration after 0031_phase9b', () => {
    const tags = migrationTags();
    expect(tags.indexOf('0032_phase9d')).toBe(tags.indexOf('0031_phase9b') + 1);
  });
});

describe('migration 0032: the rollup state (AA6)', () => {
  it('adds closed_through, unset, and has the next pass recompute the open days', async () => {
    const { rows } = await upgraded.query<{
      closed_through: string | null;
      outcomes_as_of: Date | null;
      rolled_up_through: Date | null;
    }>(
      `select closed_through::text, outcomes_as_of, rolled_up_through from analytics_rollup_state
       where environment_id = $1`,
      [environmentId],
    );
    expect(rows).toEqual([
      {
        closed_through: null,
        outcomes_as_of: null,
        rolled_up_through: new Date('2026-01-06T00:00:00Z'),
      },
    ]);
  });
});

describe('migration 0032: the reserved start of a transition (AL6)', () => {
  const insert = (from: string) =>
    upgraded.query(
      `insert into analytics_transition_daily (environment_id, day, time_zone, source,
         inquiry_template_id, inquiry_template_version_id, from_step_id, to_step_id, count)
       values (${key}, $2, 'consent', 1)`,
      [environmentId, from],
    );

  it('takes $start as the step a transition comes from, and still refuses any other malformed id', async () => {
    await expect(insert('$start')).resolves.toBeDefined();
    await expect(insert('Not-A-Step')).rejects.toThrow(
      /analytics_transition_daily_from_step_id_format/,
    );
  });
});

describe('migration 0032: check reasons by type and requirement (AL7)', () => {
  it('gives an earlier reason its check’s one type and requirement, and removes one it cannot attribute', async () => {
    const { rows } = await upgraded.query<{
      check_name: string;
      verification_type: string;
      requirement: string;
      count: number;
    }>(
      `select check_name, verification_type::text, requirement::text, count
       from analytics_check_reason_daily where environment_id = $1 order by check_name`,
      [environmentId],
    );
    expect(rows).toEqual([
      {
        check_name: 'id_expired',
        verification_type: 'government_id',
        requirement: 'required',
        count: 2,
      },
    ]);
  });

  it('keys a reason by its type and requirement, both required', async () => {
    const reason = (requirement: string | null) =>
      upgraded.query(
        `insert into analytics_check_reason_daily (environment_id, day, time_zone, source,
           inquiry_template_id, inquiry_template_version_id, verification_type, check_name,
           requirement, reason, count)
         values (${key}, 'government_id', 'name_match', $2, 'mismatch', 1)`,
        [environmentId, requirement],
      );
    await expect(reason('required')).resolves.toBeDefined();
    await expect(reason('not_required')).resolves.toBeDefined();
    await expect(reason('required')).rejects.toThrow(/analytics_check_reason_daily_key/);
    await expect(reason(null)).rejects.toThrow(/null value in column "requirement"/);
  });
});

describe('migration 0032: a webhook’s updated_at and its failure alert (KW2)', () => {
  const updatedAt = async () =>
    (
      await upgraded.query<{ updated_at: Date }>(`select updated_at from webhooks where id = $1`, [
        webhookId,
      ])
    ).rows[0]?.updated_at.toISOString();

  it('keeps updated_at when the alert time alone is set, and moves it on a change of the webhook', async () => {
    await upgraded.query(
      `update webhooks set failure_alert_notified_at = '2026-02-01T00:00:00Z' where id = $1`,
      [webhookId],
    );
    expect(await updatedAt()).toBe(EARLIER);
    await upgraded.query(`update webhooks set name = 'Synthetic hook' where id = $1`, [webhookId]);
    expect(await updatedAt()).not.toBe(EARLIER);
  });
});
