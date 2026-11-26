/**
 * C133.1, C133.4, C133.5 and decision 59 through the routes (Workflow 8B Stage 3, `api-queues-sla`):
 * a case's SLA under its template version's SLA policy.
 *
 * - It starts as the version's `sla-starts-on` says (on creation, on entering a queue, on the first
 *   assignment), pinning the policy's revision, target, calendar and `on-reopen`; a public
 *   `sla-expires-in-seconds` given at creation wins.
 * - Every status change moves it (`applySlaOnStatusChangeInTx`): a pausing status pauses it and keeps
 *   the time used, leaving it resumes from what remains, an `end` status meets it, a reopen continues
 *   or restarts by `on-reopen`; each with its history row. A pause past a deadline the sweep has not
 *   reached yet is that deadline's expiry and stages `case.sla-expired` (once).
 * - A calendar edit recomputes the running deadlines on it, each with a history row (decision 59).
 *
 * Times come from the test clock (`2026-10-20T12:00:00Z`, a Tuesday, 13:00 in London). Synthetic only.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { T0 } from '../../../test-support/fakes.js';
import { createTestApi, type TestApi } from '../../../test-support/harness.js';
import {
  call,
  expectAnswer,
  historyOf,
  newCase,
  person,
  publishedTemplate,
  readCase,
  weekdays,
} from '../queues/testing.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

beforeEach(() => {
  api.clock.set(T0);
});

afterAll(async () => {
  await api.close();
});

const MINUTE = 60_000;
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE).toISOString();

async function slaPolicy(attributes: Record<string, unknown>) {
  return expectAnswer(
    await call(api, api.token, 'POST', '/case-sla-policies', {
      data: {
        type: 'case-sla-policy',
        attributes: { name: 'Synthetic SLA', 'target-minutes': 240, ...attributes },
      },
    }),
    201,
  ).data;
}

async function setStatus(id: string, status: string) {
  return expectAnswer(
    await call(api, api.token, 'POST', `/cases/${id}/set-status`, { meta: { status } }),
    200,
  ).data;
}

const sla = (attributes: Record<string, unknown>) => ({
  state: attributes['sla-state'],
  expiresAt: attributes['sla-expires-at'],
});

describe('a policy’s SLA starts (C133.1, C133.4)', () => {
  it('on creation, pinning the policy’s revision', async () => {
    const policy = await slaPolicy({});
    const template = await publishedTemplate(api, { 'sla-policy-id': policy.id });

    const made = await newCase(api, template.id);

    expect(sla(made.attributes)).toEqual({ state: 'running', expiresAt: at(240) });
    const started = (await historyOf(api, made.id)).find(({ kind }) => kind === 'sla-started');
    expect(started).toMatchObject({
      actorType: 'system',
      to: { state: 'running', epoch: 1, 'case-sla-policy-id': policy.id, revision: 1 },
    });
    const pinned = await api.database.db.execute(sql`select sla_policy_id, sla_policy_revision,
      sla_target_ms, sla_on_reopen from cases where id = ${made.id}`);
    expect((pinned as unknown as { rows: unknown[] }).rows).toEqual([
      {
        sla_policy_id: policy.id,
        sla_policy_revision: 1,
        sla_target_ms: 240 * MINUTE,
        sla_on_reopen: 'continue',
      },
    ]);
  });

  it('on entering a queue, and on the first assignment, as the version says', async () => {
    const policy = await slaPolicy({});
    const onQueue = await publishedTemplate(api, {
      'sla-policy-id': policy.id,
      'sla-starts-on': 'entered-queue',
    });
    const onAssign = await publishedTemplate(api, {
      'sla-policy-id': policy.id,
      'sla-starts-on': 'assigned',
    });
    const box = expectAnswer(
      await call(api, api.token, 'POST', '/case-queues', {
        data: { type: 'case-queue', attributes: { name: 'Synthetic queue' } },
      }),
      201,
    ).data;
    const agent = await person(api);
    const queued = await newCase(api, onQueue.id);
    const assigned = await newCase(api, onAssign.id);

    api.clock.advance(10 * MINUTE);
    expectAnswer(
      await call(api, api.token, 'PATCH', `/cases/${queued.id}`, {
        data: { attributes: { 'case-queue-id': box.id } },
      }),
      200,
    );
    const afterAssign = expectAnswer(
      await call(api, api.token, 'POST', `/cases/${assigned.id}/assign`, {
        meta: { 'user-id': agent.id },
      }),
      200,
    ).data;

    expect(queued.attributes['sla-state']).toBe('none');
    expect(assigned.attributes['sla-state']).toBe('none');
    expect(sla((await readCase(api, queued.id)).attributes)).toEqual({
      state: 'running',
      expiresAt: at(250),
    });
    expect(sla(afterAssign.attributes)).toEqual({ state: 'running', expiresAt: at(250) });
  });

  it('gives way to a public deadline given at creation', async () => {
    const policy = await slaPolicy({});
    const template = await publishedTemplate(api, { 'sla-policy-id': policy.id });

    const made = await newCase(api, template.id, {}, { 'sla-expires-in-seconds': 120 });

    expect(sla(made.attributes)).toEqual({ state: 'running', expiresAt: at(2) });
  });
});

describe('every status change moves the SLA (C133.5)', () => {
  it('pauses, resumes from what remains, is met, and continues on reopen', async () => {
    const policy = await slaPolicy({});
    const template = await publishedTemplate(api, { 'sla-policy-id': policy.id });
    const made = await newCase(api, template.id);

    api.clock.advance(60 * MINUTE);
    const paused = await setStatus(made.id, 'pending');
    api.clock.advance(30 * MINUTE);
    const resumed = await setStatus(made.id, 'open');
    api.clock.advance(10 * MINUTE);
    const met = await setStatus(made.id, 'approved');
    api.clock.advance(5 * MINUTE);
    const reopened = await setStatus(made.id, 'open');

    expect(sla(paused.attributes)).toEqual({ state: 'paused', expiresAt: null });
    expect(sla(resumed.attributes)).toEqual({ state: 'running', expiresAt: at(90 + 180) });
    expect(sla(met.attributes)).toEqual({ state: 'met', expiresAt: at(270) });
    expect(sla(reopened.attributes)).toEqual({ state: 'running', expiresAt: at(105 + 170) });
    expect(
      (await historyOf(api, made.id))
        .map(({ kind }) => kind)
        .filter((kind) => kind.startsWith('sla-')),
    ).toEqual(['sla-started', 'sla-paused', 'sla-resumed', 'sla-met', 'sla-resumed']);
  });

  it('restarts on reopen when the policy says so', async () => {
    const policy = await slaPolicy({ 'on-reopen': 'restart', 'target-minutes': 60 });
    const template = await publishedTemplate(api, { 'sla-policy-id': policy.id });
    const made = await newCase(api, template.id);

    api.clock.advance(30 * MINUTE);
    await setStatus(made.id, 'declined');
    api.clock.advance(30 * MINUTE);
    const reopened = await setStatus(made.id, 'open');

    expect(sla(reopened.attributes)).toEqual({ state: 'running', expiresAt: at(60 + 60) });
  });

  it('expires and stages case.sla-expired once when a pause comes after an unswept deadline', async () => {
    const template = await publishedTemplate(api);
    const made = await newCase(api, template.id, {}, { 'sla-expires-in-seconds': 60 });

    api.clock.advance(2 * MINUTE);
    const paused = await setStatus(made.id, 'pending');
    await setStatus(made.id, 'open');

    expect(paused.attributes['sla-state']).toBe('expired');
    // K8-23: through the request's own publisher, so it is delivered at once, not at the next sweep.
    const fired = api.events
      .named('case.sla-expired')
      .filter((event) => (event.payload as { data: { id: string } }).data.id === made.id);
    expect(fired).toHaveLength(1);
    const outbox = await api.database.db.execute(sql`select name from events
      where object_id = ${made.id} and name = 'case.sla-expired'`);
    expect((outbox as unknown as { rows: unknown[] }).rows).toEqual([]);
    const breach = await api.database.db.execute(sql`select kind from user_notifications
      where case_id = ${made.id}`);
    expect((breach as unknown as { rows: unknown[] }).rows).toEqual([]);
  });

  it('leaves a case with no SLA as it is', async () => {
    const template = await publishedTemplate(api);
    const made = await newCase(api, template.id);

    const paused = await setStatus(made.id, 'pending');

    expect(paused.attributes['sla-state']).toBe('none');
    expect((await historyOf(api, made.id)).map(({ kind }) => kind)).not.toContain('sla-paused');
  });
});

describe('a calendar edit recomputes the deadlines on it (decision 59)', () => {
  it('measures the time used on the old hours and runs what remains on the new ones', async () => {
    const hours = expectAnswer(
      await call(api, api.token, 'POST', '/case-calendars', {
        data: {
          type: 'case-calendar',
          attributes: { name: 'Synthetic hours', 'time-zone': 'Europe/London', week: weekdays() },
        },
      }),
      201,
    ).data;
    const policy = await slaPolicy({ 'case-calendar-id': hours.id });
    const template = await publishedTemplate(api, { 'sla-policy-id': policy.id });
    const made = await newCase(api, template.id);
    const untouched = await newCase(
      api,
      (await publishedTemplate(api)).id,
      {},
      {
        'sla-expires-in-seconds': 3_600,
      },
    );

    api.clock.advance(60 * MINUTE);
    expectAnswer(
      await call(api, api.token, 'PATCH', `/case-calendars/${hours.id}`, {
        data: { type: 'case-calendar', attributes: { week: weekdays('09:00', '15:00') } },
      }),
      200,
    );

    expect(made.attributes['sla-expires-at']).toBe('2026-10-20T16:00:00.000Z');
    expect((await readCase(api, made.id)).attributes['sla-expires-at']).toBe(
      '2026-10-21T10:00:00.000Z',
    );
    expect((await historyOf(api, made.id)).at(-1)).toMatchObject({
      kind: 'sla-recomputed',
      actorType: 'api-key',
      to: { 'expires-at': '2026-10-21T10:00:00.000Z', 'case-calendar-id': hours.id },
    });
    expect((await readCase(api, untouched.id)).attributes['sla-expires-at']).toBe(at(60));
    expect(api.audit.withAction('case-calendar.updated').at(-1)?.metadata).toEqual({
      attributes: ['week'],
      'recomputed-case-count': 1,
    });
  });
});
