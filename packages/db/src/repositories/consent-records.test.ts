/**
 * C236, C237, C241.3 (Workflow 11A, `api-consent`): the consent repositories on PGlite. A record's
 * sealed members are sealed for its id and opened on read; the status is derived (review H27) the
 * same way in code and in the list filter; a withdrawal happens once; a redaction clears the
 * evidence, the text keys and the subject link and keeps the bare fact; a decline stands for its
 * validity; the retention pass deletes a bare fact past its term that no token cites; a text is
 * stored once per environment and digest. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { consentRecordsCrossEnv } from '../cross-env.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import {
  consentRecordStatusOf,
  createConsentRecord,
  deleteEndedShareTokens,
  deleteExpiredConsentFacts,
  getConsentConnection,
  getConsentRecord,
  hasStandingDecline,
  listConsentRecords,
  listConsentRecordsOfSubjects,
  listInquiryFlowConsents,
  listSessionShareConsents,
  lockConsentRecord,
  markShareCopiesConsentWithdrawn,
  redactConsentRecordsOfSubject,
  setConsentRecordSubject,
  shareTokensCitingConsentRecords,
  withdrawConsentRecord,
  type NewOpenedConsentRecord,
} from './consent-records.js';
import {
  deleteUncitedConsentTexts,
  getConsentText,
  insertConsentTextIfAbsent,
} from './consent-texts.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(randomBytes(32)) });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);
const NOW = new Date('2026-11-12T12:00:00.000Z');
const DAY = 86_400_000;

async function seed() {
  const source = await createTestTenant(database.db, { organizationName: 'Example Source' });
  const destination = await createTestTenant(database.db, { organizationName: 'Example Partner' });
  const connectionId = testId('cxn');
  const policyId = testId('cxnp');
  await database.client.query(
    `insert into connect_connections (id, source_organization_id, destination_organization_id,
       status, creator_type, creator_id) values ($1, $2, $3, 'active', 'api-key', $4)`,
    [connectionId, source.organization.id, destination.organization.id, testId('key')],
  );
  await database.client.query(
    `insert into connect_share_policies (id, connection_id, version, body, created_by_type, created_by_id)
     values ($1, $2, 1, '{"purpose":"share.reuse-kyc"}'::jsonb, 'api-key', $3)`,
    [policyId, connectionId, testId('key')],
  );
  return { source, destination, connectionId, policyId };
}

type Seeded = Awaited<ReturnType<typeof seed>>;

const flowRecord = (
  seeded: Seeded,
  overrides: Partial<NewOpenedConsentRecord> = {},
): NewOpenedConsentRecord => ({
  id: testId('cnsr'),
  side: 'source',
  outcome: 'accepted',
  purpose: 'share.reuse-kyc',
  subjectType: 'inquiry',
  subjectId: testId('inq'),
  connectionId: seeded.connectionId,
  recipientOrganizationId: seeded.destination.organization.id,
  recipientName: 'Example Partner',
  dataCategories: ['identity-fields', 'check-results'],
  explicitBiometric: false,
  textLocale: 'en',
  textKeys: ['share.consent.source'],
  textSha256: DIGEST,
  method: 'flow',
  sessionId: testId('iqse'),
  evidenceIp: '192.0.2.10',
  evidenceUserAgent: 'synthetic-agent/1.0',
  acceptedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 14 * DAY),
  ...overrides,
});

describe('a record is sealed for its id and opened on read (C236.3, C236.4)', () => {
  it('stores the evidence as ciphertext and serves it opened, in its own environment only', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const created = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    expect(created.evidenceIp).toBe('192.0.2.10');
    expect(created.evidenceUserAgent).toBe('synthetic-agent/1.0');

    const raw = await database.client.query<{ evidence_ip: string; evidence_user_agent: string }>(
      'select evidence_ip, evidence_user_agent from consent_records where id = $1',
      [created.id],
    );
    expect(raw.rows[0]?.evidence_ip).not.toBe('192.0.2.10');
    expect(raw.rows[0]?.evidence_user_agent).not.toContain('synthetic-agent');

    expect((await getConsentRecord(database.db, environmentId, created.id))?.evidenceIp).toBe(
      '192.0.2.10',
    );
    expect(
      await getConsentRecord(database.db, seeded.destination.environment.id, created.id),
    ).toBeNull();
    // A ciphertext moved to another row fails to open (row AAD).
    const other = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    await database.client.query(
      'update consent_records set evidence_ip = (select evidence_ip from consent_records where id = $1) where id = $2',
      [created.id, other.id],
    );
    await expect(getConsentRecord(database.db, environmentId, other.id)).rejects.toThrow();
  });

  it('seals an attested record’s text and evidence reference', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const created = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, {
        method: 'attested',
        sessionId: null,
        evidenceIp: null,
        evidenceUserAgent: null,
        acceptedAt: null,
        attestedAt: NOW,
        attestedByType: 'api-key',
        attestedById: testId('key'),
        evidenceReference: 'synthetic-ticket-1',
        attestedTextBody: 'Synthetic attested text.',
        textKeys: [],
      }),
    );
    const read = await getConsentRecord(database.db, environmentId, created.id);
    expect(read?.attestedTextBody).toBe('Synthetic attested text.');
    expect(read?.evidenceReference).toBe('synthetic-ticket-1');
  });
});

describe('the derived status (C236.1, review H27)', () => {
  const base = {
    outcome: 'accepted' as const,
    redactedAt: null,
    withdrawnAt: null,
    expiresAt: new Date(NOW.getTime() + 1),
  };
  it.each([
    ['active', base],
    ['expired', { ...base, expiresAt: NOW }],
    ['withdrawn', { ...base, withdrawnAt: NOW, expiresAt: NOW }],
    ['redacted', { ...base, withdrawnAt: NOW, redactedAt: NOW }],
    ['declined', { ...base, outcome: 'declined' as const, redactedAt: NOW, withdrawnAt: NOW }],
  ])('is %s', (status, record) => {
    expect(consentRecordStatusOf(record, NOW)).toBe(status);
  });
});

describe('the list (C236.2)', () => {
  it('lists newest first with every filter, the status read as the code reads it', async () => {
    onTestFinished(wallClockStepsBack());
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const clock = createdAtClock(database.db, new Date(NOW.getTime() - 60 * DAY));
    const subject = testId('inq');
    const active = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { subjectId: subject }),
    );
    await clock.at('consent_records', active.id);
    const expired = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { expiresAt: new Date(NOW.getTime() - 1) }),
    );
    await clock.at('consent_records', expired.id);
    const declined = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { outcome: 'declined', acceptedAt: null, subjectId: subject }),
    );
    await clock.at('consent_records', declined.id);
    const destination = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { side: 'destination', subjectType: 'share-token', subjectId: null }),
    );
    await clock.at('consent_records', destination.id);

    const all = await listConsentRecords(database.db, environmentId, { now: NOW });
    expect(all.items.map((record) => record.id)).toEqual([
      destination.id,
      declined.id,
      expired.id,
      active.id,
    ]);
    const ids = async (filters: Parameters<typeof listConsentRecords>[2]) =>
      (await listConsentRecords(database.db, environmentId, filters)).items.map(({ id }) => id);
    expect(await ids({ now: NOW, statuses: ['expired'] })).toEqual([expired.id]);
    expect(await ids({ now: NOW, statuses: ['active', 'declined'] })).toEqual([
      destination.id,
      declined.id,
      active.id,
    ]);
    expect(await ids({ now: NOW, side: 'destination' })).toEqual([destination.id]);
    expect(await ids({ now: NOW, subjectIds: [subject] })).toEqual([declined.id, active.id]);
    expect(await ids({ now: NOW, connectionIds: [testId('cxn')] })).toEqual([]);
    expect(await ids({ now: NOW, statuses: [] })).toEqual([]);

    const first = await listConsentRecords(database.db, environmentId, {
      now: NOW,
      page: { size: 2 },
    });
    expect(first.items.map(({ id }) => id)).toEqual([destination.id, declined.id]);
    expect(first.next).toBe(declined.id);
    const second = await listConsentRecords(database.db, environmentId, {
      now: NOW,
      page: { size: 2, after: first.next ?? undefined },
    });
    expect(second.items.map(({ id }) => id)).toEqual([expired.id, active.id]);
    expect(second.next).toBeNull();
  });

  it('finds a destination record by its share token while the token is its subject', async () => {
    const seeded = await seed();
    const environmentId = seeded.destination.environment.id;
    const token = testId('cnst');
    const record = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, {
        side: 'destination',
        subjectType: 'share-token',
        subjectId: token,
        shareTokenId: token,
      }),
    );
    const page = await listConsentRecords(database.db, environmentId, {
      now: NOW,
      subjectIds: [token],
    });
    expect(page.items.map(({ id }) => id)).toEqual([record.id]);
  });
});

describe('locks, withdrawal, redaction and the subject (C237.2, C241.3, C236.10)', () => {
  it('locks a record for update or share, and withdraws it once', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const record = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    await database.db.transaction(async (tx) => {
      expect((await lockConsentRecord(tx, environmentId, record.id, 'update'))?.id).toBe(record.id);
      expect((await lockConsentRecord(tx, environmentId, record.id, 'share'))?.id).toBe(record.id);
      expect(await lockConsentRecord(tx, environmentId, testId('cnsr'), 'update')).toBeNull();
    });
    const withdrawn = await withdrawConsentRecord(database.db, environmentId, record.id, {
      withdrawnAt: NOW,
      withdrawnVia: 'api',
      withdrawalReason: 'subject-request',
    });
    expect(withdrawn).toMatchObject({ withdrawnVia: 'api', withdrawalReason: 'subject-request' });
    expect(
      await withdrawConsentRecord(database.db, environmentId, record.id, {
        withdrawnAt: NOW,
        withdrawnVia: 'operator',
      }),
    ).toBeNull();
  });

  it('redacts the records about a subject and keeps their bare fact', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const subject = testId('inq');
    const record = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { subjectId: subject, evidenceReference: 'synthetic-ref' }),
    );
    const untouched = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    const redacted = await redactConsentRecordsOfSubject(
      database.db,
      environmentId,
      { type: 'inquiry', id: subject },
      NOW,
    );
    expect(redacted.map(({ id }) => id)).toEqual([record.id]);
    const read = await getConsentRecord(database.db, environmentId, record.id);
    expect(read).toMatchObject({
      redactedAt: NOW,
      subjectType: null,
      subjectId: null,
      sessionId: null,
      textKeys: [],
      evidenceIp: null,
      evidenceUserAgent: null,
      evidenceReference: null,
      attestedTextBody: null,
      textSha256: DIGEST,
      dataCategories: ['identity-fields', 'check-results'],
    });
    expect((await getConsentRecord(database.db, environmentId, untouched.id))?.redactedAt).toBe(
      null,
    );
    // A second redaction finds nothing to do.
    expect(
      await redactConsentRecordsOfSubject(
        database.db,
        environmentId,
        { type: 'inquiry', id: subject },
        NOW,
      ),
    ).toEqual([]);
  });

  it('moves a destination record to the copy it covers, and finds records by subject', async () => {
    const seeded = await seed();
    const environmentId = seeded.destination.environment.id;
    const token = testId('cnst');
    const record = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, {
        side: 'destination',
        subjectType: 'share-token',
        subjectId: token,
        shareTokenId: token,
      }),
    );
    const clone = testId('inq');
    const moved = await setConsentRecordSubject(database.db, environmentId, record.id, {
      type: 'inquiry',
      id: clone,
    });
    expect(moved).toMatchObject({ subjectType: 'inquiry', subjectId: clone, shareTokenId: token });
    expect(
      (
        await listConsentRecordsOfSubjects(database.db, environmentId, [
          { type: 'inquiry', id: clone },
        ])
      ).map(({ id }) => id),
    ).toEqual([record.id]);
    expect(await listConsentRecordsOfSubjects(database.db, environmentId, [])).toEqual([]);
  });
});

describe('a witnessed decline stands for its validity (C236.5, V08)', () => {
  it('finds a standing decline for the recipient and purpose on the given inquiries only', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const inquiry = testId('inq');
    await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, {
        subjectId: inquiry,
        outcome: 'declined',
        acceptedAt: null,
        expiresAt: new Date(NOW.getTime() + DAY),
      }),
    );
    const query = {
      recipientOrganizationId: seeded.destination.organization.id,
      purpose: 'share.reuse-kyc',
      now: NOW,
    };
    expect(
      await hasStandingDecline(database.db, environmentId, { ...query, inquiryIds: [inquiry] }),
    ).toBe(true);
    expect(
      await hasStandingDecline(database.db, environmentId, {
        ...query,
        inquiryIds: [testId('inq')],
      }),
    ).toBe(false);
    expect(await hasStandingDecline(database.db, environmentId, { ...query, inquiryIds: [] })).toBe(
      false,
    );
    expect(
      await hasStandingDecline(database.db, environmentId, {
        ...query,
        inquiryIds: [inquiry],
        now: new Date(NOW.getTime() + DAY),
      }),
    ).toBe(false);
    expect(
      await hasStandingDecline(database.db, environmentId, {
        ...query,
        recipientOrganizationId: seeded.source.organization.id,
        inquiryIds: [inquiry],
      }),
    ).toBe(false);
  });
});

describe('a decline on an inquiry of the account stands for the account (V08)', () => {
  it('finds a decline witnessed on any inquiry of the given accounts, and none of another', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const { inquiry: row } = await createTestInquiry(database.db, environmentId);
    const inquiry = row.id;
    const account = row.accountId;
    const { inquiry: elsewhere } = await createTestInquiry(database.db, environmentId);
    const other = elsewhere.accountId;
    await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { subjectId: inquiry, outcome: 'declined', acceptedAt: null }),
    );
    const query = {
      recipientOrganizationId: seeded.destination.organization.id,
      purpose: 'share.reuse-kyc',
      inquiryIds: [],
      now: NOW,
    };
    expect(
      await hasStandingDecline(database.db, environmentId, { ...query, accountIds: [account] }),
    ).toBe(true);
    expect(
      await hasStandingDecline(database.db, environmentId, { ...query, accountIds: [other] }),
    ).toBe(false);
  });
});

describe('a session’s and an inquiry’s flow records (C237.6)', () => {
  it('lists the session’s accepted records not withdrawn or redacted, oldest first', async () => {
    onTestFinished(wallClockStepsBack());
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const clock = createdAtClock(database.db);
    const sessionId = testId('iqse');
    const inquiry = testId('inq');
    const first = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { sessionId, subjectId: inquiry }),
    );
    await clock.at('consent_records', first.id);
    const second = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { sessionId, subjectId: inquiry }),
    );
    await clock.at('consent_records', second.id);
    const declined = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { sessionId, subjectId: inquiry, outcome: 'declined', acceptedAt: null }),
    );
    await clock.at('consent_records', declined.id);
    await withdrawConsentRecord(database.db, environmentId, second.id, {
      withdrawnAt: NOW,
      withdrawnVia: 'flow',
    });
    expect(
      (await listSessionShareConsents(database.db, environmentId, sessionId, 20)).map(
        ({ id }) => id,
      ),
    ).toEqual([first.id]);
    expect(
      (await listInquiryFlowConsents(database.db, environmentId, inquiry)).map(({ id }) => id),
    ).toEqual([first.id, second.id, declined.id]);
  });
});

describe('the retention of bare facts (C241.3)', () => {
  it('deletes a redacted record past its environment’s term, unless a token cites it', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    await database.client.query(
      `update environments set settings = settings || '{"consent-proof-retention-days": 10}'::jsonb
        where id = $1`,
      [environmentId],
    );
    const old = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    const recent = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    const cited = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    const live = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    await database.client.query(`update consent_records set redacted_at = $2 where id = any($1)`, [
      [old.id, cited.id],
      new Date(NOW.getTime() - 11 * DAY),
    ]);
    await database.client.query(`update consent_records set redacted_at = $2 where id = $1`, [
      recent.id,
      new Date(NOW.getTime() - 9 * DAY),
    ]);
    await database.client.query(
      `insert into connect_share_tokens (environment_id, id, connection_id, policy_id, environment_kind,
         destination_environment_id, source_type, source_id, consent_record_id, data_categories,
         status, creator_type, creator_id, expires_at)
       values ($1, $2, $3, $4, 'sandbox', $5, 'inquiry', $6, $7, '{identity-fields}', 'created',
         'api-key', $8, now() + interval '1 day')`,
      [
        environmentId,
        testId('cnst'),
        seeded.connectionId,
        seeded.policyId,
        seeded.destination.environment.id,
        testId('inq'),
        cited.id,
        testId('key'),
      ],
    );
    expect(await deleteExpiredConsentFacts(database.db, NOW, 100)).toBeGreaterThanOrEqual(1);
    expect(await getConsentRecord(database.db, environmentId, old.id)).toBeNull();
    for (const kept of [recent, cited, live]) {
      expect(await getConsentRecord(database.db, environmentId, kept.id)).not.toBeNull();
    }
  });
});

describe('consent texts (C236.3, C241.3; review P11)', () => {
  it('stores a text once per environment and digest, sealed for that pair', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const text = { sha256: OTHER_DIGEST, locale: 'en', body: 'Synthetic share text.' };
    await insertConsentTextIfAbsent(database.db, environmentId, text);
    await insertConsentTextIfAbsent(database.db, environmentId, { ...text, body: 'ignored' });
    const read = await getConsentText(database.db, environmentId, OTHER_DIGEST);
    expect(read).toMatchObject({ sha256: OTHER_DIGEST, locale: 'en', body: text.body });
    const count = await database.db.execute(
      sql`select count(*)::int as n from consent_texts where environment_id = ${environmentId}`,
    );
    expect((count as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(1);
    expect(await getConsentText(database.db, seeded.destination.environment.id, OTHER_DIGEST)).toBe(
      null,
    );
  });

  it('deletes the texts no record cites, once they are older than the cut-off', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const cited = 'c'.repeat(64);
    const biometric = 'd'.repeat(64);
    const uncited = 'e'.repeat(64);
    const fresh = 'f'.repeat(64);
    const old = new Date(NOW.getTime() - 2 * DAY);
    for (const sha256 of [cited, biometric, uncited]) {
      await insertConsentTextIfAbsent(database.db, environmentId, {
        sha256,
        locale: 'en',
        body: `Synthetic ${sha256.slice(0, 1)}`,
        createdAt: old,
      });
    }
    await insertConsentTextIfAbsent(database.db, environmentId, {
      sha256: fresh,
      locale: 'en',
      body: 'Synthetic fresh',
      createdAt: NOW,
    });
    await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { textSha256: cited, biometricTextSha256: biometric }),
    );
    expect(await deleteUncitedConsentTexts(database.db, 100, new Date(NOW.getTime() - DAY))).toBe(
      1,
    );
    expect(await getConsentText(database.db, environmentId, uncited)).toBeNull();
    for (const sha256 of [cited, biometric, fresh]) {
      expect(await getConsentText(database.db, environmentId, sha256)).not.toBeNull();
    }
    expect(await deleteUncitedConsentTexts(database.db, 100, new Date(NOW.getTime() - DAY))).toBe(
      0,
    );
  });
});

describe('the cross-environment twin (C240.5)', () => {
  it('locks the source record for share and lists the records touching objects', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    const subject = testId('inq');
    const token = testId('cnst');
    const record = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { subjectId: subject }),
    );
    const cites = await createConsentRecord(
      database.db,
      environmentId,
      flowRecord(seeded, { shareTokenId: token }),
    );
    await database.db.transaction(async (tx) => {
      expect(
        (await consentRecordsCrossEnv.lockSourceConsentRecordForShare(tx, environmentId, record.id))
          ?.id,
      ).toBe(record.id);
    });
    expect(
      (
        await consentRecordsCrossEnv.getCounterpartyConsentRecord(
          database.db,
          environmentId,
          record.id,
        )
      )?.id,
    ).toBe(record.id);
    expect(
      (
        await consentRecordsCrossEnv.listConsentRecordsTouching(database.db, environmentId, [
          subject,
          token,
        ])
      )
        .map(({ id }) => id)
        .sort(),
    ).toEqual([record.id, cites.id].sort());
    expect(
      await consentRecordsCrossEnv.listConsentRecordsTouching(database.db, environmentId, []),
    ).toEqual([]);
  });
});

describe('the reads of a record’s connection and citing token (C236.1, C236.5)', () => {
  it('reads a connection the organisation is a side of, and the token citing a record', async () => {
    const seeded = await seed();
    const environmentId = seeded.source.environment.id;
    expect(
      await getConsentConnection(
        database.db,
        seeded.destination.organization.id,
        seeded.connectionId,
      ),
    ).toMatchObject({
      id: seeded.connectionId,
      sourceOrganizationId: seeded.source.organization.id,
      destinationOrganizationId: seeded.destination.organization.id,
      status: 'active',
    });
    const stranger = await createTestTenant(database.db);
    expect(
      await getConsentConnection(database.db, stranger.organization.id, seeded.connectionId),
    ).toBeNull();

    const cited = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    const uncited = await createConsentRecord(database.db, environmentId, flowRecord(seeded));
    const token = testId('cnst');
    await database.client.query(
      `insert into connect_share_tokens (environment_id, id, connection_id, policy_id, environment_kind,
         destination_environment_id, source_type, source_id, consent_record_id, data_categories,
         status, creator_type, creator_id, expires_at)
       values ($1, $2, $3, $4, 'sandbox', $5, 'inquiry', $6, $7, '{identity-fields}', 'created',
         'api-key', $8, now() + interval '1 day')`,
      [
        environmentId,
        token,
        seeded.connectionId,
        seeded.policyId,
        seeded.destination.environment.id,
        testId('inq'),
        cited.id,
        testId('key'),
      ],
    );
    const citing = await shareTokensCitingConsentRecords(database.db, environmentId, [
      cited.id,
      uncited.id,
    ]);
    expect([...citing]).toEqual([[cited.id, token]]);
    expect((await shareTokensCitingConsentRecords(database.db, environmentId, [])).size).toBe(0);
  });
});

describe('the copies of a share learn of a destination withdrawal (C237.6 (2))', () => {
  it('marks every clone of the token once, and nothing of another token', async () => {
    const seeded = await seed();
    const environmentId = seeded.destination.environment.id;
    const token = testId('cnst');
    const other = testId('cnst');
    const provenanceOf = (shareTokenId: string) =>
      JSON.stringify({
        kind: 'connect-clone',
        'share-token-id': shareTokenId,
        'source-organization-name': 'Example Source',
        'source-environment-kind': 'sandbox',
        'source-created-at': '2026-11-01T00:00:00.000Z',
        'source-status': 'approved',
        'cloned-at': '2026-11-02T00:00:00.000Z',
      });
    const { inquiry: clone } = await createTestInquiry(database.db, environmentId);
    const { inquiry: unrelated } = await createTestInquiry(database.db, environmentId);
    await database.client.query('update inquiries set provenance = $2::jsonb where id = $1', [
      clone.id,
      provenanceOf(token),
    ]);
    await database.client.query('update inquiries set provenance = $2::jsonb where id = $1', [
      unrelated.id,
      provenanceOf(other),
    ]);
    expect(await markShareCopiesConsentWithdrawn(database.db, environmentId, token, NOW)).toBe(1);
    const read = async (id: string) =>
      (
        await database.client.query<{ provenance: Record<string, unknown> }>(
          'select provenance from inquiries where id = $1',
          [id],
        )
      ).rows[0]?.provenance;
    expect((await read(clone.id))?.['consent-withdrawn-at']).toBe(NOW.toISOString());
    expect((await read(unrelated.id))?.['consent-withdrawn-at']).toBeUndefined();
    // A second withdrawal keeps the first time.
    expect(
      await markShareCopiesConsentWithdrawn(
        database.db,
        environmentId,
        token,
        new Date(NOW.getTime() + DAY),
      ),
    ).toBe(0);
    expect((await read(clone.id))?.['consent-withdrawn-at']).toBe(NOW.toISOString());
  });
});

describe('the retention of ended share tokens (C241.4)', () => {
  it('deletes expired and failed tokens 30 days after they ended, and a redeemed one once both sides are gone', async () => {
    const seeded = await seed();
    const source = seeded.source.environment.id;
    const destination = seeded.destination.environment.id;
    const { inquiry: kept } = await createTestInquiry(database.db, source);
    const { inquiry: gone } = await createTestInquiry(database.db, source);
    const { inquiry: copy } = await createTestInquiry(database.db, destination);
    const { inquiry: goneCopy } = await createTestInquiry(database.db, destination);
    await database.client.query('update inquiries set redacted_at = $2 where id = any($1)', [
      [gone.id, goneCopy.id],
      NOW,
    ]);
    const ended = new Date(NOW.getTime() - 31 * DAY);
    const recent = new Date(NOW.getTime() - 29 * DAY);
    const token = async (
      status: string,
      options: { at?: Date; sourceId?: string; destinationId?: string | null },
    ) => {
      const record = await createConsentRecord(database.db, source, flowRecord(seeded));
      const id = testId('cnst');
      await database.client.query(
        `insert into connect_share_tokens (environment_id, id, connection_id, policy_id,
           environment_kind, destination_environment_id, source_type, source_id, consent_record_id,
           data_categories, status, creator_type, creator_id, expires_at, expired_at, expiry_reason,
           failed_at, failure_reason, pending_at, redeemed_at, redeem_mode, destination_type,
           destination_id)
         values ($1, $2, $3, $4, 'sandbox', $5, 'inquiry', $6, $7, '{identity-fields}', $8,
           'api-key', $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, $18)`,
        [
          source,
          id,
          seeded.connectionId,
          seeded.policyId,
          destination,
          options.sourceId ?? testId('inq'),
          record.id,
          status,
          testId('key'),
          NOW,
          status === 'expired' ? options.at : null,
          status === 'expired' ? 'time' : null,
          status === 'failed' ? options.at : null,
          status === 'failed' ? 'import_failed' : null,
          status === 'redeemed' ? (options.at ?? ended) : null,
          status === 'redeemed' ? 'clone' : null,
          status === 'redeemed' ? 'inquiry' : null,
          status === 'redeemed' ? (options.destinationId ?? null) : null,
        ],
      );
      return id;
    };
    const oldExpired = await token('expired', { at: ended });
    const newExpired = await token('expired', { at: recent });
    const oldFailed = await token('failed', { at: ended });
    const bothGone = await token('redeemed', { sourceId: gone.id, destinationId: goneCopy.id });
    const sourceLeft = await token('redeemed', { sourceId: kept.id, destinationId: goneCopy.id });
    const copyLeft = await token('redeemed', { sourceId: gone.id, destinationId: copy.id });
    const created = await token('created', {});

    expect(await deleteEndedShareTokens(database.db, NOW, 100)).toBe(3);
    const left = await database.client.query<{ id: string }>(
      'select id from connect_share_tokens where id = any($1)',
      [[oldExpired, newExpired, oldFailed, bothGone, sourceLeft, copyLeft, created]],
    );
    expect(left.rows.map(({ id }) => id).sort()).toEqual(
      [newExpired, sourceLeft, copyLeft, created].sort(),
    );
  });
});
