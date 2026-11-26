/**
 * Migration 0024 (Phase 7, Workflow 7B; one migration for the Workflow, extended per Stage 1b
 * checkpoint) on the production server image: on an empty database, and on one upgraded from 0023
 * with rows in it. Stage 1a recreated the two `report_type` CHECK constraints with `custom-list`
 * (C106.2). Checkpoint (L) adds the list tables, list matches and screenings, the importer tables
 * and `list_config` (C98, C99, C100). Checkpoint (T) adds the transaction tables, with the
 * append-only trigger of the status history and the labels (C104, C105). Checkpoint (G) adds the
 * graph tables, and an incomplete `graph_index_state` row of every kind for each environment that
 * predates the migration, so the `graph-backfill` job indexes what it held (C101, C102). Every value
 * is synthetic; addresses are from the documentation ranges, and the point is open ocean.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { migrationTags, runMigrations } from './migrate.js';
import {
  createIntegrationPool,
  createTestInquiryOnEarlierSchema,
  createTestTenant,
  testId,
  startIntegrationPostgres,
} from './testing.js';

const keyring = createKeyring(randomBytes(32));
const digest = () => randomBytes(32).toString('hex');

let container: StartedPostgreSqlContainer | undefined;
const pools: Pool[] = [];

beforeAll(async () => {
  setDefaultKeyring(keyring);
  container = await startIntegrationPostgres();
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await Promise.all(pools.map((pool) => pool.end()));
  await container?.stop();
});

async function freshDatabase(name: string): Promise<Database> {
  if (!container) throw new Error('no container');
  const admin = createIntegrationPool(container.getConnectionUri());
  pools.push(admin);
  await admin.query(`create database ${name}`);
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${name}`;
  const pool = createIntegrationPool(url.toString());
  pools.push(pool);
  return createDatabase(pool);
}

/** An inquiry, written with the columns every schema since 0003 has. */
async function seedInquiry(db: Database) {
  const { environment } = await createTestTenant(db);
  const { inquiry, versionId } = await createTestInquiryOnEarlierSchema(db, environment.id);
  return { environmentId: environment.id, inquiryId: inquiry.id, versionId };
}

/** One list of each storage form, an item of each, a match, a screening and an import. */
async function writeListRows(db: Database, seeded: Awaited<ReturnType<typeof seedInquiry>>) {
  const { environmentId, inquiryId } = seeded;
  const ips = testId('lst');
  const places = testId('lst');
  const faces = testId('lst');
  const backgrounds = testId('lst');
  await db.execute(
    `insert into lists (id, environment_id, type, name, item_retention_days)
       values ('${ips}', '${environmentId}', 'ip-address', 'Synthetic ranges', null),
              ('${places}', '${environmentId}', 'geolocation', 'Synthetic places', null),
              ('${faces}', '${environmentId}', 'face', 'Synthetic faces', 30),
              ('${backgrounds}', '${environmentId}', 'selfie-background', 'Synthetic rooms', 30)`,
  );
  const range = testId('liip');
  const place = testId('ligl');
  const face = testId('lifc');
  const background = testId('lisb');
  const key = digest();
  await db.execute(
    `insert into list_items (id, environment_id, list_id, value, match_key, normaliser_version,
       status)
     values ('${range}', '${environmentId}', '${ips}', 'sealed', '${key}', 'lists-1', 'active'),
            ('${place}', '${environmentId}', '${places}', 'sealed', '${digest()}', 'lists-1',
             'active'),
            ('${face}', '${environmentId}', '${faces}', null, null, 'lists-1', 'pending'),
            ('${background}', '${environmentId}', '${backgrounds}', null, null, 'lists-1',
             'pending')`,
  );
  await db.execute(
    `insert into list_item_keys (environment_id, item_id, key_kind, match_key)
       values ('${environmentId}', '${range}', 'identifier-ip-range', '${digest()}')`,
  );
  await db.execute(
    `insert into list_item_ip_ranges (environment_id, item_id, range)
       values ('${environmentId}', '${range}', '192.0.2.0/24')`,
  );
  await db.execute(
    `insert into list_item_geo (environment_id, item_id, bbox, part)
       values ('${environmentId}', '${place}', box(point(-140.5, -30.5), point(-140, -30)), 0)`,
  );
  await db.execute(
    `insert into list_item_faces (environment_id, item_id, source_inquiry_id)
       values ('${environmentId}', '${face}', '${inquiryId}')`,
  );
  await db.execute(
    `insert into list_item_backgrounds (environment_id, item_id, source_inquiry_id)
       values ('${environmentId}', '${background}', '${inquiryId}')`,
  );
  await db.execute(
    `insert into list_matches (id, environment_id, list_id, list_item_id, inquiry_id, source,
       method, tier, list_version)
     values ('${testId('lmt')}', '${environmentId}', '${ips}', '${range}', '${inquiryId}',
       'session.ip-address', 'cidr', 'R', 1)`,
  );
  await db.execute(
    `insert into list_screenings (environment_id, inquiry_id, trigger_status)
       values ('${environmentId}', '${inquiryId}', 'completed')`,
  );
  const importer = testId('mprt');
  await db.execute(
    `insert into importers (id, environment_id, list_id, file_sha256, file_bytes, storage_key,
       wrapped_dek)
     values ('${importer}', '${environmentId}', '${ips}', '${digest()}', 10, 'imports/x', 'dek')`,
  );
  await db.execute(
    `insert into list_import_rows (environment_id, importer_id, row, value, match_key)
       values ('${environmentId}', '${importer}', 1, 'sealed', '${digest()}')`,
  );
  await db.execute(
    `insert into list_import_errors (environment_id, importer_id, row, "column", code)
       values ('${environmentId}', '${importer}', 2, 'value', 'invalid_value')`,
  );
}

/** A type, a version, a transaction, and one row of each table that hangs from it. */
async function writeTransactionRows(db: Database, seeded: Awaited<ReturnType<typeof seedInquiry>>) {
  const { environmentId, inquiryId } = seeded;
  const type = testId('txntp');
  const version = testId('txntpv');
  const transaction = testId('txn');
  const related = testId('txn');
  await db.execute(
    `insert into transaction_types (id, environment_id, name)
       values ('${type}', '${environmentId}', 'Synthetic payout')`,
  );
  await db.execute(
    `insert into transaction_type_versions (id, environment_id, transaction_type_id, version,
       status, statuses, published_at)
     values ('${version}', '${environmentId}', '${type}', 1, 'published',
       array['created', 'approved'], now())`,
  );
  await db.execute(
    `insert into transactions (id, environment_id, transaction_type_id,
       transaction_type_version_id, status, fields, tags)
     values ('${transaction}', '${environmentId}', '${type}', '${version}', 'created', 'sealed',
             array['synthetic']),
            ('${related}', '${environmentId}', '${type}', '${version}', 'created', 'sealed',
             '{}')`,
  );
  await db.execute(
    `insert into transaction_status_history (environment_id, transaction_id, to_status, actor_type)
       values ('${environmentId}', '${transaction}', 'created', 'system')`,
  );
  const label = testId('txnl');
  await db.execute(
    `insert into transaction_labels (id, environment_id, transaction_id, label, score)
       values ('${label}', '${environmentId}', '${transaction}', 'synthetic-label', 0.5)`,
  );
  await db.execute(
    `insert into transaction_objects (environment_id, transaction_id, inquiry_id)
       values ('${environmentId}', '${transaction}', '${inquiryId}')`,
  );
  await db.execute(
    `insert into transaction_relations (environment_id, transaction_id, relation_schema_key,
       related_transaction_id)
     values ('${environmentId}', '${transaction}', 'parent', '${related}')`,
  );
  await db.execute(
    `insert into transaction_field_keys (environment_id, transaction_id, field_key, value_key)
       values ('${environmentId}', '${transaction}', 'reference', '${digest()}')`,
  );
  const file = testId('txnf');
  await db.execute(
    `insert into transaction_files (id, environment_id, transaction_id, field_key, filename,
       mime_type, byte_size, sha256, storage_key, wrapped_dek)
     values ('${file}', '${environmentId}', '${transaction}', 'statement', 'sealed',
       'application/pdf', 10, '${digest()}', 'transactions/${file}', 'ov1.key.dek')`,
  );
  return { transaction, label };
}

/** The transaction's history and labels stay, but for the redaction (the C73 trigger pattern). */
async function expectAppendOnly(
  db: Database,
  rows: Awaited<ReturnType<typeof writeTransactionRows>>,
) {
  await expect(
    db.execute(`update transaction_labels set label = 'other' where id = '${rows.label}'`),
  ).rejects.toThrow();
  await expect(
    db.execute(
      `delete from transaction_status_history where transaction_id = '${rows.transaction}'`,
    ),
  ).rejects.toThrow();
  await db.transaction(async (tx) => {
    await tx.execute(`select set_config('openverify.transaction_redaction', 'on', true)`);
    await tx.execute(
      `update transaction_labels set label = null, redacted_at = now()
        where id = '${rows.label}'`,
    );
    await tx.execute(
      `update transaction_status_history set from_status = null, to_status = null,
         redacted_at = now() where transaction_id = '${rows.transaction}'`,
    );
  });
}

/** One row of each graph table: an attribute, an index job, a component, a template and a query. */
async function writeGraphRows(db: Database, seeded: Awaited<ReturnType<typeof seedInquiry>>) {
  const { environmentId, inquiryId } = seeded;
  const account = await db.execute(`select account_id from inquiries where id = '${inquiryId}'`);
  const accountId = (account.rows[0] as { account_id: string }).account_id;
  await db.execute(
    `insert into graph_attributes (environment_id, kind, value_key, key_id, account_id,
       source_type, source_id, inquiry_id)
     values ('${environmentId}', 4, '${digest()}', 'AbCdEfGh_-1', '${accountId}', 'inquiry',
             '${inquiryId}', '${inquiryId}')`,
  );
  await db.execute(
    `insert into graph_index_jobs (environment_id, inquiry_id, trigger_status)
       values ('${environmentId}', '${inquiryId}', 'completed')`,
  );
  await db.execute(
    `insert into graph_components (environment_id, account_id, component_id, size, computed_at)
       values ('${environmentId}', '${accountId}', 'component-1', 1, now())`,
  );
  const template = testId('grqt');
  const version = testId('grqtv');
  const query = testId('grphq');
  await db.execute(
    `insert into graph_query_templates (id, environment_id, name)
       values ('${template}', '${environmentId}', 'Synthetic template')`,
  );
  await db.execute(
    `insert into graph_query_template_versions (id, environment_id, graph_query_template_id,
       version, status, config, published_at)
     values ('${version}', '${environmentId}', '${template}', 1, 'published', '{}', now())`,
  );
  await db.execute(
    `insert into graph_queries (id, environment_id, graph_query_template_id,
       graph_query_template_version_id, params, account_ids)
     values ('${query}', '${environmentId}', '${template}', '${version}', 'sealed',
             array['${accountId}'])`,
  );
  // The account leaves every stored result through the GIN index (C101.4).
  const found = await db.execute(
    `select id from graph_queries where account_ids @> array['${accountId}']`,
  );
  expect(found.rows).toEqual([{ id: query }]);
  return { accountId, query };
}

/** The backfill state of an environment: kind codes and whether each is complete. */
async function indexState(db: Database, environmentId: string) {
  const result = await db.execute(
    `select kind, complete from graph_index_state where environment_id = '${environmentId}'
      order by kind`,
  );
  return result.rows;
}

async function operatorClasses(db: Database) {
  const result = await db.execute(
    `select i.relname as index, am.amname as access, o.opcname as opclass
       from pg_class i
       join pg_am am on am.oid = i.relam
       join pg_index x on x.indexrelid = i.oid
       join pg_opclass o on o.oid = x.indclass[0]
      where i.relname in ('list_item_ip_ranges_range_idx', 'list_item_geo_bbox_idx')
      order by i.relname`,
  );
  return result.rows;
}

async function explain(db: Database, statement: string): Promise<string> {
  await db.execute('set enable_seqscan = off');
  const result = await db.execute(`explain ${statement}`);
  await db.execute('set enable_seqscan = on');
  return result.rows.map((row) => (row as Record<string, string>)['QUERY PLAN']).join('\n');
}

const OPERATOR_CLASSES = [
  { index: 'list_item_geo_bbox_idx', access: 'gist', opclass: 'box_ops' },
  { index: 'list_item_ip_ranges_range_idx', access: 'spgist', opclass: 'inet_ops' },
];

describe('Workflow 7B migration 0024 on Postgres 17', () => {
  it('creates the list tables on an empty database; the containment and box operators use their indexes', async () => {
    const db = await freshDatabase('phase7_0024_empty');
    await runMigrations(db);
    const seeded = await seedInquiry(db);

    await writeListRows(db, seeded);

    expect(await operatorClasses(db)).toEqual(OPERATOR_CLASSES);
    // C98.1: a default GiST class on cidr would silently fall back to a sequential scan.
    expect(
      await explain(db, `select item_id from list_item_ip_ranges where range >>= '192.0.2.7'`),
    ).toContain('list_item_ip_ranges_range_idx');
    expect(
      await explain(
        db,
        `select item_id from list_item_geo where bbox @> box(point(-140.2, -30.2), point(-140.2, -30.2))`,
      ),
    ).toContain('list_item_geo_bbox_idx');
    const contained = await db.execute(
      `select count(*)::int as count from list_item_ip_ranges where range >>= '192.0.2.7'`,
    );
    expect(contained.rows).toEqual([{ count: 1 }]);
    const outside = await db.execute(
      `select count(*)::int as count from list_item_ip_ranges where range >>= '198.51.100.7'`,
    );
    expect(outside.rows).toEqual([{ count: 0 }]);
    // An inquiry's screening and matches go with it; the list and its items stay.
    await db.execute(`delete from list_item_faces where source_inquiry_id = '${seeded.inquiryId}'`);
    await db.execute(
      `delete from list_item_backgrounds where source_inquiry_id = '${seeded.inquiryId}'`,
    );
    await db.execute(`delete from inquiries where id = '${seeded.inquiryId}'`);
    const left = await db.execute(
      `select (select count(*)::int from list_matches) as matches,
              (select count(*)::int from list_screenings) as screenings,
              (select count(*)::int from list_items) as items`,
    );
    expect(left.rows).toEqual([{ matches: 0, screenings: 0, items: 4 }]);
  });

  it('creates the transaction tables on an empty database, with the two tables append-only', async () => {
    const db = await freshDatabase('phase7_0024_transactions');
    await runMigrations(db);
    const seeded = await seedInquiry(db);

    const rows = await writeTransactionRows(db, seeded);

    await expectAppendOnly(db, rows);
    const objects = await db.execute(
      `select object_id from transaction_objects where transaction_id = '${rows.transaction}'`,
    );
    expect(objects.rows).toEqual([{ object_id: seeded.inquiryId }]);
  });

  it('creates the graph tables on an empty database; a new environment has no backfill to do', async () => {
    const db = await freshDatabase('phase7_0024_graph');
    await runMigrations(db);
    const seeded = await seedInquiry(db);

    await writeGraphRows(db, seeded);

    expect(await indexState(db, seeded.environmentId)).toEqual([]);
    await db.execute(`delete from inquiries where id = '${seeded.inquiryId}'`);
    const left = await db.execute(
      `select (select count(*)::int from graph_attributes) as attributes,
              (select count(*)::int from graph_index_jobs) as jobs`,
    );
    expect(left.rows).toEqual([{ attributes: 0, jobs: 0 }]);
  });

  it('upgrades a database at 0023 with rows in it: the version keeps its row with an empty list-config', async () => {
    const db = await freshDatabase('phase7_0024_upgrade');
    await runMigrations(db, { upTo: '0023_phase7a' });
    const seeded = await seedInquiry(db);

    await runMigrations(db);

    const version = await db.execute(
      `select list_config, signal_config from inquiry_template_versions
        where id = '${seeded.versionId}'`,
    );
    expect(version.rows).toEqual([{ list_config: {}, signal_config: {} }]);
    await writeListRows(db, seeded);
    expect(await operatorClasses(db)).toEqual(OPERATOR_CLASSES);
    await expectAppendOnly(db, await writeTransactionRows(db, seeded));
    // C101.5 (H10): the environment held data before the graph existed, so every kind starts
    // incomplete; one created after the upgrade starts complete (no row).
    expect(await indexState(db, seeded.environmentId)).toEqual(
      Array.from({ length: 18 }, (_, index) => ({ kind: index + 1, complete: false })),
    );
    const later = await seedInquiry(db);
    expect(await indexState(db, later.environmentId)).toEqual([]);
    await writeGraphRows(db, seeded);
    const applied = await db.execute(
      'select count(*)::int as count from drizzle.__drizzle_migrations',
    );
    expect(applied.rows).toEqual([{ count: migrationTags().length }]);
  });
});
