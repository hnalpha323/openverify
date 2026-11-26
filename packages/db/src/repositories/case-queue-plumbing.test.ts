/**
 * Workflow 8B Stage 1b, checkpoint (Q) (C132, C133): the db plumbing of queues, policies, calendars
 * and the SLA.
 *
 * - The repository stubs named their owner, `api-queues-sla`, until it built them (Stage 3): each now
 *   answers, and none rejects as not built.
 * - The seeds write a queue with its members, a policy with its sources in order, a calendar and an
 *   SLA policy, and a case in a queue with an assignee, each by SQL with the defaults C132 and C133
 *   state, so a Stage 3 test can start from them.
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseAssignmentPolicy,
  seedCaseCalendar,
  seedCaseQueue,
  seedCaseSlaPolicy,
  seedCaseTemplate,
  testId,
  type TestDatabase,
} from '../testing.js';
import type { Db } from '../client.js';
import {
  CaseRepositoryNotBuiltError,
  createUser,
  getCaseAssignmentPolicyRow,
  getCaseCalendarRow,
  getCaseQueueRow,
  getCaseSlaPolicyRow,
  listCaseAssignmentPolicySources,
  listCaseQueueMembers,
  lockCaseQueueRow,
  lockDueCaseSlas,
  pullNextCaseId,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const db = (): Db => database.db;

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

async function tenant() {
  const { organization, environment } = await createTestTenant(db());
  return { environmentId: environment.id, organizationId: organization.id };
}

async function user(organizationId: string): Promise<string> {
  const id = testId('usr');
  await createUser(db(), {
    id,
    organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
  return id;
}

describe('the (Q) repository stubs (C132, C133)', () => {
  const ENV = testId('env');
  const STUBS: readonly [string, () => Promise<unknown>][] = [
    ['getCaseQueueRow', () => getCaseQueueRow(db(), ENV, testId('cqueue'))],
    ['lockCaseQueueRow', () => lockCaseQueueRow(db(), ENV, testId('cqueue'))],
    ['listCaseQueueMembers', () => listCaseQueueMembers(db(), ENV, testId('cqueue'))],
    [
      'pullNextCaseId',
      () => pullNextCaseId(db(), ENV, [testId('cqueue')], { kind: 'user', userId: testId('usr') }),
    ],
    ['getCaseAssignmentPolicyRow', () => getCaseAssignmentPolicyRow(db(), ENV, testId('cap'))],
    [
      'listCaseAssignmentPolicySources',
      () => listCaseAssignmentPolicySources(db(), ENV, testId('cap')),
    ],
    ['getCaseSlaPolicyRow', () => getCaseSlaPolicyRow(db(), ENV, testId('cslap'))],
    ['getCaseCalendarRow', () => getCaseCalendarRow(db(), ENV, testId('ccal'))],
    ['lockDueCaseSlas', () => lockDueCaseSlas(db(), { now: new Date(0), limit: 500 })],
  ];

  it.each(STUBS)('%s is built by api-queues-sla and answers', async (_name, call) => {
    const error = await call().then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).not.toBeInstanceOf(CaseRepositoryNotBuiltError);
    expect(error).toBeNull();
  });
});

describe('the (Q) seeds', () => {
  it('write a queue with its members, at 50 open and unpaused unless told', async () => {
    const { environmentId, organizationId } = await tenant();
    const [first, second] = [await user(organizationId), await user(organizationId)];

    const { id } = await seedCaseQueue(db(), environmentId, {
      members: [{ userId: first }, { userId: second, maxOpen: 3, paused: true }],
    });

    const queue = await query(`select status, name from case_queues where id = $1`, [id]);
    const members = await query(
      `select user_id, max_open, paused from case_queue_members where case_queue_id = $1
       order by user_id`,
      [id],
    );
    expect(queue.rows).toEqual([{ status: 'active', name: 'Synthetic queue' }]);
    expect(members.rows).toEqual(
      [
        { user_id: first, max_open: 50, paused: false },
        { user_id: second, max_open: 3, paused: true },
      ].sort((a, b) => (a.user_id < b.user_id ? -1 : 1)),
    );
  });

  it('write a policy with its sources in the order given', async () => {
    const { environmentId } = await tenant();
    const template = await seedCaseTemplate(db(), environmentId);
    const queue = await seedCaseQueue(db(), environmentId);

    const { id } = await seedCaseAssignmentPolicy(db(), environmentId, {
      distribution: 'fewest-open',
      sources: [{ caseQueueId: queue.id }, { caseTemplateId: template.id }],
    });

    const policy = await query(
      `select distribution, sort, agent_ids, max_capacity from case_assignment_policies
       where id = $1`,
      [id],
    );
    const sources = await query(
      `select position, case_template_id, case_queue_id from case_assignment_policy_sources
       where case_assignment_policy_id = $1 order by position`,
      [id],
    );
    expect(policy.rows).toEqual([
      { distribution: 'fewest-open', sort: 'created-at', agent_ids: null, max_capacity: null },
    ]);
    expect(sources.rows).toEqual([
      { position: 0, case_template_id: null, case_queue_id: queue.id },
      { position: 1, case_template_id: template.id, case_queue_id: null },
    ]);
  });

  it('write a calendar and an SLA policy on it', async () => {
    const { environmentId } = await tenant();

    const calendar = await seedCaseCalendar(db(), environmentId, {
      holidays: [{ date: '2026-12-25', label: 'Closed' }],
    });
    const { id } = await seedCaseSlaPolicy(db(), environmentId, { caseCalendarId: calendar.id });

    const stored = await query(
      `select time_zone, week->'monday' as monday, week->'saturday' as saturday, holidays
       from case_calendars where id = $1`,
      [calendar.id],
    );
    const policy = await query(
      `select target_minutes, case_calendar_id, on_reopen, revision from case_sla_policies
       where id = $1`,
      [id],
    );
    expect(stored.rows).toEqual([
      {
        time_zone: 'Europe/London',
        monday: [{ start: '09:00', end: '17:00' }],
        saturday: [],
        holidays: [{ date: '2026-12-25', label: 'Closed' }],
      },
    ]);
    expect(policy.rows).toEqual([
      { target_minutes: 240, case_calendar_id: calendar.id, on_reopen: 'continue', revision: 1 },
    ]);
  });

  it('put a seeded case in a queue, assigned by a user', async () => {
    const { environmentId, organizationId } = await tenant();
    const template = await seedCaseTemplate(db(), environmentId);
    const queue = await seedCaseQueue(db(), environmentId);
    const assignee = await user(organizationId);

    const { id } = await seedCase(db(), environmentId, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: 1,
      caseQueueId: queue.id,
      assigneeId: assignee,
    });

    const stored = await query<{
      case_queue_id: string;
      assignee_id: string;
      assigner_type: string;
      assigner_id: string;
      assigned: boolean;
    }>(
      `select case_queue_id, assignee_id, assigner_type, assigner_id,
         assigned_at is not null as assigned
       from cases where id = $1`,
      [id],
    );
    expect(stored.rows).toEqual([
      {
        case_queue_id: queue.id,
        assignee_id: assignee,
        assigner_type: 'user',
        assigner_id: assignee,
        assigned: true,
      },
    ]);
  });
});
