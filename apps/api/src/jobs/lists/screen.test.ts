/**
 * C99.4-C99.6 (Workflow 7B, `api-lists`): the `list-screen` job and its sweep on PGlite: the probes
 * of C99.5 in their order, the screening's end states, the matches and count in one transaction,
 * `on-list-match` (owner decision 5 after Workflow 6C: a redacted inquiry is never moved, which the
 * 6D guard does not cover because it leaves `completed -> needs_review` unguarded), and the sweep.
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { emptyExtractedFields, type ListKind } from '@openverify/core';
import { newId } from '@openverify/contracts';
import {
  createAccount,
  createGovernmentIdExtraction,
  createInquirySession,
  createList,
  createListScreening,
  createVerification,
  getInquiry,
  getListItem,
  getListScreening,
  hashSessionToken,
  insertListItems,
  listListMatches,
  recordSessionNetworkEvaluation,
  redactInquiryRecords,
  setVerificationStatus,
  updateEnvironmentSettings,
  type Db,
  type Inquiry,
  type ListRow,
  type NewList,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedOtpChallenge,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BiometricListSelection, ListScreenJob } from '../../ports.js';
import { newListItem } from '../../services/lists/keys.js';
import {
  createFakeBiometricListMatcher,
  createRecordingEventPublisher,
  fixedClock,
  type RecordingEventPublisher,
} from '../../test-support/fakes.js';
import { createCapturingLogger } from '../testing.js';
import { LIST_SCREEN_MAX_ATTEMPTS, processListScreen, type ListScreenDeps } from './screen.js';
import { LIST_SCREEN_REENQUEUE_AFTER_MS, runListScreenSweep } from './sweep.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let events: RecordingEventPublisher;
const clock = fixedClock(new Date('2026-10-31T12:00:00.000Z'));
const key = new Uint8Array(randomBytes(32));

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  events = createRecordingEventPublisher();
});

const deps = (overrides: Partial<ListScreenDeps> = {}): ListScreenDeps => ({
  db,
  clock,
  logger: createCapturingLogger(),
  events,
  keyring: database.keyring,
  blindIndexKey: key,
  ...overrides,
});

const PREFIXES: Partial<
  Record<ListKind, 'lis' | 'liea' | 'lipn' | 'ligin' | 'lin' | 'liip' | 'lic' | 'libf' | 'liif'>
> = {
  string: 'lis',
  'email-address': 'liea',
  'phone-number': 'lipn',
  'government-id-number': 'ligin',
  name: 'lin',
  'ip-address': 'liip',
  country: 'lic',
  'browser-fingerprint': 'libf',
  field: 'liif',
};

async function listWith(
  type: ListKind,
  values: readonly Readonly<Record<string, unknown>>[] = [],
  input: Partial<NewList> = {},
  environment = environmentId,
): Promise<{ list: ListRow; itemIds: string[] }> {
  const list = await createList(db, environment, {
    id: newId('lst'),
    type,
    name: 'Synthetic',
    ...input,
  });
  const items = values.map((value) =>
    newListItem(key, environment, list, {
      id: newId(PREFIXES[type] ?? 'lis'),
      value,
      creator: { type: 'api-key', id: newId('key') },
    }),
  );
  await insertListItems(db, environment, list.id, items);
  return { list, itemIds: items.map(({ id }) => id) };
}

interface PendingOptions {
  listConfig?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  status?: string;
  environment?: string;
}

/** An inquiry in `status` with its pending outbox row. */
async function screenable(options: PendingOptions = {}): Promise<Inquiry> {
  const environment = options.environment ?? environmentId;
  const { inquiry } = await createTestInquiry(db, environment, { fields: options.fields ?? {} });
  await db.execute(
    sql`update inquiry_template_versions set list_config = ${JSON.stringify(options.listConfig ?? {})}::jsonb
         where id = ${inquiry.inquiryTemplateVersionId}`,
  );
  await db.execute(
    sql`update inquiries set status = ${options.status ?? 'completed'} where id = ${inquiry.id}`,
  );
  await createListScreening(db, environment, { inquiryId: inquiry.id, triggerStatus: 'completed' });
  const current = await getInquiry(db, environment, inquiry.id);
  if (current === null) {
    throw new Error('the inquiry is gone');
  }
  return current;
}

const jobOf = (inquiry: Inquiry): ListScreenJob => ({
  environmentId: inquiry.environmentId,
  inquiryId: inquiry.id,
});

const screeningOf = (inquiry: Inquiry) => getListScreening(db, inquiry.environmentId, inquiry.id);
const statusOf = async (inquiry: Inquiry) =>
  (await getInquiry(db, inquiry.environmentId, inquiry.id))?.status;
const matchesOf = async (inquiry: Inquiry) =>
  (await listListMatches(db, inquiry.environmentId, { inquiryIds: [inquiry.id] }, { size: 100 }))
    .items;

async function fresh(): Promise<string> {
  return (await createTestTenant(db)).environment.id;
}

const named = (list: ListRow, extra: Record<string, unknown> = {}) => ({
  screen: [list.id],
  ...extra,
});

async function decided(
  inquiryId: string,
  type: 'government_id' | 'email_address',
  status: 'passed' | 'needs_review',
) {
  const id = testId('ver');
  await createVerification(db, environmentId, { id, inquiryId, type });
  await setVerificationStatus(db, environmentId, id, { to: 'submitted' });
  await setVerificationStatus(db, environmentId, id, { to: status });
  return id;
}

async function governmentId(inquiryId: string, fields: Record<string, string | null>) {
  const id = await decided(inquiryId, 'government_id', 'passed');
  await createGovernmentIdExtraction(db, environmentId, {
    verificationId: id,
    fields: { ...emptyExtractedFields(), ...fields },
    fieldSources: {},
    identificationNumberIndex: null,
    frontPhash: null,
    idClassGroup: 'passport',
  });
  await db.execute(sql`update verifications set country = 'ZZ' where id = ${id}`);
  return id;
}

async function sessionAt(
  inquiry: Inquiry,
  facts: {
    ip: string;
    clientAddressSource?: 'socket' | 'trust-all';
    countryCode?: string;
    location?: { latitude: number; longitude: number };
  },
) {
  const session = await createInquirySession(db, inquiry.environmentId, {
    id: newId('iqse'),
    inquiryId: inquiry.id,
    tokenHash: hashSessionToken(`ovs_${randomBytes(16).toString('hex')}`),
    expiresAt: new Date(clock.now().getTime() + 3_600_000),
  });
  await recordSessionNetworkEvaluation(db, inquiry.environmentId, {
    id: newId('net'),
    inquirySessionId: session.id,
    ip: facts.ip,
    clientAddressSource: facts.clientAddressSource ?? 'socket',
    evaluatedAt: clock.now(),
    facts: {
      isTor: null,
      isDatacenter: null,
      isVpn: null,
      isProxy: null,
      hostingAsn: null,
      hostingAsnConfidence: null,
      privacyRelay: null,
      threatLevel: null,
      countryCode: facts.countryCode ?? null,
      countryName: null,
      location:
        facts.location === undefined
          ? null
          : { regionCode: null, regionName: null, ...facts.location },
      asn: null,
      organization: null,
      serviceType: null,
      proxyType: null,
      ipConnectionType: null,
    },
    reasons: [],
    sources: [],
  });
  return session;
}

describe('a screening (C99.4)', () => {
  it('writes the match, the count and the event in one go, with the value sealed', async () => {
    const { list, itemIds } = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    const inquiry = await screenable({
      listConfig: named(list),
      fields: { email_address: 'listed@example.com' },
    });

    const result = await processListScreen(jobOf(inquiry), deps());

    expect(result).toEqual({ status: 'screened' });
    const [match] = await matchesOf(inquiry);
    expect(match).toMatchObject({
      listId: list.id,
      listItemId: itemIds[0],
      accountId: inquiry.accountId,
      source: 'inquiry.fields',
      method: 'exact',
      tier: 'R',
      status: 'open',
      matchedValue: 'listed@example.com',
    });
    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'completed',
      matchCount: 1,
      unscreened: [],
      notApplicable: [],
      reviewCause: null,
      screenedAt: clock.now(),
    });
    expect((await getListItem(db, environmentId, itemIds[0] ?? ''))?.matchCount).toBe(1);
    const [event] = events.events;
    expect(event?.name).toBe('list-match.created');
    expect(JSON.stringify(event?.payload)).not.toContain('listed@example.com');
    expect(await statusOf(inquiry)).toBe('completed');
  });

  it('reads a list with nothing matching as a count of 0', async () => {
    const { list } = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    const inquiry = await screenable({
      listConfig: named(list),
      fields: { email_address: 'other@example.com' },
    });

    await processListScreen(jobOf(inquiry), deps());

    expect(await screeningOf(inquiry)).toMatchObject({ status: 'completed', matchCount: 0 });
    expect(events.events).toEqual([]);
  });

  it('never makes a screening partial for a value the subject does not have (H16)', async () => {
    const { list } = await listWith('phone-number');
    const inquiry = await screenable({ listConfig: named(list) });

    await processListScreen(jobOf(inquiry), deps());

    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'completed',
      matchCount: 0,
      notApplicable: [{ 'list-id': list.id, reason: 'subject_has_no_value' }],
    });
  });

  it('ends partial for a value it could not read, keeping what it found (H02)', async () => {
    const phones = await listWith('phone-number');
    const emails = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    const inquiry = await screenable({
      listConfig: { screen: [phones.list.id, emails.list.id] },
      fields: { phone_number: 'not a number', email_address: 'listed@example.com' },
    });

    await processListScreen(jobOf(inquiry), deps());

    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'partial',
      matchCount: null,
      unscreened: [{ 'list-id': phones.list.id, reason: 'probe_unavailable' }],
    });
    expect(await matchesOf(inquiry)).toHaveLength(1);
  });

  it('counts the open matches already there, the C99.9 record among them', async () => {
    const { list, itemIds } = await listWith('government-id-number', [{ 'id-number': 'X1234567' }]);
    const inquiry = await screenable({ listConfig: named(list) });
    await db.execute(sql`
      insert into list_matches (id, environment_id, list_id, list_item_id, inquiry_id, source,
        method, tier, list_version)
      values (${newId('lmt')}, ${environmentId}, ${list.id}, ${itemIds[0] ?? ''}, ${inquiry.id},
        'government-id.identification-number', 'exact', 'R', 1)`);

    await processListScreen(jobOf(inquiry), deps());

    expect(await screeningOf(inquiry)).toMatchObject({ status: 'completed', matchCount: 1 });
  });

  it('runs once: a second run finds nothing pending and writes nothing', async () => {
    const { list } = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    const inquiry = await screenable({
      listConfig: named(list),
      fields: { email_address: 'listed@example.com' },
    });
    await processListScreen(jobOf(inquiry), deps());
    events = createRecordingEventPublisher();

    expect(await processListScreen(jobOf(inquiry), deps())).toEqual({ status: 'skipped' });
    expect(await matchesOf(inquiry)).toHaveLength(1);
    expect(events.events).toEqual([]);
  });

  it('skips an inquiry with no row', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    expect(await processListScreen(jobOf(inquiry), deps())).toEqual({ status: 'skipped' });
  });
});

describe('the probes of C99.5', () => {
  it('prefers the confirmed OTP destination over the fields, as C84.2 does', async () => {
    const { list } = await listWith('email-address', [
      { value: 'confirmed@example.com', 'match-type': 'email_address' },
    ]);
    const inquiry = await screenable({
      listConfig: named(list),
      fields: { email_address: 'typed@example.com' },
    });
    const id = await decided(inquiry.id, 'email_address', 'passed');
    await seedOtpChallenge(db, environmentId, {
      verificationId: id,
      inquiryId: inquiry.id,
      channel: 'email',
      destination: 'confirmed@example.com',
      status: 'confirmed',
      confirmedAt: clock.now(),
    });

    await processListScreen(jobOf(inquiry), deps());

    expect(await matchesOf(inquiry)).toEqual([
      expect.objectContaining({
        source: 'otp.email-address',
        matchedValue: 'confirmed@example.com',
      }),
    ]);
  });

  it('falls back to the account’s fields', async () => {
    const { list } = await listWith('phone-number', [{ value: '+12025550100' }]);
    const account = await createAccount(db, environmentId, {
      id: testId('acc'),
      fields: { phone_number: '+12025550100' },
    });
    const inquiry = await screenable({ listConfig: named(list) });
    await db.execute(sql`update inquiries set account_id = ${account.id} where id = ${inquiry.id}`);

    await processListScreen(jobOf(inquiry), deps());

    expect(await matchesOf(inquiry)).toEqual([
      expect.objectContaining({ source: 'account.fields', accountId: account.id }),
    ]);
  });

  it('reads the number, class and name of the latest decided government ID', async () => {
    const numbers = await listWith('government-id-number', [
      { 'id-number': 'X1234567', 'id-class': 'passport' },
    ]);
    const names = await listWith('name', [{ 'name-first': 'Avery', 'name-last': 'Quillfeather' }]);
    const countries = await listWith('country', [{ 'country-code': 'ZZ' }]);
    const inquiry = await screenable({
      listConfig: { screen: [numbers.list.id, names.list.id, countries.list.id] },
    });
    await governmentId(inquiry.id, {
      'identification-number': 'X1234567',
      'name-first': 'Avery',
      'name-last': 'Quillfeather',
    });

    await processListScreen(jobOf(inquiry), deps());

    const sources = (await matchesOf(inquiry)).map(({ source }) => source).sort();
    expect(sources).toEqual([
      'government-id.identification-number',
      'government-id.issuing-country',
      'government-id.name',
    ]);
  });

  it('screens another name in the fields too, and leaves a rejected handoff’s ID out (C96.3)', async () => {
    const { list } = await listWith('name', [
      { 'name-first': 'Avery', 'name-last': 'Quillfeather' },
      { 'name-first': 'Robin', 'name-last': 'Inkwell' },
    ]);
    const inquiry = await screenable({
      listConfig: named(list),
      fields: { name_first: 'Robin', name_last: 'Inkwell' },
    });
    const id = await governmentId(inquiry.id, {
      'name-first': 'Avery',
      'name-last': 'Quillfeather',
    });
    await db.execute(sql`update verifications set from_rejected_handoff = true where id = ${id}`);

    await processListScreen(jobOf(inquiry), deps());

    expect((await matchesOf(inquiry)).map(({ source }) => source)).toEqual(['inquiry.fields']);
  });

  it('reads every session’s address, and a field by the list’s key', async () => {
    const ips = await listWith('ip-address', [{ value: '198.51.100.0/24' }]);
    const fields = await listWith('field', [{ 'field-value': 'promo-1' }], {
      fieldKey: 'campaign',
    });
    const inquiry = await screenable({
      listConfig: { screen: [ips.list.id, fields.list.id] },
      fields: { campaign: 'promo-1' },
    });
    await sessionAt(inquiry, { ip: '203.0.113.5' });
    await sessionAt(inquiry, { ip: '198.51.100.9' });

    await processListScreen(jobOf(inquiry), deps());

    expect((await matchesOf(inquiry)).map(({ method }) => method).sort()).toEqual([
      'cidr',
      'exact',
    ]);
  });

  it('keeps an untrusted production address out of the probes (P05)', async () => {
    const environment = (await createTestTenant(db, { kind: 'production' })).environment.id;
    const { list } = await listWith('ip-address', [{ value: '192.0.2.1' }], {}, environment);
    const inquiry = await screenable({ listConfig: named(list), environment });
    await sessionAt(inquiry, { ip: '192.0.2.1', clientAddressSource: 'trust-all' });

    await processListScreen(jobOf(inquiry), deps());

    expect(await matchesOf(inquiry)).toEqual([]);
    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'partial',
      unscreened: [{ 'list-id': list.id, reason: 'client_address_untrusted' }],
    });
  });
});

describe('which lists (C99.5, V21)', () => {
  it('reads every active list of the kinds `all` covers, never a string or biometric one', async () => {
    const environment = await fresh();
    const email = await listWith('email-address', [], {}, environment);
    const string = await listWith('string', [], {}, environment);
    await listWith('email-address', [], { screenAtCompletion: false }, environment);
    await createList(db, environment, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });
    const inquiry = await screenable({ environment });

    await processListScreen(jobOf(inquiry), deps());

    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'completed',
      notApplicable: [{ 'list-id': email.list.id, reason: 'subject_has_no_value' }],
    });
    expect(string.list.id).toMatch(/^lst_/u);
  });

  it('records a kind the environment does not collect, and stays complete under `all`', async () => {
    const environment = await fresh();
    const fingerprints = await listWith('browser-fingerprint', [], {}, environment);
    const points = await listWith('geolocation', [], {}, environment);
    const inquiry = await screenable({ environment });

    await processListScreen(jobOf(inquiry), deps());

    const screening = await screeningOf(inquiry);
    expect(screening).toMatchObject({ status: 'completed', matchCount: 0 });
    expect(screening?.unscreened).toEqual(
      expect.arrayContaining([
        { 'list-id': fingerprints.list.id, reason: 'kind_not_collected' },
        { 'list-id': points.list.id, reason: 'kind_not_collected' },
      ]),
    );
  });

  it('counts fingerprints once recognition is on', async () => {
    const environment = await fresh();
    await updateEnvironmentSettings(db, environment, {
      'signal-collection': {
        'session-integrity': 'on',
        'device-recognition': 'consent',
        'device-recognition-basis': null,
      },
    });
    const fingerprints = await listWith('browser-fingerprint', [], {}, environment);
    const inquiry = await screenable({ environment });

    await processListScreen(jobOf(inquiry), deps());

    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'completed',
      unscreened: [],
      notApplicable: [{ 'list-id': fingerprints.list.id, reason: 'subject_has_no_value' }],
    });
  });

  it('ends partial for a named list of a kind no longer collected, or archived', async () => {
    const environment = await fresh();
    const fingerprints = await listWith('browser-fingerprint', [], {}, environment);
    const archived = await listWith('string', [], {}, environment);
    await db.execute(
      sql`update lists set status = 'archived', archived_at = now() where id = ${archived.list.id}`,
    );
    const inquiry = await screenable({
      listConfig: { screen: [fingerprints.list.id, archived.list.id] },
      environment,
    });

    await processListScreen(jobOf(inquiry), deps());

    const screening = await screeningOf(inquiry);
    expect(screening?.status).toBe('partial');
    expect(screening?.unscreened).toEqual(
      expect.arrayContaining([
        { 'list-id': fingerprints.list.id, reason: 'kind_not_collected' },
        { 'list-id': archived.list.id, reason: 'list_archived' },
      ]),
    );
  });

  it('asks the matcher for a named biometric list, and keeps its answer', async () => {
    const face = await createList(db, environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });
    const inquiry = await screenable({ listConfig: named(face) });
    const biometric = createFakeBiometricListMatcher();
    biometric.outcome = {
      matches: [],
      unscreened: [{ 'list-id': face.id, reason: 'consent_not_given' }],
      compared: [],
    };

    await processListScreen(jobOf(inquiry), deps({ biometric }));

    expect(biometric.calls).toEqual([{ inquiryId: inquiry.id, listIds: [face.id] }]);
    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'partial',
      unscreened: [{ 'list-id': face.id, reason: 'consent_not_given' }],
    });
    const selection: BiometricListSelection = { id: face.id, kind: 'face', version: 1 };
    expect(selection.id).toBe(face.id);
  });
});

describe('on-list-match (C99.6)', () => {
  async function matching(status = 'completed') {
    const { list } = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    return screenable({
      listConfig: named(list, { 'on-list-match': 'needs_review' }),
      fields: { email_address: 'listed@example.com' },
      status,
    });
  }

  it('sends a completed inquiry to review on an open match', async () => {
    const inquiry = await matching();

    await processListScreen(jobOf(inquiry), deps());

    expect(await statusOf(inquiry)).toBe('needs_review');
    expect((await screeningOf(inquiry))?.reviewCause).toBe('list_match');
    expect(events.events.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['list-match.created', 'inquiry.marked-for-review']),
    );
  });

  it('sends it to review on a partial screening, with its own cause', async () => {
    const { list } = await listWith('phone-number');
    const inquiry = await screenable({
      listConfig: named(list, { 'on-list-match': 'needs_review' }),
      fields: { phone_number: 'not a number' },
    });

    await processListScreen(jobOf(inquiry), deps());

    expect(await statusOf(inquiry)).toBe('needs_review');
    expect((await screeningOf(inquiry))?.reviewCause).toBe('list_unscreened');
  });

  it('leaves it alone with the rule off, or with nothing to report', async () => {
    const { list } = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    const off = await screenable({
      listConfig: named(list),
      fields: { email_address: 'listed@example.com' },
    });
    const clean = await screenable({
      listConfig: named(list, { 'on-list-match': 'needs_review' }),
      fields: { email_address: 'other@example.com' },
    });

    await processListScreen(jobOf(off), deps());
    await processListScreen(jobOf(clean), deps());

    expect(await statusOf(off)).toBe('completed');
    expect((await screeningOf(off))?.reviewCause).toBeNull();
    expect(await statusOf(clean)).toBe('completed');
    expect((await screeningOf(clean))?.reviewCause).toBeNull();
  });

  it.each(['approved', 'declined', 'needs_review'])(
    'leaves a %s inquiry as it is, and records why',
    async (status) => {
      const inquiry = await matching(status);

      await processListScreen(jobOf(inquiry), deps());

      expect(await statusOf(inquiry)).toBe(status);
      expect((await screeningOf(inquiry))?.reviewCause).toBe('inquiry_already_decided');
    },
  );

  it.each(['failed', 'expired'])(
    'records the cause on a %s inquiry, without a move',
    async (status) => {
      const inquiry = await matching(status);

      await processListScreen(jobOf(inquiry), deps());

      expect(await statusOf(inquiry)).toBe(status);
      expect((await screeningOf(inquiry))?.reviewCause).toBe('list_match');
    },
  );
});

describe('a redacted inquiry (owner decision 5 after Workflow 6C)', () => {
  it('is never moved: the job ends the row errored, reads nothing and writes nothing', async () => {
    const { list } = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    const inquiry = await screenable({
      listConfig: named(list, { 'on-list-match': 'needs_review' }),
      fields: { email_address: 'listed@example.com' },
    });
    await redactInquiryRecords(db, environmentId, inquiry.id);

    expect(await processListScreen(jobOf(inquiry), deps())).toEqual({ status: 'skipped' });

    expect(await statusOf(inquiry)).toBe('completed');
    expect(await matchesOf(inquiry)).toEqual([]);
    expect(await screeningOf(inquiry)).toMatchObject({ status: 'errored', matchCount: null });
    expect(events.events).toEqual([]);
  });
});

describe('a run that fails (C99.4)', () => {
  const failing = (): Partial<ListScreenDeps> => ({
    biometric: { match: () => Promise.reject(new Error('vision is down')) },
  });

  async function faceInquiry(config: Record<string, unknown> = {}) {
    const face = await createList(db, environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });
    return screenable({ listConfig: named(face, config) });
  }

  it('counts the attempt, keeps the row pending and fails the job', async () => {
    const inquiry = await faceInquiry();
    await expect(processListScreen(jobOf(inquiry), deps(failing()))).rejects.toThrow(
      'vision is down',
    );
    expect((await screeningOf(inquiry))?.status).toBe('pending');
  });

  it('ends errored after the last attempt, and on-list-match sends it to review', async () => {
    const inquiry = await faceInquiry({ 'on-list-match': 'needs_review' });
    await db.execute(
      sql`update list_screenings set attempts = ${LIST_SCREEN_MAX_ATTEMPTS - 1}
           where inquiry_id = ${inquiry.id}`,
    );

    await expect(processListScreen(jobOf(inquiry), deps(failing()))).resolves.toEqual({
      status: 'screened',
    });

    expect(await screeningOf(inquiry)).toMatchObject({
      status: 'errored',
      matchCount: null,
      reviewCause: 'list_unscreened',
    });
    expect(await statusOf(inquiry)).toBe('needs_review');
  });

  it('needs the blind-index key', async () => {
    const inquiry = await faceInquiry();
    await expect(
      processListScreen(jobOf(inquiry), deps({ blindIndexKey: undefined })),
    ).rejects.toThrow('blind index key');
  });
});

describe('the sweep (C99.4, C107.1)', () => {
  it('enqueues pending rows once, recovers a lost enqueue, and ends a redacted row', async () => {
    const environment = await fresh();
    const first = await screenable({ environment });
    const redacted = await screenable({ environment });
    await redactInquiryRecords(db, environment, redacted.id);
    const enqueued: ListScreenJob[] = [];
    const sweep = (at: Date) =>
      runListScreenSweep({
        db,
        clock: fixedClock(at),
        logger: createCapturingLogger(),
        screens: {
          enqueueListScreen(job) {
            enqueued.push(job);
            return Promise.resolve();
          },
        },
      });
    const ours = () => enqueued.filter((job) => job.environmentId === environment);

    await sweep(clock.now());
    expect(ours()).toEqual([jobOf(first)]);
    expect(await screeningOf(redacted)).toMatchObject({ status: 'errored' });

    await sweep(new Date(clock.now().getTime() + 15_000));
    expect(ours()).toHaveLength(1);

    await sweep(new Date(clock.now().getTime() + LIST_SCREEN_REENQUEUE_AFTER_MS + 1000));
    expect(ours()).toHaveLength(2);
  });
});
