/**
 * Workflow 11A Stage 1b: what `foundation-11a` builds in the database (migration
 * `0035_phase11_connect`, the Workflow's one).
 *
 * Checkpoint (C), C230.5: `connect_connections` (organisation-scoped, one per ordered pair, a
 * self-connection allowed, the sealed `agreement_reference` bound to its row),
 * `connect_share_policies` (versions per connection, unique) and `connect_share_tokens` (scoped to
 * the source environment, the categories fixed at creation, one consent record per token, the
 * inbound-list index and the partial expiry index). The sealed column joins `ENCRYPTED_COLUMNS` and
 * the KEK rewrap. The repositories are stubs until `api-connect` builds them; their cross-environment
 * functions live in separate `*.cross-env.ts` modules, served only from `@openverify/db/cross-env`
 * (C240.5, V04), never from the package's entry.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { ENCRYPTED_COLUMNS } from './encrypted-columns.js';
import * as entry from './index.js';
import { REWRAP_TABLES, rewrapTableBatch, type RewrapTable } from './repositories/key-rotation.js';
import { openValue, sealValue, type Sealed } from './sealed.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from './testing.js';

let database: TestDatabase;
const baseKek = randomBytes(32);

beforeAll(async () => {
  database = await createTestDatabase({ keyring: createKeyring(baseKek) });
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await database.close();
});

const AGREEMENT = 'connect_connections.agreement_reference';

const refused = async (text: string, params: unknown[]) =>
  database.client.query(text, params).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

async function twoOrganizations() {
  const source = await createTestTenant(database.db, { organizationName: 'Example Source' });
  const destination = await createTestTenant(database.db, { organizationName: 'Example Partner' });
  return { source, destination };
}

/** A connection row with its policy version 1, as `api-connect`'s create writes them. */
async function insertConnection(sourceOrg: string, destinationOrg: string) {
  const id = testId('cxn');
  const policyId = testId('cxnp');
  await database.client.query(
    `insert into connect_connections (id, source_organization_id, destination_organization_id,
       status, creator_type, creator_id)
     values ($1, $2, $3, 'pending', 'api-key', $4)`,
    [id, sourceOrg, destinationOrg, testId('key')],
  );
  await database.client.query(
    `insert into connect_share_policies (id, connection_id, version, body, created_by_type, created_by_id)
     values ($1, $2, 1, '{"purpose":"share.reuse-kyc"}'::jsonb, 'api-key', $3)`,
    [policyId, id, testId('key')],
  );
  await database.client.query(
    'update connect_connections set current_policy_id = $2 where id = $1',
    [id, policyId],
  );
  return { id, policyId };
}

async function insertToken(
  seeded: Awaited<ReturnType<typeof twoOrganizations>>,
  connection: { id: string; policyId: string },
  options: { consentRecordId?: string; categories?: string; status?: string } = {},
) {
  const id = testId('cnst');
  const result = await refused(
    `insert into connect_share_tokens (environment_id, id, connection_id, policy_id, environment_kind,
       destination_environment_id, source_type, source_id, consent_record_id, data_categories,
       explicit_biometric, status, creator_type, creator_id, expires_at)
     values ($1, $2, $3, $4, 'sandbox', $5, 'inquiry', $6, $7, $8::text[], false, $9, 'api-key', $10,
       now() + interval '14 days')`,
    [
      seeded.source.environment.id,
      id,
      connection.id,
      connection.policyId,
      seeded.destination.environment.id,
      testId('inq'),
      options.consentRecordId ?? (await insertConsentRecord(seeded, connection.id)).id,
      options.categories ?? '{identity-fields,check-results}',
      options.status ?? 'created',
      testId('key'),
    ],
  );
  return { id, result };
}

describe('connect_connections (C230.5, C231)', () => {
  it('keeps one connection per ordered pair of organisations, a self-connection included', async () => {
    const { source, destination } = await twoOrganizations();
    await insertConnection(source.organization.id, destination.organization.id);

    expect(
      await refused(
        `insert into connect_connections (id, source_organization_id, destination_organization_id,
           status, creator_type, creator_id) values ($1, $2, $3, 'pending', 'user', $4)`,
        [testId('cxn'), source.organization.id, destination.organization.id, testId('usr')],
      ),
    ).toContain('connect_connections_source_destination_key');
    // The reverse direction is its own connection, and so is a self-connection (C230.2).
    await insertConnection(destination.organization.id, source.organization.id);
    await insertConnection(source.organization.id, source.organization.id);
  });

  it('holds its status, creator and deactivation to their closed lists', async () => {
    const { source, destination } = await twoOrganizations();
    const { id } = await insertConnection(source.organization.id, destination.organization.id);

    expect(
      await refused(`update connect_connections set status = 'ready' where id = $1`, [id]),
    ).toContain('connect_connections_status_valid');
    expect(
      await refused(`update connect_connections set creator_type = 'workflow' where id = $1`, [id]),
    ).toContain('connect_connections_creator_type_valid');
    expect(
      await refused(
        `update connect_connections set status = 'inactive', deactivated_at = now() where id = $1`,
        [id],
      ),
    ).toContain('connect_connections_deactivated');
    expect(
      await refused(
        `update connect_connections set status = 'inactive', deactivated_at = now(),
           deactivated_by = 'destination' where id = $1`,
        [id],
      ),
    ).toBe('accepted');
    expect(
      await refused(`update connect_connections set id = 'cnst_01M5CN0000000000000011A200'`, []),
    ).toContain('connect_connections_id_format');
  });

  it('seals the agreement reference for its row, in ENCRYPTED_COLUMNS and the KEK rewrap', async () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'connect_connections',
      column: 'agreement_reference',
      aad: 'row',
    });
    expect(REWRAP_TABLES).toContain('connect_connections');

    const { source, destination } = await twoOrganizations();
    const { id } = await insertConnection(source.organization.id, destination.organization.id);
    const sealed = sealValue(AGREEMENT, id, 'Example data-sharing agreement 2026-11 (synthetic)');
    await database.client.query(
      'update connect_connections set agreement_reference = $2 where id = $1',
      [id, sealed],
    );
    const stored = await database.client.query<{ agreement_reference: string }>(
      'select agreement_reference from connect_connections where id = $1',
      [id],
    );
    const value = stored.rows[0]?.agreement_reference ?? '';
    expect(value).not.toContain('agreement');
    expect(openValue(AGREEMENT, id, value as Sealed)).toContain('(synthetic)');
    expect(() => openValue(AGREEMENT, testId('cxn'), value as Sealed)).toThrow();

    const rotated = createKeyring(randomBytes(32), [baseKek]);
    let after: string | null = null;
    let rewrapped = 0;
    do {
      const batch = await rewrapTableBatch(
        database.db,
        'connect_connections' as string as RewrapTable,
        {
          keyring: rotated,
          after,
        },
      );
      rewrapped += batch.rewrapped;
      after = batch.next;
    } while (after !== null);
    expect(rewrapped).toBeGreaterThanOrEqual(1);
    const again = await database.client.query<{ agreement_reference: string }>(
      'select agreement_reference from connect_connections where id = $1',
      [id],
    );
    expect(
      openValue(AGREEMENT, id, (again.rows[0]?.agreement_reference ?? '') as Sealed, rotated),
    ).toContain('(synthetic)');
  });
});

describe('connect_share_policies (C230.3, C231.6)', () => {
  it('numbers each connection’s versions from 1, once each', async () => {
    const { source, destination } = await twoOrganizations();
    const { id } = await insertConnection(source.organization.id, destination.organization.id);

    expect(
      await refused(
        `insert into connect_share_policies (id, connection_id, version, body, created_by_type, created_by_id)
         values ($1, $2, 1, '{}'::jsonb, 'user', $3)`,
        [testId('cxnp'), id, testId('usr')],
      ),
    ).toContain('connect_share_policies_connection_id_version_key');
    expect(
      await refused(
        `insert into connect_share_policies (id, connection_id, version, body, created_by_type, created_by_id)
         values ($1, $2, 0, '{}'::jsonb, 'user', $3)`,
        [testId('cxnp'), id, testId('usr')],
      ),
    ).toContain('connect_share_policies_version_positive');
  });

  it('lets a connection name only a policy of its own as current or accepted', async () => {
    const one = await twoOrganizations();
    const two = await twoOrganizations();
    const first = await insertConnection(
      one.source.organization.id,
      one.destination.organization.id,
    );
    const second = await insertConnection(
      two.source.organization.id,
      two.destination.organization.id,
    );

    expect(
      await refused('update connect_connections set accepted_policy_id = $2 where id = $1', [
        first.id,
        second.policyId,
      ]),
    ).toContain('connect_connections_accepted_policy_fk');
  });
});

describe('connect_share_tokens (C230.5, C232)', () => {
  it('stores the categories fixed at creation, from the closed list only', async () => {
    const seeded = await twoOrganizations();
    const connection = await insertConnection(
      seeded.source.organization.id,
      seeded.destination.organization.id,
    );

    expect((await insertToken(seeded, connection)).result).toBe('accepted');
    expect(
      (await insertToken(seeded, connection, { categories: '{identity-fields,face-templates}' }))
        .result,
    ).toContain('connect_share_tokens_data_categories_valid');
  });

  it('lets one consent record authorise one token (C232.1)', async () => {
    const seeded = await twoOrganizations();
    const connection = await insertConnection(
      seeded.source.organization.id,
      seeded.destination.organization.id,
    );
    const consentRecordId = (await insertConsentRecord(seeded, connection.id)).id;

    expect((await insertToken(seeded, connection, { consentRecordId })).result).toBe('accepted');
    expect((await insertToken(seeded, connection, { consentRecordId })).result).toContain(
      'connect_share_tokens_consent_record_id_key',
    );
  });

  it('keeps each final status with its time and reason', async () => {
    const seeded = await twoOrganizations();
    const connection = await insertConnection(
      seeded.source.organization.id,
      seeded.destination.organization.id,
    );
    const { id } = await insertToken(seeded, connection);

    expect(
      await refused(`update connect_share_tokens set status = 'ready' where id = $1`, [id]),
    ).toContain('connect_share_tokens_status_valid');
    expect(
      await refused(`update connect_share_tokens set status = 'expired' where id = $1`, [id]),
    ).toContain('connect_share_tokens_expired');
    expect(
      await refused(
        `update connect_share_tokens set status = 'expired', expired_at = now(),
           expiry_reason = 'source_expired' where id = $1`,
        [id],
      ),
    ).toBe('accepted');
    expect(
      await refused(
        `update connect_share_tokens set status = 'failed', failed_at = now(),
           failure_reason = 'gone' where id = $1`,
        [(await insertToken(seeded, connection)).id],
      ),
    ).toContain('connect_share_tokens_failure_reason_valid');
  });

  it('indexes inbound lists by destination and the expiry sweep by created tokens only', async () => {
    const indexes = await database.client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where tablename = 'connect_share_tokens'`,
    );
    const byName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    expect(byName.get('connect_share_tokens_inbound_idx')).toMatch(
      /\(destination_environment_id, status, created_at, id\)/,
    );
    expect(byName.get('connect_share_tokens_expires_at_created_idx')).toMatch(
      /\(expires_at\) WHERE \(status = 'created'/,
    );
  });
});

describe('the Connect repositories (C240.5, V04)', () => {
  it('keeps every cross-environment function out of the package entry', () => {
    const names = Object.keys(entry);
    expect(names.filter((name) => /crossEnv|CrossEnv/.test(name))).toEqual([]);
  });

  it('serves the cross-environment functions from their own entry point only', async () => {
    const crossEnvEntry = './cross-env.js';
    const module = (await import(/* @vite-ignore */ crossEnvEntry)) as Record<string, unknown>;
    expect(Object.keys(module).sort()).toEqual(
      [
        'connectConnectionsCrossEnv',
        'connectSharePoliciesCrossEnv',
        'connectShareTokensCrossEnv',
        // (K): the consent records' twin.
        'consentRecordsCrossEnv',
      ].sort(),
    );
  });

  // Workflow 11A api-connect built them (its API tests hold what they do).
  it('declares the own-environment functions on the entry', () => {
    const own = entry as unknown as Record<string, unknown>;
    for (const name of ['createConnection', 'createSharePolicyVersion', 'createShareToken']) {
      expect(typeof own[name]).toBe('function');
    }
  });
});

// Checkpoint (R), C230.5 (review F08): provenance and reliance on the existing tables -------------

describe('provenance and reliance columns (C230.5, C235)', () => {
  const columnsOf = async (table: string) =>
    new Map(
      (
        await database.client.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>(
          `select column_name, data_type, is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = $1`,
          [table],
        )
      ).rows.map((row) => [row.column_name, `${row.data_type} ${row.is_nullable}`]),
    );

  it.each([
    ['inquiries', 'provenance'],
    ['verifications', 'provenance'],
    ['files', 'provenance'],
    // The check rows already hold ADR 0002's `provenance`; Connect's is beside it.
    ['verification_checks', 'connect_provenance'],
    ['accounts', 'hydrated_fields'],
    ['inquiries', 'hydrated_fields'],
    ['transactions', 'hydrated_fields'],
  ])('%s.%s is a nullable jsonb', async (table, column) => {
    expect((await columnsOf(table)).get(column)).toBe('jsonb YES');
  });

  it('records on a decision whether it relied on a clone, and which token', async () => {
    const columns = await columnsOf('inquiry_decisions');
    expect(columns.get('relied_on_cloned')).toBe('boolean NO');
    expect(columns.get('share_token_id')).toBe('text YES');
  });

  it('holds a provenance to the two kinds, and hydrated fields to a list', async () => {
    const checks = await database.client.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conname in ('inquiries_provenance_kind_valid', 'verifications_provenance_kind_valid',
          'files_provenance_kind_valid', 'verification_checks_connect_provenance_kind_valid',
          'accounts_hydrated_fields_list', 'inquiries_hydrated_fields_list',
          'transactions_hydrated_fields_list', 'inquiry_decisions_share_token_id_format',
          'inquiry_decisions_relied_on_cloned_token')`,
    );
    expect(checks.rows.map((row) => row.conname).sort()).toEqual([
      'accounts_hydrated_fields_list',
      'files_provenance_kind_valid',
      'inquiries_hydrated_fields_list',
      'inquiries_provenance_kind_valid',
      'inquiry_decisions_relied_on_cloned_token',
      'inquiry_decisions_share_token_id_format',
      'transactions_hydrated_fields_list',
      'verification_checks_connect_provenance_kind_valid',
      'verifications_provenance_kind_valid',
    ]);
    const kind = checks.rows.find((row) => row.conname === 'verifications_provenance_kind_valid');
    expect(kind?.def).toContain('connect-clone');
    expect(kind?.def).toContain('connect-hydrate');
  });
});

// Checkpoint (K), C230.5, C236: consent records and the texts they cite ---------------------------

const DIGEST = 'a'.repeat(64);

async function insertConsentRecord(
  seeded: Awaited<ReturnType<typeof twoOrganizations>>,
  connectionId: string,
  values: Record<string, unknown> = {},
) {
  const id = testId('cnsr');
  const row: Record<string, unknown> = {
    environment_id: seeded.source.environment.id,
    id,
    side: 'source',
    outcome: 'accepted',
    purpose: 'share.reuse-kyc',
    subject_type: 'inquiry',
    subject_id: testId('inq'),
    connection_id: connectionId,
    recipient_organization_id: seeded.destination.organization.id,
    recipient_name: 'Example Partner',
    data_categories: '{identity-fields}',
    explicit_biometric: false,
    text_locale: 'en',
    text_keys: '{share.consent.source}',
    text_sha256: DIGEST,
    method: 'flow',
    session_id: testId('iqse'),
    accepted_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    ...values,
  };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => '$' + String(index + 1)).join(', ');
  const result = await refused(
    `insert into consent_records (${columns.join(', ')}) values (${placeholders})`,
    Object.values(row),
  );
  return { id, result };
}

describe('consent_records (C230.5, C236)', () => {
  it('keeps a witnessed acceptance, and holds the closed lists of C236', async () => {
    const seeded = await twoOrganizations();
    const { id: connectionId } = await insertConnection(
      seeded.source.organization.id,
      seeded.destination.organization.id,
    );

    expect((await insertConsentRecord(seeded, connectionId)).result).toBe('accepted');
    expect(
      (await insertConsentRecord(seeded, connectionId, { side: 'counterparty' })).result,
    ).toContain('consent_records_side_valid');
    expect((await insertConsentRecord(seeded, connectionId, { method: 'email' })).result).toContain(
      'consent_records_method_valid',
    );
    expect(
      (await insertConsentRecord(seeded, connectionId, { text_sha256: 'not-a-digest' })).result,
    ).toContain('consent_records_text_sha256_hex');
    expect(
      (
        await insertConsentRecord(seeded, connectionId, {
          data_categories: '{identity-fields,face-templates}',
        })
      ).result,
    ).toContain('consent_records_data_categories_valid');
  });

  it('records a decline only from the flow (C236.11), and an attestation with its time and actor', async () => {
    const seeded = await twoOrganizations();
    const { id: connectionId } = await insertConnection(
      seeded.source.organization.id,
      seeded.destination.organization.id,
    );

    expect(
      (await insertConsentRecord(seeded, connectionId, { outcome: 'declined', accepted_at: null }))
        .result,
    ).toBe('accepted');
    expect(
      (
        await insertConsentRecord(seeded, connectionId, {
          outcome: 'declined',
          method: 'attested',
          session_id: null,
          accepted_at: null,
          attested_at: new Date().toISOString(),
          attested_by_type: 'api-key',
          attested_by_id: testId('key'),
        })
      ).result,
    ).toContain('consent_records_declined_in_flow');
    expect(
      (await insertConsentRecord(seeded, connectionId, { method: 'attested', session_id: null }))
        .result,
    ).toContain('consent_records_attested');
    expect(
      (
        await insertConsentRecord(seeded, connectionId, {
          method: 'attested',
          session_id: null,
          attested_at: new Date().toISOString(),
          attested_by_type: 'api-key',
          attested_by_id: testId('key'),
        })
      ).result,
    ).toBe('accepted');
  });

  it('keeps a withdrawal with its channel and reason from the closed lists (C237)', async () => {
    const seeded = await twoOrganizations();
    const { id: connectionId } = await insertConnection(
      seeded.source.organization.id,
      seeded.destination.organization.id,
    );
    const { id } = await insertConsentRecord(seeded, connectionId);

    expect(
      await refused('update consent_records set withdrawn_at = now() where id = $1', [id]),
    ).toContain('consent_records_withdrawn');
    expect(
      await refused(
        `update consent_records set withdrawn_at = now(), withdrawn_via = 'flow',
           withdrawal_reason = 'changed-mind' where id = $1`,
        [id],
      ),
    ).toContain('consent_records_withdrawal_reason_valid');
    expect(
      await refused(
        `update consent_records set withdrawn_at = now(), withdrawn_via = 'operator',
           withdrawal_reason = 'subject-request' where id = $1`,
        [id],
      ),
    ).toBe('accepted');
  });

  it('is what a share token cites, in its own environment (C232.1)', async () => {
    const seeded = await twoOrganizations();
    const connection = await insertConnection(
      seeded.source.organization.id,
      seeded.destination.organization.id,
    );

    expect(
      (await insertToken(seeded, connection, { consentRecordId: testId('cnsr') })).result,
    ).toContain('connect_share_tokens_consent_record_fk');
  });

  it('seals the evidence and an attested text for the row, in ENCRYPTED_COLUMNS and the rewrap', () => {
    for (const column of [
      'attested_text_body',
      'evidence_ip',
      'evidence_user_agent',
      'evidence_reference',
    ]) {
      expect(ENCRYPTED_COLUMNS).toContainEqual({ table: 'consent_records', column, aad: 'row' });
    }
    expect(REWRAP_TABLES).toContain('consent_records');
  });
});

describe('consent_texts (C230.5, C236.3)', () => {
  it('keeps one text per environment and digest, its body sealed for <environment>:<digest> (P11)', async () => {
    const seeded = await twoOrganizations();
    const environmentId = seeded.source.environment.id;
    const rowId = `${environmentId}:${DIGEST}`;
    const body = sealValue('consent_texts.body', rowId, 'Example share consent text (synthetic)');
    const insert = () =>
      refused(
        `insert into consent_texts (environment_id, sha256, locale, body) values ($1, $2, 'en', $3)`,
        [environmentId, DIGEST, body],
      );

    expect(await insert()).toBe('accepted');
    expect(await insert()).toContain('consent_texts_pkey');
    expect(
      await refused(
        `insert into consent_texts (environment_id, sha256, locale, body) values ($1, 'x', 'en', $2)`,
        [environmentId, body],
      ),
    ).toContain('consent_texts_sha256_hex');
    expect(ENCRYPTED_COLUMNS).toContainEqual({
      table: 'consent_texts',
      column: 'body',
      aad: 'row',
    });
    expect(REWRAP_TABLES).toContain('consent_texts');

    const rotated = createKeyring(randomBytes(32), [baseKek]);
    let after: string | null = null;
    let rewrapped = 0;
    do {
      const batch = await rewrapTableBatch(database.db, 'consent_texts' as string as RewrapTable, {
        keyring: rotated,
        after,
      });
      rewrapped += batch.rewrapped;
      after = batch.next;
    } while (after !== null);
    expect(rewrapped).toBeGreaterThanOrEqual(1);
    const stored = await database.client.query<{ body: string }>(
      'select body from consent_texts where environment_id = $1 and sha256 = $2',
      [environmentId, DIGEST],
    );
    expect(
      openValue('consent_texts.body', rowId, (stored.rows[0]?.body ?? '') as Sealed, rotated),
    ).toBe('Example share consent text (synthetic)');
  });

  it('serves the consent repositories from the entry and the cross-environment twin from cross-env', async () => {
    const own = entry as unknown as Record<string, unknown>;
    for (const name of ['createConsentRecord', 'insertConsentTextIfAbsent']) {
      expect(typeof own[name]).toBe('function');
    }
    const crossEnvEntry = './cross-env.js';
    const module = (await import(/* @vite-ignore */ crossEnvEntry)) as Record<string, unknown>;
    expect(Object.keys(module)).toContain('consentRecordsCrossEnv');
  });
});
