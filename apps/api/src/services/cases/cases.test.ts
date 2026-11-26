/**
 * C129-C137 through the routes (Workflow 8B Stage 3, `api-cases`): cases on a published version.
 *
 * - Create: named from the template's key and counter, in the version's initial status, holding
 *   `meta.object-ids` with their attached state, fields validated and sealed, tags normalised, a
 *   public SLA in range (`sla_out_of_range`), `case.created` with no field value, history rows.
 * - Read: fields masked member-wise without `pii:view`; a template the reader may not see is 404.
 * - Change: `lock-version` (409 `case_version_conflict`); fields (`case.updated-fields` with keys);
 *   the queue (`case.queue-updated`); tags (`case.updated-tags` with the added and removed); held
 *   objects once each, at most 1,000, of the kinds the version allows; status changes by the map
 *   with required comments, resolutions and their events in order; a comment with mentions.
 * - The timeline and the held objects are read in their own pages.
 *
 * Every value is synthetic.
 */
import { eventAttributesSchema } from '@openverify/contracts';
import { createTestInquiry, testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
}, 120_000);

afterAll(async () => {
  await api.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

let calls = 0;
const call = (method: Method, url: string, payload?: unknown, as = token) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `cases-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: unknown }>;
}

const json = (response: { body: string }) =>
  JSON.parse(response.body) as {
    data: Resource;
    included?: Resource[];
    errors?: unknown[];
    code?: string;
    'lock-version'?: number;
  };

let keys = 0;

/** A published template, with the given version attributes. */
async function template(attributes: Record<string, unknown> = {}) {
  keys += 1;
  const created = await call('POST', '/case-templates', {
    data: { attributes: { name: 'Synthetic review', key: `CS${String(keys)}`, ...attributes } },
  });
  expect(created.statusCode, created.body).toBe(201);
  const data = json(created).data;
  const draft = (data.relationships['draft-version']?.data as { id: string }).id;
  const published = await call('POST', `/case-template-versions/${draft}/publish`, { meta: {} });
  expect(published.statusCode, published.body).toBe(200);
  return { id: data.id, key: String(data.attributes.key), versionId: draft };
}

async function createCase(
  templateId: string,
  attributes: Record<string, unknown> = {},
  meta?: Record<string, unknown>,
) {
  const response = await call('POST', '/cases', {
    data: { attributes: { 'case-template-id': templateId, ...attributes } },
    ...(meta === undefined ? {} : { meta }),
  });
  expect(response.statusCode, response.body).toBe(201);
  return json(response).data;
}

const fits = (name: string, payload: unknown) =>
  eventAttributesSchema.safeParse({ name, payload, 'created-at': new Date().toISOString() })
    .success;

const FIELDS = [
  { key: 'note', label: 'Note', type: 'string', config: { searchable: true } },
  { key: 'score', label: 'Score', type: 'integer' },
];

describe('creating a case (C129.2, C136)', () => {
  it('names it from the key and counter, in the initial status, holding its objects', async () => {
    const t = await template({ 'field-schemas': FIELDS });
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const before = api.events.named('case.created').length;

    const first = await createCase(
      t.id,
      { fields: { note: 'synthetic-canary-note', score: 3 }, tags: ['Review', 'review', 'urgent'] },
      { 'object-ids': [inquiry.id] },
    );
    const second = await createCase(t.id);

    expect(first.attributes).toMatchObject({
      name: `${t.key}-1`,
      status: 'open',
      'status-category': 'initial',
      resolution: null,
      fields: {
        note: { type: 'string', value: 'synthetic-canary-note' },
        score: { type: 'integer', value: 3 },
      },
      'sla-state': 'none',
    });
    expect(first.attributes['held-object-counts']).toMatchObject({ inquiries: 1 });
    expect(typeof first.attributes['lock-version']).toBe('number');
    expect((first.attributes.tags as string[]).length).toBe(2);
    expect(first.relationships.inquiries?.data).toEqual([{ type: 'inquiry', id: inquiry.id }]);
    expect(second.attributes.name).toBe(`${t.key}-2`);
    const created = api.events.named('case.created').slice(before);
    expect(created).toHaveLength(2);
    expect(JSON.stringify(created)).not.toContain('synthetic-canary-note');
    expect(created.every((event) => fits('case.created', event.payload))).toBe(true);

    const history = JSON.parse((await call('GET', `/cases/${first.id}/history`)).body) as {
      data: { attributes: { kind: string } }[];
    };
    expect(history.data.map(({ attributes }) => attributes.kind)).toEqual(
      expect.arrayContaining(['created', 'object-attached']),
    );
    expect(JSON.stringify(history)).not.toContain('synthetic-canary-note');
    const objects = JSON.parse((await call('GET', `/cases/${first.id}/objects`)).body) as {
      data: { id: string; attributes: Record<string, unknown> }[];
    };
    expect(objects.data[0]).toMatchObject({
      id: `${first.id}:${inquiry.id}`,
      attributes: {
        'object-type': 'inquiry',
        'object-id': inquiry.id,
        'attached-by-type': 'user',
      },
    });
    expect(objects.data[0]?.attributes['attached-state']).toMatchObject({ status: 'created' });
  });

  it('refuses what the template cannot take', async () => {
    const t = await template({ 'held-object-types': ['account'] });
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const post = (attributes: Record<string, unknown>, meta?: Record<string, unknown>) =>
      call('POST', '/cases', {
        data: { attributes: { 'case-template-id': t.id, ...attributes } },
        ...(meta === undefined ? {} : { meta }),
      });

    const kind = await post({}, { 'object-ids': [inquiry.id] });
    expect(kind.statusCode).toBe(422);
    expect(json(kind).code).toBe('object_type_unsupported');
    // A SAR is not an object OpenVerify has: the contract refuses its id before the service.
    const sar = await post({}, { 'object-ids': ['sar_01M6FQZCV622MRCK2ZKC7F4HD9'] });
    expect(sar.statusCode).toBe(400);
    const workflow = await post({}, { 'object-ids': ['wfl_01M6FQZCV622MRCK2ZKC7F4HD9'] });
    expect(json(workflow).code).toBe('object_type_unsupported');
    const missing = await post({}, { 'object-ids': [testId('acc')] });
    expect(missing.statusCode).toBe(422);
    const sla = await post({}, { 'sla-expires-in-seconds': 7_776_001 });
    expect(json(sla).code).toBe('sla_out_of_range');
    const field = await post({ fields: { unknown: 'x' } });
    expect(field.statusCode).toBe(422);
    expect(JSON.stringify(json(field))).not.toContain('"x"');
    const unknown = await post({ 'case-template-id': 'ctmpl_01M5CK3190XEVBM5ZXA76E1JSN' });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuses an archived template and one with nothing published', async () => {
    const t = await template();
    await call('POST', `/case-templates/${t.id}/archive`, { meta: {} });
    const archived = await call('POST', '/cases', {
      data: { attributes: { 'case-template-id': t.id } },
    });
    expect(archived.statusCode).toBe(409);
    expect(json(archived).code).toBe('case_template_archived');

    keys += 1;
    const draftOnly = json(
      await call('POST', '/case-templates', {
        data: { attributes: { name: 'Draft only', key: `CS${String(keys)}` } },
      }),
    ).data;
    const unpublished = await call('POST', '/cases', {
      data: { attributes: { 'case-template-id': draftOnly.id } },
    });
    expect(json(unpublished).code).toBe('case_template_not_published');
  });

  it('starts a public SLA from sla-expires-in-seconds', async () => {
    const t = await template();

    const made = await createCase(t.id, {}, { 'sla-expires-in-seconds': 3_600 });

    expect(made.attributes['sla-state']).toBe('running');
    const expires = Date.parse(String(made.attributes['sla-expires-at']));
    expect(expires - api.clock.now().getTime()).toBe(3_600_000);
  });

  it('is limited by case-create: 429 past it, and through when the limiter cannot answer', async () => {
    const t = await template();
    const decision = (allowed: boolean) => ({
      allowed,
      limit: 600,
      remaining: allowed ? 1 : 0,
      resetAt: new Date(),
      retryAfterSeconds: allowed ? 0 : 60,
    });
    const post = () =>
      call('POST', '/cases', { data: { attributes: { 'case-template-id': t.id } } });
    const refusing = vi
      .spyOn(api.deps.rateLimiter, 'consume')
      .mockImplementation((key) => Promise.resolve(decision(!key.startsWith('case-create:'))));
    try {
      expect((await post()).statusCode).toBe(429);
    } finally {
      refusing.mockRestore();
    }
    const failing = vi
      .spyOn(api.deps.rateLimiter, 'consume')
      .mockImplementation((key) =>
        key.startsWith('case-create:')
          ? Promise.reject(new Error('synthetic limiter outage'))
          : Promise.resolve(decision(true)),
      );
    try {
      expect((await post()).statusCode).toBe(201);
    } finally {
      failing.mockRestore();
    }
  });
});

describe('reading cases (C129.2, C129.4, C136.4)', () => {
  it('masks fields member-wise without pii:view, and lists newest first under filters', async () => {
    const t = await template({ 'field-schemas': FIELDS });
    const made = await createCase(t.id, { fields: { note: 'synthetic-masked' } });
    const viewer = api.newUserToken(api.environmentId, { permissions: ['cases:read'] });

    const read = json(await call('GET', `/cases/${made.id}`, undefined, viewer)).data;
    expect(read.attributes.fields).toEqual({ note: { type: 'string', value: null } });
    const listed = JSON.parse(
      (await call('GET', `/cases?filter[case-template-id]=${t.id}&page[size]=100`)).body,
    ) as { data: { id: string }[] };
    expect(listed.data.map(({ id }) => id)).toContain(made.id);
    const none = JSON.parse(
      (await call('GET', `/cases?filter[case-template-id]=${t.id}&filter[status-category]=end`))
        .body,
    ) as { data: unknown[] };
    expect(none.data).toEqual([]);
    expect((await call('GET', '/cases/case_01M6FQZCV622MRCK2ZKC7F4HD9')).statusCode).toBe(404);
  });

  it('hides a case of a template that lists roles the reader does not hold (P14)', async () => {
    const role = testId('role');
    await api.database.db.execute(sql`insert into roles (id, organization_id, name, permissions)
      values (${role}, ${api.organizationId}, 'Synthetic case role', '{}'::text[])`);
    const t = await template({ 'visible-to-roles': [role] });
    const made = await createCase(t.id).catch(() => null);

    expect(made).toBeNull();
    const key = await api.newApiKey(api.environmentId);
    const byKey = await call(
      'POST',
      '/cases',
      { data: { attributes: { 'case-template-id': t.id } } },
      key,
    );
    expect(byKey.statusCode).toBe(404);
  });

  it('includes its template and comments on request', async () => {
    const t = await template();
    const made = await createCase(t.id);
    await call('POST', `/cases/${made.id}/add-comment`, { meta: { message: 'Synthetic include' } });

    const read = json(await call('GET', `/cases/${made.id}?include=case-template,case-comments`));

    expect(read.included?.map(({ type }: { type?: string } & Resource) => type).sort()).toEqual([
      'case-comment',
      'case-template',
    ]);
  });
});

describe('what a case route decides at its edges (K8-13)', () => {
  it('refuses a creator email that names nobody of the organisation, at its pointer', async () => {
    const t = await template();

    const refused = await call('POST', '/cases', {
      data: {
        attributes: { 'case-template-id': t.id, 'creator-email-address': 'nobody@example.com' },
      },
    });

    expect(refused.statusCode).toBe(422);
    expect(JSON.stringify(json(refused).errors)).toContain(
      '/data/attributes/creator-email-address',
    );
  });

  it('pages the history and the held objects by their cursors, and refuses a cursor of another case', async () => {
    const t = await template({ 'held-object-types': ['inquiry'] });
    const inquiries = [
      (await createTestInquiry(api.database.db, api.environmentId)).inquiry.id,
      (await createTestInquiry(api.database.db, api.environmentId)).inquiry.id,
    ];
    const made = await createCase(t.id, {}, { 'object-ids': inquiries });
    const other = await createCase(t.id);
    interface Page {
      data: { id: string }[];
      links: { next: string | null };
    }
    const page = (response: { body: string }) => JSON.parse(response.body) as Page;

    const history = page(await call('GET', `/cases/${made.id}/history?page[size]=1`));
    const objects = page(await call('GET', `/cases/${made.id}/objects?page[size]=1`));
    const after = (next: string | null) => new URL(next ?? '', 'https://api.example.com');
    const historyNext = page(
      await call('GET', `/cases/${made.id}/history${after(history.links.next).search}`),
    );
    const objectsNext = page(
      await call('GET', `/cases/${made.id}/objects${after(objects.links.next).search}`),
    );
    const foreign = await call(
      'GET',
      `/cases/${made.id}/objects?page[after]=${encodeURIComponent(`${other.id}:${inquiries[0] ?? ''}`)}`,
    );

    expect(history.data).toHaveLength(1);
    expect(historyNext.data.length).toBeGreaterThanOrEqual(1);
    expect(historyNext.data[0]?.id).not.toBe(history.data[0]?.id);
    expect([...objects.data, ...objectsNext.data].map(({ id }) => id.split(':')[1]).sort()).toEqual(
      [...inquiries].sort(),
    );
    expect(foreign.statusCode).toBe(400);
  });

  it('moves a case into a queue and out again, each with case.queue-updated and no assignee', async () => {
    const t = await template();
    const made = await createCase(t.id);
    const queue = await call('POST', '/case-queues', {
      data: { type: 'case-queue', attributes: { name: 'Synthetic queue', members: [] } },
    });
    expect(queue.statusCode, queue.body).toBe(201);
    const queueId = json(queue).data.id;
    const before = api.events.named('case.queue-updated').length;

    const entered = await call('PATCH', `/cases/${made.id}`, {
      data: { attributes: { 'case-queue-id': queueId } },
    });
    const left = await call('PATCH', `/cases/${made.id}`, {
      data: { attributes: { 'case-queue-id': null } },
    });

    expect([entered.statusCode, left.statusCode]).toEqual([200, 200]);
    expect(json(left).data.relationships['case-queue']?.data ?? null).toBeNull();
    expect(json(left).data.relationships.assignee?.data ?? null).toBeNull();
    expect(api.events.named('case.queue-updated').slice(before)).toHaveLength(2);
    const moves = await api.database.client.query<{ from: unknown; to: unknown }>(
      `select "from", "to" from case_history where case_id = $1 and kind = 'queue-changed'
        order by id`,
      [made.id],
    );
    expect(moves.rows).toEqual([
      { from: { 'case-queue-id': null }, to: { 'case-queue-id': queueId } },
      { from: { 'case-queue-id': queueId }, to: { 'case-queue-id': null } },
    ]);
  });
});

describe('redacting a comment (C134.2)', () => {
  it('lets its author redact it, anyone else only with cases:redact, and a repeat changes nothing', async () => {
    const t = await template();
    const made = await createCase(t.id);
    const writer = ['cases:read', 'cases:write'] as const;
    const author = api.newUserToken(api.environmentId, {
      permissions: writer,
      userId: testId('usr'),
    });
    const stranger = api.newUserToken(api.environmentId, {
      permissions: writer,
      userId: testId('usr'),
    });
    for (const [as, message] of [
      [author, 'Synthetic by the author'],
      [stranger, 'Synthetic by a stranger'],
    ] as const) {
      const added = await call('POST', `/cases/${made.id}/add-comment`, { meta: { message } }, as);
      expect(added.statusCode, added.body).toBe(200);
    }
    const listed = JSON.parse((await call('GET', `/cases/${made.id}/comments`)).body) as {
      data: { id: string; attributes: { message: string } }[];
    };
    const idOf = (message: string) =>
      listed.data.find(({ attributes }) => attributes.message === message)?.id ?? '';
    const own = idOf('Synthetic by the author');
    const theirs = idOf('Synthetic by a stranger');
    const redact = (id: string, as: string) =>
      call('POST', `/case-comments/${id}/redact`, { meta: {} }, as);

    const refused = await redact(own, stranger);
    const first = await redact(own, author);
    const again = await redact(own, author);
    const byAdmin = await redact(theirs, token);
    const missing = await redact(testId('cscm'), token);

    expect(refused.statusCode).toBe(403);
    expect([first.statusCode, again.statusCode, byAdmin.statusCode]).toEqual([200, 200, 200]);
    expect(json(first).data.attributes.message).toBeNull();
    expect(json(byAdmin).data.attributes.message).toBeNull();
    expect(missing.statusCode).toBe(404);
    const rows = await api.database.client.query<{ to: unknown }>(
      `select "to" from case_history where case_id = $1 and kind = 'comment-redacted' order by id`,
      [made.id],
    );
    expect(rows.rows).toEqual([{ to: { 'comment-id': own } }, { to: { 'comment-id': theirs } }]);
  });
});

describe('changing a case (C131-C136)', () => {
  it('checks lock-version, and moves it on every change', async () => {
    const t = await template({ 'field-schemas': FIELDS });
    const made = await createCase(t.id);
    const version = Number(made.attributes['lock-version']);

    const stale = await call('PATCH', `/cases/${made.id}`, {
      data: { attributes: { fields: { score: 1 } } },
      meta: { 'lock-version': version + 5 },
    });
    expect(stale.statusCode).toBe(409);
    expect(json(stale).code).toBe('case_version_conflict');

    const before = api.events.named('case.updated-fields').length;
    const changed = await call('PATCH', `/cases/${made.id}`, {
      data: { attributes: { fields: { score: 7 } } },
      meta: { 'lock-version': version },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(json(changed).data.attributes['lock-version']).toBe(version + 1);
    const fired = api.events.named('case.updated-fields').slice(before);
    expect(fired.map((event) => event.payload.meta)).toEqual([
      { context: { 'field-keys': ['score'] } },
    ]);
    expect(fits('case.updated-fields', fired[0]?.payload)).toBe(true);
  });

  it('sets, re-arms and clears the public SLA, and refuses one out of range', async () => {
    const t = await template();
    const made = await createCase(t.id);

    const set = json(
      await call('PATCH', `/cases/${made.id}`, { meta: { 'sla-expires-in-seconds': 60 } }),
    );
    expect(set.data.attributes['sla-state']).toBe('running');
    const cleared = json(
      await call('PATCH', `/cases/${made.id}`, { meta: { 'sla-expires-in-seconds': null } }),
    );
    expect(cleared.data.attributes).toMatchObject({ 'sla-state': 'none', 'sla-expires-at': null });
    const refused = await call('PATCH', `/cases/${made.id}`, {
      meta: { 'sla-expires-in-seconds': 0 },
    });
    expect(json(refused).code).toBe('sla_out_of_range');
  });

  it('changes tags with their event, and nothing for a repeat', async () => {
    const t = await template();
    const made = await createCase(t.id, { tags: ['alpha'] });
    const before = api.events.named('case.updated-tags').length;

    await call('POST', `/cases/${made.id}/add-tag`, { meta: { 'tag-name': 'beta' } });
    await call('POST', `/cases/${made.id}/add-tag`, { meta: { 'tag-id': 'beta' } });
    await call('POST', `/cases/${made.id}/remove-tag`, { meta: { 'tag-name': 'alpha' } });
    const set = json(
      await call('POST', `/cases/${made.id}/set-tags`, {
        meta: { 'tag-names': ['gamma', 'beta'] },
      }),
    );

    expect((set.data.attributes.tags as string[]).sort()).toEqual(['beta', 'gamma']);
    const fired = api.events.named('case.updated-tags').slice(before);
    expect(fired.map((event) => event.payload.meta)).toEqual([
      { context: { 'added-tags': ['beta'], 'removed-tags': [] } },
      { context: { 'added-tags': [], 'removed-tags': ['alpha'] } },
      { context: { 'added-tags': ['gamma'], 'removed-tags': [] } },
    ]);
  });

  it('attaches each object once, removes what it holds, and caps at 1,000', async () => {
    const t = await template();
    const made = await createCase(t.id);
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);

    const added = json(
      await call('POST', `/cases/${made.id}/add-objects`, {
        meta: { 'object-ids': [inquiry.id, inquiry.accountId] },
      }),
    );
    expect(added.data.attributes['held-object-counts']).toMatchObject({
      inquiries: 1,
      accounts: 1,
    });
    const repeat = json(
      await call('POST', `/cases/${made.id}/add-objects`, { meta: { 'object-ids': [inquiry.id] } }),
    );
    expect(repeat.data.attributes['lock-version']).toBe(added.data.attributes['lock-version']);
    const removed = json(
      await call('POST', `/cases/${made.id}/remove-objects`, {
        meta: { 'object-ids': [inquiry.id, testId('inq')] },
      }),
    );
    expect(removed.data.attributes['held-object-counts']).toMatchObject({
      inquiries: 0,
      accounts: 1,
    });

    await api.database.db.execute(sql`
      insert into accounts
      select (jsonb_populate_record(null::accounts, to_jsonb(a) || jsonb_build_object(
        'id', 'acc_' || lpad(n::text, 26, '0')))).*
      from accounts a, generate_series(1, 999) n where a.id = ${inquiry.accountId}`);
    await api.database.db.execute(sql`
      insert into case_accounts (environment_id, case_id, account_id, attached_by_type, attached_by_id)
      select ${api.environmentId}, ${made.id}, 'acc_' || lpad(n::text, 26, '0'), 'user',
        'usr_01M6FQZCV622MRCK2ZKC7F4HD9'
      from generate_series(1, 999) n`);
    const over = await call('POST', `/cases/${made.id}/add-objects`, {
      meta: { 'object-ids': [inquiry.id] },
    });
    expect(over.statusCode).toBe(422);
    expect(json(over).code).toBe('case_objects_limit');
  });

  it('moves the status by the map, with resolutions, required comments and events in order', async () => {
    const t = await template({
      statuses: [
        {
          key: 'open',
          label: 'Open',
          category: 'initial',
          'pauses-sla': false,
          'required-comment': false,
          'status-tags': [],
          'status-tag-required': false,
        },
        {
          key: 'approved',
          label: 'Approved',
          category: 'end',
          'pauses-sla': false,
          'required-comment': false,
          'status-tags': [],
          'status-tag-required': false,
        },
        {
          key: 'declined',
          label: 'Declined',
          category: 'end',
          'pauses-sla': false,
          'required-comment': true,
          'status-tags': [],
          'status-tag-required': false,
        },
      ],
      transitions: { open: ['approved', 'declined'], approved: ['open'], declined: ['open'] },
    });
    const made = await createCase(t.id);
    const status = (meta: Record<string, unknown>) =>
      call('POST', `/cases/${made.id}/set-status`, { meta });

    const comment = await status({ status: 'declined' });
    expect(comment.statusCode).toBe(422);
    expect(json(comment).code).toBe('case_comment_required');
    const before = api.events.events.length;
    const resolved = json(await status({ status: 'approved' }));
    expect(resolved.data.attributes).toMatchObject({
      status: 'approved',
      'status-category': 'end',
      resolution: 'Approved',
      'resolver-type': 'user',
    });
    expect(resolved.data.attributes['resolved-at']).not.toBeNull();
    const reopened = json(await status({ status: 'open' }));
    expect(reopened.data.attributes).toMatchObject({ resolution: null, 'resolved-at': null });
    const names = api.events.events.slice(before).map(({ name }) => name);
    expect(names).toEqual([
      'case.status-updated',
      'case.resolved',
      'case.status-updated',
      'case.reopened',
    ]);
    const declined = json(await status({ status: 'declined', comment: 'Synthetic reason' }));
    expect(declined.data.relationships['case-comments']?.data).toHaveLength(1);
    expect(json(await status({ status: 'declined' })).data.attributes['lock-version']).toBe(
      declined.data.attributes['lock-version'],
    );
    const refused = await status({ status: 'nonexistent' });
    expect(json(refused).code).toBe('case_transition_refused');
  });

  it('moves to a status that needs a tag only with one it lists, recording the tag (K8-13)', async () => {
    const status = (key: string, category: string, tags: string[]) => ({
      key,
      label: key,
      category,
      'pauses-sla': false,
      'required-comment': false,
      'status-tags': tags.map((tag) => ({ key: tag, label: tag })),
      'status-tag-required': tags.length > 0,
    });
    const t = await template({
      statuses: [status('open', 'initial', []), status('declined', 'end', ['fraud', 'duplicate'])],
      transitions: { open: ['declined'], declined: ['open'] },
    });
    const made = await createCase(t.id);
    const set = (meta: Record<string, unknown>) =>
      call('POST', `/cases/${made.id}/set-status`, { meta: { status: 'declined', ...meta } });

    const untagged = await set({});
    const unlisted = await set({ 'status-tag': 'other' });
    const tagged = await set({ 'status-tag': 'fraud' });

    expect([json(untagged).code, json(unlisted).code]).toEqual([
      'case_status_tag_required',
      'case_status_tag_required',
    ]);
    expect(tagged.statusCode, tagged.body).toBe(200);
    expect(json(tagged).data.attributes).toMatchObject({ status: 'declined' });
    const moved = await api.database.client.query<{ to: unknown }>(
      `select "to" from case_history where case_id = $1 and kind = 'resolved'`,
      [made.id],
    );
    // `declined` is not among the version's resolutions, so the move records none (C131.1).
    expect(moved.rows).toEqual([{ to: { status: 'declined', 'status-tag': 'fraud' } }]);
  });

  it('changes nothing when it removes objects the case does not hold (K8-13)', async () => {
    const t = await template({ 'held-object-types': ['inquiry'] });
    const made = await createCase(t.id);
    const before = Number(made.attributes['lock-version']);

    const removed = await call('POST', `/cases/${made.id}/remove-objects`, {
      meta: { 'object-ids': [testId('inq')] },
    });

    expect(removed.statusCode).toBe(200);
    expect(json(removed).data.attributes['lock-version']).toBe(before);
    const rows = await api.database.client.query(
      `select 1 from case_history where case_id = $1 and kind = 'object-removed'`,
      [made.id],
    );
    expect(rows.rows).toEqual([]);
  });

  it('adds a comment with its mentions checked, and lists comments newest first', async () => {
    const t = await template();
    const made = await createCase(t.id);
    const before = api.events.named('case-comment.created').length;

    await call('POST', `/cases/${made.id}/add-comment`, { meta: { message: 'First synthetic' } });
    await call('POST', `/cases/${made.id}/add-comment`, {
      meta: { message: 'Ping @[usr_01M6FQZCV622MRCK2ZKC7F4HD9] synthetic' },
    });

    const fired = api.events.named('case-comment.created').slice(before);
    expect(fired).toHaveLength(2);
    expect(fired.every((event) => fits('case-comment.created', event.payload))).toBe(true);
    const comments = JSON.parse((await call('GET', `/cases/${made.id}/comments`)).body) as {
      data: { attributes: { message: string; mentions: string[] } }[];
    };
    expect(comments.data).toHaveLength(2);
    expect(comments.data.map(({ attributes }) => attributes.mentions)).toEqual([[], []]);
  });

  it('refuses a change to a redacted case with case_redacted', async () => {
    const t = await template();
    const made = await createCase(t.id);
    await api.database.db.execute(
      sql`update cases set redacted_at = now(), fields = null where id = ${made.id}`,
    );

    const refused = await call('POST', `/cases/${made.id}/add-tag`, { meta: { 'tag-name': 'x' } });

    expect(refused.statusCode).toBe(410);
    expect(json(refused).code).toBe('case_redacted');
  });
});
