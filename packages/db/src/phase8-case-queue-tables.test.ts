/**
 * Workflow 8B Stage 1b, checkpoint (Q) (plan C132, C133): the queue, assignment and SLA tables of
 * migration 0028, and the SLA columns of `cases`, read from the migrated database's catalogs.
 *
 * - queues with their members (each user once, `max-open` 1 to 500), archived exactly when they say
 *   so, and a round-robin cursor (C132.1, C132.3);
 * - assignment policies with their sources in priority order, each a template or a queue of the same
 *   environment (C132.2); SLA policies with their revision and calendar (C133.1); calendars (C133.2);
 * - a case's queue and SLA policy, and a version's queue and policies, of their own environment;
 * - the SLA state of a case (C133.4): `sla-expires-at` set exactly while running, met or expired,
 *   a target exactly while there is an SLA, a pinned policy whole;
 * - the indexes of the pull (C132.3), the open-case counts, the `case-sla` sweep (C133.6) and the
 *   calendar recompute (decision 59);
 * - an environment's deletion takes all of it.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser } from './index.js';
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

const TABLES = [
  'case_queues',
  'case_queue_members',
  'case_assignment_policies',
  'case_assignment_policy_sources',
  'case_sla_policies',
  'case_calendars',
];

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = await query<{ column_name: string; udt_name: string }>(
    `select column_name, udt_name from information_schema.columns where table_name = $1`,
    [table],
  );
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.udt_name]));
}

async function refused(statement: string, params: unknown[], message: string) {
  await expect(query(statement, params), message).rejects.toThrow(message);
}

async function tenant(): Promise<{ environmentId: string; organizationId: string }> {
  const { organization, environment } = await createTestTenant(database.db);
  return { environmentId: environment.id, organizationId: organization.id };
}

async function user(organizationId: string): Promise<string> {
  const id = testId('usr');
  await createUser(database.db, {
    id,
    organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
  return id;
}

const WEEK = JSON.stringify({
  monday: [{ start: '09:00', end: '17:00' }],
  tuesday: [{ start: '09:00', end: '17:00' }],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
});

async function seedQueue(environmentId: string, policyId: string | null = null) {
  const id = testId('cqueue');
  await query(
    `insert into case_queues (id, environment_id, name, case_assignment_policy_id)
     values ($1, $2, 'Synthetic queue', $3)`,
    [id, environmentId, policyId],
  );
  return id;
}

async function seedPolicy(environmentId: string) {
  const id = testId('cap');
  await query(
    `insert into case_assignment_policies (id, environment_id, name, distribution)
     values ($1, $2, 'Synthetic policy', 'round-robin')`,
    [id, environmentId],
  );
  return id;
}

async function seedCalendar(environmentId: string) {
  const id = testId('ccal');
  await query(
    `insert into case_calendars (id, environment_id, name, time_zone, week)
     values ($1, $2, 'Synthetic hours', 'Europe/London', $3::jsonb)`,
    [id, environmentId, WEEK],
  );
  return id;
}

async function seedSlaPolicy(environmentId: string, calendarId: string | null = null) {
  const id = testId('cslap');
  await query(
    `insert into case_sla_policies (id, environment_id, name, target_minutes, case_calendar_id)
     values ($1, $2, 'Synthetic SLA', 240, $3)`,
    [id, environmentId, calendarId],
  );
  return id;
}

const STATUSES = JSON.stringify([
  { key: 'open', label: 'Open', category: 'initial' },
  { key: 'approved', label: 'Approved', category: 'end' },
]);

async function seedTemplate(environmentId: string) {
  const id = testId('ctmpl');
  const versionId = testId('ctmplv');
  await query(
    `insert into case_templates (id, environment_id, name, key) values ($1, $2, 'Review', $3)`,
    [id, environmentId, `K${id.slice(-6).replace(/[^A-Z0-9]/g, '0')}`],
  );
  await query(
    `insert into case_template_versions (id, environment_id, case_template_id, version, status,
       statuses, published_at)
     values ($1, $2, $3, 1, 'published', $4::jsonb, now())`,
    [versionId, environmentId, id, STATUSES],
  );
  return { id, versionId };
}

let cases = 0;

async function seedCase(environmentId: string) {
  const template = await seedTemplate(environmentId);
  const id = testId('case');
  await query(
    `insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
       status, status_category, creator_type, creator_id, fields)
     values ($1, $2, $3, $4, $5, 'open', 'initial', 'user', $6, 'sealed-canary')`,
    [
      id,
      environmentId,
      template.id,
      template.versionId,
      `KYC-${String((cases += 1))}`,
      testId('usr'),
    ],
  );
  return { id, templateId: template.id, versionId: template.versionId };
}

describe('the queue and SLA tables (C132, C133)', () => {
  it('exist, each with its environment', async () => {
    for (const table of TABLES) {
      expect(await columnsOf(table), table).toHaveProperty('environment_id');
    }
  });

  it('give a case its SLA columns (C133.4)', async () => {
    expect(await columnsOf('cases')).toMatchObject({
      sla_state: 'text',
      sla_epoch: 'int4',
      sla_consumed_ms: 'int8',
      sla_segment_started_at: 'timestamptz',
      sla_expires_at: 'timestamptz',
      sla_expired_at: 'timestamptz',
      sla_met_at: 'timestamptz',
      sla_target_ms: 'int8',
      sla_policy_id: 'text',
      sla_policy_revision: 'int4',
      sla_case_calendar_id: 'text',
      sla_on_reopen: 'text',
    });
  });

  it('keep each change’s time on every row that changes', async () => {
    const result = await query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname like 'case_%_set_updated_at' order by tgname`,
    );

    expect(result.rows.map(({ tgname }) => tgname)).toEqual(
      expect.arrayContaining([
        'case_assignment_policies_set_updated_at',
        'case_calendars_set_updated_at',
        'case_queue_members_set_updated_at',
        'case_queues_set_updated_at',
        'case_sla_policies_set_updated_at',
      ]),
    );
  });
});

describe('queues and members (C132.1)', () => {
  it('are archived exactly when they say so, with a valid status', async () => {
    const { environmentId } = await tenant();
    const id = await seedQueue(environmentId);

    await refused(
      `update case_queues set status = 'archived' where id = $1`,
      [id],
      'case_queues_archived_with_status',
    );
    await refused(
      `update case_queues set status = 'paused' where id = $1`,
      [id],
      'case_queues_status_valid',
    );
    await expect(
      query(`update case_queues set status = 'archived', archived_at = now() where id = $1`, [id]),
    ).resolves.toBeDefined();
  });

  it('take a round-robin cursor that is a user id', async () => {
    const { environmentId } = await tenant();
    const id = await seedQueue(environmentId);

    await refused(
      `update case_queues set round_robin_cursor = $2 where id = $1`,
      [id, testId('key')],
      'case_queues_round_robin_cursor_format',
    );
  });

  it('hold each member once, at 50 open cases and unpaused by default, within 1 to 500', async () => {
    const { environmentId, organizationId } = await tenant();
    const queueId = await seedQueue(environmentId);
    const userId = await user(organizationId);
    const add = `insert into case_queue_members (environment_id, case_queue_id, user_id)
      values ($1, $2, $3)`;
    await query(add, [environmentId, queueId, userId]);

    const member = await query<{ max_open: number; paused: boolean }>(
      `select max_open, paused from case_queue_members where case_queue_id = $1`,
      [queueId],
    );
    expect(member.rows).toEqual([{ max_open: 50, paused: false }]);
    await refused(add, [environmentId, queueId, userId], 'case_queue_members_pkey');
    await refused(
      `update case_queue_members set max_open = 501 where case_queue_id = $1`,
      [queueId],
      'case_queue_members_max_open_range',
    );
    await refused(add, [environmentId, queueId, testId('usr')], 'case_queue_members_user_fk');
  });

  it('name a policy of their own environment', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();
    const policyId = await seedPolicy(other.environmentId);

    await expect(seedQueue(environmentId, policyId)).rejects.toThrow('case_queues_policy_fk');
  });
});

describe('assignment policies (C132.2)', () => {
  it('take a distribution and a sort, created-at by default', async () => {
    const { environmentId } = await tenant();
    const id = await seedPolicy(environmentId);

    const policy = await query<{ sort: string }>(
      `select sort from case_assignment_policies where id = $1`,
      [id],
    );
    expect(policy.rows).toEqual([{ sort: 'created-at' }]);
    await refused(
      `update case_assignment_policies set distribution = 'random' where id = $1`,
      [id],
      'case_assignment_policies_distribution_valid',
    );
    await refused(
      `update case_assignment_policies set sort = 'name' where id = $1`,
      [id],
      'case_assignment_policies_sort_valid',
    );
  });

  it('name 1 to 200 agents or none, and a capacity of 1 to 500 or none', async () => {
    const { environmentId } = await tenant();
    const id = await seedPolicy(environmentId);

    await refused(
      `update case_assignment_policies set agent_ids = '{}'::text[] where id = $1`,
      [id],
      'case_assignment_policies_agent_ids_count',
    );
    await refused(
      `update case_assignment_policies set max_capacity = 0 where id = $1`,
      [id],
      'case_assignment_policies_max_capacity_range',
    );
  });

  it('read each source, a template or a queue of its environment, once in order', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();
    const policyId = await seedPolicy(environmentId);
    const queueId = await seedQueue(environmentId);
    const { id: templateId } = await seedTemplate(environmentId);
    const foreignQueue = await seedQueue(other.environmentId);
    const add = `insert into case_assignment_policy_sources (environment_id,
        case_assignment_policy_id, position, case_template_id, case_queue_id)
      values ($1, $2, $3, $4, $5)`;
    await query(add, [environmentId, policyId, 0, templateId, null]);
    await query(add, [environmentId, policyId, 1, null, queueId]);

    await refused(
      add,
      [environmentId, policyId, 2, templateId, queueId],
      'case_assignment_policy_sources_one_source',
    );
    await refused(
      add,
      [environmentId, policyId, 2, null, null],
      'case_assignment_policy_sources_one_source',
    );
    await refused(
      add,
      [environmentId, policyId, 2, null, queueId],
      'case_assignment_policy_sources_queue_key',
    );
    await refused(
      add,
      [environmentId, policyId, 50, null, await seedQueue(environmentId)],
      'case_assignment_policy_sources_position_range',
    );
    await refused(
      add,
      [environmentId, policyId, 3, null, foreignQueue],
      'case_assignment_policy_sources_queue_fk',
    );
  });
});

describe('SLA policies and calendars (C133.1, C133.2)', () => {
  it('count business minutes from 1 to 525,600, revision 1 and continue by default', async () => {
    const { environmentId } = await tenant();
    const id = await seedSlaPolicy(environmentId);

    const policy = await query<{ revision: number; on_reopen: string }>(
      `select revision, on_reopen from case_sla_policies where id = $1`,
      [id],
    );
    expect(policy.rows).toEqual([{ revision: 1, on_reopen: 'continue' }]);
    await refused(
      `update case_sla_policies set target_minutes = 525601 where id = $1`,
      [id],
      'case_sla_policies_target_minutes_range',
    );
    await refused(
      `update case_sla_policies set on_reopen = 'resume' where id = $1`,
      [id],
      'case_sla_policies_on_reopen_valid',
    );
  });

  it('take a calendar of their own environment', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();

    await expect(
      seedSlaPolicy(environmentId, await seedCalendar(other.environmentId)),
    ).rejects.toThrow('case_sla_policies_calendar_fk');
  });

  it('keep a calendar’s week as an object and its holidays and closures as lists', async () => {
    const { environmentId } = await tenant();
    const id = await seedCalendar(environmentId);

    await refused(
      `update case_calendars set week = '[]'::jsonb where id = $1`,
      [id],
      'case_calendars_week_object',
    );
    await refused(
      `update case_calendars set holidays = '{}'::jsonb where id = $1`,
      [id],
      'case_calendars_holidays_array',
    );
    await refused(
      `update case_calendars set closures = '{}'::jsonb where id = $1`,
      [id],
      'case_calendars_closures_array',
    );
  });
});

describe('what a case and a version name (C132.1, C130.2)', () => {
  it('put a case in a queue of its own environment', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();
    const { id } = await seedCase(environmentId);

    await refused(
      `update cases set case_queue_id = $2 where id = $1`,
      [id, await seedQueue(other.environmentId)],
      'cases_queue_fk',
    );
    await expect(
      query(`update cases set case_queue_id = $2 where id = $1`, [
        id,
        await seedQueue(environmentId),
      ]),
    ).resolves.toBeDefined();
  });

  it('give a version a queue and policies of its own environment', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();
    const { versionId } = await seedTemplate(environmentId);

    await refused(
      `update case_template_versions set default_queue_id = $2 where id = $1`,
      [versionId, await seedQueue(other.environmentId)],
      'case_template_versions_default_queue_fk',
    );
    await refused(
      `update case_template_versions set assignment_policy_id = $2 where id = $1`,
      [versionId, await seedPolicy(other.environmentId)],
      'case_template_versions_assignment_policy_fk',
    );
    await refused(
      `update case_template_versions set sla_policy_id = $2 where id = $1`,
      [versionId, await seedSlaPolicy(other.environmentId)],
      'case_template_versions_sla_policy_fk',
    );
  });
});

describe('a case’s SLA (C133.4)', () => {
  it('starts with none: no deadline, no target, nothing consumed', async () => {
    const { environmentId } = await tenant();
    const { id } = await seedCase(environmentId);

    const sla = await query(
      `select sla_state, sla_epoch, sla_consumed_ms::text as sla_consumed_ms, sla_expires_at, sla_target_ms, sla_on_reopen
       from cases where id = $1`,
      [id],
    );
    expect(sla.rows).toEqual([
      {
        sla_state: 'none',
        sla_epoch: 0,
        sla_consumed_ms: '0',
        sla_expires_at: null,
        sla_target_ms: null,
        sla_on_reopen: 'continue',
      },
    ]);
  });

  it('has a deadline exactly while running, met or expired, and a target exactly with an SLA', async () => {
    const { environmentId } = await tenant();
    const { id } = await seedCase(environmentId);
    const set = (assignments: string) =>
      query(`update cases set ${assignments} where id = $1`, [id]);

    await expect(set(`sla_state = 'running', sla_target_ms = 60000`)).rejects.toThrow(
      'cases_sla_expires_at_with_state',
    );
    await expect(
      set(`sla_state = 'paused', sla_target_ms = 60000, sla_expires_at = now()`),
    ).rejects.toThrow('cases_sla_expires_at_with_state');
    await expect(set(`sla_state = 'running', sla_expires_at = now()`)).rejects.toThrow(
      'cases_sla_target_with_state',
    );
    await expect(
      set(`sla_state = 'late', sla_target_ms = 60000, sla_expires_at = now()`),
    ).rejects.toThrow('cases_sla_state_valid');
    await expect(
      set(`sla_state = 'running', sla_target_ms = 60000, sla_expires_at = now(),
        sla_segment_started_at = now(), sla_epoch = 1`),
    ).resolves.toBeDefined();
  });

  it('is met or expired with the time it was', async () => {
    const { environmentId } = await tenant();
    const { id } = await seedCase(environmentId);
    const set = (assignments: string) =>
      query(
        `update cases set sla_target_ms = 60000, sla_expires_at = now(), ${assignments}
         where id = $1`,
        [id],
      );

    await expect(set(`sla_state = 'met'`)).rejects.toThrow('cases_sla_met_at_with_state');
    await expect(set(`sla_state = 'expired'`)).rejects.toThrow('cases_sla_expired_at_with_state');
    await expect(set(`sla_state = 'expired', sla_expired_at = now()`)).resolves.toBeDefined();
  });

  it('pins a policy of its environment whole, with its calendar only beside a policy', async () => {
    const { environmentId } = await tenant();
    const other = await tenant();
    const { id } = await seedCase(environmentId);
    const policyId = await seedSlaPolicy(environmentId);
    const set = (assignments: string, params: unknown[] = []) =>
      query(`update cases set ${assignments} where id = $1`, [id, ...params]);

    await expect(set(`sla_policy_id = $2`, [policyId])).rejects.toThrow(
      'cases_sla_policy_is_whole',
    );
    await expect(
      set(`sla_case_calendar_id = $2`, [await seedCalendar(environmentId)]),
    ).rejects.toThrow('cases_sla_calendar_with_policy');
    await expect(
      set(`sla_policy_id = $2, sla_policy_revision = 1`, [
        await seedSlaPolicy(other.environmentId),
      ]),
    ).rejects.toThrow('cases_sla_policy_fk');
    await expect(set(`sla_policy_revision = 0, sla_policy_id = $2`, [policyId])).rejects.toThrow(
      'cases_sla_counts',
    );
    await expect(
      set(`sla_policy_id = $2, sla_policy_revision = 1`, [policyId]),
    ).resolves.toBeDefined();
  });
});

describe('the indexes (C132.3, C133.6, decision 59)', () => {
  async function definitionOf(name: string): Promise<string> {
    const result = await query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = $1`,
      [name],
    );
    return result.rows[0]?.indexdef ?? '';
  }

  it('pull the most urgent unassigned, unresolved, unredacted case of a queue', async () => {
    const definition = await definitionOf('cases_pull_idx');

    expect(definition).toContain('(environment_id, case_queue_id, sla_expires_at, created_at, id)');
    expect(definition).toContain('assignee_id IS NULL');
    expect(definition).toContain("status_category <> 'end'::text");
    expect(definition).toContain('redacted_at IS NULL');
  });

  it('count a person’s open cases, per queue', async () => {
    const definition = await definitionOf('cases_open_assignee_idx');

    expect(definition).toContain('(environment_id, assignee_id, case_queue_id)');
    expect(definition).toContain('assignee_id IS NOT NULL');
    expect(definition).toContain("status_category <> 'end'::text");
  });

  it('find the running deadlines that are due, and those on a calendar', async () => {
    expect(await definitionOf('cases_sla_due_idx')).toContain("sla_state = 'running'::text");
    expect(await definitionOf('cases_sla_calendar_idx')).toContain(
      '(environment_id, sla_case_calendar_id)',
    );
    expect(await definitionOf('case_queue_members_user_idx')).toContain(
      '(environment_id, user_id)',
    );
  });
});

describe('beside the environment', () => {
  it('go with their environment', async () => {
    const { environmentId, organizationId } = await tenant();
    const policyId = await seedPolicy(environmentId);
    const queueId = await seedQueue(environmentId, policyId);
    await query(
      `insert into case_queue_members (environment_id, case_queue_id, user_id) values ($1, $2, $3)`,
      [environmentId, queueId, await user(organizationId)],
    );
    await query(
      `insert into case_assignment_policy_sources (environment_id, case_assignment_policy_id,
         position, case_queue_id) values ($1, $2, 0, $3)`,
      [environmentId, policyId, queueId],
    );
    const slaPolicyId = await seedSlaPolicy(environmentId, await seedCalendar(environmentId));
    const { id } = await seedCase(environmentId);
    await query(
      `update cases set case_queue_id = $2, sla_policy_id = $3, sla_policy_revision = 1
       where id = $1`,
      [id, queueId, slaPolicyId],
    );

    await query('begin');
    await query(`select set_config('openverify.environment_deletion', 'on', true)`);
    await query(`delete from environments where id = $1`, [environmentId]);
    await query('commit');

    for (const table of [...TABLES, 'cases']) {
      const rows = await query<{ count: number }>(
        `select count(*)::int as count from ${table} where environment_id = $1`,
        [environmentId],
      );
      expect(rows.rows, table).toEqual([{ count: 0 }]);
    }
  });
});
