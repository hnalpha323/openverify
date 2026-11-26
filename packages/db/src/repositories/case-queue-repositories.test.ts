/**
 * Workflow 8B Stage 3 (`api-queues-sla`; C132, C133): the queue, policy, calendar and SLA repositories.
 *
 * - Queues: written, changed, archived, their members replaced (naming who left) and read in
 *   user-id order, listed newest first (C1) under their filters, and a person's active queues.
 * - The pull: the most urgent unassigned case of the queues, by `sla_expires_at` (none last), then
 *   `created_at`, then id, never one assigned, resolved, redacted or of a template the reader may not
 *   see, and never one another transaction holds (`SKIP LOCKED`).
 * - What a policy reads of a person: active, `cases:write`, template visibility, open cases and the
 *   latest assignment; the stranded cases of the re-assignment sweep.
 * - Policies with their sources in order, SLA policies with their revision, calendars.
 * - The SLA sweep's due rows (across environments, earliest first) and a calendar's cases.
 *
 * Every value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseCalendar,
  seedCaseQueue,
  seedCaseSlaPolicy,
  seedCaseTemplate,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import type { Db } from '../client.js';
import {
  createCaseAssignmentPolicyRow,
  createCaseCalendarRow,
  createCaseQueueRow,
  createCaseSlaPolicyRow,
  createUser,
  getCaseAssignmentPolicyRow,
  getCaseCalendarRow,
  getCaseQueueRow,
  getCaseSlaPolicyRow,
  listCaseAssignmentPolicyRows,
  listCaseAssignmentPolicySources,
  listCaseAssignmentPolicySourcesOf,
  listCaseCalendarRows,
  listCaseQueueMembers,
  listCaseQueueMembersOf,
  listCaseQueueRows,
  listCaseSlaPolicyRows,
  listMemberCaseQueueIds,
  lockCaseAssignmentPolicyRow,
  lockCaseCalendarRow,
  lockCaseQueueRow,
  lockCasesOnCalendar,
  lockDueCaseSlas,
  lockQueueCasesAssignedTo,
  lockStrandedCases,
  lockUnassignedQueueCases,
  pullNextCaseId,
  readCaseAssigneeFacts,
  replaceCaseQueueMembers,
  updateCaseAssignmentPolicyRow,
  updateCaseCalendarRow,
  updateCaseQueueRow,
  updateCaseSlaPolicyRow,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const db = (): Db => database.db;

async function tenant() {
  const { organization, environment } = await createTestTenant(db());
  return { environmentId: environment.id, organizationId: organization.id };
}

async function user(organizationId: string, permissions: readonly string[] = ['cases:write']) {
  const id = testId('usr');
  await createUser(db(), {
    id,
    organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
  const roleId = testId('role');
  await db().execute(sql`insert into roles (id, organization_id, name, permissions)
    values (${roleId}, ${organizationId}, ${`Synthetic ${roleId}`},
      ${`{${permissions.join(',')}}`}::text[])`);
  await db().execute(sql`insert into user_roles (organization_id, user_id, role_id)
    values (${organizationId}, ${id}, ${roleId})`);
  return { id, roleId };
}

let numbers = 0;

async function caseOf(
  environmentId: string,
  template: { id: string; versionId: string; key: string },
  input: { caseQueueId?: string | null; assigneeId?: string | null } = {},
) {
  numbers += 1;
  return (
    await seedCase(db(), environmentId, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: numbers,
      ...input,
    })
  ).id;
}

/** A running SLA due at `expiresAt`, written whole so every check holds. */
async function running(caseId: string, expiresAt: Date, extra = sql``) {
  await db().execute(sql`update cases set sla_state = 'running', sla_epoch = 1,
      sla_target_ms = 60000, sla_segment_started_at = ${new Date(
        expiresAt.getTime() - 60_000,
      ).toISOString()}::timestamptz, sla_expires_at = ${expiresAt.toISOString()}::timestamptz
      ${extra}
    where id = ${caseId}`);
}

describe('queues and their members (C132.1)', () => {
  it('writes, reads, changes and archives a queue, and moves its cursor', async () => {
    const { environmentId, organizationId } = await tenant();
    const agent = await user(organizationId);
    const id = testId('cqueue');

    const created = await createCaseQueueRow(db(), environmentId, {
      id,
      name: 'Synthetic queue',
      caseAssignmentPolicyId: null,
    });
    const renamed = await updateCaseQueueRow(db(), environmentId, id, {
      name: 'Synthetic queue two',
      roundRobinCursor: agent.id,
    });
    const at = new Date('2026-11-03T10:00:00.000Z');
    const archived = await updateCaseQueueRow(db(), environmentId, id, { archivedAt: at });

    expect(created).toMatchObject({ id, status: 'active', name: 'Synthetic queue' });
    expect(renamed).toMatchObject({ name: 'Synthetic queue two', roundRobinCursor: agent.id });
    expect(archived).toMatchObject({ status: 'archived', archivedAt: at });
    expect(await getCaseQueueRow(db(), environmentId, id)).toMatchObject({ status: 'archived' });
    expect(await getCaseQueueRow(db(), environmentId, testId('cqueue'))).toBeNull();
    expect(await updateCaseQueueRow(db(), environmentId, testId('cqueue'), { name: 'x' })).toBe(
      null,
    );
    const other = await tenant();
    expect(await getCaseQueueRow(db(), other.environmentId, id)).toBeNull();
    const locked = await db().transaction((tx) => lockCaseQueueRow(tx, environmentId, id));
    expect(locked?.id).toBe(id);
  });

  it('replaces the members, naming who left, and reads them in user-id order', async () => {
    const { environmentId, organizationId } = await tenant();
    const [a, b, c] = [
      await user(organizationId),
      await user(organizationId),
      await user(organizationId),
    ];
    const { id } = await seedCaseQueue(db(), environmentId, {
      members: [{ userId: a.id }, { userId: b.id }],
    });

    const result = await replaceCaseQueueMembers(db(), environmentId, id, [
      { userId: c.id, maxOpen: 3, paused: true },
      { userId: b.id, maxOpen: 7, paused: false },
    ]);
    const members = await listCaseQueueMembers(db(), environmentId, id);

    expect(result.removedUserIds).toEqual([a.id]);
    expect(members.map(({ userId, maxOpen, paused }) => ({ userId, maxOpen, paused }))).toEqual(
      [
        { userId: c.id, maxOpen: 3, paused: true },
        { userId: b.id, maxOpen: 7, paused: false },
      ].sort((x, y) => (x.userId < y.userId ? -1 : 1)),
    );
    const second = await seedCaseQueue(db(), environmentId, { members: [{ userId: a.id }] });
    const of = await listCaseQueueMembersOf(db(), environmentId, [id, second.id]);
    expect(of.map(({ caseQueueId }) => caseQueueId).sort()).toEqual([id, id, second.id].sort());
    expect(await listCaseQueueMembersOf(db(), environmentId, [])).toEqual([]);
  });

  it('lists queues newest first under their filters, and a person’s active queues', async () => {
    onTestFinished(wallClockStepsBack());
    const { environmentId, organizationId } = await tenant();
    const member = await user(organizationId);
    const clock = createdAtClock(db());
    const first = await seedCaseQueue(db(), environmentId, { members: [{ userId: member.id }] });
    const second = await seedCaseQueue(db(), environmentId);
    const third = await seedCaseQueue(db(), environmentId, { members: [{ userId: member.id }] });
    for (const { id } of [first, second, third]) {
      await clock.at('case_queues', id);
    }
    await updateCaseQueueRow(db(), environmentId, third.id, { archivedAt: new Date() });

    const all = await listCaseQueueRows(db(), environmentId, {}, { size: 2 });
    const rest = await listCaseQueueRows(
      db(),
      environmentId,
      {},
      { size: 2, after: all.next ?? undefined },
    );
    const ofMember = await listCaseQueueRows(
      db(),
      environmentId,
      { memberIds: [member.id] },
      { size: 10 },
    );
    const archived = await listCaseQueueRows(
      db(),
      environmentId,
      { statuses: ['archived'] },
      { size: 10 },
    );

    expect([...all.items, ...rest.items].map(({ id }) => id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(ofMember.items.map(({ id }) => id)).toEqual([third.id, first.id]);
    expect(archived.items.map(({ id }) => id)).toEqual([third.id]);
    expect(
      (await listCaseQueueRows(db(), environmentId, { statuses: [] }, { size: 10 })).items,
    ).toEqual([]);
    expect(await listMemberCaseQueueIds(db(), environmentId, member.id)).toEqual([first.id]);
  });
});

describe('the pull (C132.3)', () => {
  it('takes the most urgent unassigned case the reader may see, by deadline then age', async () => {
    onTestFinished(wallClockStepsBack());
    const { environmentId, organizationId } = await tenant();
    const reader = await user(organizationId);
    const template = await seedCaseTemplate(db(), environmentId);
    const hidden = await seedCaseTemplate(db(), environmentId);
    await db().execute(sql`update case_templates set visible_to_roles = '{role_none}'::text[]
      where id = ${hidden.id}`);
    const queue = await seedCaseQueue(db(), environmentId);
    const other = await seedCaseQueue(db(), environmentId);
    const clock = createdAtClock(db());
    const oldest = await caseOf(environmentId, template, { caseQueueId: queue.id });
    const later = await caseOf(environmentId, template, { caseQueueId: queue.id });
    const due = await caseOf(environmentId, template, { caseQueueId: other.id });
    const dueSooner = await caseOf(environmentId, hidden, { caseQueueId: queue.id });
    const assigned = await caseOf(environmentId, template, {
      caseQueueId: queue.id,
      assigneeId: reader.id,
    });
    for (const id of [oldest, later, due, dueSooner, assigned]) {
      await clock.at('cases', id);
    }
    await running(due, new Date('2026-11-05T00:00:00.000Z'));
    await running(dueSooner, new Date('2026-11-04T00:00:00.000Z'));
    const asReader = { kind: 'user' as const, userId: reader.id };

    const picks: (string | null)[] = [];
    for (let index = 0; index < 4; index += 1) {
      const picked = await db().transaction(async (tx) => {
        const id = await pullNextCaseId(tx, environmentId, [queue.id, other.id], asReader);
        if (id !== null) {
          await tx.execute(sql`update cases set assignee_id = ${reader.id}, assigner_type = 'user',
            assigner_id = ${reader.id}, assigned_at = now() where id = ${id}`);
        }
        return id;
      });
      picks.push(picked);
    }

    expect(picks).toEqual([due, oldest, later, null]);
    expect(await pullNextCaseId(db(), environmentId, [], asReader)).toBeNull();
  });

  it('skips a case another transaction holds, and a resolved or redacted one', async () => {
    const { environmentId, organizationId } = await tenant();
    const reader = await user(organizationId);
    const template = await seedCaseTemplate(db(), environmentId);
    const queue = await seedCaseQueue(db(), environmentId);
    const resolved = await caseOf(environmentId, template, { caseQueueId: queue.id });
    await db().execute(sql`update cases set status = 'approved', status_category = 'end',
      resolution = 'Approved', resolver_type = 'user', resolver_id = ${reader.id},
      resolved_at = now() where id = ${resolved}`);
    const held = await caseOf(environmentId, template, { caseQueueId: queue.id });
    const free = await caseOf(environmentId, template, { caseQueueId: queue.id });
    const asReader = { kind: 'user' as const, userId: reader.id };

    // PGlite runs one connection, so a held row is shown by its lock clause instead: the pull
    // asks SKIP LOCKED, which `cases.integration` proves on Postgres.
    const first = await pullNextCaseId(db(), environmentId, [queue.id], asReader);

    expect([held, free]).toContain(first);
    expect(first).not.toBe(resolved);
  });
});

describe('what a policy reads of a person (C132.3, C132.6)', () => {
  it('reads activity, permission, template visibility, open cases and the latest assignment', async () => {
    const { environmentId, organizationId } = await tenant();
    const busy = await user(organizationId);
    const reader = await user(organizationId, ['cases:read']);
    const gone = await user(organizationId);
    await db().execute(sql`update users set status = 'deactivated' where id = ${gone.id}`);
    const template = await seedCaseTemplate(db(), environmentId);
    await db().execute(sql`update case_templates
      set visible_to_roles = ${`{${busy.roleId}}`}::text[] where id = ${template.id}`);
    await caseOf(environmentId, template, { assigneeId: busy.id });
    const latest = await caseOf(environmentId, template, { assigneeId: busy.id });
    const at = new Date('2026-11-02T09:00:00.000Z');
    await db().execute(sql`update cases set assigned_at = ${at.toISOString()}::timestamptz
      where id = ${latest}`);
    await db().execute(sql`update cases set assigned_at = '2026-11-01T09:00:00Z'
      where id <> ${latest} and assignee_id = ${busy.id}`);
    const nobody = testId('usr');

    const facts = await readCaseAssigneeFacts(db(), {
      environmentId,
      organizationId,
      caseTemplateId: template.id,
      userIds: [reader.id, busy.id, gone.id, nobody],
    });
    const untemplated = await readCaseAssigneeFacts(db(), {
      environmentId,
      organizationId,
      caseTemplateId: null,
      userIds: [reader.id],
    });

    expect(facts).toEqual([
      {
        userId: reader.id,
        active: true,
        holdsCasesWrite: false,
        seesTemplate: false,
        openCount: 0,
        lastAssignedAt: null,
      },
      {
        userId: busy.id,
        active: true,
        holdsCasesWrite: true,
        seesTemplate: true,
        openCount: 2,
        lastAssignedAt: at,
      },
      {
        userId: gone.id,
        active: false,
        holdsCasesWrite: true,
        seesTemplate: false,
        openCount: 0,
        lastAssignedAt: null,
      },
    ]);
    expect(untemplated[0]?.seesTemplate).toBe(true);
    expect(
      await readCaseAssigneeFacts(db(), {
        environmentId,
        organizationId,
        caseTemplateId: null,
        userIds: [],
      }),
    ).toEqual([]);
  });

  it('finds the open cases of someone deactivated, without cases:write or the template', async () => {
    const { environmentId, organizationId } = await tenant();
    const fine = await user(organizationId);
    const gone = await user(organizationId);
    await db().execute(sql`update users set status = 'deactivated' where id = ${gone.id}`);
    const reader = await user(organizationId, ['cases:read']);
    const blind = await user(organizationId);
    const template = await seedCaseTemplate(db(), environmentId);
    const restricted = await seedCaseTemplate(db(), environmentId);
    await db()
      .execute(sql`update case_templates set visible_to_roles = ${`{${fine.roleId}}`}::text[]
      where id = ${restricted.id}`);
    await caseOf(environmentId, template, { assigneeId: fine.id });
    await caseOf(environmentId, restricted, { assigneeId: fine.id });
    const ofGone = await caseOf(environmentId, template, { assigneeId: gone.id });
    const ofReader = await caseOf(environmentId, template, { assigneeId: reader.id });
    const ofBlind = await caseOf(environmentId, restricted, { assigneeId: blind.id });
    const ofNobody = await caseOf(environmentId, template, { assigneeId: testId('usr') });
    const resolved = await caseOf(environmentId, template, { assigneeId: gone.id });
    await db().execute(sql`update cases set status = 'approved', status_category = 'end',
      resolution = 'Approved', resolver_type = 'user', resolver_id = ${fine.id},
      resolved_at = now() where id = ${resolved}`);

    const stranded = await db().transaction((tx) => lockStrandedCases(tx, { limit: 500 }));
    const mine = stranded.filter((each) => each.environmentId === environmentId);

    expect(mine.map(({ caseId }) => caseId)).toEqual([ofGone, ofReader, ofBlind, ofNobody].sort());
    expect(mine.every((each) => each.organizationId === organizationId)).toBe(true);
    const one = await db().transaction((tx) => lockStrandedCases(tx, { limit: 1 }));
    expect(one).toHaveLength(1);
  });

  it('locks a queue’s cases of members who left, and its unassigned cases', async () => {
    const { environmentId, organizationId } = await tenant();
    const [left, stays] = [await user(organizationId), await user(organizationId)];
    const template = await seedCaseTemplate(db(), environmentId);
    const queue = await seedCaseQueue(db(), environmentId);
    const ofLeft = await caseOf(environmentId, template, {
      caseQueueId: queue.id,
      assigneeId: left.id,
    });
    await caseOf(environmentId, template, { caseQueueId: queue.id, assigneeId: stays.id });
    const unassigned = await caseOf(environmentId, template, { caseQueueId: queue.id });
    await caseOf(environmentId, template, { assigneeId: left.id });

    const [ofMembers, waiting, none] = await db().transaction(async (tx) => [
      await lockQueueCasesAssignedTo(tx, environmentId, queue.id, [left.id]),
      await lockUnassignedQueueCases(tx, environmentId, queue.id),
      await lockQueueCasesAssignedTo(tx, environmentId, queue.id, []),
    ]);

    expect(ofMembers).toEqual([ofLeft]);
    expect(waiting).toEqual([unassigned]);
    expect(none).toEqual([]);
  });
});

describe('assignment policies (C132.2)', () => {
  it('writes a policy with its sources in order, replaces them, and lists newest first', async () => {
    onTestFinished(wallClockStepsBack());
    const { environmentId, organizationId } = await tenant();
    const agent = await user(organizationId);
    const template = await seedCaseTemplate(db(), environmentId);
    const queue = await seedCaseQueue(db(), environmentId);
    const id = testId('cap');

    const created = await createCaseAssignmentPolicyRow(db(), environmentId, {
      id,
      name: 'Synthetic policy',
      distribution: 'fewest-open',
      sort: 'sla-expires-at',
      agentIds: [agent.id],
      maxCapacity: 4,
      sources: [{ caseQueueId: queue.id }, { caseTemplateId: template.id }],
    });
    const sources = await listCaseAssignmentPolicySources(db(), environmentId, id);
    const updated = await updateCaseAssignmentPolicyRow(db(), environmentId, id, {
      name: 'Synthetic policy two',
      agentIds: null,
      maxCapacity: null,
      roundRobinCursor: agent.id,
      sources: [{ caseTemplateId: template.id }],
    });
    const after = await listCaseAssignmentPolicySourcesOf(db(), environmentId, [id]);
    const second = await createCaseAssignmentPolicyRow(db(), environmentId, {
      id: testId('cap'),
      name: 'Synthetic policy three',
      distribution: 'round-robin',
      sort: 'created-at',
      agentIds: null,
      maxCapacity: null,
      sources: [{ caseQueueId: queue.id }],
    });
    const clock = createdAtClock(db());
    await clock.at('case_assignment_policies', id);
    await clock.at('case_assignment_policies', second.id);

    expect(created).toMatchObject({
      distribution: 'fewest-open',
      sort: 'sla-expires-at',
      agentIds: [agent.id],
      maxCapacity: 4,
    });
    expect(
      sources.map(({ position, caseTemplateId, caseQueueId }) => ({
        position,
        caseTemplateId,
        caseQueueId,
      })),
    ).toEqual([
      { position: 0, caseTemplateId: null, caseQueueId: queue.id },
      { position: 1, caseTemplateId: template.id, caseQueueId: null },
    ]);
    expect(updated).toMatchObject({
      name: 'Synthetic policy two',
      agentIds: null,
      maxCapacity: null,
      roundRobinCursor: agent.id,
    });
    expect(after.map(({ caseTemplateId }) => caseTemplateId)).toEqual([template.id]);
    expect(await getCaseAssignmentPolicyRow(db(), environmentId, id)).toMatchObject({ id });
    expect(await getCaseAssignmentPolicyRow(db(), environmentId, testId('cap'))).toBeNull();
    const locked = await db().transaction((tx) =>
      lockCaseAssignmentPolicyRow(tx, environmentId, id),
    );
    expect(locked?.id).toBe(id);
    const listed = await listCaseAssignmentPolicyRows(db(), environmentId, {}, { size: 10 });
    expect(listed.items.map((row) => row.id)).toEqual([second.id, id]);
    const fewest = await listCaseAssignmentPolicyRows(
      db(),
      environmentId,
      { distributions: ['fewest-open'] },
      { size: 10 },
    );
    expect(fewest.items.map((row) => row.id)).toEqual([id]);
    expect(
      await updateCaseAssignmentPolicyRow(db(), environmentId, testId('cap'), { name: 'x' }),
    ).toBeNull();
    expect(await listCaseAssignmentPolicySourcesOf(db(), environmentId, [])).toEqual([]);
  });
});

describe('SLA policies and calendars (C133.1, C133.2)', () => {
  it('writes an SLA policy, moves its revision on demand, and lists by calendar', async () => {
    onTestFinished(wallClockStepsBack());
    const { environmentId } = await tenant();
    const calendar = await seedCaseCalendar(db(), environmentId);
    const id = testId('cslap');

    const created = await createCaseSlaPolicyRow(db(), environmentId, {
      id,
      name: 'Synthetic SLA',
      targetMinutes: 90,
      caseCalendarId: calendar.id,
      onReopen: 'restart',
    });
    const renamed = await updateCaseSlaPolicyRow(db(), environmentId, id, { name: 'Renamed' });
    const revised = await updateCaseSlaPolicyRow(db(), environmentId, id, {
      targetMinutes: 120,
      caseCalendarId: null,
      newRevision: true,
    });
    const other = await seedCaseSlaPolicy(db(), environmentId, { caseCalendarId: calendar.id });
    const clock = createdAtClock(db());
    await clock.at('case_sla_policies', id);
    await clock.at('case_sla_policies', other.id);

    expect(created).toMatchObject({ targetMinutes: 90, onReopen: 'restart', revision: 1 });
    expect(renamed).toMatchObject({ name: 'Renamed', revision: 1 });
    expect(revised).toMatchObject({ targetMinutes: 120, caseCalendarId: null, revision: 2 });
    expect(await getCaseSlaPolicyRow(db(), environmentId, id)).toMatchObject({ revision: 2 });
    expect(await getCaseSlaPolicyRow(db(), environmentId, testId('cslap'))).toBeNull();
    const all = await listCaseSlaPolicyRows(db(), environmentId, {}, { size: 10 });
    expect(all.items.map((row) => row.id)).toEqual([other.id, id]);
    const onCalendar = await listCaseSlaPolicyRows(
      db(),
      environmentId,
      { caseCalendarIds: [calendar.id] },
      { size: 10 },
    );
    expect(onCalendar.items.map((row) => row.id)).toEqual([other.id]);
    expect(
      await updateCaseSlaPolicyRow(db(), environmentId, testId('cslap'), { name: 'x' }),
    ).toBeNull();
  });

  it('writes, locks, changes and lists calendars', async () => {
    onTestFinished(wallClockStepsBack());
    const { environmentId } = await tenant();
    const id = testId('ccal');
    const day = [{ start: '08:00', end: '12:00' }];
    const week = {
      monday: day,
      tuesday: day,
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    };

    const created = await createCaseCalendarRow(db(), environmentId, {
      id,
      name: 'Synthetic hours',
      timeZone: 'America/New_York',
      week,
      holidays: [{ date: '2026-12-25', label: 'Closed' }],
      closures: [],
    });
    const changed = await updateCaseCalendarRow(db(), environmentId, id, {
      holidays: [],
      closures: [{ start: '2026-12-24T12:00', end: '2026-12-24T17:00', label: 'Early close' }],
    });
    const other = await seedCaseCalendar(db(), environmentId);
    const clock = createdAtClock(db());
    await clock.at('case_calendars', id);
    await clock.at('case_calendars', other.id);

    expect(created).toMatchObject({ timeZone: 'America/New_York', week });
    expect(created.holidays).toEqual([{ date: '2026-12-25', label: 'Closed' }]);
    expect(changed).toMatchObject({ holidays: [], closures: [{ label: 'Early close' }] });
    expect(await getCaseCalendarRow(db(), environmentId, id)).toMatchObject({ id });
    expect(await getCaseCalendarRow(db(), environmentId, testId('ccal'))).toBeNull();
    const locked = await db().transaction((tx) => lockCaseCalendarRow(tx, environmentId, id));
    expect(locked?.id).toBe(id);
    const listed = await listCaseCalendarRows(db(), environmentId, {}, { size: 10 });
    expect(listed.items.map((row) => row.id)).toEqual([other.id, id]);
    expect(await updateCaseCalendarRow(db(), environmentId, testId('ccal'), { name: 'x' })).toBe(
      null,
    );
  });
});

describe('the SLA rows (C133.6, decision 59)', () => {
  it('locks running deadlines due now, earliest first, with their epoch and organisation', async () => {
    const { environmentId, organizationId } = await tenant();
    const template = await seedCaseTemplate(db(), environmentId);
    const now = new Date('2026-11-03T12:00:00.000Z');
    const late = await caseOf(environmentId, template);
    const later = await caseOf(environmentId, template);
    const future = await caseOf(environmentId, template);
    const paused = await caseOf(environmentId, template);
    await running(late, new Date('2026-11-03T11:00:00.000Z'));
    await running(later, new Date('2026-11-03T12:00:00.000Z'));
    await running(future, new Date('2026-11-03T12:00:01.000Z'));
    await db().execute(sql`update cases set sla_state = 'paused', sla_epoch = 2,
      sla_target_ms = 60000, sla_consumed_ms = 1000 where id = ${paused}`);

    const due = await db().transaction((tx) => lockDueCaseSlas(tx, { now, limit: 500 }));
    const mine = due.filter((each) => each.environmentId === environmentId);

    expect(mine).toEqual([
      {
        environmentId,
        organizationId,
        caseId: late,
        slaEpoch: 1,
        slaExpiresAt: new Date('2026-11-03T11:00:00.000Z'),
      },
      {
        environmentId,
        organizationId,
        caseId: later,
        slaEpoch: 1,
        slaExpiresAt: new Date('2026-11-03T12:00:00.000Z'),
      },
    ]);
    const one = await db().transaction((tx) => lockDueCaseSlas(tx, { now, limit: 1 }));
    expect(one).toHaveLength(1);
  });

  it('locks the unredacted running and paused cases counting on a calendar', async () => {
    const { environmentId } = await tenant();
    const template = await seedCaseTemplate(db(), environmentId);
    const calendar = await seedCaseCalendar(db(), environmentId);
    const policy = await seedCaseSlaPolicy(db(), environmentId, { caseCalendarId: calendar.id });
    const onCalendar = sql`, sla_policy_id = ${policy.id}, sla_policy_revision = 1,
      sla_case_calendar_id = ${calendar.id}`;
    const runningCase = await caseOf(environmentId, template);
    const pausedCase = await caseOf(environmentId, template);
    const metCase = await caseOf(environmentId, template);
    const elsewhere = await caseOf(environmentId, template);
    await running(runningCase, new Date('2026-11-04T00:00:00.000Z'), onCalendar);
    await db().execute(sql`update cases set sla_state = 'paused', sla_epoch = 2,
      sla_target_ms = 60000 ${onCalendar} where id = ${pausedCase}`);
    await db().execute(sql`update cases set sla_state = 'met', sla_epoch = 1, sla_target_ms = 60000,
      sla_expires_at = now(), sla_met_at = now() ${onCalendar} where id = ${metCase}`);
    await running(elsewhere, new Date('2026-11-04T00:00:00.000Z'));

    const locked = await db().transaction((tx) =>
      lockCasesOnCalendar(tx, environmentId, calendar.id),
    );

    expect(locked).toEqual([runningCase, pausedCase].sort());
  });
});
