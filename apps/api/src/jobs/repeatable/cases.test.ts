/**
 * C132.6, C133.6, C133.7 (Workflow 8B Stage 3, `api-queues-sla`): the case sweeps.
 *
 * - `case-sla` (decision 60): each running SLA due now expires once, with its history row, a breach
 *   notification for the assignee and `case.sla-expired` staged in the same transaction and
 *   dispatched after it; a second pass finds nothing; a deadline still ahead is left; a row that
 *   fails is rolled back alone and logged by id, the others commit.
 * - `case-reassign` (C132.6): an open case assigned to someone deactivated, without `cases:write` or
 *   no longer seeing the template returns to its queue's policy or to nobody, with `case.assigned`
 *   for each change; a case of an eligible assignee is left.
 *
 * Every value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRecordingEventPublisher,
  T0,
  type RecordingEventPublisher,
} from '../../test-support/fakes.js';
import { createTestApi, type TestApi } from '../../test-support/harness.js';
import {
  call,
  expectAnswer,
  historyOf,
  newCase,
  person,
  publishedTemplate,
  readCase,
} from '../../services/cases/queues/testing.js';
import { runCaseReassignSweep, runCaseSlaSweep, type CaseSweepDeps } from './cases.js';

let api: TestApi;
let events: RecordingEventPublisher;
const logged: { level: string; object: Record<string, unknown>; message: string }[] = [];

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

beforeEach(() => {
  api.clock.set(T0);
  events = createRecordingEventPublisher();
  logged.length = 0;
});

afterAll(async () => {
  await api.close();
});

const deps = (): CaseSweepDeps => ({
  db: api.database.db,
  clock: api.clock,
  events,
  logger: {
    info: (object, message) => logged.push({ level: 'info', object, message }),
    warn: (object, message) => logged.push({ level: 'warn', object, message }),
    error: (object, message) => logged.push({ level: 'error', object, message }),
  },
});

const MINUTE = 60_000;

const firedFor = (id: string) =>
  events
    .named('case.sla-expired')
    .filter((event) => (event.payload as { data: { id: string } }).data.id === id);

describe('the case-sla sweep (C133.6)', () => {
  it('expires each due SLA once, notifying its assignee, and leaves one still ahead', async () => {
    const agent = await person(api);
    const template = await publishedTemplate(api);
    const due = await newCase(api, template.id, {}, { 'sla-expires-in-seconds': 60 });
    const ahead = await newCase(api, template.id, {}, { 'sla-expires-in-seconds': 3_600 });
    expectAnswer(
      await call(api, api.token, 'POST', `/cases/${due.id}/assign`, {
        meta: { 'user-id': agent.id },
      }),
      200,
    );

    api.clock.advance(2 * MINUTE);
    await runCaseSlaSweep(deps());
    await runCaseSlaSweep(deps());

    expect(firedFor(due.id)).toHaveLength(1);
    expect(firedFor(ahead.id)).toHaveLength(0);
    const expired = await readCase(api, due.id);
    expect(expired.attributes).toMatchObject({
      'sla-state': 'expired',
      'sla-expires-at': new Date(T0.getTime() + MINUTE).toISOString(),
    });
    expect((await readCase(api, ahead.id)).attributes['sla-state']).toBe('running');
    expect((await historyOf(api, due.id)).at(-1)).toMatchObject({
      kind: 'sla-expired',
      actorType: 'system',
      to: { state: 'expired', epoch: 1 },
    });
    const notified = await api.database.db.execute(sql`select user_id, kind from user_notifications
      where case_id = ${due.id} and kind = 'sla-breached'`);
    expect((notified as unknown as { rows: unknown[] }).rows).toEqual([
      { user_id: agent.id, kind: 'sla-breached' },
    ]);
  });

  it('never fires for a case resolved before the sweep reached it', async () => {
    const template = await publishedTemplate(api);
    const made = await newCase(api, template.id, {}, { 'sla-expires-in-seconds': 60 });

    api.clock.advance(2 * MINUTE);
    expectAnswer(
      await call(api, api.token, 'POST', `/cases/${made.id}/set-status`, {
        meta: { status: 'approved' },
      }),
      200,
    );
    await runCaseSlaSweep(deps());

    expect(firedFor(made.id)).toHaveLength(0);
    expect((await readCase(api, made.id)).attributes['sla-state']).toBe('expired');
  });

  it('rolls back a row that fails alone, logging its id, and commits the others', async () => {
    const template = await publishedTemplate(api);
    const broken = await newCase(api, template.id, {}, { 'sla-expires-in-seconds': 60 });
    const fine = await newCase(api, template.id, {}, { 'sla-expires-in-seconds': 60 });
    // A running SLA whose pinned calendar row reads a zone no runtime knows cannot be measured.
    const calendar = await api.database.db.execute(sql`insert into case_calendars
      (id, environment_id, name, time_zone, week)
      values ('ccal_01M5CK3190XEVBM5ZXA76E1JSN', ${api.environmentId}, 'Broken', 'Synthetic/Nowhere',
        '{"monday":[{"start":"09:00","end":"17:00"}]}'::jsonb) returning id`);
    const policy = await api.database.db.execute(sql`insert into case_sla_policies
      (id, environment_id, name, target_minutes, case_calendar_id)
      values ('cslap_01M5CK3190XEVBM5ZXA76E1JSN', ${api.environmentId}, 'Broken', 1,
        'ccal_01M5CK3190XEVBM5ZXA76E1JSN') returning id`);
    expect((calendar as unknown as { rows: unknown[] }).rows).toHaveLength(1);
    expect((policy as unknown as { rows: unknown[] }).rows).toHaveLength(1);
    await api.database.db.execute(sql`update cases set
      sla_policy_id = 'cslap_01M5CK3190XEVBM5ZXA76E1JSN', sla_policy_revision = 1,
      sla_case_calendar_id = 'ccal_01M5CK3190XEVBM5ZXA76E1JSN' where id = ${broken.id}`);

    api.clock.advance(2 * MINUTE);
    await runCaseSlaSweep(deps());

    expect(firedFor(fine.id)).toHaveLength(1);
    expect(firedFor(broken.id)).toHaveLength(0);
    expect((await readCase(api, broken.id)).attributes['sla-state']).toBe('running');
    expect(
      logged.filter(({ level, object }) => level === 'error' && object.caseId === broken.id),
    ).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain('Synthetic/Nowhere');
  });
});

describe('the case-reassign sweep (C132.6)', () => {
  it('returns a case whose assignee was deactivated to its queue’s policy, or to nobody', async () => {
    const [leaving, staying, lost] = [await person(api), await person(api), await person(api)];
    const box = expectAnswer(
      await call(api, api.token, 'POST', '/case-queues', {
        data: {
          type: 'case-queue',
          attributes: {
            name: 'Synthetic queue',
            members: [{ 'user-id': leaving.id }, { 'user-id': staying.id }],
          },
        },
      }),
      201,
    ).data;
    const rule = expectAnswer(
      await call(api, api.token, 'POST', '/case-assignment-policies', {
        data: {
          type: 'case-assignment-policy',
          attributes: {
            name: 'Synthetic policy',
            distribution: 'fewest-open',
            sources: [{ type: 'case-queue', id: box.id }],
          },
        },
      }),
      201,
    ).data;
    expectAnswer(
      await call(api, api.token, 'PATCH', `/case-queues/${box.id}`, {
        data: { type: 'case-queue', attributes: { 'case-assignment-policy-id': rule.id } },
      }),
      200,
    );
    const template = await publishedTemplate(api);
    const queued = await newCase(api, template.id, { 'case-queue-id': box.id });
    const loose = await newCase(api, template.id);
    const kept = await newCase(api, template.id);
    for (const [id, userId] of [
      [queued.id, leaving.id],
      [loose.id, lost.id],
      [kept.id, staying.id],
    ] as const) {
      expectAnswer(
        await call(api, api.token, 'POST', `/cases/${id}/assign`, { meta: { 'user-id': userId } }),
        200,
      );
    }
    await api.database.db.execute(sql`update users set status = 'deactivated'
      where id = ${leaving.id}`);
    await api.database.db.execute(sql`update roles set permissions = '{cases:read}'::text[]
      where id = ${lost.roleId}`);

    await runCaseReassignSweep(deps());
    await runCaseReassignSweep(deps());

    expect((await readCase(api, queued.id)).attributes).toMatchObject({
      'assignee-id': staying.id,
      'assigner-type': 'case-assignment-policy',
      'assigner-id': rule.id,
    });
    expect((await readCase(api, loose.id)).attributes['assignee-id']).toBeNull();
    expect((await readCase(api, kept.id)).attributes['assignee-id']).toBe(staying.id);
    const assigned = events
      .named('case.assigned')
      .map((event) => (event.payload as { data: { id: string } }).data.id);
    expect(assigned.sort()).toEqual([queued.id, queued.id, loose.id].sort());
    expect((await historyOf(api, loose.id)).at(-1)).toMatchObject({
      kind: 'unassigned',
      actorType: 'system',
      from: { 'assignee-id': lost.id },
    });
  });
});
