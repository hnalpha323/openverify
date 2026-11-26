/**
 * C132.1, C132.2, C133.1, C133.2 through the routes (Workflow 8B Stage 3, `api-queues-sla`): the
 * configuration that routes and times cases.
 *
 * - Queues: created with members (each an active user of the organisation holding `cases:write`,
 *   else `case_assignee_ineligible`, which never says whether the id names anyone) and a policy of
 *   the environment; read, listed newest first under their filters, renamed; archived for good, which
 *   gives the unassigned cases back to no queue (`case.queue-updated` each); members replaced, a
 *   member who leaves giving back their open cases of the queue (`case.assigned` to nobody).
 * - Assignment policies: sources of the environment in priority order, agents who may hold cases.
 * - SLA policies: around the clock and `continue` unless told; a calendar of the environment; a
 *   revision moved by what changes the SLA; a target a calendar cannot reach in ten years refused.
 * - Calendars: a zone the runtime knows and no boundary in a clock change (`calendar_invalid` naming
 *   the dates); holidays imported from a `date,label` CSV through `readCsv`, refused rows by number
 *   and code only.
 * - Every change is audited with ids, names of members and counts, never a value (P19).
 *
 * Every value is synthetic.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createdAtClock, wallClockStepsBack } from '@openverify/db/testing';
import { createTestApi, type TestApi } from '../../../test-support/harness.js';
import {
  ALL_WEEK,
  call,
  expectAnswer,
  historyOf,
  newCase,
  person,
  publishedTemplate,
  readCase,
  weekdays,
} from './testing.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

const queueBody = (attributes: Record<string, unknown>) => ({
  data: { type: 'case-queue', attributes },
});

async function queue(attributes: Record<string, unknown> = {}) {
  return expectAnswer(
    await call(
      api,
      api.token,
      'POST',
      '/case-queues',
      queueBody({ name: 'Synthetic queue', ...attributes }),
    ),
    201,
  ).data;
}

async function policy(attributes: Record<string, unknown>) {
  return expectAnswer(
    await call(api, api.token, 'POST', '/case-assignment-policies', {
      data: {
        type: 'case-assignment-policy',
        attributes: { name: 'Synthetic policy', distribution: 'round-robin', ...attributes },
      },
    }),
    201,
  ).data;
}

describe('queues and their members (C132.1)', () => {
  it('creates a queue with its members and policy, and reads it back', async () => {
    const [agent, other] = [await person(api), await person(api)];
    const template = await publishedTemplate(api);
    const rule = await policy({ sources: [{ type: 'case-template', id: template.id }] });

    const created = await queue({
      'case-assignment-policy-id': rule.id,
      members: [{ 'user-id': agent.id }, { 'user-id': other.id, 'max-open': 3, paused: true }],
    });
    const read = expectAnswer(await call(api, api.token, 'GET', `/case-queues/${created.id}`), 200);

    expect(created.attributes).toMatchObject({
      status: 'active',
      name: 'Synthetic queue',
      'archived-at': null,
      'case-assignment-policy-id': rule.id,
    });
    expect(read.data.attributes.members).toEqual(
      [
        { 'user-id': agent.id, 'max-open': 50, paused: false },
        { 'user-id': other.id, 'max-open': 3, paused: true },
      ].sort((a, b) => (a['user-id'] < b['user-id'] ? -1 : 1)),
    );
    const [entry] = api.audit.withAction('case-queue.created').slice(-1);
    expect(entry?.resourceId).toBe(created.id);
    expect(entry?.metadata).toEqual({ 'member-count': 2, 'case-assignment-policy-id': rule.id });
    expect(JSON.stringify(entry)).not.toContain('Synthetic queue');
  });

  it('refuses a member who may not hold cases, alike for anyone who does not exist', async () => {
    const reader = await person(api, { permissions: ['cases:read'] });
    const gone = await person(api, { status: 'deactivated' });
    const other = await api.newTenant();
    const stranger = await person(api, {
      environmentId: other.environmentId,
      organizationId: other.organizationId,
    });

    const answers = [];
    for (const id of [reader.id, gone.id, stranger.id]) {
      answers.push(
        await call(
          api,
          api.token,
          'POST',
          '/case-queues',
          queueBody({ name: 'Synthetic queue', members: [{ 'user-id': id }] }),
        ),
      );
    }

    for (const answer of answers) {
      expect(answer.status, answer.raw).toBe(422);
      expect(answer.body.code).toBe('case_assignee_ineligible');
      expect(answer.body.errors?.[0]?.pointer).toBe('/data/attributes/members/0/user-id');
    }
    expect(answers[0]?.body.detail).toBe(answers[2]?.body.detail);
  });

  it('refuses a policy this environment does not hold, and answers 404 for an unknown queue', async () => {
    const other = await api.newTenant();
    const template = await publishedTemplate(api);
    const foreign = expectAnswer(
      await call(api, other.token, 'POST', '/case-assignment-policies', {
        data: {
          type: 'case-assignment-policy',
          attributes: {
            name: 'Synthetic policy',
            distribution: 'round-robin',
            sources: [
              { type: 'case-template', id: (await publishedTemplate(api, {}, other.token)).id },
            ],
          },
        },
      }),
      201,
    );

    const refused = await call(
      api,
      api.token,
      'POST',
      '/case-queues',
      queueBody({ name: 'Synthetic queue', 'case-assignment-policy-id': foreign.data.id }),
    );
    const missing = await call(
      api,
      api.token,
      'GET',
      '/case-queues/cqueue_01M5CK3190XEVBM5ZXA76E1JSN',
    );

    expect(refused.status, refused.raw).toBe(422);
    expect(refused.body.errors?.[0]?.pointer).toBe('/data/attributes/case-assignment-policy-id');
    expect(missing.status).toBe(404);
    expect(template.id).toMatch(/^ctmpl_/);
  });

  it('lists queues newest first under their filters', async () => {
    onTestFinished(wallClockStepsBack());
    const tenant = await api.newTenant();
    const member = await person(api, {
      environmentId: tenant.environmentId,
      organizationId: tenant.organizationId,
    });
    const make = async (attributes: Record<string, unknown>) =>
      expectAnswer(
        await call(
          api,
          tenant.token,
          'POST',
          '/case-queues',
          queueBody({ name: 'Synthetic queue', ...attributes }),
        ),
        201,
      ).data;
    const first = await make({ members: [{ 'user-id': member.id }] });
    const second = await make({});
    const third = await make({ members: [{ 'user-id': member.id }] });
    const clock = createdAtClock(api.database.db);
    for (const { id } of [first, second, third]) {
      await clock.at('case_queues', id);
    }
    expectAnswer(
      await call(
        api,
        tenant.token,
        'PATCH',
        `/case-queues/${second.id}`,
        queueBody({ status: 'archived' }),
      ),
      200,
    );

    const page = expectAnswer(
      await call(api, tenant.token, 'GET', '/case-queues?page[size]=2'),
      200,
    );
    const rest = expectAnswer(
      await call(api, tenant.token, 'GET', String(page.links?.next).replace('/api/v1', '')),
      200,
    );
    const ofMember = expectAnswer(
      await call(api, tenant.token, 'GET', `/case-queues?filter[member-id]=${member.id}`),
      200,
    );
    const archived = expectAnswer(
      await call(api, tenant.token, 'GET', '/case-queues?filter[status]=archived'),
      200,
    );

    expect([...page.data, ...rest.data].map(({ id }) => id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(ofMember.data.map(({ id }) => id)).toEqual([third.id, first.id]);
    expect(archived.data.map(({ id }) => id)).toEqual([second.id]);
  });

  it('archives a queue for good, giving its unassigned cases back to no queue', async () => {
    const agent = await person(api);
    const box = await queue();
    const template = await publishedTemplate(api);
    const waiting = await newCase(api, template.id, { 'case-queue-id': box.id });
    const taken = await newCase(api, template.id, { 'case-queue-id': box.id });
    expectAnswer(
      await call(api, api.token, 'POST', `/cases/${taken.id}/assign`, {
        meta: { 'user-id': agent.id },
      }),
      200,
    );
    const before = api.events.named('case.queue-updated').length;

    const archived = expectAnswer(
      await call(
        api,
        api.token,
        'PATCH',
        `/case-queues/${box.id}`,
        queueBody({ status: 'archived' }),
      ),
      200,
    );
    const again = await call(
      api,
      api.token,
      'PATCH',
      `/case-queues/${box.id}`,
      queueBody({ name: 'Back' }),
    );
    const members = await call(
      api,
      api.token,
      'PUT',
      `/case-queues/${box.id}/members`,
      queueBody({ members: [] }),
    );
    const newEntry = await call(api, api.token, 'POST', '/cases', {
      data: { attributes: { 'case-template-id': template.id, 'case-queue-id': box.id } },
    });

    expect(archived.data.attributes).toMatchObject({ status: 'archived' });
    expect(typeof archived.data.attributes['archived-at']).toBe('string');
    expect((await readCase(api, waiting.id)).relationships?.['case-queue']?.data).toBeNull();
    expect((await readCase(api, taken.id)).relationships?.['case-queue']?.data).toEqual({
      type: 'case-queue',
      id: box.id,
    });
    const moved = api.events.named('case.queue-updated').slice(before);
    expect(moved.map((event) => (event.payload as { data: { id: string } }).data.id)).toEqual([
      waiting.id,
    ]);
    expect((await historyOf(api, waiting.id)).map(({ kind }) => kind)).toContain('queue-changed');
    expect(again.status).toBe(409);
    expect(members.status).toBe(409);
    expect(newEntry.status).toBe(422);
    expect(api.audit.withAction('case-queue.archived').at(-1)?.metadata).toEqual({
      'returned-case-count': 1,
    });
  });

  it('replaces the members; one who leaves gives back their open cases of the queue', async () => {
    const [stays, leaves] = [await person(api), await person(api)];
    const box = await queue({ members: [{ 'user-id': stays.id }, { 'user-id': leaves.id }] });
    const template = await publishedTemplate(api);
    const theirs = await newCase(api, template.id, { 'case-queue-id': box.id });
    expectAnswer(
      await call(api, api.token, 'POST', `/cases/${theirs.id}/assign`, {
        meta: { 'user-id': leaves.id },
      }),
      200,
    );
    const elsewhere = await newCase(api, template.id);
    expectAnswer(
      await call(api, api.token, 'POST', `/cases/${elsewhere.id}/assign`, {
        meta: { 'user-id': leaves.id },
      }),
      200,
    );
    const before = api.events.named('case.assigned').length;

    const replaced = expectAnswer(
      await call(
        api,
        api.token,
        'PUT',
        `/case-queues/${box.id}/members`,
        queueBody({ members: [{ 'user-id': stays.id, 'max-open': 9 }] }),
      ),
      200,
    );

    expect(replaced.data.attributes.members).toEqual([
      { 'user-id': stays.id, 'max-open': 9, paused: false },
    ]);
    expect((await readCase(api, theirs.id)).attributes['assignee-id']).toBeNull();
    expect((await readCase(api, elsewhere.id)).attributes['assignee-id']).toBe(leaves.id);
    const unassigned = api.events.named('case.assigned').slice(before);
    expect(unassigned).toHaveLength(1);
    expect((unassigned[0]?.payload as { data: { id: string } }).data.id).toBe(theirs.id);
    expect((await historyOf(api, theirs.id)).at(-1)).toMatchObject({
      kind: 'unassigned',
      from: { 'assignee-id': leaves.id },
    });
    expect(api.audit.withAction('case-queue.members-set').at(-1)?.metadata).toEqual({
      'member-count': 1,
      'removed-count': 1,
      'returned-case-count': 1,
    });
  });
});

describe('assignment policies (C132.2)', () => {
  it('creates a policy with its sources in order and its agents, then replaces them', async () => {
    const agent = await person(api);
    const template = await publishedTemplate(api);
    const box = await queue();

    const created = await policy({
      distribution: 'fewest-open',
      agents: [agent.id],
      'max-capacity': 4,
      sources: [
        { type: 'case-queue', id: box.id },
        { type: 'case-template', id: template.id },
      ],
    });
    const changed = expectAnswer(
      await call(api, api.token, 'PATCH', `/case-assignment-policies/${created.id}`, {
        data: {
          type: 'case-assignment-policy',
          attributes: { sources: [{ type: 'case-template', id: template.id }], agents: null },
        },
      }),
      200,
    );
    const fewest = expectAnswer(
      await call(
        api,
        api.token,
        'GET',
        '/case-assignment-policies?filter[distribution]=fewest-open',
      ),
      200,
    );

    expect(created.attributes).toMatchObject({
      distribution: 'fewest-open',
      sort: 'created-at',
      agents: [agent.id],
      'max-capacity': 4,
      sources: [
        { type: 'case-queue', id: box.id },
        { type: 'case-template', id: template.id },
      ],
    });
    expect(changed.data.attributes).toMatchObject({
      agents: null,
      sources: [{ type: 'case-template', id: template.id }],
    });
    expect(fewest.data.map(({ id }) => id)).toContain(created.id);
    expect(
      expectAnswer(
        await call(api, api.token, 'GET', `/case-assignment-policies/${created.id}`),
        200,
      ).data.id,
    ).toBe(created.id);
    expect(api.audit.withAction('case-assignment-policy.updated').at(-1)?.metadata).toEqual({
      attributes: ['agents', 'sources'],
    });
  });

  it('refuses a source of another environment and an agent who may not hold cases', async () => {
    const other = await api.newTenant();
    const foreign = await publishedTemplate(api, {}, other.token);
    const reader = await person(api, { permissions: ['cases:read'] });
    const template = await publishedTemplate(api);

    const source = await call(api, api.token, 'POST', '/case-assignment-policies', {
      data: {
        type: 'case-assignment-policy',
        attributes: {
          name: 'Synthetic policy',
          distribution: 'round-robin',
          sources: [
            { type: 'case-template', id: template.id },
            { type: 'case-template', id: foreign.id },
          ],
        },
      },
    });
    const agent = await call(api, api.token, 'POST', '/case-assignment-policies', {
      data: {
        type: 'case-assignment-policy',
        attributes: {
          name: 'Synthetic policy',
          distribution: 'round-robin',
          agents: [reader.id],
          sources: [{ type: 'case-template', id: template.id }],
        },
      },
    });
    const missing = await call(
      api,
      api.token,
      'GET',
      '/case-assignment-policies/cap_01M5CK3190XEVBM5ZXA76E1JSN',
    );

    expect(source.status, source.raw).toBe(422);
    expect(source.body.errors?.[0]?.pointer).toBe('/data/attributes/sources/1/id');
    expect(agent.status, agent.raw).toBe(422);
    expect(agent.body.code).toBe('case_assignee_ineligible');
    expect(agent.body.errors?.[0]?.pointer).toBe('/data/attributes/agents/0');
    expect(missing.status).toBe(404);
  });
});

const slaBody = (attributes: Record<string, unknown>) => ({
  data: { type: 'case-sla-policy', attributes },
});
const calendarBody = (attributes: Record<string, unknown>) => ({
  data: { type: 'case-calendar', attributes },
});

async function calendar(attributes: Record<string, unknown> = {}) {
  return expectAnswer(
    await call(
      api,
      api.token,
      'POST',
      '/case-calendars',
      calendarBody({
        name: 'Synthetic hours',
        'time-zone': 'Europe/London',
        week: weekdays(),
        ...attributes,
      }),
    ),
    201,
  ).data;
}

describe('SLA policies (C133.1)', () => {
  it('runs around the clock and continues on reopen unless told, at revision 1', async () => {
    const created = expectAnswer(
      await call(
        api,
        api.token,
        'POST',
        '/case-sla-policies',
        slaBody({ name: 'Synthetic SLA', 'target-minutes': 240 }),
      ),
      201,
    );

    expect(created.data.attributes).toMatchObject({
      'target-minutes': 240,
      'case-calendar-id': null,
      'on-reopen': 'continue',
      revision: 1,
    });
  });

  it('moves the revision when the SLA changes, and not for a new name', async () => {
    const hours = await calendar();
    const created = expectAnswer(
      await call(
        api,
        api.token,
        'POST',
        '/case-sla-policies',
        slaBody({ name: 'Synthetic SLA', 'target-minutes': 60, 'case-calendar-id': hours.id }),
      ),
      201,
    );
    const renamed = expectAnswer(
      await call(
        api,
        api.token,
        'PATCH',
        `/case-sla-policies/${created.data.id}`,
        slaBody({ name: 'Renamed' }),
      ),
      200,
    );
    const revised = expectAnswer(
      await call(
        api,
        api.token,
        'PATCH',
        `/case-sla-policies/${created.data.id}`,
        slaBody({ 'target-minutes': 120, 'on-reopen': 'restart' }),
      ),
      200,
    );
    const onCalendar = expectAnswer(
      await call(api, api.token, 'GET', `/case-sla-policies?filter[case-calendar-id]=${hours.id}`),
      200,
    );

    expect(renamed.data.attributes.revision).toBe(1);
    expect(revised.data.attributes).toMatchObject({
      'target-minutes': 120,
      'on-reopen': 'restart',
      revision: 2,
    });
    expect(onCalendar.data.map(({ id }) => id)).toEqual([created.data.id]);
    expect(api.audit.withAction('case-sla-policy.updated').at(-1)?.metadata).toEqual({
      attributes: ['on-reopen', 'target-minutes'],
      revision: 2,
    });
  });

  it('refuses a calendar of another environment, and a target no calendar reaches in ten years', async () => {
    const other = await api.newTenant();
    const foreign = expectAnswer(
      await call(
        api,
        other.token,
        'POST',
        '/case-calendars',
        calendarBody({ name: 'Synthetic hours', 'time-zone': 'Europe/London', week: weekdays() }),
      ),
      201,
    );
    const thin = await calendar({
      week: {
        ...weekdays('09:00', '09:00'),
        monday: [{ start: '09:00', end: '10:00' }],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
      },
    });

    const elsewhere = await call(
      api,
      api.token,
      'POST',
      '/case-sla-policies',
      slaBody({ name: 'Synthetic SLA', 'target-minutes': 60, 'case-calendar-id': foreign.data.id }),
    );
    const unreachable = await call(
      api,
      api.token,
      'POST',
      '/case-sla-policies',
      slaBody({ name: 'Synthetic SLA', 'target-minutes': 525_600, 'case-calendar-id': thin.id }),
    );
    const missing = await call(
      api,
      api.token,
      'GET',
      '/case-sla-policies/cslap_01M5CK3190XEVBM5ZXA76E1JSN',
    );

    expect(elsewhere.status, elsewhere.raw).toBe(422);
    expect(elsewhere.body.errors?.[0]?.pointer).toBe('/data/attributes/case-calendar-id');
    expect(unreachable.status, unreachable.raw).toBe(422);
    expect(unreachable.body.code).toBe('sla_out_of_range');
    expect(missing.status).toBe(404);
  });
});

describe('calendars (C133.2, C133.3)', () => {
  it('creates, reads, lists and changes a calendar', async () => {
    const created = await calendar({
      holidays: [{ date: '2026-12-25', label: 'Closed' }],
      closures: [{ start: '2026-12-24T12:00', end: '2026-12-24T17:00', label: 'Early close' }],
    });
    const changed = expectAnswer(
      await call(
        api,
        api.token,
        'PATCH',
        `/case-calendars/${created.id}`,
        calendarBody({ week: ALL_WEEK }),
      ),
      200,
    );
    const listed = expectAnswer(
      await call(api, api.token, 'GET', '/case-calendars?page[size]=100'),
      200,
    );

    expect(created.attributes).toMatchObject({
      'time-zone': 'Europe/London',
      holidays: [{ date: '2026-12-25', label: 'Closed' }],
    });
    expect(changed.data.attributes.week).toEqual(ALL_WEEK);
    expect(listed.data.map(({ id }) => id)).toContain(created.id);
    expect(
      (await call(api, api.token, 'GET', '/case-calendars/ccal_01M5CK3190XEVBM5ZXA76E1JSN')).status,
    ).toBe(404);
  });

  it('refuses a zone the runtime does not know and a boundary in a clock change, naming the dates', async () => {
    const unknownZone = await call(
      api,
      api.token,
      'POST',
      '/case-calendars',
      calendarBody({ name: 'Synthetic hours', 'time-zone': 'Synthetic/Nowhere', week: weekdays() }),
    );
    const gap = await call(
      api,
      api.token,
      'POST',
      '/case-calendars',
      calendarBody({
        name: 'Synthetic hours',
        'time-zone': 'America/New_York',
        week: { ...weekdays(), sunday: [{ start: '02:30', end: '04:00' }] },
      }),
    );
    const valid = await calendar({ 'time-zone': 'America/New_York' });
    const patched = await call(
      api,
      api.token,
      'PATCH',
      `/case-calendars/${valid.id}`,
      calendarBody({ week: { ...weekdays(), sunday: [{ start: '02:30', end: '04:00' }] } }),
    );

    expect(unknownZone.status, unknownZone.raw).toBe(422);
    expect(unknownZone.body.code).toBe('calendar_invalid');
    expect(gap.status, gap.raw).toBe(422);
    expect(gap.body.code).toBe('calendar_invalid');
    expect(gap.body.dates).toContain('2027-03-14');
    expect(patched.status, patched.raw).toBe(422);
    expect(patched.body.code).toBe('calendar_invalid');
  });

  it('imports holidays from a CSV, refusing rows by number and code only', async () => {
    const hours = await calendar({ holidays: [{ date: '2026-12-25', label: 'Closed' }] });
    const csv = [
      'date,label',
      '2026-12-25,Christmas closure',
      '2026-12-26,Boxing closure',
      '2026-02-30,Synthetic canary label',
      '2026-12-26,Again',
      '2027-01-01,New year closure',
    ].join('\r\n');

    const imported = expectAnswer(
      await call(
        api,
        api.token,
        'POST',
        `/case-calendars/${hours.id}/holidays/import`,
        calendarBody({ csv }),
      ),
      200,
    );
    const replaced = expectAnswer(
      await call(
        api,
        api.token,
        'POST',
        `/case-calendars/${hours.id}/holidays/import`,
        calendarBody({ csv: 'date,label\r\n2027-04-05,Spring closure\r\n', replace: true }),
      ),
      200,
    );
    const badHeader = await call(
      api,
      api.token,
      'POST',
      `/case-calendars/${hours.id}/holidays/import`,
      calendarBody({ csv: 'day,label\r\n2027-04-05,Spring closure\r\n' }),
    );

    expect(imported.meta).toEqual({
      'imported-count': 3,
      refused: [
        { row: 4, code: 'invalid_value' },
        { row: 5, code: 'date_repeated' },
      ],
    });
    expect(imported.data.attributes.holidays).toEqual([
      { date: '2026-12-25', label: 'Christmas closure' },
      { date: '2026-12-26', label: 'Boxing closure' },
      { date: '2027-01-01', label: 'New year closure' },
    ]);
    expect(JSON.stringify(imported.meta)).not.toContain('canary');
    expect(replaced.data.attributes.holidays).toEqual([
      { date: '2027-04-05', label: 'Spring closure' },
    ]);
    expect(badHeader.status, badHeader.raw).toBe(422);
    expect(badHeader.raw).not.toContain('Spring closure');
    expect(api.audit.withAction('case-calendar.holidays-imported').at(-1)?.metadata).toEqual({
      'imported-count': 1,
      'refused-count': 0,
      replace: true,
    });
  });
});
