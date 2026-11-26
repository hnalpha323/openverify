/**
 * Migration 0030 (Workflow 9A), upgrading a database at 0029 on PGlite. Workflow 9A Stage 1a starts
 * it with the Phase 8 vocabularies the flow needs (review F05; plan outcome items 2 and 5): the
 * ninth trigger type `trigger-flow`, the run creator `inquiry-flow`, and on decision records the
 * kind `flow-failure` and the actor `inquiry-flow`, named by the inquiry's id. Each is a text
 * column held by a CHECK, so each is a recreated CHECK. `foundation-9a` extends this migration.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import * as schema from './schema.js';
import {
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  createTestVerificationOnEarlierSchema,
  PGLITE_EXTENSIONS,
  testId,
} from './testing.js';

let client: PGlite;
const db = () => drizzle({ client, schema });

beforeAll(async () => {
  client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  await runMigrations(db(), { upTo: '0029_phase8d' });
  await runMigrations(db());
}, 120_000);

afterAll(async () => {
  await client.close();
});

const definition = async (name: string): Promise<string> => {
  const rows = await client.query<{ def: string }>(
    'select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1',
    [name],
  );
  const [row] = rows.rows;
  if (row === undefined) throw new Error(`no constraint ${name}`);
  return row.def;
};

describe('migration 0030: applies on top of 0029 (Workflow 9A)', () => {
  it('is the migration after 0029_phase8d', () => {
    const tags = migrationTags();
    expect(tags.indexOf('0030_phase9a')).toBe(tags.indexOf('0029_phase8d') + 1);
  });

  it('lets a workflow be triggered by a flow, everywhere a trigger type is held (C152.2)', async () => {
    for (const name of [
      'workflow_versions_trigger_type_valid',
      'workflow_triggers_kind_valid',
      'workflow_runs_trigger_type_valid',
    ]) {
      expect(await definition(name), name).toContain("'trigger-flow'");
    }
  });

  it('names a flow as a run creator (C120.1 amended)', async () => {
    expect(await definition('workflow_runs_creator_valid')).toContain("'inquiry-flow'");
  });

  it('records a flow failure, decided by the inquiry flow and named by the inquiry id (C150.7)', async () => {
    expect(await definition('inquiry_decisions_kind_valid')).toContain("'flow-failure'");
    expect(await definition('inquiry_decisions_actor_type_valid')).toContain("'inquiry-flow'");
    const format = await definition('inquiry_decisions_actor_id_format');
    expect(format).toContain("'inquiry-flow'");
    expect(format).toContain('^inq_[0-9A-HJKMNP-TV-Z]{26}$');
  });

  it('keeps a flow out of a transaction review and a device trust', async () => {
    for (const name of [
      'transactions_reviewer_type_valid',
      'devices_trusted_by_type_valid',
      'transactions_reviewer_id_format',
      'devices_trusted_by_id_format',
    ]) {
      expect(await definition(name), name).not.toContain('inquiry-flow');
    }
  });
});

describe("migration 0030: the flow engine's columns and records on an upgraded database (Workflow 9A Stage 1b (S))", () => {
  let upgraded: PGlite;
  let seeded: {
    environmentId: string;
    inquiryId: string;
    decisionId: string;
    versionId: string;
    fileId: string;
  };

  beforeAll(async () => {
    setDefaultKeyring(createKeyring(randomBytes(32)));
    upgraded = new PGlite({ extensions: PGLITE_EXTENSIONS });
    const earlier = drizzle({ client: upgraded, schema });
    await runMigrations(earlier, { upTo: '0029_phase8d' });
    const { environment } = await createTestTenant(earlier);
    const { inquiry, versionId } = await createTestInquiryOnEarlierSchema(earlier, environment.id);
    const decisionId = testId('idec');
    await upgraded.query(
      `insert into inquiry_decisions (id, environment_id, kind, subject_type, subject_id, actor_type, actor_id)
       values ($1, $2, 'review', 'inquiry', $3, 'api-key', $4)`,
      [decisionId, environment.id, inquiry.id, testId('key')],
    );
    const verification = await createTestVerificationOnEarlierSchema(earlier, environment.id, {
      inquiryId: inquiry.id,
      type: 'government_id',
    });
    const fileId = testId('file');
    await upgraded.query(
      `insert into files (id, environment_id, verification_id, kind, storage_key, mime_type, byte_size, sha256, wrapped_dek)
       values ($1, $2, $3, 'front', $4, 'image/png', 10, $5, $6)`,
      [
        fileId,
        environment.id,
        verification.id,
        `synthetic/${fileId}`,
        '0'.repeat(64),
        `ov1.${'A'.repeat(11)}.${'B'.repeat(80)}`,
      ],
    );
    seeded = {
      environmentId: environment.id,
      inquiryId: inquiry.id,
      decisionId,
      versionId,
      fileId,
    };
    await runMigrations(earlier);
  }, 120_000);

  afterAll(async () => {
    setDefaultKeyring(undefined);
    await upgraded.close();
  });

  it('leaves an inquiry made before it with no position, no first device, no outcome and no initial fields', async () => {
    const { rows } = await upgraded.query<Record<string, unknown>>(
      `select flow_step_id, flow_state, flow_previous_step_id, flow_spec_version, first_device_kind,
         first_platform, flow_outcome, initial_fields from inquiries where id = $1`,
      [seeded.inquiryId],
    );
    expect(rows).toEqual([
      {
        flow_step_id: null,
        flow_state: null,
        flow_previous_step_id: null,
        flow_spec_version: null,
        first_device_kind: null,
        first_platform: null,
        flow_outcome: null,
        initial_fields: null,
      },
    ]);
  });

  it('leaves a decision made before it with no flow path, which a review needs none of', async () => {
    const { rows } = await upgraded.query<{ flow: unknown }>(
      'select flow from inquiry_decisions where id = $1',
      [seeded.decisionId],
    );
    expect(rows).toEqual([{ flow: null }]);
  });

  it('adds the step record, the action rows and the signal snapshots, empty, and the waiting index', async () => {
    for (const table of [
      'inquiry_flow_steps',
      'inquiry_flow_actions',
      'inquiry_flow_signal_snapshots',
    ]) {
      const { rows } = await upgraded.query<{ count: number }>(
        `select count(*)::int as count from ${table}`,
      );
      expect(rows, table).toEqual([{ count: 0 }]);
    }
    const { rows } = await upgraded.query<{ indexname: string }>(
      `select indexname from pg_indexes where indexname in ('inquiries_flow_waiting_idx', 'inquiry_flow_actions_running_idx')
       order by indexname`,
    );
    expect(rows.map(({ indexname }) => indexname)).toEqual([
      'inquiries_flow_waiting_idx',
      'inquiry_flow_actions_running_idx',
    ]);
    await upgraded.query(
      `insert into inquiry_flow_steps (environment_id, inquiry_id, seq, step_id, step_type, entered_at)
       values ($1, $2, 1, 'consent', 'consent', now())`,
      [seeded.environmentId, seeded.inquiryId],
    );
  });

  it('gives a version made before it the C154.1 defaults (Stage 1b (T))', async () => {
    const { rows } = await upgraded.query<Record<string, unknown>>(
      `select field_schemas, copy, enabled_locales, default_locale, embed_origins, redirect_uri_schemes,
         redirect_include_status, acknowledgements, publish_note, flow_sha256
       from inquiry_template_versions where id = $1`,
      [seeded.versionId],
    );
    expect(rows).toEqual([
      {
        field_schemas: [],
        copy: {},
        enabled_locales: ['en'],
        default_locale: 'en',
        embed_origins: [],
        redirect_uri_schemes: [],
        redirect_include_status: false,
        acknowledgements: [],
        publish_note: null,
        flow_sha256: null,
      },
    ]);
    for (const table of ['deployments', 'inquiry_template_promotions', 'simulation_presets']) {
      const { rows: counted } = await upgraded.query<{ count: number }>(
        `select count(*)::int as count from ${table}`,
      );
      expect(counted, table).toEqual([{ count: 0 }]);
    }
  });

  it('leaves an inquiry made before it with no redirect, and a file with no capture method (Stage 1b (F))', async () => {
    const { rows: inquiries } = await upgraded.query<Record<string, unknown>>(
      'select redirect_uri from inquiries where id = $1',
      [seeded.inquiryId],
    );
    const { rows: files } = await upgraded.query<Record<string, unknown>>(
      'select capture_method from files where id = $1',
      [seeded.fileId],
    );
    expect(inquiries).toEqual([{ redirect_uri: null }]);
    expect(files).toEqual([{ capture_method: null }]);
  });

  it('leaves an inquiry made before it with no theme set, and adds the theme tables empty (Stage 1b (H))', async () => {
    const { rows } = await upgraded.query<Record<string, unknown>>(
      'select theme_set_id from inquiries where id = $1',
      [seeded.inquiryId],
    );
    expect(rows).toEqual([{ theme_set_id: null }]);
    for (const table of ['theme_sets', 'theme_set_revisions', 'theme_assets']) {
      const { rows: counted } = await upgraded.query<{ count: number }>(
        `select count(*)::int as count from ${table}`,
      );
      expect(counted, table).toEqual([{ count: 0 }]);
    }
  });
});
