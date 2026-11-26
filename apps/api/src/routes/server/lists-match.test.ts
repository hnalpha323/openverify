/**
 * C99.4 (Workflow 7B, `api-lists`): `POST /lists/match`: exact, CIDR and radius on demand, what it
 * could not read beside what it found, no record written, the C12 policy `lists-match`, and no
 * probe in a stored API log read without `pii:view` (C107.5). Every value is synthetic.
 */
import { matchListsResponseSchema } from '@openverify/contracts';
import { seedList } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { createDenyRateLimiter } from '../../test-support/fakes.js';
import { bearer, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });

const post = (url: string, payload: unknown, token?: string) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1${url}`,
    headers: bearer(token ?? api.token),
    payload: payload as Record<string, unknown>,
  });

const match = (attributes: Record<string, unknown>, token?: string) =>
  post('/lists/match', body(attributes), token);

async function listed(kind: 'email-address' | 'string', value: string, environmentId?: string) {
  const tenant = environmentId ?? api.environmentId;
  const list = await seedList(api.database.db, tenant, { kind });
  const plural = kind === 'string' ? 'strings' : 'email-addresses';
  const item = expectStatus(
    await post(`/list-item/${plural}`, body({ 'list-id': list.id, value })),
    201,
  ).data as { id: string };
  return { list, item };
}

describe('POST /lists/match (C99.4)', () => {
  it('finds a listed value, and names the item rather than the value', async () => {
    const { list, item } = await listed('email-address', 'listed-one@example.com');
    const response = await match({
      probes: [{ kind: 'email-address', value: 'LISTED-ONE@example.com' }],
      'list-ids': [list.id],
    });

    const answer = matchListsResponseSchema.parse(expectStatus(response, 200));
    expect(answer.data.attributes).toEqual({
      matches: [
        {
          'list-id': list.id,
          'list-item': { type: 'list-item/email-address', id: item.id },
          'list-version': 2,
          source: 'request',
          method: 'exact',
          tier: 'R',
          confidence: null,
          approximate: false,
          score: null,
          'distance-meters': null,
        },
      ],
      unscreened: [],
      'not-applicable': [],
    });
    expect(response.body).not.toContain('example.com');
  });

  it('reads every active list of the probes’ kinds without list-ids', async () => {
    const tenant = await api.newTenant();
    const list = await seedList(api.database.db, tenant.environmentId, { kind: 'string' });
    await seedList(api.database.db, tenant.environmentId, { kind: 'email-address' });
    const answer = matchListsResponseSchema.parse(
      expectStatus(
        await match({ probes: [{ kind: 'string', value: 'nothing here' }] }, tenant.token),
        200,
      ),
    );
    expect(answer.data.attributes).toEqual({ matches: [], unscreened: [], 'not-applicable': [] });
    expect(list.id).toMatch(/^lst_/u);
  });

  it('says what it could not read, and what it had nothing for', async () => {
    const fuzzy = await seedList(api.database.db, api.environmentId, { kind: 'name' });
    await api.database.db.execute(
      sql`update lists set allow_fuzzy_name_first = true where id = ${fuzzy.id}`,
    );
    const phone = await seedList(api.database.db, api.environmentId, { kind: 'phone-number' });
    const empty = await seedList(api.database.db, api.environmentId, { kind: 'country' });
    const answer = matchListsResponseSchema.parse(
      expectStatus(
        await match({
          probes: [
            { kind: 'name', 'name-first': 'Jane', 'name-last': 'Example' },
            { kind: 'phone-number', value: 'not a number' },
          ],
          'list-ids': [fuzzy.id, phone.id, empty.id],
        }),
        200,
      ),
    );

    expect(answer.data.attributes.matches).toEqual([]);
    expect(answer.data.attributes.unscreened).toHaveLength(2);
    expect(answer.data.attributes.unscreened).toEqual(
      expect.arrayContaining([
        { 'list-id': fuzzy.id, reason: 'method_not_on_demand' },
        { 'list-id': phone.id, reason: 'probe_unavailable' },
      ]),
    );
    expect(answer.data.attributes['not-applicable']).toEqual([
      { 'list-id': empty.id, reason: 'subject_has_no_value' },
    ]);
  });

  it('reads a list this environment does not hold as unscreened, saying nothing of it', async () => {
    const tenant = await api.newTenant();
    const other = await seedList(api.database.db, tenant.environmentId);
    const answer = matchListsResponseSchema.parse(
      expectStatus(
        await match({ probes: [{ kind: 'string', value: 'x' }], 'list-ids': [other.id] }),
        200,
      ),
    );
    expect(answer.data.attributes.unscreened).toEqual([
      { 'list-id': other.id, reason: 'list_archived' },
    ]);
  });

  it('writes no record', async () => {
    const { list } = await listed('string', 'no record');
    await match({ probes: [{ kind: 'string', value: 'no record' }], 'list-ids': [list.id] });
    const rows = await api.database.client.query(`select 1 from list_matches where list_id = $1`, [
      list.id,
    ]);
    expect(rows.rows).toEqual([]);
  });

  it('takes the C12 policy lists-match, per key', async () => {
    const calls = api.rateLimiter.calls.length;
    await match({ probes: [{ kind: 'string', value: 'x' }] });
    const call = api.rateLimiter.calls
      .slice(calls)
      .find(({ key }) => key.startsWith('lists-match'));
    expect(call?.policy).toEqual({ name: 'lists-match', limit: 60, windowSeconds: 60 });
    expect(call?.key).toMatch(/^lists-match:key_/u);
  });

  it('answers 429 past the policy', async () => {
    const limited = await createInquiryTestApi({ rateLimiter: createDenyRateLimiter(30) });
    try {
      const response = await limited.app.inject({
        method: 'POST',
        url: '/api/v1/lists/match',
        headers: bearer(limited.token),
        payload: body({ probes: [{ kind: 'string', value: 'x' }] }),
      });
      expectStatus(response, 429);
    } finally {
      await limited.close();
    }
  });
});

describe('stored API logs of the list routes (C107.5, P07)', () => {
  const stored = async (path: string) => {
    const reader = api.newUserToken(api.environmentId, { permissions: ['api-logs:read'] });
    const list = async () =>
      expectStatus(
        await api.app.inject({
          url: `/api/v1/api-logs?page[size]=100`,
          headers: bearer(reader),
        }),
        200,
      ) as unknown as { data: { attributes: Record<string, unknown> }[] };
    return vi.waitFor(async () => {
      const entry = (await list()).data.find(({ attributes }) => attributes.path === path);
      expect(entry).toBeDefined();
      return entry;
    });
  };

  it('keeps no probe, item value or dismissal reason for a reader without pii:view', async () => {
    const { list, item } = await listed('email-address', 'logged-value@example.com');
    await match({
      probes: [{ kind: 'email-address', value: 'logged-probe@example.com' }],
      'list-ids': [list.id],
    });

    const created = await stored('/api/v1/list-item/email-addresses');
    const matched = await stored('/api/v1/lists/match');

    expect(JSON.stringify(created)).not.toContain('logged-value');
    expect(JSON.stringify(matched)).not.toContain('logged-probe');
    expect(item.id).toMatch(/^liea_/u);
  });
});
