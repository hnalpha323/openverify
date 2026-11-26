/**
 * Workflow 9B Stage 1b, checkpoint (A): what `foundation-9b` builds in the database for analytics
 * (C163.2-C163.4, C174.5), frozen for `api-analytics`:
 *
 * - the twelve rollup tables of `ANALYTICS_ROLLUP_TABLES`, each with exactly its row type's columns
 *   (counts only: no end user's id and no value; an operator's id in the assignee table alone), its
 *   `source` and `time_zone`, its key as one unique index `NULLS NOT DISTINCT` led by
 *   `(environment_id, day)` (the redaction's upsert target and the reads' range), and every
 *   vocabulary, form and count held by a CHECK;
 * - `analytics_rollup_state`, one row per environment;
 * - every row deleted with its environment, and an assignee row with its user;
 * - the `(environment_id, updated_at)` indexes of the dirty-day scan (B2).
 *
 * Every value is synthetic.
 */
import { ANALYTICS_CHECK_STATUSES, ANALYTICS_ROLLUP_TABLES } from '@openverify/core';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsRollupTableOf } from './repositories/analytics.js';
import { createUser } from './repositories/users.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

const refused = async (text: string, params: unknown[] = []) =>
  query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const KEY = ['environment_id', 'day', 'time_zone', 'source'];
const INQUIRY = ['inquiry_template_id', 'inquiry_template_version_id', 'platform', 'device_kind'];
const VERSION = ['inquiry_template_id', 'inquiry_template_version_id'];

/** Each table's columns, from `packages/core/src/analytics/rows.ts` in snake case. */
const COLUMNS: Record<(typeof ANALYTICS_ROLLUP_TABLES)[number], readonly string[]> = {
  analytics_inquiry_daily: [
    ...KEY,
    ...INQUIRY,
    'created',
    'started',
    'interacted',
    'finished',
    'completed',
    'completed_verified',
    'completed_with_fallback',
    'completed_unverified',
    'failed',
    'expired_before_start',
    'expired_after_start',
    'approved',
    'declined',
    'needs_review',
    'marked_for_review',
    'decided_automatic',
    'decided_manual',
    'decided_not_declared',
    'finish_seconds_histogram',
  ],
  analytics_inquiry_tag_daily: [
    ...KEY,
    ...INQUIRY,
    'tag',
    'created',
    'finished',
    'completed',
    'failed',
  ],
  analytics_step_daily: [...KEY, ...VERSION, 'step_id', 'entered', 'exited', 'revisits'],
  analytics_transition_daily: [...KEY, ...VERSION, 'from_step_id', 'to_step_id', 'count'],
  analytics_path_daily: [...KEY, ...VERSION, 'path_sha256', 'step_ids', 'count'],
  analytics_verification_daily: [
    ...KEY,
    ...VERSION,
    'verification_type',
    'capture_method',
    'country',
    'created',
    'submitted',
    'passed',
    'failed',
    'requires_retry',
    'skipped',
    'needs_review',
    'canceled',
  ],
  analytics_verification_step_daily: [
    ...KEY,
    ...VERSION,
    'step_id',
    'verification_type',
    'entered',
    'passed',
    'failed_after_attempts',
    'needs_review',
    'skipped',
  ],
  analytics_check_daily: [
    ...KEY,
    ...VERSION,
    'verification_type',
    'check_name',
    'requirement',
    'status',
    'count',
  ],
  // K9-24 (AL7): a reason keeps its check's type and requirement.
  analytics_check_reason_daily: [
    ...KEY,
    ...VERSION,
    'verification_type',
    'check_name',
    'requirement',
    'reason',
    'count',
  ],
  analytics_case_daily: [
    ...KEY,
    'case_template_id',
    'created',
    'resolved',
    'sla_met',
    'sla_missed',
    'resolution_seconds_histogram',
  ],
  analytics_case_assignee_daily: [...KEY, 'case_template_id', 'user_id', 'assigned', 'resolved'],
  analytics_signal_daily: [...KEY, ...INQUIRY, 'signal_name', 'bin', 'count'],
};

/** The ids a rollup may hold: its environment, templates and versions, and the assignee's user. */
const ALLOWED_IDS = new Set([
  'environment_id',
  'inquiry_template_id',
  'inquiry_template_version_id',
  'case_template_id',
  'step_id',
  'from_step_id',
  'to_step_id',
]);

const zeros = `array[${Array.from({ length: 40 }, () => '0').join(',')}]`;

async function inquiryRow(environmentId: string, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    environment_id: `'${environmentId}'`,
    day: `'2026-11-01'`,
    time_zone: `'Europe/Paris'`,
    source: `'facts'`,
    inquiry_template_id: `'${testId('itmpl')}'`,
    inquiry_template_version_id: `'${testId('itmplv')}'`,
    platform: 'null',
    device_kind: 'null',
    created: '12',
    finish_seconds_histogram: zeros,
    ...overrides,
  };
  return refused(
    `insert into analytics_inquiry_daily (${Object.keys(values).join(', ')})
     values (${Object.values(values).join(', ')})`,
  );
}

describe('the rollup tables (C163.3)', () => {
  it('are the twelve of ANALYTICS_ROLLUP_TABLES, each with exactly its row type’s columns', async () => {
    for (const table of ANALYTICS_ROLLUP_TABLES) {
      const { rows } = await query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = $1`,
        [table],
      );
      expect(rows.map((row) => row.column_name).sort(), table).toEqual([...COLUMNS[table]].sort());
    }
  });

  it('hold no end user’s id: an operator’s id in the assignee table alone (rule 11, review P20)', () => {
    for (const table of ANALYTICS_ROLLUP_TABLES) {
      const ids = COLUMNS[table].filter((name) => name.endsWith('_id') && !ALLOWED_IDS.has(name));
      expect(ids, table).toEqual(table === 'analytics_case_assignee_daily' ? ['user_id'] : []);
    }
  });

  it('are the tables the repository names, by name', () => {
    for (const table of ANALYTICS_ROLLUP_TABLES) {
      expect(getTableConfig(analyticsRollupTableOf(table)).name).toBe(table);
    }
  });

  it('key each table by one unique index, nulls not distinct, led by (environment_id, day, time_zone, source)', async () => {
    for (const table of ANALYTICS_ROLLUP_TABLES) {
      const { rows } = await query<{ indexdef: string }>(
        `select indexdef from pg_indexes where tablename = $1 and indexname = $2`,
        [table, `${table}_key`],
      );
      expect(rows, table).toHaveLength(1);
      const definition = rows[0]?.indexdef ?? '';
      expect(definition, table).toContain('UNIQUE');
      expect(definition, table).toContain('(environment_id, day, time_zone, source');
      expect(definition, table).toContain('NULLS NOT DISTINCT');
    }
  });

  it('refuse a second row of one key, null dimensions included, and add to it by an upsert (C163.4)', async () => {
    const { environment } = await createTestTenant(database.db);
    const template = testId('itmpl');
    const version = testId('itmplv');
    const key = {
      inquiry_template_id: `'${template}'`,
      inquiry_template_version_id: `'${version}'`,
      source: `'redacted'`,
    };
    expect(await inquiryRow(environment.id, key)).toBe('accepted');
    expect(await inquiryRow(environment.id, key)).toContain('analytics_inquiry_daily_key');
    // Another zone, source or day is another row (C163.2: a zone change never relabels a bucket).
    expect(await inquiryRow(environment.id, { ...key, time_zone: `'UTC'` })).toBe('accepted');
    expect(await inquiryRow(environment.id, { ...key, source: `'facts'` })).toBe('accepted');

    await query(
      `insert into analytics_inquiry_daily (environment_id, day, time_zone, source,
         inquiry_template_id, inquiry_template_version_id, platform, device_kind, created,
         finish_seconds_histogram)
       values ($1, '2026-11-01', 'Europe/Paris', 'redacted', $2, $3, null, null, 1, ${zeros})
       on conflict (environment_id, day, time_zone, source, inquiry_template_id,
         inquiry_template_version_id, platform, device_kind)
       do update set created = analytics_inquiry_daily.created + excluded.created`,
      [environment.id, template, version],
    );
    const { rows } = await query<{ created: number }>(
      `select created from analytics_inquiry_daily
       where environment_id = $1 and source = 'redacted' and time_zone = 'Europe/Paris'`,
      [environment.id],
    );
    expect(rows).toEqual([{ created: 13 }]);
  });

  it('hold each vocabulary, form and count to its CHECK', async () => {
    const { environment } = await createTestTenant(database.db);
    const cases: [Record<string, string>, string][] = [
      [{ source: `'live'` }, 'analytics_inquiry_daily_source_valid'],
      [{ time_zone: `''` }, 'analytics_inquiry_daily_time_zone_length'],
      [{ time_zone: `'${'A'.repeat(65)}'` }, 'analytics_inquiry_daily_time_zone_length'],
      [{ platform: `'ios'` }, 'analytics_inquiry_daily_platform_valid'],
      [{ device_kind: `'tv'` }, 'analytics_inquiry_daily_device_kind_valid'],
      [{ inquiry_template_id: `'tmpl_1'` }, 'analytics_inquiry_daily_inquiry_template_id_format'],
      [
        { inquiry_template_version_id: `'${testId('itmpl')}'` },
        'analytics_inquiry_daily_inquiry_template_version_id_format',
      ],
      [{ created: '-1' }, 'analytics_inquiry_daily_counts_nonnegative'],
      [{ finish_seconds_histogram: 'array[0, 0]' }, 'analytics_inquiry_daily_histogram_shape'],
      [
        { finish_seconds_histogram: zeros.replace('[0', '[-1') },
        'analytics_inquiry_daily_histogram_shape',
      ],
    ];
    for (const [overrides, constraint] of cases) {
      expect(await inquiryRow(environment.id, overrides), constraint).toContain(constraint);
    }
    expect(
      await inquiryRow(environment.id, { platform: `'android'`, device_kind: `'native'` }),
    ).toBe('accepted');
  });

  it('count a check under each of its six statuses, and no other (review H03, B12)', async () => {
    const { environment } = await createTestTenant(database.db);
    const insert = (status: string, checkName = 'id_expired') =>
      refused(
        `insert into analytics_check_daily (environment_id, day, time_zone, source,
           inquiry_template_id, inquiry_template_version_id, verification_type, check_name,
           requirement, status, count)
         values ($1, '2026-11-01', 'UTC', 'facts', $2, $3, 'government_id', $4, 'required', $5, 3)`,
        [environment.id, testId('itmpl'), testId('itmplv'), checkName, status],
      );
    for (const status of ANALYTICS_CHECK_STATUSES) {
      expect(await insert(status), status).toBe('accepted');
    }
    expect(await insert('skipped')).toContain('analytics_check_daily_status_valid');
    expect(await insert('passed', 'Id-Expired')).toContain(
      'analytics_check_daily_check_name_snake_case',
    );
  });

  it('hold step ids, paths, capture methods, countries and assignees to their forms', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const template = testId('itmpl');
    const version = testId('itmplv');
    const step = (stepId: string) =>
      refused(
        `insert into analytics_step_daily (environment_id, day, time_zone, source,
           inquiry_template_id, inquiry_template_version_id, step_id, entered)
         values ($1, '2026-11-01', 'UTC', 'facts', $2, $3, $4, 1)`,
        [env, template, version, stepId],
      );
    expect(await step('consent')).toBe('accepted');
    expect(await step('Consent')).toContain('analytics_step_daily_step_id_format');

    const path = (sha: string, steps: string) =>
      refused(
        `insert into analytics_path_daily (environment_id, day, time_zone, source,
           inquiry_template_id, inquiry_template_version_id, path_sha256, step_ids, count)
         values ($1, '2026-11-01', 'UTC', 'facts', $2, $3, $4, ${steps}, 1)`,
        [env, template, version, sha],
      );
    expect(await path('a'.repeat(64), `array['consent','selfie']`)).toBe('accepted');
    expect(await path('A'.repeat(64), `array['consent']`)).toContain(
      'analytics_path_daily_path_sha256_format',
    );
    expect(await path('b'.repeat(64), `array[]::text[]`)).toContain(
      'analytics_path_daily_step_ids_present',
    );

    const attempt = (captureMethod: string, country: string) =>
      refused(
        `insert into analytics_verification_daily (environment_id, day, time_zone, source,
           inquiry_template_id, inquiry_template_version_id, verification_type, capture_method,
           country, created)
         values ($1, '2026-11-01', 'UTC', 'facts', $2, $3, 'government_id', ${captureMethod},
           ${country}, 1)`,
        [env, template, version],
      );
    expect(await attempt(`'camera'`, `'FR'`)).toBe('accepted');
    expect(await attempt('null', 'null')).toBe('accepted');
    expect(await attempt(`'scanner'`, `'DE'`)).toContain(
      'analytics_verification_daily_capture_method_valid',
    );
    expect(await attempt(`'upload'`, `'de'`)).toContain(
      'analytics_verification_daily_country_iso2',
    );
  });

  it('delete every row with its environment, the rollup state included', async () => {
    const { environment } = await createTestTenant(database.db);
    expect(await inquiryRow(environment.id)).toBe('accepted');
    await query(
      `insert into analytics_rollup_state (environment_id, rolled_up_through, time_zone, step_data_from)
       values ($1, now(), 'UTC', '2026-10-01')`,
      [environment.id],
    );

    await query('delete from environments where id = $1', [environment.id]);

    for (const table of ['analytics_inquiry_daily', 'analytics_rollup_state']) {
      const { rows } = await query<{ count: number }>(
        `select count(*)::int as count from ${table} where environment_id = $1`,
        [environment.id],
      );
      expect(rows, table).toEqual([{ count: 0 }]);
    }
  });

  it('key an assignee row by an operator of the organisation, null once re-keyed, gone with its user (review P20)', async () => {
    const { organization, environment } = await createTestTenant(database.db);
    const user = await createUser(database.db, {
      id: testId('usr'),
      organizationId: organization.id,
      email: `reviewer-${testId('usr').slice(-6).toLowerCase()}@example.com`,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
    });
    const insert = (userId: string | null) =>
      refused(
        `insert into analytics_case_assignee_daily (environment_id, day, time_zone, source,
           case_template_id, user_id, assigned)
         values ($1, '2026-11-01', 'UTC', 'facts', $2, $3, 2)`,
        [environment.id, testId('ctmpl'), userId],
      );
    expect(await insert(user.id)).toBe('accepted');
    expect(await insert(null)).toBe('accepted');
    expect(await insert(testId('usr'))).toContain('foreign key');
    expect(await insert('key_1')).toContain('analytics_case_assignee_daily_user_id_format');

    await query('delete from users where id = $1', [user.id]);

    const { rows } = await query<{ user_id: string | null }>(
      'select user_id from analytics_case_assignee_daily where environment_id = $1',
      [environment.id],
    );
    expect(rows).toEqual([{ user_id: null }]);
  });
});

describe('the rollup state (C163.2, C163.4, C164.8)', () => {
  it('is one row per environment, empty until the first pass', async () => {
    const { environment } = await createTestTenant(database.db);
    await query('insert into analytics_rollup_state (environment_id) values ($1)', [
      environment.id,
    ]);
    const { rows } = await query<Record<string, unknown>>(
      `select rolled_up_through, outcomes_as_of, time_zone, step_data_from
       from analytics_rollup_state where environment_id = $1`,
      [environment.id],
    );
    expect(rows).toEqual([
      { rolled_up_through: null, outcomes_as_of: null, time_zone: null, step_data_from: null },
    ]);
    expect(
      await refused('insert into analytics_rollup_state (environment_id) values ($1)', [
        environment.id,
      ]),
    ).toContain('analytics_rollup_state_pkey');
    expect(
      await refused(`update analytics_rollup_state set time_zone = '' where environment_id = $1`, [
        environment.id,
      ]),
    ).toContain('analytics_rollup_state_time_zone_length');
  });
});

describe('the dirty-day scan (C163.4, B2)', () => {
  it.each([
    ['inquiries', 'inquiries_environment_id_updated_at_idx'],
    ['verifications', 'verifications_environment_id_updated_at_idx'],
    ['verification_checks', 'verification_checks_environment_id_updated_at_idx'],
  ])('finds the %s an environment changed since the watermark by index', async (table, name) => {
    const { rows } = await query<{ indexdef: string }>(
      'select indexdef from pg_indexes where tablename = $1 and indexname = $2',
      [table, name],
    );
    expect(rows[0]?.indexdef ?? '').toContain('(environment_id, updated_at)');
  });
});
