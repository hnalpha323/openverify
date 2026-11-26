/**
 * Migration 0035 (Workflow 11A, `0035_phase11_connect`), upgrading a database at 0034 on PGlite: the
 * Workflow's one migration, which `contracts-11a` starts with `organizations.connect_inbound`
 * (C231.10; decision 71: an organisation receives connections only after its admin turns it on) and
 * `foundation-11a` extends per checkpoint, each checkpoint with its own describe. Every value is
 * synthetic.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  PGLITE_EXTENSIONS,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  testId,
} from './testing.js';

let upgraded: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let earlierOrganizationId: string;
/** (C): two tenants written on 0034, which the Connect tables reference after the upgrade. */
let earlier: { source: string; sourceEnv: string; destination: string; destinationEnv: string };
/** (R): an inquiry and a verification written on 0034. */
let earlierInquiryId: string;
let earlierVerificationId: string;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
  db = drizzle({ client: upgraded, schema });
  await runMigrations(db, { upTo: '0034_phase10c' });
  // Written in SQL: the drizzle schema already names the new column, which 0034 does not have.
  earlierOrganizationId = testId('org');
  await upgraded.query(`insert into organizations (id, name) values ($1, 'Example Test Org')`, [
    earlierOrganizationId,
  ]);
  const source = await createTestTenant(db, { organizationName: 'Example Source' });
  const destination = await createTestTenant(db, { organizationName: 'Example Partner' });
  earlier = {
    source: source.organization.id,
    sourceEnv: source.environment.id,
    destination: destination.organization.id,
    destinationEnv: destination.environment.id,
  };
  const { inquiry } = await createTestInquiryOnEarlierSchema(db, source.environment.id);
  earlierInquiryId = inquiry.id;
  earlierVerificationId = (
    await createTestVerificationOnEarlierSchema(db, source.environment.id, {
      inquiryId: inquiry.id,
      type: 'government_id',
    })
  ).id;
  await runMigrations(db);
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await upgraded.close();
});

describe('migration 0035: applies on top of 0034 (Workflow 11A)', () => {
  it('is the migration after 0034_phase10c', () => {
    const tags = migrationTags();
    expect(tags.indexOf('0035_phase11_connect')).toBe(tags.indexOf('0034_phase10c') + 1);
  });
});

describe('migration 0035: organizations.connect_inbound (C231.10)', () => {
  it('leaves every earlier organisation closed to inbound connections', async () => {
    const rows = await upgraded.query<{ connect_inbound: boolean }>(
      'select connect_inbound from organizations where id = $1',
      [earlierOrganizationId],
    );
    expect(rows.rows).toEqual([{ connect_inbound: false }]);
  });

  it('defaults a new organisation to off, never null', async () => {
    const rows = await upgraded.query<{ column_default: string; is_nullable: string }>(
      `select column_default, is_nullable from information_schema.columns
         where table_name = 'organizations' and column_name = 'connect_inbound'`,
    );
    expect(rows.rows).toEqual([{ column_default: 'false', is_nullable: 'NO' }]);
  });
});

describe('migration 0035: the Connect tables (C230.5; foundation-11a checkpoint C)', () => {
  it('adds the three tables empty, and connects organisations written before it', async () => {
    for (const table of [
      'connect_connections',
      'connect_share_policies',
      'connect_share_tokens',
      'consent_records',
      'consent_texts',
    ]) {
      const rows = await upgraded.query<{ count: string }>(
        `select count(*)::text as count from ${table}`,
      );
      expect(rows.rows).toEqual([{ count: '0' }]);
    }
    const connectionId = testId('cxn');
    const policyId = testId('cxnp');
    await upgraded.query(
      `insert into connect_connections (id, source_organization_id, destination_organization_id,
         status, creator_type, creator_id) values ($1, $2, $3, 'pending', 'api-key', $4)`,
      [connectionId, earlier.source, earlier.destination, testId('key')],
    );
    await upgraded.query(
      `insert into connect_share_policies (id, connection_id, version, body, created_by_type, created_by_id)
       values ($1, $2, 1, '{}'::jsonb, 'api-key', $3)`,
      [policyId, connectionId, testId('key')],
    );
    // (K): a token cites a consent record of its own environment.
    const consentRecordId = testId('cnsr');
    await upgraded.query(
      `insert into consent_records (environment_id, id, side, outcome, purpose, subject_type,
         subject_id, connection_id, recipient_organization_id, recipient_name, data_categories,
         text_sha256, method, session_id, accepted_at, expires_at)
       values ($1, $2, 'source', 'accepted', 'share.reuse-kyc', 'account', $3, $4, $5,
         'Example Partner', '{contact-fields}', $6, 'flow', $7, now(), now() + interval '1 day')`,
      [
        earlier.sourceEnv,
        consentRecordId,
        testId('acc'),
        connectionId,
        earlier.destination,
        'c'.repeat(64),
        testId('iqse'),
      ],
    );
    await upgraded.query(
      `insert into connect_share_tokens (environment_id, id, connection_id, policy_id,
         environment_kind, destination_environment_id, source_type, source_id, consent_record_id,
         data_categories, status, creator_type, creator_id, expires_at)
       values ($1, $2, $3, $4, 'sandbox', $5, 'account', $6, $7, '{contact-fields}', 'created',
         'user', $8, now() + interval '1 day')`,
      [
        earlier.sourceEnv,
        testId('cnst'),
        connectionId,
        policyId,
        earlier.destinationEnv,
        testId('acc'),
        consentRecordId,
        testId('usr'),
      ],
    );
    const tokens = await upgraded.query<{ status: string; peek_count: number }>(
      'select status, peek_count from connect_share_tokens where connection_id = $1',
      [connectionId],
    );
    expect(tokens.rows).toEqual([{ status: 'created', peek_count: 0 }]);
  });
});

describe('migration 0035: provenance and reliance (C230.5; foundation-11a checkpoint R)', () => {
  it('leaves every row written before it as no copy', async () => {
    const inquiry = await upgraded.query<{ provenance: unknown; hydrated_fields: unknown }>(
      'select provenance, hydrated_fields from inquiries where id = $1',
      [earlierInquiryId],
    );
    expect(inquiry.rows).toEqual([{ provenance: null, hydrated_fields: null }]);
    const verification = await upgraded.query<{ provenance: unknown }>(
      'select provenance from verifications where id = $1',
      [earlierVerificationId],
    );
    expect(verification.rows).toEqual([{ provenance: null }]);
  });

  it('defaults a decision to relying on no clone', async () => {
    const rows = await upgraded.query<{ column_name: string; column_default: string | null }>(
      `select column_name, column_default from information_schema.columns
        where table_name = 'inquiry_decisions' and column_name in ('relied_on_cloned', 'share_token_id')
        order by column_name`,
    );
    expect(rows.rows).toEqual([
      { column_name: 'relied_on_cloned', column_default: 'false' },
      { column_name: 'share_token_id', column_default: null },
    ]);
  });
});
