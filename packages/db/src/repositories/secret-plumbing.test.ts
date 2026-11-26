/**
 * Workflow 8A Stage 1b, checkpoint (X) (plan C125.1, C143.5): what `foundation-8a` builds of the
 * secrets.
 *
 * - both sealed columns are listed for the rewrap, under their seal names, and `kek:rewrap` re-wraps
 *   each, so the new KEK alone opens them and the row-bound AAD still holds;
 * - a ciphertext moved to another row does not open.
 *
 * Every value is a synthetic canary.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { openValue, sealValue, type Sealed } from '../sealed.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { REWRAP_TABLES, rewrapAll } from './key-rotation.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const oldKeyring = createKeyring(oldKek);
const CURRENT = 'canary-secret-current';
const PREVIOUS = 'canary-secret-previous';
const VALUE_COLUMN = 'workflow_secret_values.value';
const PREVIOUS_COLUMN = 'workflow_secret_values.previous_value';
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase({ keyring: oldKeyring });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

async function seedValue(): Promise<{ id: string; environmentId: string; secretId: string }> {
  const { organization, environment } = await createTestTenant(database.db);
  const secretId = testId('wsec');
  const id = testId('wsecv');
  await query(
    `insert into workflow_secrets (id, organization_id, key, allowed_hosts, created_by)
     values ($1, $2, 'crm_token', '{api.example.com}', $3)`,
    [secretId, organization.id, testId('usr')],
  );
  await query(
    `insert into workflow_secret_values (id, organization_id, secret_id, environment_id, value, last4,
       previous_value, previous_expires_at)
     values ($1, $2, $3, $4, $5, 'rent', $6, now())`,
    [
      id,
      organization.id,
      secretId,
      environment.id,
      sealValue(VALUE_COLUMN, id, CURRENT),
      sealValue(PREVIOUS_COLUMN, id, PREVIOUS),
    ],
  );
  return { id, environmentId: environment.id, secretId };
}

async function storedValues(id: string): Promise<{ value: Sealed; previous_value: Sealed }> {
  const { rows } = await query<{ value: Sealed; previous_value: Sealed }>(
    `select value, previous_value from workflow_secret_values where id = $1`,
    [id],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new Error('the seeded value is gone');
  }
  return row;
}

describe('C143.5: the sealed secret columns', () => {
  it('are listed for the rewrap, under their seal names', () => {
    expect(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}:${c.aad}`)).toEqual(
      expect.arrayContaining([`${VALUE_COLUMN}:row`, `${PREVIOUS_COLUMN}:row`]),
    );
    expect(REWRAP_TABLES).toContain('workflow_secret_values');
    expect(SEALED).toMatchObject({
      workflowSecretValue: VALUE_COLUMN,
      workflowSecretPreviousValue: PREVIOUS_COLUMN,
    });
  });

  it('are re-wrapped by kek:rewrap, so the new KEK alone opens them', async () => {
    const { id } = await seedValue();
    const rotating = createKeyring(newKek, [oldKek]);

    await rewrapAll(database.db, { keyring: rotating });

    const onlyNew = createKeyring(newKek);
    const row = await storedValues(id);
    expect(openValue(VALUE_COLUMN, id, row.value, onlyNew)).toBe(CURRENT);
    expect(openValue(PREVIOUS_COLUMN, id, row.previous_value, onlyNew)).toBe(PREVIOUS);
  });

  it('do not open from another row', async () => {
    const first = await seedValue();
    const second = await seedValue();
    const { value } = await storedValues(first.id);

    expect(openValue(VALUE_COLUMN, first.id, value)).toBe(CURRENT);
    expect(() => openValue(VALUE_COLUMN, second.id, value)).toThrow();
  });
});
