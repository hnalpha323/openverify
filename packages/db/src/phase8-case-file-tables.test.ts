/**
 * Workflow 8B Stage 1b, checkpoint (F) (plan C135, C138): the attachment, rendition and export
 * tables of migration 0028, read from the migrated database's catalogs.
 *
 * - `case_attachments` (`catt_`): a case's file of its own environment, one of four types by its
 *   bytes, at most 10 MiB, its sealed name and digest kept until redaction (P34), its object's key and
 *   wrapped data key until the object is gone; a scan names its provider and a verdict its time (H20),
 *   a ready rendition its pages (C135.2, C135.5);
 * - `file_renditions`: the rendition state of an inquiry's file, with its foreign key on `files(id)`,
 *   gone with its file (C135.3);
 * - `rendition_pages`: the sealed page objects of a file or an attachment, keyed by the source's id and
 *   page, which outlive a deleted file row so that its object is still found and deleted (Stage 1a
 *   amendment 9);
 * - `case_exports` (`cexp_`): its creator's, its request sealed until it finished, its file whole
 *   while it is kept, a failure's code alone (C138.1);
 * - an environment's deletion takes all of it.
 *
 * Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFile, createVerification } from './index.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
} from './testing.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

const query = <Row extends object>(text: string, params: unknown[] = []) =>
  database.client.query<Row>(text, params);

const TABLES = ['case_attachments', 'file_renditions', 'rendition_pages', 'case_exports'];

async function columnsOf(table: string): Promise<Record<string, string>> {
  const result = await query<{ column_name: string; udt_name: string }>(
    `select column_name, udt_name from information_schema.columns where table_name = $1`,
    [table],
  );
  return Object.fromEntries(result.rows.map((row) => [row.column_name, row.udt_name]));
}

async function refused(statement: string, params: unknown[], message: string) {
  await expect(query(statement, params), message).rejects.toThrow(message);
}

async function environment(): Promise<string> {
  const { environment: created } = await createTestTenant(database.db);
  return created.id;
}

const STATUSES = JSON.stringify([
  { key: 'open', label: 'Open', category: 'initial' },
  { key: 'approved', label: 'Approved', category: 'end' },
]);

let cases = 0;

async function seedCase(environmentId: string): Promise<string> {
  const templateId = testId('ctmpl');
  const versionId = testId('ctmplv');
  await query(
    `insert into case_templates (id, environment_id, name, key) values ($1, $2, 'Review', $3)`,
    [templateId, environmentId, `F${templateId.slice(-6).replace(/[^A-Z0-9]/g, '0')}`],
  );
  await query(
    `insert into case_template_versions (id, environment_id, case_template_id, version, status,
       statuses, published_at)
     values ($1, $2, $3, 1, 'published', $4::jsonb, now())`,
    [versionId, environmentId, templateId, STATUSES],
  );
  const id = testId('case');
  await query(
    `insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
       status, status_category, creator_type, creator_id, fields)
     values ($1, $2, $3, $4, $5, 'open', 'initial', 'user', $6, 'sealed-canary')`,
    [id, environmentId, templateId, versionId, `KYC-${String((cases += 1))}`, testId('usr')],
  );
  return id;
}

const SHA = 'a'.repeat(64);
/** A synthetic wrapped data key in `encryptBytes`' form; it wraps nothing. */
const DEK = `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`;

interface AttachmentColumns {
  id?: string;
  mimeType?: string;
  byteSize?: number;
  originalFilename?: string | null;
  sha256?: string | null;
  storageKey?: string | null;
  wrappedDek?: string | null;
  scanStatus?: string;
  scanProvider?: string | null;
  scannedAt?: string | null;
  renditionStatus?: string;
  renditionPageCount?: number | null;
  redactedAt?: string | null;
  deletedAt?: string | null;
}

async function insertAttachment(
  environmentId: string,
  caseId: string,
  row: AttachmentColumns = {},
) {
  const id = row.id ?? testId('catt');
  await query(
    `insert into case_attachments (id, environment_id, case_id, mime_type, byte_size,
       original_filename, sha256, storage_key, wrapped_dek, uploader_type, uploader_id,
       scan_status, scan_provider, scanned_at, rendition_status, rendition_page_count,
       redacted_at, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'user', $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      id,
      environmentId,
      caseId,
      row.mimeType ?? 'image/png',
      row.byteSize ?? 1024,
      row.originalFilename === undefined ? 'sealed-canary' : row.originalFilename,
      row.sha256 === undefined ? SHA : row.sha256,
      row.storageKey === undefined ? `${environmentId}/${id}` : row.storageKey,
      row.wrappedDek === undefined ? DEK : row.wrappedDek,
      testId('usr'),
      row.scanStatus ?? 'not_scanned',
      row.scanProvider ?? null,
      row.scannedAt ?? null,
      row.renditionStatus ?? 'pending',
      row.renditionPageCount ?? null,
      row.redactedAt ?? null,
      row.deletedAt ?? null,
    ],
  );
  return id;
}

async function seedFile(environmentId: string): Promise<string> {
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  const verification = await createVerification(database.db, environmentId, {
    id: testId('ver'),
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  const id = testId('file');
  // Synthetic bytes standing in for an image; nothing is stored.
  const bytes = randomBytes(64);
  await createFile(database.db, environmentId, {
    id,
    verificationId: verification.id,
    kind: 'front',
    storageKey: `${environmentId}/${id}`,
    mimeType: 'image/jpeg',
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    wrappedDek: DEK,
  });
  return id;
}

async function insertPage(environmentId: string, sourceId: string, page = 1, id?: string) {
  await query(
    `insert into rendition_pages (id, environment_id, source_id, page, media_type, width, height,
       byte_size, storage_key, wrapped_dek)
     values ($1, $2, $3, $4, 'image/png', 800, 600, 2048, $5, $6)`,
    [
      id ?? `${sourceId}/${String(page)}`,
      environmentId,
      sourceId,
      page,
      `${environmentId}/renditions/${sourceId}/${String(page)}`,
      DEK,
    ],
  );
}

interface ExportColumns {
  status?: string;
  creatorType?: string;
  creatorId?: string;
  request?: string | null;
  caseCount?: number | null;
  byteSize?: number | null;
  errorCode?: string | null;
  storageKey?: string | null;
  wrappedDek?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
}

async function insertExport(environmentId: string, row: ExportColumns = {}) {
  const id = testId('cexp');
  await query(
    `insert into case_exports (id, environment_id, creator_type, creator_id, format, request,
       status, case_count, byte_size, error_code, storage_key, wrapped_dek, completed_at,
       expires_at)
     values ($1, $2, $3, $4, 'csv', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      environmentId,
      row.creatorType ?? 'user',
      row.creatorId ?? testId('usr'),
      row.request === undefined ? 'sealed-canary' : row.request,
      row.status ?? 'pending',
      row.caseCount ?? null,
      row.byteSize ?? null,
      row.errorCode ?? null,
      row.storageKey ?? null,
      row.wrappedDek ?? null,
      row.completedAt ?? null,
      row.expiresAt ?? null,
    ],
  );
  return id;
}

const COMPLETED: ExportColumns = {
  status: 'completed',
  request: null,
  caseCount: 3,
  byteSize: 512,
  storageKey: 'exports/synthetic',
  wrappedDek: DEK,
  completedAt: '2026-11-03T10:00:00Z',
  expiresAt: '2026-11-04T10:00:00Z',
};

describe('the attachment, rendition and export tables (C135, C138)', () => {
  it('exist, each with its environment', async () => {
    for (const table of TABLES) {
      expect(await columnsOf(table), table).toHaveProperty('environment_id');
    }
  });

  it('keep each change’s time on the rows that change', async () => {
    const result = await query<{ tgname: string }>(
      `select tgname from pg_trigger where tgname = any($1) order by tgname`,
      [
        [
          'case_attachments_set_updated_at',
          'case_exports_set_updated_at',
          'file_renditions_set_updated_at',
        ],
      ],
    );

    expect(result.rows.map(({ tgname }) => tgname)).toEqual([
      'case_attachments_set_updated_at',
      'case_exports_set_updated_at',
      'file_renditions_set_updated_at',
    ]);
  });
});

describe('case attachments (C135.2, C135.5)', () => {
  it('hold a file of a case of their own environment', async () => {
    const environmentId = await environment();
    const caseId = await seedCase(environmentId);

    await insertAttachment(environmentId, caseId);
    await refused(
      `insert into case_attachments (id, environment_id, case_id, mime_type, byte_size,
         original_filename, sha256, storage_key, wrapped_dek, uploader_type, uploader_id,
         scan_status, rendition_status)
       values ($1, $2, $3, 'image/png', 10, 'x', $4, $5, $7, 'user', $6, 'not_scanned',
         'pending')`,
      [testId('catt'), await environment(), caseId, SHA, `k/${testId('catt')}`, testId('usr'), DEK],
      'case_attachments_case_fk',
    );
  });

  it('take a JPEG, PNG, WebP or PDF of at most 10 MiB', async () => {
    const environmentId = await environment();
    const caseId = await seedCase(environmentId);

    await insertAttachment(environmentId, caseId, { mimeType: 'application/pdf' });
    await expect(
      insertAttachment(environmentId, caseId, { mimeType: 'image/gif' }),
    ).rejects.toThrow('case_attachments_mime_type_valid');
    await expect(insertAttachment(environmentId, caseId, { byteSize: 10_485_761 })).rejects.toThrow(
      'case_attachments_byte_size_range',
    );
  });

  it('keep the sealed name and the digest until redaction, and the object until it is gone', async () => {
    const environmentId = await environment();
    const caseId = await seedCase(environmentId);

    await expect(
      insertAttachment(environmentId, caseId, { originalFilename: null }),
    ).rejects.toThrow('case_attachments_filename_until_redacted');
    await expect(insertAttachment(environmentId, caseId, { sha256: null })).rejects.toThrow(
      'case_attachments_sha256_until_redacted',
    );
    await expect(insertAttachment(environmentId, caseId, { storageKey: null })).rejects.toThrow(
      'case_attachments_object_until_deleted',
    );
    await expect(
      insertAttachment(environmentId, caseId, {
        deletedAt: '2026-11-03T10:00:00Z',
        storageKey: null,
        wrappedDek: null,
      }),
    ).rejects.toThrow('case_attachments_deleted_after_redaction');
    await insertAttachment(environmentId, caseId, {
      originalFilename: null,
      sha256: null,
      storageKey: null,
      wrappedDek: null,
      renditionStatus: 'deleted',
      redactedAt: '2026-11-03T10:00:00Z',
      deletedAt: '2026-11-03T10:00:01Z',
    });
  });

  it('name the provider of a scan and the time of a verdict (H20)', async () => {
    const environmentId = await environment();
    const caseId = await seedCase(environmentId);

    await expect(
      insertAttachment(environmentId, caseId, {
        scanStatus: 'clean',
        scannedAt: '2026-11-03T10:00:00Z',
      }),
    ).rejects.toThrow('case_attachments_scan_provider_with_status');
    await expect(
      insertAttachment(environmentId, caseId, { scanProvider: 'sandbox' }),
    ).rejects.toThrow('case_attachments_scan_provider_with_status');
    await expect(
      insertAttachment(environmentId, caseId, { scanStatus: 'clean', scanProvider: 'sandbox' }),
    ).rejects.toThrow('case_attachments_scanned_at_with_verdict');
    await expect(
      insertAttachment(environmentId, caseId, { scanStatus: 'mystery', scanProvider: 'sandbox' }),
    ).rejects.toThrow('case_attachments_scan_status_valid');
    await insertAttachment(environmentId, caseId, {
      scanStatus: 'infected',
      scanProvider: 'sandbox',
      scannedAt: '2026-11-03T10:00:00Z',
    });
    await insertAttachment(environmentId, caseId, { scanStatus: 'pending', scanProvider: 'clamd' });
  });

  it('count a ready rendition’s pages, and nothing else’s', async () => {
    const environmentId = await environment();
    const caseId = await seedCase(environmentId);

    await expect(
      insertAttachment(environmentId, caseId, { renditionStatus: 'ready' }),
    ).rejects.toThrow('case_attachments_rendition_pages_when_ready');
    await expect(
      insertAttachment(environmentId, caseId, { renditionPageCount: 2 }),
    ).rejects.toThrow('case_attachments_rendition_pages_when_ready');
    await expect(
      insertAttachment(environmentId, caseId, {
        renditionStatus: 'ready',
        renditionPageCount: 21,
      }),
    ).rejects.toThrow('case_attachments_rendition_page_count_range');
    await insertAttachment(environmentId, caseId, {
      renditionStatus: 'ready',
      renditionPageCount: 3,
    });
  });
});

describe('renditions of an inquiry’s files (C135.3)', () => {
  it('belong to a file, and go with it', async () => {
    const environmentId = await environment();
    const fileId = await seedFile(environmentId);

    await query(
      `insert into file_renditions (file_id, environment_id, status) values ($1, $2, 'pending')`,
      [fileId, environmentId],
    );
    await refused(
      `insert into file_renditions (file_id, environment_id, status) values ($1, $2, 'pending')`,
      [testId('file'), environmentId],
      'file_renditions_file_fk',
    );
    await query(`delete from files where id = $1`, [fileId]);

    const left = await query(`select 1 from file_renditions where file_id = $1`, [fileId]);
    expect(left.rows).toEqual([]);
  });

  it('count a ready rendition’s pages and name a failure’s code', async () => {
    const environmentId = await environment();
    const insert = (status: string, pages: number | null, code: string | null) =>
      seedFile(environmentId).then((fileId) =>
        query(
          `insert into file_renditions (file_id, environment_id, status, page_count, error_code,
             rendered_at)
           values ($1, $2, $3, $4, $5, case when $3 = 'ready' then now() end)`,
          [fileId, environmentId, status, pages, code],
        ),
      );

    await expect(insert('ready', null, null)).rejects.toThrow('file_renditions_pages_when_ready');
    await expect(insert('failed', null, null)).rejects.toThrow('file_renditions_error_when_failed');
    await expect(insert('pending', null, 'rendition_unavailable')).rejects.toThrow(
      'file_renditions_error_when_failed',
    );
    await expect(insert('mystery', null, null)).rejects.toThrow('file_renditions_status_valid');
    await insert('ready', 1, null);
    await insert('failed', null, 'rendition_unavailable');
  });
});

describe('rendition pages (C135.3; Stage 1a amendment 9)', () => {
  it('are keyed by their source and page, a file’s or an attachment’s, 1 to 20', async () => {
    const environmentId = await environment();
    const fileId = await seedFile(environmentId);
    const attachmentId = await insertAttachment(environmentId, await seedCase(environmentId));

    await insertPage(environmentId, fileId, 1);
    await insertPage(environmentId, attachmentId, 20);
    await expect(insertPage(environmentId, attachmentId, 21)).rejects.toThrow(
      'rendition_pages_page_range',
    );
    await expect(insertPage(environmentId, fileId, 2, `${fileId}/3`)).rejects.toThrow(
      'rendition_pages_id_format',
    );
    await expect(insertPage(environmentId, testId('inq'), 1)).rejects.toThrow(
      'rendition_pages_source_id_format',
    );
  });

  it('outlive a deleted file row, so that their objects are still found', async () => {
    const environmentId = await environment();
    const fileId = await seedFile(environmentId);
    await insertPage(environmentId, fileId, 1);

    await query(`delete from files where id = $1`, [fileId]);

    const left = await query<{ storage_key: string }>(
      `select storage_key from rendition_pages where source_id = $1`,
      [fileId],
    );
    expect(left.rows).toHaveLength(1);
  });

  it('take an image of at most 4,096 px a side and 16 MiB, as JPEG or PNG', async () => {
    const environmentId = await environment();
    const fileId = await seedFile(environmentId);
    const insert = (mediaType: string, side: number, bytes: number) =>
      query(
        `insert into rendition_pages (id, environment_id, source_id, page, media_type, width,
           height, byte_size, storage_key, wrapped_dek)
         values ($1, $2, $3, 1, $4, $5, $5, $6, $7, $8)`,
        [`${fileId}/1`, environmentId, fileId, mediaType, side, bytes, `r/${testId('file')}`, DEK],
      );

    await expect(insert('image/webp', 100, 100)).rejects.toThrow(
      'rendition_pages_media_type_valid',
    );
    await expect(insert('image/png', 4097, 100)).rejects.toThrow('rendition_pages_size_range');
    await expect(insert('image/png', 100, 16_777_217)).rejects.toThrow(
      'rendition_pages_size_range',
    );
  });
});

describe('case exports (C138.1)', () => {
  it('are a user’s or a key’s', async () => {
    const environmentId = await environment();

    await insertExport(environmentId);
    await insertExport(environmentId, { creatorType: 'api-key', creatorId: testId('key') });
    await expect(
      insertExport(environmentId, { creatorType: 'workflow-run', creatorId: testId('wfr') }),
    ).rejects.toThrow('case_exports_creator_type_valid');
    await expect(
      insertExport(environmentId, { creatorType: 'user', creatorId: testId('key') }),
    ).rejects.toThrow('case_exports_creator_id_format');
  });

  it('keep the sealed request only until they finish', async () => {
    const environmentId = await environment();

    await expect(insertExport(environmentId, { request: null })).rejects.toThrow(
      'case_exports_request_until_finished',
    );
    await insertExport(environmentId, { status: 'running' });
    await insertExport(environmentId, COMPLETED);
  });

  it('hold a file exactly while completed, with its count, times and size', async () => {
    const environmentId = await environment();

    await expect(
      insertExport(environmentId, { ...COMPLETED, storageKey: null, wrappedDek: null }),
    ).rejects.toThrow('case_exports_file_while_completed');
    await expect(insertExport(environmentId, { ...COMPLETED, caseCount: null })).rejects.toThrow(
      'case_exports_finished_with_times',
    );
    await expect(insertExport(environmentId, { ...COMPLETED, byteSize: null })).rejects.toThrow(
      'case_exports_file_while_completed',
    );
    await expect(insertExport(environmentId, { ...COMPLETED, caseCount: 10_001 })).rejects.toThrow(
      'case_exports_counts',
    );
    await insertExport(environmentId, {
      ...COMPLETED,
      status: 'expired',
      storageKey: null,
      wrappedDek: null,
    });
  });

  it('name a failure’s code, and nothing else’s', async () => {
    const environmentId = await environment();

    await expect(insertExport(environmentId, { status: 'failed', request: null })).rejects.toThrow(
      'case_exports_error_when_failed',
    );
    await expect(insertExport(environmentId, { errorCode: 'export_too_large' })).rejects.toThrow(
      'case_exports_error_when_failed',
    );
    await insertExport(environmentId, {
      status: 'failed',
      request: null,
      errorCode: 'export_too_large',
    });
  });
});

describe('the indexes (C135.5, C138.1, C16)', () => {
  async function definitionOf(name: string): Promise<string> {
    const result = await query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = $1`,
      [name],
    );
    return result.rows[0]?.indexdef ?? '';
  }

  it('list a case’s attachments, find the scans to run and the objects left to delete', async () => {
    expect(await definitionOf('case_attachments_case_created_at_idx')).toContain(
      '(environment_id, case_id, created_at, id)',
    );
    expect(await definitionOf('case_attachments_scan_pending_idx')).toContain(
      "scan_status = 'pending'::text",
    );
    expect(await definitionOf('case_attachments_undeleted_redacted_idx')).toContain(
      'deleted_at IS NULL',
    );
  });

  it('list a creator’s exports newest first, and find those to expire', async () => {
    expect(await definitionOf('case_exports_creator_created_at_idx')).toContain(
      '(environment_id, creator_type, creator_id, created_at, id)',
    );
    expect(await definitionOf('case_exports_expiry_idx')).toContain("status = 'completed'::text");
  });

  it('find a source’s pages, and the discarded ones left to delete', async () => {
    expect(await definitionOf('rendition_pages_source_idx')).toContain(
      '(environment_id, source_id)',
    );
    expect(await definitionOf('rendition_pages_discarded_idx')).toContain(
      'discarded_at IS NOT NULL',
    );
  });
});

describe('beside the environment', () => {
  it('go with their environment', async () => {
    const environmentId = await environment();
    const fileId = await seedFile(environmentId);
    const attachmentId = await insertAttachment(environmentId, await seedCase(environmentId));
    await query(
      `insert into file_renditions (file_id, environment_id, status) values ($1, $2, 'pending')`,
      [fileId, environmentId],
    );
    await insertPage(environmentId, attachmentId, 1);
    await insertExport(environmentId);

    await query('begin');
    await query(`select set_config('openverify.environment_deletion', 'on', true)`);
    await query(`delete from environments where id = $1`, [environmentId]);
    await query('commit');

    for (const table of TABLES) {
      const rows = await query<{ count: number }>(
        `select count(*)::int as count from ${table} where environment_id = $1`,
        [environmentId],
      );
      expect(rows.rows, table).toEqual([{ count: 0 }]);
    }
  });
});
