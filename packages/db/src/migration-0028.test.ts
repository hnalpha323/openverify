/**
 * Migration 0028 (Workflow 8B), upgrading a database at 0027 on PGlite. The migrator runs a batch in
 * one transaction, so this upgrade is what proves each change: a fresh database passes whatever a
 * check says. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  PGLITE_EXTENSIONS,
  seedCase,
  seedCaseTemplate,
  seedWorkflowRun,
  testId,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
let client: PGlite;
let runId: string;
let environmentId: string;
let inquiryId: string;
let keyId: string;
const db = () => drizzle({ client, schema });

beforeAll(async () => {
  setDefaultKeyring(keyring);
  client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await runMigrations(db(), { upTo: '0027_phase8a' });
  const { environment } = await createTestTenant(db());
  environmentId = environment.id;
  ({ id: runId } = await seedWorkflowRun(db(), environment.id));
  ({
    inquiry: { id: inquiryId },
  } = await createTestInquiryOnEarlierSchema(db(), environment.id));
  keyId = testId('key');
  await client.query(
    `insert into api_keys (id, environment_id, name, prefix, secret_hash)
     values ($1, $2, 'Before 0028', 'ov_sbx_', $3)`,
    [keyId, environmentId, randomBytes(32).toString('hex')],
  );
  await client.query(
    `update workflow_runs set creator_type = 'account-action', creator_id = $1 where id = $2`,
    [testId('accac'), runId],
  );
  await runMigrations(db());
}, 120_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await client.close();
});

describe('migration 0028: a run a case action started (C120.1, C140.1)', () => {
  const setCreator = (type: string, id: string) =>
    client.query(`update workflow_runs set creator_type = $1, creator_id = $2 where id = $3`, [
      type,
      id,
      runId,
    ]);

  it('applies on top of 0027 in one batch, keeping the rows', async () => {
    const applied = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    const runs = await client.query<{ creator_type: string }>(
      'select creator_type from workflow_runs',
    );

    expect(applied.rows[0]?.count).toBe(migrationTags().length);
    expect(runs.rows).toEqual([{ creator_type: 'account-action' }]);
  });

  it('takes case-action as a creator, with a cact_ id', async () => {
    await expect(setCreator('case-action', testId('cact'))).resolves.toBeDefined();
  });

  it('still refuses a creator outside the list', async () => {
    await expect(setCreator('case', testId('case'))).rejects.toThrow('workflow_runs_creator_valid');
  });
});

describe('migration 0028: the case tables on an upgraded database (C129, C136.1)', () => {
  it('leaves a key minted before it with no case template restriction', async () => {
    const keys = await client.query<{ case_template_ids: string[] | null }>(
      'select case_template_ids from api_keys where id = $1',
      [keyId],
    );

    expect(keys.rows).toEqual([{ case_template_ids: null }]);
  });

  it('holds an inquiry made before it in a case, and refuses one of no environment', async () => {
    const template = await seedCaseTemplate(db(), environmentId);
    const { id: caseId } = await seedCase(db(), environmentId, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: 1,
    });
    const attach = (id: string) =>
      client.query(
        `insert into case_inquiries (environment_id, case_id, inquiry_id, attached_by_type,
           attached_by_id)
         values ($1, $2, $3, 'user', $4)`,
        [environmentId, caseId, id, testId('usr')],
      );

    await expect(attach(inquiryId)).resolves.toBeDefined();
    await expect(attach(testId('inq'))).rejects.toThrow('case_inquiries_inquiry_fk');
  });
});
