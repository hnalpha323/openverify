/**
 * Workflow 7B Stage 1b, checkpoint (T): what `foundation-7b` builds in the transaction repositories
 * (the redaction of C105.5 with `stubEventPayloads` and `forgetStoredResponses`, the C16 reads, and
 * the rows' sealed values), the subject prefixes, and the stubs that reject until their owner builds
 * them. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { SEALED } from '../encrypted-columns.js';
import { openJson, openValue, type Sealed } from '../sealed.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedTransaction,
  seedTransactionFieldKey,
  seedTransactionFile,
  seedTransactionLabel,
  seedTransactionStatus,
  seedTransactionType,
  testId,
  type TestDatabase,
} from '../testing.js';
import { createApiLog } from './api-logs.js';
import { createEvent } from './events.js';
import {
  listRedactedTransactionFiles,
  listTransactionsDueForRetention,
  markTransactionFilesDeleted,
  redactTransactionRecords,
} from './index.js';
import { updateEnvironmentSettings } from './organizations.js';
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

const FIELDS = {
  iban: { type: 'string', value: 'synthetic-iban' },
  amount: { type: 'number', value: 12.5 },
  'ledger-entry': { type: 'string', value: 'synthetic-ledger-entry' },
};

async function seedRows(fields: Readonly<Record<string, unknown>> = FIELDS) {
  const { environment } = await createTestTenant(database.db);
  const environmentId = environment.id;
  const type = await seedTransactionType(database.db, environmentId);
  const transaction = await seedTransaction(database.db, environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
    referenceId: 'synthetic-reference',
    fields,
    tags: ['synthetic'],
  });
  await seedTransactionStatus(database.db, environmentId, {
    transactionId: transaction.id,
    fromStatus: 'created',
    toStatus: 'approved',
  });
  const label = await seedTransactionLabel(database.db, environmentId, {
    transactionId: transaction.id,
  });
  const file = await seedTransactionFile(database.db, environmentId, {
    transactionId: transaction.id,
    filename: 'synthetic-statement.pdf',
  });
  await seedTransactionFieldKey(database.db, environmentId, {
    transactionId: transaction.id,
    fieldKey: 'iban',
  });
  await seedTransactionFieldKey(database.db, environmentId, {
    transactionId: transaction.id,
    fieldKey: 'ledger-entry',
  });
  return { environmentId, type, transactionId: transaction.id, labelId: label.id, file };
}

async function rows<Row>(statement: ReturnType<typeof sql>): Promise<Row[]> {
  return ((await database.db.execute(statement)) as unknown as { rows: Row[] }).rows;
}

const sealedFieldsOf = async (id: string) =>
  (await rows<{ fields: Sealed | null }>(sql`select fields from transactions where id = ${id}`))[0]
    ?.fields;

describe('redactTransactionRecords (C105.5)', () => {
  it('answers null for a transaction of another environment', async () => {
    const { transactionId } = await seedRows();
    const other = await createTestTenant(database.db);

    expect(
      await redactTransactionRecords(database.db, other.environment.id, transactionId),
    ).toBeNull();
  });

  it('nulls the fields, the field keys and the filename, and returns the undeleted files', async () => {
    const { environmentId, transactionId, file } = await seedRows();
    const at = new Date('2026-10-31T10:00:00.000Z');

    const redacted = await redactTransactionRecords(database.db, environmentId, transactionId, {
      at,
    });

    expect(redacted?.alreadyRedacted).toBe(false);
    expect(redacted?.transaction).toMatchObject({
      id: transactionId,
      fields: null,
      redactedAt: at,
    });
    expect(await sealedFieldsOf(transactionId)).toBeNull();
    expect(
      await rows(
        sql`select field_key from transaction_field_keys where transaction_id = ${transactionId}`,
      ),
    ).toEqual([]);
    expect(redacted?.files.map(({ id, filename }) => ({ id, filename }))).toEqual([
      { id: file.id, filename: null },
    ]);
    expect(await rows(sql`select filename from transaction_files where id = ${file.id}`)).toEqual([
      { filename: null },
    ]);
  });

  it('keeps the fields it is told to keep, with their keys, sealed again for the row (P21)', async () => {
    const { environmentId, transactionId } = await seedRows();

    const redacted = await redactTransactionRecords(database.db, environmentId, transactionId, {
      keepFieldKeys: ['ledger-entry'],
    });

    expect(redacted?.transaction.fields).toEqual({ 'ledger-entry': FIELDS['ledger-entry'] });
    const sealed = (await sealedFieldsOf(transactionId)) ?? ('' as Sealed);
    expect(openJson(SEALED.transactionFields, transactionId, sealed)).toEqual({
      'ledger-entry': FIELDS['ledger-entry'],
    });
    expect(
      await rows(
        sql`select field_key from transaction_field_keys where transaction_id = ${transactionId}`,
      ),
    ).toEqual([{ field_key: 'ledger-entry' }]);
  });

  it('lets a later run take a kept field too: the audited override of P21', async () => {
    const { environmentId, transactionId } = await seedRows();
    const first = new Date('2026-10-31T10:00:00.000Z');
    await redactTransactionRecords(database.db, environmentId, transactionId, {
      at: first,
      keepFieldKeys: ['ledger-entry'],
    });

    const again = await redactTransactionRecords(database.db, environmentId, transactionId, {
      at: new Date('2026-11-01T10:00:00.000Z'),
    });

    expect(again?.alreadyRedacted).toBe(true);
    expect(again?.transaction).toMatchObject({ fields: null, redactedAt: first });
    expect(
      await rows(
        sql`select field_key from transaction_field_keys where transaction_id = ${transactionId}`,
      ),
    ).toEqual([]);
  });

  it('nulls the free text of the history and the labels, stamping them', async () => {
    const { environmentId, transactionId, labelId } = await seedRows();
    const at = new Date('2026-10-31T10:00:00.000Z');

    await redactTransactionRecords(database.db, environmentId, transactionId, { at });

    expect(
      await rows(sql`select from_status, to_status, actor_type, redacted_at is not null as stamped
        from transaction_status_history where transaction_id = ${transactionId}`),
    ).toEqual([{ from_status: null, to_status: null, actor_type: 'system', stamped: true }]);
    expect(
      await rows(sql`select label, model_version, score, redacted_at is not null as stamped
        from transaction_labels where id = ${labelId}`),
    ).toEqual([{ label: null, model_version: null, score: 0.5, stamped: true }]);
  });

  it('runs twice without touching what the first run stamped', async () => {
    const { environmentId, transactionId, labelId } = await seedRows();
    const first = new Date('2026-10-31T10:00:00.000Z');
    await redactTransactionRecords(database.db, environmentId, transactionId, { at: first });

    await redactTransactionRecords(database.db, environmentId, transactionId, {
      at: new Date('2026-11-01T10:00:00.000Z'),
    });

    const [label] = await rows<{ redacted_at: Date | string }>(
      sql`select redacted_at from transaction_labels where id = ${labelId}`,
    );
    expect(new Date(label?.redacted_at ?? 0)).toEqual(first);
  });

  it('keeps what is not its own: the reference, status, tags, objects and relations (C105.5)', async () => {
    const { environmentId, transactionId, type } = await seedRows();
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const related = await seedTransaction(database.db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    await database.db.execute(sql`
      insert into transaction_objects (environment_id, transaction_id, inquiry_id)
      values (${environmentId}, ${transactionId}, ${inquiry.id})`);
    await database.db.execute(sql`
      insert into transaction_relations (environment_id, transaction_id, relation_schema_key,
        related_transaction_id)
      values (${environmentId}, ${transactionId}, 'parent', ${related.id})`);

    const redacted = await redactTransactionRecords(database.db, environmentId, transactionId);

    expect(redacted?.transaction).toMatchObject({
      referenceId: 'synthetic-reference',
      status: 'created',
      tags: ['synthetic'],
    });
    expect(
      await rows(sql`select object_id from transaction_objects
        where transaction_id = ${transactionId}`),
    ).toEqual([{ object_id: inquiry.id }]);
    expect(
      await rows(sql`select target_id from transaction_relations
        where transaction_id = ${transactionId}`),
    ).toEqual([{ target_id: related.id }]);
  });

  it('stubs the events and reports how many, for the transaction, its files and labels (P04)', async () => {
    const { environmentId, transactionId, labelId, file } = await seedRows();
    const eventFor = (id: string, objectId: string, objectType: string) =>
      createEvent(database.db, environmentId, {
        id,
        name: 'transaction.created',
        objectType,
        objectId,
        payload: { data: { type: objectType, id: objectId, attributes: { status: 'created' } } },
      });
    const events = [
      await eventFor(`evt_${transactionId.slice(4)}`, transactionId, 'transaction'),
      await eventFor(`evt_${labelId.slice(5)}`, labelId, 'transaction-label'),
      await eventFor(`evt_${file.id.slice(5)}`, file.id, 'transaction-file'),
    ];

    const redacted = await redactTransactionRecords(database.db, environmentId, transactionId);

    expect(redacted?.stubbedEvents).toBe(3);
    for (const event of events) {
      const [stored] = await rows<{ redacted_at: unknown }>(
        sql`select redacted_at from events where id = ${event.id}`,
      );
      expect(stored?.redacted_at, event.id).not.toBeNull();
    }
  });

  it('forgets the stored copies that are about it or mention it (P04)', async () => {
    const { environmentId, transactionId, file } = await seedRows();
    const logged = async (resourceId: string | null, subject: string) =>
      createApiLog(database.db, environmentId, {
        id: testId('alog'),
        method: 'GET',
        path: '/api/v1/transactions',
        route: '/api/v1/transactions',
        status: 200,
        durationMs: 1,
        requestId: 'req_synthetic',
        resourceId,
        ip: '192.0.2.1',
        userAgent: null,
        query: { 'filter[identifier][value]': 'synthetic-iban' },
        requestBody: null,
        responseBody: { data: [{ id: subject }] },
      });
    const about = await logged(transactionId, transactionId);
    const mention = await logged(null, file.id);

    await redactTransactionRecords(database.db, environmentId, transactionId);

    for (const log of [about, mention]) {
      expect(
        await rows(sql`select query, response_body from api_logs where id = ${log.id}`),
      ).toEqual([{ query: null, response_body: null }]);
    }
  });
});

describe('the sealed values', () => {
  it('seals the filename for its row', async () => {
    const { file } = await seedRows();

    const [row] = await rows<{ filename: Sealed }>(
      sql`select filename from transaction_files where id = ${file.id}`,
    );
    const sealed = row?.filename ?? ('' as Sealed);

    expect(openValue(SEALED.transactionFileFilename, file.id, sealed)).toBe(
      'synthetic-statement.pdf',
    );
    expect(() => openValue(SEALED.transactionFileFilename, `${file.id}x`, sealed)).toThrow();
  });
});

describe('the C16 reads', () => {
  it('finds the unredacted transactions past their environment’s window, oldest first', async () => {
    const { environment } = await createTestTenant(database.db);
    await updateEnvironmentSettings(database.db, environment.id, {
      'transaction-retention-days': 30,
    });
    const type = await seedTransactionType(database.db, environment.id);
    const seed = (createdAt: Date) =>
      seedTransaction(database.db, environment.id, {
        transactionTypeId: type.id,
        transactionTypeVersionId: type.versionId,
        createdAt,
      });
    const now = new Date('2026-10-31T00:00:00.000Z');
    const oldest = await seed(new Date('2026-08-01T00:00:00.000Z'));
    const older = await seed(new Date('2026-09-01T00:00:00.000Z'));
    await seed(new Date('2026-10-15T00:00:00.000Z'));
    const redacted = await seed(new Date('2026-07-01T00:00:00.000Z'));
    await redactTransactionRecords(database.db, environment.id, redacted.id);

    const due = await listTransactionsDueForRetention(database.db, { now });

    expect(due.filter((row) => row.environmentId === environment.id)).toEqual([
      { id: oldest.id, environmentId: environment.id },
      { id: older.id, environmentId: environment.id },
    ]);
  });

  it('keeps every transaction of an environment that sets no window', async () => {
    const { environment } = await createTestTenant(database.db);
    const type = await seedTransactionType(database.db, environment.id);
    await seedTransaction(database.db, environment.id, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    const due = await listTransactionsDueForRetention(database.db);

    expect(due.filter((row) => row.environmentId === environment.id)).toEqual([]);
  });

  it('lists a redacted transaction’s files until their objects are marked deleted', async () => {
    const { environmentId, transactionId, file } = await seedRows();
    const others = await seedRows();
    const mine = async () =>
      (await listRedactedTransactionFiles(database.db, { limit: 1000 })).filter(
        (row) => row.environmentId === environmentId,
      );

    expect(await mine()).toEqual([]);
    await redactTransactionRecords(database.db, environmentId, transactionId);
    expect(await mine()).toEqual([{ id: file.id, environmentId, storageKey: file.storageKey }]);

    await markTransactionFilesDeleted(database.db, environmentId, [file.id], new Date());
    await markTransactionFilesDeleted(database.db, environmentId, [], new Date());

    expect(await mine()).toEqual([]);
    const left = await listRedactedTransactionFiles(database.db, { limit: 1000 });
    expect(left.map((row) => row.id)).not.toContain(others.file.id);
  });

  it('marks a file deleted only in its own environment, and keeps the first time', async () => {
    const { environmentId, transactionId, file } = await seedRows();
    const other = await createTestTenant(database.db);
    await redactTransactionRecords(database.db, environmentId, transactionId);

    await markTransactionFilesDeleted(database.db, other.environment.id, [file.id], new Date());
    expect(await rows(sql`select deleted_at from transaction_files where id = ${file.id}`)).toEqual(
      [{ deleted_at: null }],
    );

    const first = new Date('2026-10-31T10:00:00.000Z');
    await markTransactionFilesDeleted(database.db, environmentId, [file.id], first);
    await markTransactionFilesDeleted(database.db, environmentId, [file.id], new Date());
    const [row] = await rows<{ deleted_at: Date | string }>(
      sql`select deleted_at from transaction_files where id = ${file.id}`,
    );
    expect(new Date(row?.deleted_at ?? 0)).toEqual(first);
  });
});

describe('the redaction subjects (C107.5)', () => {
  it.each(['txn', 'txnf', 'txnl'])('finds %s ids', (prefix) => {
    const id = `${prefix}_01M5CK16P0D13FXHZSS4TCFBVH`;
    expect(subjectIdsIn({ data: { id } })).toEqual([id]);
  });

  it.each(['txntp', 'txntpv'])('leaves %s ids out: configuration, not a subject', (prefix) => {
    expect(subjectIdsIn({ id: `${prefix}_01M5CK16P0D13FXHZSS4TCFBVH` })).toEqual([]);
  });
});
