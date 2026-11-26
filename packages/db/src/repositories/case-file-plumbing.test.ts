/**
 * Workflow 8B Stage 1b, checkpoint (F): what `foundation-8b` builds in the repositories for an
 * attachment, a rendition and an export.
 *
 * - the sealed name and request, and the three wrapped data keys, listed for the rewrap, and
 *   `kek:rewrap` re-wrapping each, so the new KEK alone opens them (C143.5);
 * - an attachment's id is a redaction subject (C143.5);
 * - the seeds write each row as the tables hold it;
 * - the repositories themselves are `api-case-files`' (`case-files.test.ts`).
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, decryptBytes, encryptBytes, setDefaultKeyring } from '../crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { openJson, openValue, type Sealed } from '../sealed.js';
import {
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseAttachment,
  seedCaseExport,
  seedCaseTemplate,
  seedFileRendition,
  seedRenditionPage,
  testId,
  type TestDatabase,
} from '../testing.js';
import { REWRAP_TABLES, rewrapAll } from './key-rotation.js';
import { REDACTION_SUBJECT_ID_PREFIXES, subjectIdsIn } from './subject-ids.js';

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const oldKeyring = createKeyring(oldKek);
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

const tenant = async () => (await createTestTenant(database.db)).environment.id;

let numbers = 0;

async function newCase(environmentId: string): Promise<string> {
  const template = await seedCaseTemplate(database.db, environmentId);
  numbers += 1;
  const { id } = await seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: numbers,
  });
  return id;
}

const FILE_COLUMNS = [
  'case_attachments.original_filename:row',
  'case_attachments.wrapped_dek:file',
  'case_exports.request:row',
  'case_exports.wrapped_dek:file',
  'rendition_pages.wrapped_dek:file',
];

describe('C143.5: the sealed attachment, rendition and export columns', () => {
  it('are listed for the rewrap, under their seal names', () => {
    expect(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}:${c.aad}`)).toEqual(
      expect.arrayContaining(FILE_COLUMNS),
    );
    expect(REWRAP_TABLES).toEqual(
      expect.arrayContaining(['case_attachments', 'case_exports', 'rendition_pages']),
    );
    expect([SEALED.caseAttachmentFilename, SEALED.caseExportRequest]).toEqual([
      'case_attachments.original_filename',
      'case_exports.request',
    ]);
  });

  it('are re-wrapped by kek:rewrap, so the new KEK alone opens them', async () => {
    const environmentId = await tenant();
    const caseId = await newCase(environmentId);
    const attachmentId = testId('catt');
    const original = encryptBytes(Buffer.from('synthetic attachment'), oldKeyring, {
      context: attachmentId,
    });
    await seedCaseAttachment(database.db, environmentId, {
      id: attachmentId,
      caseId,
      filename: 'synthetic-canary.png',
      wrappedDek: original.wrappedDek,
    });
    const page = encryptBytes(Buffer.from('synthetic page'), oldKeyring, {
      context: `${attachmentId}/1`,
    });
    await seedRenditionPage(database.db, environmentId, {
      sourceId: attachmentId,
      page: 1,
      wrappedDek: page.wrappedDek,
    });
    const exportId = testId('cexp');
    await seedCaseExport(database.db, environmentId, {
      id: exportId,
      request: { filter: { status: ['open'] } },
    });
    const file = encryptBytes(Buffer.from('synthetic export'), oldKeyring, { context: exportId });
    await query(
      `update case_exports set status = 'completed', request = null, case_count = 1,
         byte_size = 16, storage_key = $2, wrapped_dek = $3, completed_at = now(),
         expires_at = now() + interval '24 hours'
       where id = $1`,
      [exportId, `exports/${exportId}`, file.wrappedDek],
    );
    const pending = testId('cexp');
    await seedCaseExport(database.db, environmentId, {
      id: pending,
      request: { search: { canary: 'request' } },
    });

    await rewrapAll(database.db, { keyring: createKeyring(newKek, [oldKek]) });

    const newOnly = createKeyring(newKek);
    const read = async (table: string, column: string, id: string) => {
      const rows = await query<{ value: string | null }>(
        `select "${column}" as value from "${table}" where id = $1`,
        [id],
      );
      return rows.rows[0]?.value ?? null;
    };
    const filename = (await read('case_attachments', 'original_filename', attachmentId)) as Sealed;
    expect(openValue(SEALED.caseAttachmentFilename, attachmentId, filename, newOnly)).toBe(
      'synthetic-canary.png',
    );
    const request = (await read('case_exports', 'request', pending)) as Sealed;
    expect(openJson(SEALED.caseExportRequest, pending, request, newOnly)).toEqual({
      search: { canary: 'request' },
    });
    const opened = async (table: string, id: string, ciphertext: Uint8Array, context: string) =>
      decryptBytes(
        { ciphertext, wrappedDek: (await read(table, 'wrapped_dek', id)) ?? '' },
        newOnly,
        { context },
      ).toString();
    expect(await opened('case_attachments', attachmentId, original.ciphertext, attachmentId)).toBe(
      'synthetic attachment',
    );
    expect(
      await opened('rendition_pages', `${attachmentId}/1`, page.ciphertext, `${attachmentId}/1`),
    ).toBe('synthetic page');
    expect(await opened('case_exports', exportId, file.ciphertext, exportId)).toBe(
      'synthetic export',
    );
    setDefaultKeyring(createKeyring(newKek, [oldKek]));
  });
});

describe('C143.5: an attachment’s id is a redaction subject', () => {
  it('is found in a copy', () => {
    const attachmentId = testId('catt');

    expect(REDACTION_SUBJECT_ID_PREFIXES).toEqual(expect.arrayContaining(['catt']));
    expect(subjectIdsIn(JSON.stringify({ data: { attachment: attachmentId } }))).toEqual([
      attachmentId,
    ]);
  });
});

describe('the seeds', () => {
  it('write an attachment not scanned, a file’s rendition and its page, and a pending export', async () => {
    const environmentId = await tenant();
    const caseId = await newCase(environmentId);
    const { id } = await seedCaseAttachment(database.db, environmentId, { caseId });
    const pageId = await seedRenditionPage(database.db, environmentId, { sourceId: id, page: 2 });
    const { id: exportId } = await seedCaseExport(database.db, environmentId);

    const attachment = await query<{ scan_status: string; rendition_status: string }>(
      `select scan_status, rendition_status from case_attachments where id = $1`,
      [id],
    );
    const exported = await query<{ status: string }>(
      `select status from case_exports where id = $1`,
      [exportId],
    );
    expect(attachment.rows).toEqual([{ scan_status: 'not_scanned', rendition_status: 'pending' }]);
    expect(pageId).toBe(`${id}/2`);
    expect(exported.rows).toEqual([{ status: 'pending' }]);
    await expect(
      seedFileRendition(database.db, environmentId, { fileId: testId('file') }),
    ).rejects.toMatchObject({ cause: { constraint: 'file_renditions_file_fk' } });
  });
});
