/**
 * C132.2-C132.4 through the routes (Workflow 8B Stage 3, `api-queues-sla`): assignment.
 *
 * - On entry (`assignOnEntry`, which `api-cases` calls on create and on a queue change): the queue's
 *   policy, else the version's, assigns at once when an agent is eligible (active, `cases:write`, the
 *   template visible, not paused, under capacity), else the case waits for pull. Round-robin walks
 *   user ids after the cursor; fewest-open takes the fewest open cases; the creator strategies take
 *   the case's or its first inquiry's creator. Each assignment names the policy as assigner, writes a
 *   history row with the strategy and its inputs (ids and counts), and fires `case.assigned`.
 * - By hand (`POST /cases/:id/assign`): oneself with `cases:write`, anyone else with `cases:assign`;
 *   by id or by address within the organisation, a refusal never saying whether an address exists;
 *   `null` unassigns; the same assignee is no change; `lock-version` is checked.
 * - By pull (`POST /cases/next`): the most urgent unassigned case of the caller's queues that they
 *   may see, by deadline then age, assigned to them; `data: null` when none waits.
 *
 * Every value is synthetic.
 */
import { createTestInquiry, testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../../../test-support/harness.js';
import { UNMASKED } from '../../../auth/pii.js';
import { workOfUnit } from '../queues/work.js';
import { caseUnitIn } from '../shared.js';
import { assignByPolicyInTx } from './apply.js';
import {
  call,
  expectAnswer,
  historyOf,
  newCase,
  person,
  publishedTemplate,
  readCase,
  type Person,
} from '../queues/testing.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

const byId = (a: Person, b: Person) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function people(count: number, options: Parameters<typeof person>[1] = {}) {
  const made: Person[] = [];
  for (let index = 0; index < count; index += 1) {
    made.push(await person(api, options));
  }
  return made.sort(byId);
}

async function policy(attributes: Record<string, unknown>, sourceId: string) {
  return expectAnswer(
    await call(api, api.token, 'POST', '/case-assignment-policies', {
      data: {
        type: 'case-assignment-policy',
        attributes: {
          name: 'Synthetic policy',
          distribution: 'round-robin',
          sources: [
            { type: sourceId.startsWith('cqueue_') ? 'case-queue' : 'case-template', id: sourceId },
          ],
          ...attributes,
        },
      },
    }),
    201,
  ).data;
}

async function queue(attributes: Record<string, unknown>) {
  return expectAnswer(
    await call(api, api.token, 'POST', '/case-queues', {
      data: { type: 'case-queue', attributes: { name: 'Synthetic queue', ...attributes } },
    }),
    201,
  ).data;
}

/** A queue pushed by a policy of `distribution`, with `members`. */
async function pushedQueue(
  distribution: string,
  members: readonly { 'user-id': string; 'max-open'?: number; paused?: boolean }[],
  extra: Record<string, unknown> = {},
) {
  const box = await queue({ members });
  const rule = await policy({ distribution, ...extra }, box.id);
  expectAnswer(
    await call(api, api.token, 'PATCH', `/case-queues/${box.id}`, {
      data: { type: 'case-queue', attributes: { 'case-assignment-policy-id': rule.id } },
    }),
    200,
  );
  return { queueId: box.id, policyId: rule.id };
}

const assigneeOf = async (id: string) => (await readCase(api, id)).attributes['assignee-id'];

describe('assignment on entry (C132.2, C132.3)', () => {
  it('round-robin walks the members after the cursor, naming the policy and its inputs', async () => {
    const members = await people(3);
    const { queueId, policyId } = await pushedQueue(
      'round-robin',
      members.map(({ id }) => ({ 'user-id': id })),
    );
    const template = await publishedTemplate(api);
    const before = api.events.named('case.assigned').length;

    const made = [];
    for (let index = 0; index < 4; index += 1) {
      made.push(await newCase(api, template.id, { 'case-queue-id': queueId }));
    }

    expect(made.map(({ attributes }) => attributes['assignee-id'])).toEqual([
      members[0]?.id,
      members[1]?.id,
      members[2]?.id,
      members[0]?.id,
    ]);
    expect(made[0]?.attributes).toMatchObject({
      'assigner-type': 'case-assignment-policy',
      'assigner-id': policyId,
    });
    expect(typeof made[0]?.attributes['assigned-at']).toBe('string');
    expect(api.events.named('case.assigned').length - before).toBe(4);
    const assigned = (await historyOf(api, String(made[1]?.id))).find(
      ({ kind }) => kind === 'assigned',
    );
    expect(assigned).toMatchObject({
      actorType: 'case-assignment-policy',
      to: {
        'assignee-id': members[1]?.id,
        strategy: 'round-robin',
        cursor: members[0]?.id,
        eligible: 3,
        candidates: 3,
      },
    });
    const cursor = await api.database.db.execute(
      sql`select round_robin_cursor from case_queues where id = ${queueId}`,
    );
    expect(
      (cursor as unknown as { rows: { round_robin_cursor: string }[] }).rows[0]?.round_robin_cursor,
    ).toBe(members[0]?.id);
    const notified = await api.database.db.execute(sql`select user_id, kind from user_notifications
      where case_id = ${String(made[2]?.id)}`);
    expect((notified as unknown as { rows: unknown[] }).rows).toEqual([
      { user_id: members[2]?.id, kind: 'assigned' },
    ]);
  });

  it('skips a paused member, one at capacity and one who may not hold cases', async () => {
    const [paused, full, reader, free] = [
      await person(api),
      await person(api),
      await person(api, { permissions: ['cases:read'] }),
      await person(api),
    ];
    const template = await publishedTemplate(api);
    const busy = await newCase(api, template.id);
    expectAnswer(
      await call(api, api.token, 'POST', `/cases/${busy.id}/assign`, {
        meta: { 'user-id': full.id },
      }),
      200,
    );
    const { queueId } = await pushedQueue('round-robin', [
      { 'user-id': paused.id, paused: true },
      { 'user-id': full.id, 'max-open': 1 },
      { 'user-id': free.id },
    ]);
    await api.database.db.execute(sql`insert into case_queue_members
      (environment_id, case_queue_id, user_id) values (${api.environmentId}, ${queueId}, ${reader.id})`);

    const made = [];
    for (let index = 0; index < 2; index += 1) {
      made.push(await newCase(api, template.id, { 'case-queue-id': queueId }));
    }

    expect(made.map(({ attributes }) => attributes['assignee-id'])).toEqual([free.id, free.id]);
  });

  it('leaves the case for pull when no agent is eligible', async () => {
    const [paused] = await people(1);
    const { queueId } = await pushedQueue('round-robin', [
      { 'user-id': String(paused?.id), paused: true },
    ]);
    const template = await publishedTemplate(api);
    const before = api.events.named('case.assigned').length;

    const made = await newCase(api, template.id, { 'case-queue-id': queueId });

    expect(made.attributes['assignee-id']).toBeNull();
    expect(api.events.named('case.assigned').length).toBe(before);
    expect((await historyOf(api, made.id)).map(({ kind }) => kind)).not.toContain('assigned');
  });

  it('fewest-open takes the agent with the fewest open cases', async () => {
    const [loaded, light] = await people(2);
    const template = await publishedTemplate(api);
    for (let index = 0; index < 2; index += 1) {
      const busy = await newCase(api, template.id);
      expectAnswer(
        await call(api, api.token, 'POST', `/cases/${busy.id}/assign`, {
          meta: { 'user-id': String(loaded?.id) },
        }),
        200,
      );
    }
    const { queueId } = await pushedQueue('fewest-open', [
      { 'user-id': String(loaded?.id) },
      { 'user-id': String(light?.id) },
    ]);

    const made = await newCase(api, template.id, { 'case-queue-id': queueId });

    expect(made.attributes['assignee-id']).toBe(light?.id);
    const assigned = (await historyOf(api, made.id)).find(({ kind }) => kind === 'assigned');
    expect(assigned?.to).toMatchObject({ strategy: 'fewest-open', 'open-count': 0, tied: 1 });
  });

  it('a version’s policy assigns a case that enters no queue, among its listed agents', async () => {
    const agents = await people(2);
    const draft = await publishedTemplate(api);
    const rule = await policy(
      { agents: agents.map(({ id }) => id), distribution: 'round-robin' },
      draft.id,
    );
    const template = await publishedTemplate(api, { 'assignment-policy-id': rule.id });

    const first = await newCase(api, template.id);
    const second = await newCase(api, template.id);

    expect([first.attributes['assignee-id'], second.attributes['assignee-id']]).toEqual(
      agents.map(({ id }) => id),
    );
    const cursor = await api.database.db.execute(
      sql`select round_robin_cursor from case_assignment_policies where id = ${rule.id}`,
    );
    expect(
      (cursor as unknown as { rows: { round_robin_cursor: string }[] }).rows[0]?.round_robin_cursor,
    ).toBe(agents[1]?.id);
  });

  it('case-creator assigns the user who created the case, when eligible', async () => {
    const [creator, other] = await people(2);
    const draft = await publishedTemplate(api);
    const rule = await policy(
      { agents: [String(creator?.id), String(other?.id)], distribution: 'case-creator' },
      draft.id,
    );
    const template = await publishedTemplate(api, { 'assignment-policy-id': rule.id });

    const byCreator = await newCase(api, template.id, {}, undefined, String(creator?.token));
    const byKey = await newCase(api, template.id);

    expect(byCreator.attributes['assignee-id']).toBe(creator?.id);
    expect(byKey.attributes['assignee-id']).toBeNull();
  });

  it('inquiry-creator assigns the user who created the case’s first inquiry', async () => {
    const [creator] = await people(1);
    const draft = await publishedTemplate(api);
    const rule = await policy(
      { agents: [String(creator?.id)], distribution: 'inquiry-creator' },
      draft.id,
    );
    const template = await publishedTemplate(api, {
      'assignment-policy-id': rule.id,
      'held-object-types': ['inquiry'],
    });
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    await api.database.db.execute(sql`insert into audit_logs (environment_id, actor_type, actor_id,
      action, resource_type, resource_id)
      values (${api.environmentId}, 'user', ${String(creator?.id)}, 'inquiry.created', 'inquiry',
        ${inquiry.id})`);

    const made = await newCase(api, template.id, {}, { 'object-ids': [inquiry.id] });

    expect(made.attributes['assignee-id']).toBe(creator?.id);
  });

  it('inquiry-creator leaves a case with no inquiry, or one an API key created, for pull (K8-13)', async () => {
    const [creator] = await people(1);
    const draft = await publishedTemplate(api);
    const rule = await policy(
      { agents: [String(creator?.id)], distribution: 'inquiry-creator' },
      draft.id,
    );
    const template = await publishedTemplate(api, {
      'assignment-policy-id': rule.id,
      'held-object-types': ['inquiry'],
    });
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    await api.database.db.execute(sql`insert into audit_logs (environment_id, actor_type, actor_id,
      action, resource_type, resource_id)
      values (${api.environmentId}, 'api_key', ${testId('key')}, 'inquiry.created', 'inquiry',
        ${inquiry.id})`);

    const none = await newCase(api, template.id);
    const byKey = await newCase(api, template.id, {}, { 'object-ids': [inquiry.id] });

    expect([none.attributes['assignee-id'], byKey.attributes['assignee-id']]).toEqual([null, null]);
  });

  it('assigns a case moved into a pushed queue, and leaves an assigned one as it is', async () => {
    const [agent, holder] = await people(2);
    const { queueId } = await pushedQueue('round-robin', [{ 'user-id': String(agent?.id) }]);
    const template = await publishedTemplate(api);
    const moved = await newCase(api, template.id);
    const held = await newCase(api, template.id);
    expectAnswer(
      await call(api, api.token, 'POST', `/cases/${held.id}/assign`, {
        meta: { 'user-id': String(holder?.id) },
      }),
      200,
    );

    for (const id of [moved.id, held.id]) {
      expectAnswer(
        await call(api, api.token, 'PATCH', `/cases/${id}`, {
          data: { attributes: { 'case-queue-id': queueId } },
        }),
        200,
      );
    }

    expect(await assigneeOf(moved.id)).toBe(agent?.id);
    expect(await assigneeOf(held.id)).toBe(holder?.id);
  });
});

describe('assignment by hand (C132.3, C132.4)', () => {
  it('assigns oneself with cases:write, and anyone else only with cases:assign', async () => {
    const writer = await person(api, { sessionPermissions: ['cases:read', 'cases:write'] });
    const [other] = await people(1);
    const template = await publishedTemplate(api);
    const made = await newCase(api, template.id);

    const self = await call(api, writer.token, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-id': writer.id },
    });
    const refused = await call(api, writer.token, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-id': String(other?.id) },
    });
    const unassignSelf = await call(api, writer.token, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-id': null },
    });

    expect(expectAnswer(self, 200).data.attributes).toMatchObject({
      'assignee-id': writer.id,
      'assigner-type': 'user',
      'assigner-id': writer.id,
    });
    expect(refused.status, refused.raw).toBe(403);
    expect(String(refused.headers['www-authenticate'])).toContain('cases:assign');
    expect(expectAnswer(unassignSelf, 200).data.attributes['assignee-id']).toBeNull();
    expect((await historyOf(api, made.id)).map(({ kind }) => kind).slice(-2)).toEqual([
      'assigned',
      'unassigned',
    ]);
    expect(api.audit.withAction('case.assigned').at(-1)?.metadata).toEqual({
      strategy: 'manual',
      'assignee-id': null,
    });
  });

  it('assigns by address within the organisation, refusing alike for anyone it cannot assign', async () => {
    const [agent] = await people(1);
    const reader = await person(api, { permissions: ['cases:read'] });
    const template = await publishedTemplate(api);
    const made = await newCase(api, template.id);
    const before = api.events.named('case.assigned').length;

    const byAddress = await call(api, api.token, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-email-address': `${String(agent?.id).toUpperCase()}@EXAMPLE.COM` },
    });
    const unknown = await call(api, api.token, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-email-address': 'nobody-synthetic@example.com' },
    });
    const ineligible = await call(api, api.token, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-email-address': `${reader.id.toLowerCase()}@example.com` },
    });

    expect(expectAnswer(byAddress, 200).data.attributes).toMatchObject({
      'assignee-id': agent?.id,
      'assigner-type': 'api-key',
    });
    for (const answer of [unknown, ineligible]) {
      expect(answer.status, answer.raw).toBe(422);
      expect(answer.body.code).toBe('case_assignee_ineligible');
      expect(answer.body.errors?.[0]?.pointer).toBe('/meta/user-email-address');
      expect(answer.raw).not.toContain('example.com');
    }
    expect(unknown.body.detail).toBe(ineligible.body.detail);
    expect(api.events.named('case.assigned').length - before).toBe(1);
  });

  it('refuses one who may not see the template, keeps a repeat as no change, checks lock-version', async () => {
    const [agent] = await people(1);
    const as = String(agent?.token);
    const blind = await person(api);
    const template = await publishedTemplate(api, { 'visible-to-roles': [String(agent?.roleId)] });
    const made = await newCase(api, template.id, {}, undefined, as);

    const hidden = await call(api, as, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-id': blind.id },
    });
    const first = expectAnswer(
      await call(api, as, 'POST', `/cases/${made.id}/assign`, {
        meta: { 'user-id': String(agent?.id) },
      }),
      200,
    );
    const before = api.events.named('case.assigned').length;
    const repeat = expectAnswer(
      await call(api, as, 'POST', `/cases/${made.id}/assign`, {
        meta: { 'user-id': String(agent?.id) },
      }),
      200,
    );
    const stale = await call(api, as, 'POST', `/cases/${made.id}/assign`, {
      meta: { 'user-id': null, 'lock-version': Number(first.data.attributes['lock-version']) - 1 },
    });

    expect(hidden.status, hidden.raw).toBe(422);
    expect(hidden.body.code).toBe('case_assignee_ineligible');
    expect(repeat.data.attributes['lock-version']).toBe(first.data.attributes['lock-version']);
    expect(api.events.named('case.assigned').length).toBe(before);
    expect(stale.status, stale.raw).toBe(409);
    expect(stale.body.code).toBe('case_version_conflict');
    expect(
      (
        await call(api, api.token, 'POST', '/cases/case_01M6FQZCV622MRCK2ZKC7F4HD9/assign', {
          meta: { 'user-id': null },
        })
      ).status,
    ).toBe(404);
  });
});

describe('the pull (C132.3)', () => {
  it('takes the most urgent unassigned case of the caller’s queues, by deadline then age', async () => {
    const puller = await person(api);
    const outsider = await person(api);
    const box = await queue({ members: [{ 'user-id': puller.id }] });
    const elsewhere = await queue({});
    const template = await publishedTemplate(api);
    const hidden = await publishedTemplate(api, { 'visible-to-roles': [outsider.roleId] });
    const old = await newCase(api, template.id, { 'case-queue-id': box.id });
    const urgent = await newCase(
      api,
      template.id,
      { 'case-queue-id': box.id },
      {
        'sla-expires-in-seconds': 3_600,
      },
    );
    await newCase(
      api,
      hidden.id,
      { 'case-queue-id': box.id },
      { 'sla-expires-in-seconds': 60 },
      outsider.token,
    );
    await newCase(
      api,
      template.id,
      { 'case-queue-id': elsewhere.id },
      {
        'sla-expires-in-seconds': 30,
      },
    );
    await api.database.db.execute(sql`update cases set created_at = now() - interval '1 hour'
      where id = ${old.id}`);

    const first = expectAnswer(
      await call(api, puller.token, 'POST', '/cases/next', { meta: {} }),
      200,
    );
    const second = expectAnswer(await call(api, puller.token, 'POST', '/cases/next', {}), 200);
    const none = expectAnswer(
      await call(api, puller.token, 'POST', '/cases/next', { meta: {} }),
      200,
    );

    expect(first.data.id).toBe(urgent.id);
    expect(first.data.attributes).toMatchObject({
      'assignee-id': puller.id,
      'assigner-type': 'user',
      'assigner-id': puller.id,
    });
    expect(second.data.id).toBe(old.id);
    expect(none.data).toBeNull();
    expect(
      (await historyOf(api, urgent.id)).find(({ kind }) => kind === 'assigned')?.to,
    ).toMatchObject({ strategy: 'pull', 'case-queue-id': box.id });
    expect(api.audit.withAction('case.assigned').at(-1)?.metadata).toEqual({
      strategy: 'pull',
      'assignee-id': puller.id,
    });
  });

  it('pulls only from queues the caller is a member of, and never as a key', async () => {
    const puller = await person(api);
    const mine = await queue({ members: [{ 'user-id': puller.id }] });
    const theirs = await queue({});
    const template = await publishedTemplate(api);
    await newCase(api, template.id, { 'case-queue-id': theirs.id });
    const waiting = await newCase(api, template.id, { 'case-queue-id': mine.id });

    const notMine = await call(api, puller.token, 'POST', '/cases/next', {
      meta: { 'case-queue-ids': [mine.id, theirs.id] },
    });
    const named = expectAnswer(
      await call(api, puller.token, 'POST', '/cases/next', {
        meta: { 'case-queue-ids': [mine.id] },
      }),
      200,
    );
    const asKey = await call(api, api.token, 'POST', '/cases/next', { meta: {} });

    expect(notMine.status, notMine.raw).toBe(422);
    expect(notMine.body.errors?.[0]?.pointer).toBe('/meta/case-queue-ids/1');
    expect(named.data.id).toBe(waiting.id);
    expect(asKey.status, asKey.raw).toBe(403);
  });
});

describe('a policy named by a step (C140.3 assign_case)', () => {
  it('runs that policy on a case, whatever its queue or version names', async () => {
    const [agent] = await people(1);
    const draft = await publishedTemplate(api);
    const rule = await policy(
      { agents: [String(agent?.id)], distribution: 'round-robin' },
      draft.id,
    );
    const template = await publishedTemplate(api);
    const made = await newCase(api, template.id);

    const assigned = await api.database.db.transaction((tx) =>
      assignByPolicyInTx(
        workOfUnit(
          caseUnitIn(
            tx,
            api.deps,
            {
              ctx: { environmentId: api.environmentId, organizationId: api.organizationId },
              actor: { type: 'workflow-run', id: 'wfr_01M5CK3190XEVBM5ZXA76E1JSN' },
              mask: UNMASKED,
              principal: null,
            },
            [],
          ),
        ),
        made.id,
        { policyId: rule.id },
      ),
    );

    expect(made.attributes['assignee-id']).toBeNull();
    expect(assigned).toBe(agent?.id);
    expect((await readCase(api, made.id)).attributes).toMatchObject({
      'assignee-id': agent?.id,
      'assigner-type': 'case-assignment-policy',
      'assigner-id': rule.id,
    });
  });
});
