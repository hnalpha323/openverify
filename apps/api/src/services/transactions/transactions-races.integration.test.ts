/**
 * Workflow 7B Stage 3 (`api-transactions`; C104.1, C105.2, C111.3) against Postgres 17 row locks
 * (Testcontainers, started without bind-parameter logging): two writers at once.
 * - Two first writes of a `write_once` field with different values: the row lock serializes them,
 *   the second reads the first's value and answers 409 `field_write_once`.
 * - Two publishes of two drafts of one type: the type lock serializes them, so the type ends with
 *   exactly one published version and the other superseded.
 * - Two status moves: each is recorded once, in the order the locks granted, and the row holds the
 *   last.
 * Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createKeyring,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, createTestTenant, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { TransactionProblemError } from '../../errors.js';
import {
  createRecordingAuditLogger,
  createRecordingEventPublisher,
} from '../../test-support/fakes.js';
import { ulidIdGenerator } from '../../ports.js';
import type { ApiDependencies } from '../context.js';
import { createTransaction, updateTransaction } from './transactions.js';
import { createTransactionType } from './types.js';
import { createTransactionTypeVersion, publishTransactionTypeVersion } from './versions.js';

const keyring = createKeyring(randomBytes(32));
const NOW = new Date('2026-11-01T12:00:00.000Z');

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let organizationId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 8 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const deps = () =>
  ({
    db,
    keyring,
    blindIndexKey: new Uint8Array(32).fill(5),
    events: createRecordingEventPublisher(),
    audit: createRecordingAuditLogger(),
    clock: { now: () => NOW },
    ids: ulidIdGenerator,
  }) as unknown as ApiDependencies;

const acting = () => ({
  ctx: { organizationId, environmentId },
  mask: UNMASKED,
  actor: { type: 'api-key' as const, id: `key_${'0'.repeat(26)}` },
});

const FIELDS = [
  {
    type: 'string',
    key: 'ledger',
    label: 'Ledger',
    config: { 'write-policy': 'write_once' as const },
  },
];

async function publishedType() {
  const type = await createTransactionType(deps(), acting(), {
    name: 'Synthetic payout',
    'field-schemas': FIELDS,
  });
  const result = await db.execute(
    sql`select id from transaction_type_versions where transaction_type_id = ${type.data.id}`,
  );
  const versionId = (result as unknown as { rows: { id: string }[] }).rows[0]?.id ?? '';
  await publishTransactionTypeVersion(deps(), acting(), versionId);
  return type.data.id;
}

describe('two writers (C105.2, C111.3)', () => {
  it('let one write a write_once field, and answer the other 409', async () => {
    const typeId = await publishedType();
    const transaction = await createTransaction(deps(), acting(), {
      'transaction-type-id': typeId,
    });
    const write = (value: string) =>
      updateTransaction(deps(), acting(), transaction.data.id, { fields: { ledger: value } });

    const outcomes = await Promise.allSettled([write('synthetic-one'), write('synthetic-two')]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    expect(refused?.reason).toBeInstanceOf(TransactionProblemError);
    expect((refused?.reason as TransactionProblemError).code).toBe('field_write_once');
  });

  it('record two status moves once each, the row holding the last granted', async () => {
    const typeId = await publishedType();
    const transaction = await createTransaction(deps(), acting(), {
      'transaction-type-id': typeId,
    });
    const move = (status: string) =>
      updateTransaction(deps(), acting(), transaction.data.id, { status });

    await Promise.all([move('approved'), move('declined')]);

    const history = await db.execute(
      sql`select from_status, to_status from transaction_status_history
          where transaction_id = ${transaction.data.id} order by id`,
    );
    const rows = (
      history as unknown as { rows: { from_status: string | null; to_status: string }[] }
    ).rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ from_status: null, to_status: 'created' });
    expect(rows[2]?.from_status).toBe(rows[1]?.to_status);
    const current = await db.execute(
      sql`select status from transactions where id = ${transaction.data.id}`,
    );
    expect((current as unknown as { rows: { status: string }[] }).rows[0]?.status).toBe(
      rows[2]?.to_status,
    );
  });
});

describe('two publishes of one type (C104.1)', () => {
  it('leave exactly one published version', async () => {
    const typeId = await publishedType();
    const first = await createTransactionTypeVersion(deps(), acting(), {
      'transaction-type-id': typeId,
    });
    const second = await createTransactionTypeVersion(deps(), acting(), {
      'transaction-type-id': typeId,
    });

    await Promise.all([
      publishTransactionTypeVersion(deps(), acting(), first.data.id),
      publishTransactionTypeVersion(deps(), acting(), second.data.id),
    ]);

    const versions = await db.execute(
      sql`select status from transaction_type_versions where transaction_type_id = ${typeId}`,
    );
    const statuses = (versions as unknown as { rows: { status: string }[] }).rows.map(
      (row) => row.status,
    );
    expect(statuses.filter((status) => status === 'published')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'superseded')).toHaveLength(2);
  });
});
