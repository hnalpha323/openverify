/**
 * C99.3 (Workflow 7B, `api-lists`): the list match routes: filters, masking of the compared value
 * and the reason, and the dismissal. Every value is synthetic.
 */
import { listMatchDocumentSchema, listMatchListDocumentSchema } from '@openverify/contracts';
import { createListScreening, getListScreening, completeListScreening } from '@openverify/db';
import { createTestInquiry, seedList, seedListItem, seedListMatch } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { includedListMatchesFor } from '../../services/lists/matches.js';
import { bearer, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const call = (method: 'GET' | 'POST', url: string, payload?: unknown, token?: string) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: bearer(token ?? api.token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

async function seeded() {
  const list = await seedList(api.database.db, api.environmentId);
  const item = await seedListItem(api.database.db, api.environmentId, { listId: list.id });
  const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
  const match = await seedListMatch(api.database.db, api.environmentId, {
    listId: list.id,
    listItemId: item.id,
    inquiryId: inquiry.id,
    accountId: inquiry.accountId,
    matchedValue: 'jane@example.com',
  });
  return { list, item, inquiry, match };
}

describe('GET /list-matches (C99.3)', () => {
  it('serves the match with its relationships', async () => {
    const { list, item, inquiry, match } = await seeded();
    const read = listMatchDocumentSchema.parse(
      expectStatus(await call('GET', `/list-matches/${match.id}`), 200),
    );

    expect(read.data.attributes).toMatchObject({
      status: 'open',
      method: 'exact',
      tier: 'R',
      'matched-value': 'jane@example.com',
      reason: null,
    });
    expect(read.data.relationships).toMatchObject({
      list: { data: { type: 'list/string', id: list.id } },
      'list-item': { data: { type: 'list-item/string', id: item.id } },
      inquiry: { data: { type: 'inquiry', id: inquiry.id } },
      account: { data: { type: 'account', id: inquiry.accountId } },
    });
  });

  it('masks the compared value and reason without pii:view', async () => {
    const { match } = await seeded();
    const token = api.newUserToken(api.environmentId, { permissions: ['lists:read'] });
    const read = listMatchDocumentSchema.parse(
      expectStatus(await call('GET', `/list-matches/${match.id}`, undefined, token), 200),
    );
    expect(read.data.attributes['matched-value']).toBeNull();
  });

  it('filters by inquiry, account, list and status', async () => {
    const { list, inquiry, match } = await seeded();
    await seeded();
    const get = async (query: string) =>
      listMatchListDocumentSchema
        .parse(expectStatus(await call('GET', `/list-matches?${query}`), 200))
        .data.map(({ id }) => id);

    expect(await get(`filter[inquiry-id]=${inquiry.id}`)).toEqual([match.id]);
    expect(await get(`filter[account-id]=${inquiry.accountId}`)).toEqual([match.id]);
    expect(await get(`filter[list-id]=${list.id}&filter[status]=open`)).toEqual([match.id]);
    expect(await get(`filter[list-id]=${list.id}&filter[status]=dismissed`)).toEqual([]);
  });

  it('answers 404 for another environment’s match', async () => {
    const { match } = await seeded();
    const tenant = await api.newTenant();
    const { token } = tenant;
    expectStatus(await call('GET', `/list-matches/${match.id}`, undefined, token), 404);
  });
});

describe('POST /list-matches/:id/dismiss (C99.3)', () => {
  const dismissal = { data: { attributes: { reason: 'Reviewed by hand' } } };

  it('dismisses an open match, and masks its reason', async () => {
    const { match } = await seeded();
    const dismissed = listMatchDocumentSchema.parse(
      expectStatus(await call('POST', `/list-matches/${match.id}/dismiss`, dismissal), 200),
    );
    expect(dismissed.data.attributes).toMatchObject({
      status: 'dismissed',
      reason: 'Reviewed by hand',
    });
    expect(dismissed.data.attributes['dismissed-at']).not.toBeNull();

    const token = api.newUserToken(api.environmentId, { permissions: ['lists:read'] });
    const masked = listMatchDocumentSchema.parse(
      expectStatus(await call('GET', `/list-matches/${match.id}`, undefined, token), 200),
    );
    expect(masked.data.attributes.reason).toBeNull();
  });

  it('answers 409 for a match already dismissed, and 404 for an unknown one', async () => {
    const { match } = await seeded();
    expectStatus(await call('POST', `/list-matches/${match.id}/dismiss`, dismissal), 200);
    expect(
      expectStatus(await call('POST', `/list-matches/${match.id}/dismiss`, dismissal), 409),
    ).toMatchObject({ code: 'list_match_not_open' });
    expectStatus(
      await call('POST', '/list-matches/lmt_00000000000000000000000000/dismiss', dismissal),
      404,
    );
  });

  it('lowers a completed screening’s count (C99.3, V06)', async () => {
    const { inquiry, match } = await seeded();
    await createListScreening(api.database.db, api.environmentId, {
      inquiryId: inquiry.id,
      triggerStatus: 'completed',
    });
    await completeListScreening(api.database.db, api.environmentId, inquiry.id, {
      status: 'completed',
      matchCount: 1,
      unscreened: [],
      notApplicable: [],
      reviewCause: null,
      at: new Date(),
    });

    expectStatus(await call('POST', `/list-matches/${match.id}/dismiss`, dismissal), 200);

    expect(
      (await getListScreening(api.database.db, api.environmentId, inquiry.id))?.matchCount,
    ).toBe(0);
  });

  it('writes an audit entry without the reason', async () => {
    const { match } = await seeded();
    expectStatus(await call('POST', `/list-matches/${match.id}/dismiss`, dismissal), 200);
    expect(api.audit.entries.filter(({ resourceId }) => resourceId === match.id)).toEqual([
      expect.objectContaining({ action: 'list-match.dismissed' }),
    ]);
  });
});

describe('includedListMatchesFor (C107.6)', () => {
  it('reads an inquiry’s or an account’s matches newest first, masked as the route serves them', async () => {
    const { inquiry, match } = await seeded();
    const open = await includedListMatchesFor(
      api.database.db,
      api.environmentId,
      { inquiryId: inquiry.id },
      UNMASKED,
    );
    expect(open.map(({ id }) => id)).toEqual([match.id]);
    expect(open[0]?.attributes['matched-value']).toBe('jane@example.com');

    const byAccount = await includedListMatchesFor(
      api.database.db,
      api.environmentId,
      { accountId: inquiry.accountId },
      UNMASKED,
    );
    expect(byAccount.map(({ id }) => id)).toEqual([match.id]);
  });

  it('reads nothing of another environment', async () => {
    const { inquiry } = await seeded();
    const other = await api.newTenant();
    expect(
      await includedListMatchesFor(
        api.database.db,
        other.environmentId,
        { inquiryId: inquiry.id },
        UNMASKED,
      ),
    ).toEqual([]);
  });
});
