/**
 * C99.8 (Workflow 7B, `api-lists`) against Postgres 17 (Testcontainers, started without
 * bind-parameter logging): the SP-GiST plan, containment in both families with the IPv4-mapped
 * fold, a radius across the antimeridian, a coarse probe, the fuzzy cap, a partial screening with a
 * pending face list beside a list with nothing to compare, the outbox recovering a lost enqueue,
 * and the races row locks decide: an approval or a redaction inside the screening's window, in both
 * orders, and two writers at a list's last place. A pending writer proves it waited, so neither
 * order passes by luck of timing. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import { LIST_LIMITS, type ListKind } from '@openverify/core';
import {
  createDatabase,
  createKeyring,
  createList,
  createListScreening,
  getInquiry,
  getList,
  getListScreening,
  insertListItems,
  listListMatches,
  lockInquiry,
  redactInquiryRecords,
  runMigrations,
  setDefaultKeyring,
  type Database,
  type Inquiry,
  type ListRow,
  type NewList,
} from '@openverify/db';
import { createIntegrationPool, createTestInquiry, createTestTenant, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { processListScreen, type ListScreenDeps } from '../../jobs/lists/screen.js';
import { runListScreenSweep } from '../../jobs/lists/sweep.js';
import { createCapturingLogger } from '../../jobs/testing.js';
import { ListProblemError } from '../../errors.js';
import {
  createAllowAllRateLimiter,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  fixedClock,
} from '../../test-support/fakes.js';
import type { ApiDependencies } from '../context.js';
import { transitionInquiryInTx } from '../inquiries.js';
import { createListItem } from './items.js';
import { newListItem } from './keys.js';
import { matchLists, type ListProbe } from './match.js';

/** Long enough for a writer that is not blocked to finish. */
const WAIT_MS = 500;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
const key = new Uint8Array(randomBytes(32));
const clock = fixedClock(new Date('2026-10-31T12:00:00.000Z'));
const events = createRecordingEventPublisher();

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(createKeyring(randomBytes(32)));
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const PREFIX: Partial<Record<ListKind, 'lis' | 'liea' | 'lin' | 'liip' | 'ligl' | 'lipn'>> = {
  string: 'lis',
  'email-address': 'liea',
  name: 'lin',
  'ip-address': 'liip',
  geolocation: 'ligl',
  'phone-number': 'lipn',
};

async function listWith(
  type: ListKind,
  values: readonly Record<string, unknown>[],
  input: Partial<NewList> = {},
): Promise<ListRow> {
  const list = await createList(db, environmentId, {
    id: newId('lst'),
    type,
    name: 'Synthetic',
    ...input,
  });
  await insertListItems(
    db,
    environmentId,
    list.id,
    values.map((value) =>
      newListItem(key, environmentId, list, {
        id: newId(PREFIX[type] ?? 'lis'),
        value,
        creator: { type: 'api-key', id: newId('key') },
      }),
    ),
  );
  return (await getList(db, environmentId, list.id)) ?? list;
}

const probe = (
  kind: ListKind,
  value: Record<string, unknown>,
  source: ListProbe['source'] = 'request',
): ListProbe => ({ source, kind, values: [value] });

const run = (lists: readonly ListRow[], probes: readonly ListProbe[]) =>
  matchLists(db, environmentId, probes, { key, lists, matcherData: { status: 'missing' } });

const deps = (): ListScreenDeps => ({
  db,
  clock,
  logger: createCapturingLogger(),
  events,
  keyring: createKeyring(randomBytes(32)),
  blindIndexKey: key,
});

async function screenable(
  listConfig: Record<string, unknown>,
  fields: Record<string, unknown>,
): Promise<Inquiry> {
  const { inquiry } = await createTestInquiry(db, environmentId, { fields });
  await db.execute(
    sql`update inquiry_template_versions set list_config = ${JSON.stringify(listConfig)}::jsonb
         where id = ${inquiry.inquiryTemplateVersionId}`,
  );
  await db.execute(sql`update inquiries set status = 'completed' where id = ${inquiry.id}`);
  await createListScreening(db, environmentId, { inquiryId: inquiry.id, triggerStatus: 'completed' });
  return (await getInquiry(db, environmentId, inquiry.id)) ?? inquiry;
}

const job = ({ id }: Inquiry) => ({ environmentId, inquiryId: id });

describe('IP ranges (C99.8, C98.1)', () => {
  it('reads a range through the SP-GiST index', async () => {
    const list = await listWith('ip-address', []);
    await db.execute(sql`
      insert into list_items (id, environment_id, list_id, match_key, normaliser_version)
      select 'liip_' || lpad(n::text, 26, 'A'), ${environmentId}, ${list.id},
             encode(sha256(n::text::bytea), 'hex'), 'lists-1'
        from generate_series(1, 2000) as n`);
    await db.execute(sql`
      insert into list_item_ip_ranges (item_id, environment_id, range)
      select 'liip_' || lpad(n::text, 26, 'A'), ${environmentId},
             set_masklen((('10.' || (n / 256)::text || '.' || (n % 256)::text || '.0')::inet), 24)::cidr
        from generate_series(1, 2000) as n`);
    await db.execute(sql`analyze list_item_ip_ranges`);

    const plan = await db.execute(sql`
      explain select item_id from list_item_ip_ranges where range >>= '10.1.2.3'::inet`);

    expect(JSON.stringify(plan.rows)).toContain('list_item_ip_ranges_range_idx');
  });

  it('holds IPv4 and IPv6 containment, with the IPv4-mapped fold', async () => {
    const list = await listWith('ip-address', [
      { value: '198.51.100.0/24' },
      { value: '2001:db8::/48' },
    ]);
    const methods = async (value: string) =>
      (await run([list], [probe('ip-address', { value })])).matches.map(({ method }) => method);

    expect(await methods('198.51.100.7')).toEqual(['cidr']);
    expect(await methods('::ffff:198.51.100.7')).toEqual(['cidr']);
    expect(await methods('2001:db8:0:1::1')).toEqual(['cidr']);
    expect(await methods('2001:db9::1')).toEqual([]);
  });
});

describe('radius (C99.8, C95.3)', () => {
  it('matches at the antimeridian, and answers probe_too_coarse for a smaller item', async () => {
    const wide = await listWith('geolocation', [
      { latitude: 0, longitude: 179.9, 'radius-meters': 60_000 },
    ]);
    const narrow = await listWith('geolocation', [
      { latitude: 0, longitude: 179.9, 'radius-meters': 1000 },
    ]);

    const outcome = await run(
      [wide, narrow],
      [probe('geolocation', { latitude: 0, longitude: -179.9 }, 'session.ip-point')],
    );

    expect(outcome.matches.map(({ listId }) => listId)).toEqual([wide.id]);
    expect(outcome.unscreened).toEqual([{ 'list-id': narrow.id, reason: 'probe_too_coarse' }]);
  });
});

describe('fuzzy first names (C99.8)', () => {
  it('reads candidates by last name, and answers limit_exceeded past the cap', async () => {
    const list = await listWith(
      'name',
      [
        { 'name-first': 'Jonathan', 'name-last': 'Crowded' },
        { 'name-first': 'Mariana', 'name-last': 'Crowded' },
        { 'name-first': 'Jonathan', 'name-last': 'Elsewhere' },
      ],
      { allowFuzzyNameFirst: true },
    );
    const value = { 'name-first': 'Jonathon', 'name-last': 'Crowded' };
    const groups = await import('@openverify/watchlist');
    const options = {
      key,
      lists: [list],
      matcherData: {
        status: 'loaded',
        groups: groups.variantGroupsFrom([], 'a'.repeat(64)),
        keysVersion: 'synthetic',
      },
    } as const;

    const found = await matchLists(db, environmentId, [probe('name', value)], options);
    expect(found.matches.map(({ method }) => method)).toEqual(['fuzzy_name']);

    const capped = await matchLists(db, environmentId, [probe('name', value)], {
      ...options,
      fuzzyCandidateCap: 1,
    });
    expect(capped).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'limit_exceeded' }],
      notApplicable: [],
    });
  });
});

describe('a screening (C99.8)', () => {
  it('is partial with a pending face list, and a list with no value does not change that', async () => {
    const face = await createList(db, environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });
    const phones = await listWith('phone-number', []);
    const inquiry = await screenable({ screen: [face.id, phones.id] }, {});

    await processListScreen(job(inquiry), deps());

    expect(await getListScreening(db, environmentId, inquiry.id)).toMatchObject({
      status: 'partial',
      matchCount: null,
      unscreened: [{ 'list-id': face.id, reason: 'list_items_pending' }],
      notApplicable: [{ 'list-id': phones.id, reason: 'subject_has_no_value' }],
    });
  });

  it('recovers a lost enqueue through the sweep', async () => {
    const list = await listWith('string', []);
    const inquiry = await screenable({ screen: [list.id] }, {});
    const enqueued: { inquiryId: string }[] = [];

    await runListScreenSweep({
      db,
      clock: { now: () => new Date() },
      logger: createCapturingLogger(),
      screens: {
        enqueueListScreen(entry) {
          enqueued.push(entry);
          return Promise.resolve();
        },
      },
    });

    expect(enqueued.map(({ inquiryId }) => inquiryId)).toContain(inquiry.id);
  });
});

describe('the races of C99.6', () => {
  async function matching() {
    const list = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    return screenable(
      { screen: [list.id], 'on-list-match': 'needs_review' },
      { email_address: 'listed@example.com' },
    );
  }

  const approve = (inquiry: Inquiry) =>
    db.transaction(async (tx) => {
      await lockInquiry(tx, environmentId, inquiry.id);
      const current = await getInquiry(tx, environmentId, inquiry.id);
      return current === null
        ? null
        : transitionInquiryInTx(tx, { events, clock }, current, 'approved');
    });

  const waited = async (work: Promise<unknown>) => {
    let settled = false;
    void work.finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    return settled;
  };

  it('an approval that commits first keeps the inquiry approved', async () => {
    const inquiry = await matching();
    let screening: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await lockInquiry(tx, environmentId, inquiry.id);
      const current = await getInquiry(tx, environmentId, inquiry.id);
      screening = processListScreen(job(inquiry), deps());
      expect(await waited(screening)).toBe(false);
      if (current !== null) {
        await transitionInquiryInTx(tx, { events, clock }, current, 'approved');
      }
    });
    await screening;

    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('approved');
    expect(await getListScreening(db, environmentId, inquiry.id)).toMatchObject({
      status: 'completed',
      reviewCause: 'inquiry_already_decided',
    });
  });

  it('a screening that commits first moves it, and the approval decides after', async () => {
    const inquiry = await matching();

    await processListScreen(job(inquiry), deps());
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('needs_review');

    await approve(inquiry);
    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('approved');
  });

  it('a redaction that commits first ends the row, and the inquiry never moves', async () => {
    const inquiry = await matching();
    let screening: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await lockInquiry(tx, environmentId, inquiry.id);
      screening = processListScreen(job(inquiry), deps());
      expect(await waited(screening)).toBe(false);
      await redactInquiryRecords(tx, environmentId, inquiry.id);
    });
    await screening;

    expect((await getInquiry(db, environmentId, inquiry.id))?.status).toBe('completed');
    expect(await getListScreening(db, environmentId, inquiry.id)).toMatchObject({
      status: 'errored',
    });
    const { items } = await listListMatches(
      db,
      environmentId,
      { inquiryIds: [inquiry.id] },
      { size: 5 },
    );
    expect(items).toEqual([]);
  });

  it('a redaction after the screening nulls the value it wrote', async () => {
    const inquiry = await matching();
    await processListScreen(job(inquiry), deps());

    await redactInquiryRecords(db, environmentId, inquiry.id);

    const { items } = await listListMatches(
      db,
      environmentId,
      { inquiryIds: [inquiry.id] },
      { size: 5 },
    );
    expect(items).toEqual([expect.objectContaining({ matchedValue: null })]);
    expect(items[0]?.redactedAt).not.toBeNull();
  });
});

describe('two writers (C97.5, C98.1)', () => {
  const service = {
    db: undefined as unknown,
    blindIndexKey: key,
    rateLimiter: createAllowAllRateLimiter(),
    audit: createRecordingAuditLogger(),
    clock,
    events,
  };
  const acting = () => ({
    ctx: { organizationId: 'org_x', environmentId },
    mask: UNMASKED,
    actor: { type: 'api-key' as const, id: `key_${'0'.repeat(26)}` },
  });
  const write = (listId: string, value: string) =>
    createListItem({ ...service, db } as unknown as ApiDependencies, acting(), 'string', {
      'list-id': listId,
      value,
    });

  it('let one take the last place of a list', async () => {
    const list = await listWith('string', []);
    await db.execute(
      sql`update lists set item_count = ${LIST_LIMITS.itemsPerList - 1} where id = ${list.id}`,
    );

    const outcomes = await Promise.allSettled([write(list.id, 'one'), write(list.id, 'two')]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(refused?.reason).toBeInstanceOf(ListProblemError);
    expect(await getList(db, environmentId, list.id)).toMatchObject({
      itemCount: LIST_LIMITS.itemsPerList,
      version: 2,
    });
  });

  it('let one write a value, and answer the other 409', async () => {
    const list = await listWith('string', []);

    const outcomes = await Promise.allSettled([write(list.id, 'same'), write(list.id, ' SAME ')]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(await getList(db, environmentId, list.id)).toMatchObject({ itemCount: 1 });
  });
});
