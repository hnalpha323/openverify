/**
 * Workflow 7B Stage 1b, checkpoint (L): what `foundation-7b` builds in the list repositories (the
 * screening outbox's write and reads, `anyListScreenedByAll`), the redaction of `list_matches`, the
 * subject prefixes, `ip-retention-days` over IP-sourced match values (C91.7, P19), and the stubs
 * that reject until their owner builds them. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  openListMatchValues,
  seedList,
  seedListItem,
  seedListMatch,
  type TestDatabase,
} from '../testing.js';
import { createEvent } from './events.js';
import { listImportObjectsDue, redactExpiredListItems, redactInquiryRecords } from './index.js';
import {
  createListScreening,
  getListScreening,
  listInquiryListScreenings,
} from './list-screenings.js';
import { anyListScreenedByAll } from './lists.js';
import { updateEnvironmentSettings } from './organizations.js';
import { nullExpiredAddresses } from './retention.js';
import { subjectIdsIn } from './subject-ids.js';

let database: TestDatabase;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

describe('the screening outbox (C99.4)', () => {
  it('writes one pending row per inquiry; a later move keeps the first row', async () => {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);

    expect(
      await createListScreening(database.db, environment.id, {
        inquiryId: inquiry.id,
        triggerStatus: 'completed',
      }),
    ).toBe(true);
    expect(
      await createListScreening(database.db, environment.id, {
        inquiryId: inquiry.id,
        triggerStatus: 'failed',
      }),
    ).toBe(false);

    expect(await getListScreening(database.db, environment.id, inquiry.id)).toMatchObject({
      status: 'pending',
      matchCount: null,
      unscreened: [],
      notApplicable: [],
      reviewCause: null,
      screenedAt: null,
    });
  });

  it('reads no row for another environment, and none for an unscreened inquiry', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    await createListScreening(database.db, environment.id, {
      inquiryId: inquiry.id,
      triggerStatus: 'expired',
    });

    expect(await getListScreening(database.db, other.environment.id, inquiry.id)).toBeNull();
    const none = await createTestInquiry(database.db, environment.id);
    expect(await getListScreening(database.db, environment.id, none.inquiry.id)).toBeNull();
  });

  it('reads a page of inquiries at once, by inquiry id', async () => {
    const { environment } = await createTestTenant(database.db);
    const screened = await createTestInquiry(database.db, environment.id);
    const unscreened = await createTestInquiry(database.db, environment.id);
    await createListScreening(database.db, environment.id, {
      inquiryId: screened.inquiry.id,
      triggerStatus: 'completed',
    });

    const rows = await listInquiryListScreenings(database.db, environment.id, [
      screened.inquiry.id,
      unscreened.inquiry.id,
    ]);

    expect([...rows.keys()]).toEqual([screened.inquiry.id]);
    expect(rows.get(screened.inquiry.id)?.status).toBe('pending');
    expect((await listInquiryListScreenings(database.db, environment.id, [])).size).toBe(0);
  });
});

describe('anyListScreenedByAll (C99.5)', () => {
  it('is true only for an active list with screen-at-completion of a kind `all` reads', async () => {
    const { environment } = await createTestTenant(database.db);
    expect(await anyListScreenedByAll(database.db, environment.id)).toBe(false);

    await seedList(database.db, environment.id, { kind: 'string' });
    await seedList(database.db, environment.id, { kind: 'face' });
    await seedList(database.db, environment.id, { kind: 'email-address', status: 'archived' });
    await seedList(database.db, environment.id, { kind: 'name', screenAtCompletion: false });
    expect(await anyListScreenedByAll(database.db, environment.id)).toBe(false);

    await seedList(database.db, environment.id, { kind: 'email-address' });
    expect(await anyListScreenedByAll(database.db, environment.id)).toBe(true);
  });

  it('counts a kind the environment does not collect, which only a row can record (V21)', async () => {
    const { environment } = await createTestTenant(database.db);
    await seedList(database.db, environment.id, { kind: 'browser-fingerprint' });
    expect(await anyListScreenedByAll(database.db, environment.id)).toBe(true);
  });
});

describe('the redaction of list matches (C98.4, C107.5)', () => {
  async function seedMatch() {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const list = await seedList(database.db, environment.id);
    const item = await seedListItem(database.db, environment.id, { listId: list.id });
    const match = await seedListMatch(database.db, environment.id, {
      listId: list.id,
      listItemId: item.id,
      inquiryId: inquiry.id,
      matchedValue: 'synthetic-value',
      dismissal: { reason: 'Synthetic reason', at: new Date() },
    });
    return { environmentId: environment.id, inquiryId: inquiry.id, listId: list.id, match };
  }

  it('nulls the compared value and the reason and sets redacted-at', async () => {
    const { environmentId, inquiryId, match } = await seedMatch();
    const at = new Date('2026-10-31T10:00:00.000Z');

    await redactInquiryRecords(database.db, environmentId, inquiryId, { at });

    expect(await openListMatchValues(database.db, environmentId, match.id)).toEqual({
      matchedValue: null,
      reason: null,
      redactedAt: at,
    });
  });

  it('stubs the match events and forgets the stored copies by the match id', async () => {
    const { environmentId, inquiryId, match } = await seedMatch();
    const event = await createEvent(database.db, environmentId, {
      id: `evt_${match.id.slice(4)}`,
      name: 'list-match.created',
      objectType: 'list-match',
      objectId: match.id,
      payload: { data: { type: 'list-match', id: match.id, attributes: { status: 'open' } } },
    });

    await redactInquiryRecords(database.db, environmentId, inquiryId);

    const result = await database.client.query<{ redacted_at: string | null }>(
      `select redacted_at from events where id = $1`,
      [event.id],
    );
    expect(result.rows[0]?.redacted_at).not.toBeNull();
  });

  it('keeps the first redaction time on a second run', async () => {
    const { environmentId, inquiryId, match } = await seedMatch();
    const first = new Date('2026-10-31T10:00:00.000Z');
    await redactInquiryRecords(database.db, environmentId, inquiryId, { at: first });
    await redactInquiryRecords(database.db, environmentId, inquiryId, {
      at: new Date('2026-11-01T10:00:00.000Z'),
    });

    const stored = await openListMatchValues(database.db, environmentId, match.id);
    expect(stored?.redactedAt).toEqual(first);
  });
});

describe('the redaction subjects (C107.5)', () => {
  it.each(['lst', 'lis', 'liea', 'lifc', 'ligin', 'lmt', 'mprt'])('finds %s ids', (prefix) => {
    const id = `${prefix}_01M5CK16P0D13FXHZSS4TCFBVH`;
    expect(subjectIdsIn({ data: { id } })).toEqual([id]);
  });
});

describe('ip-retention-days over list matches (C91.7, P19)', () => {
  it('nulls the IP-sourced values past the window and keeps the record and other values', async () => {
    const { environment } = await createTestTenant(database.db);
    await updateEnvironmentSettings(database.db, environment.id, { 'ip-retention-days': 1 });
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const list = await seedList(database.db, environment.id, { kind: 'ip-address' });
    const old = new Date(Date.now() - 3 * 86_400_000);
    const seeded = async (
      source: 'session.ip-address' | 'session.ip-point' | 'inquiry.fields',
      createdAt: Date,
    ) => {
      const item = await seedListItem(database.db, environment.id, {
        listId: list.id,
        prefix: 'liip',
      });
      return seedListMatch(database.db, environment.id, {
        listId: list.id,
        listItemId: item.id,
        inquiryId: inquiry.id,
        source,
        createdAt,
      });
    };
    const address = await seeded('session.ip-address', old);
    const point = await seeded('session.ip-point', old);
    const fresh = await seeded('session.ip-address', new Date());
    const field = await seeded('inquiry.fields', old);

    expect(await nullExpiredAddresses(database.db)).toBeGreaterThanOrEqual(2);

    const value = async (id: string) =>
      (await openListMatchValues(database.db, environment.id, id))?.matchedValue;
    expect(await value(address.id)).toBeNull();
    expect(await value(point.id)).toBeNull();
    expect(await value(fresh.id)).toBe('synthetic-value');
    expect(await value(field.id)).toBe('synthetic-value');
  });
});

describe('the C16 steps (Workflow 7B Stage 1b)', () => {
  it('keeps the C16 pass quiet until the owners build their steps', async () => {
    expect(await redactExpiredListItems(database.db)).toBe(0);
    expect(await listImportObjectsDue(database.db)).toEqual([]);
  });
});
