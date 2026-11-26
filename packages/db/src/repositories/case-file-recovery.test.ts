/**
 * K8-28 (Workflow 8D; plan item 111): what `case-export-sweep` enqueues again. Each list answers the
 * rows left unfinished since before its cutoff (an export `pending` or `running`, an unredacted
 * attachment's scan `pending`, an unredacted attachment's or an inquiry file's rendition `pending`),
 * oldest first across environments, and nothing finished, redacted or newer. The rendition lists read
 * their own partial indexes, each explained with sequential scans off. Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedCase,
  seedCaseAttachment,
  seedCaseExport,
  seedCaseTemplate,
  seedFileRendition,
  testId,
  type TestDatabase,
} from '../testing.js';
import { claimCaseExportRow, listUnfinishedCaseExports } from './case-exports.js';
import { listPendingCaseAttachmentScans } from './case-attachments.js';
import { listPendingRenditionSources } from './file-renditions.js';
import { createFile } from './files.js';
import { createVerification } from './verifications.js';

let database: TestDatabase;
let environmentId: string;
let caseId: string;
const NOW = new Date('2026-11-03T12:00:00.000Z');
const OLD = new Date(NOW.getTime() - 10 * 60_000);
const CUTOFF = new Date(NOW.getTime() - 60_000);

const query = (text: string, params: unknown[] = []) => database.client.query(text, params);

/** Stamps a row's times (the update names `updated_at`, so the trigger keeps it). */
const stamp = (table: string, key: string, id: string, at: Date) =>
  query(`update ${table} set created_at = $2, updated_at = $2 where ${key} = $1`, [id, at]);

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  const template = await seedCaseTemplate(database.db, environmentId);
  ({ id: caseId } = await seedCase(database.db, environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: 1,
  }));
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function attachment(input: {
  scan?: 'pending' | 'clean';
  rendition?: 'pending' | 'ready';
  at: Date;
  redacted?: boolean;
}) {
  const { id } = await seedCaseAttachment(database.db, environmentId, { caseId });
  if (input.scan !== undefined) {
    await query(
      `update case_attachments set scan_status = $2, scan_provider = 'sandbox',
         scanned_at = case when $2 = 'clean' then now() else null end where id = $1`,
      [id, input.scan],
    );
  }
  if (input.rendition === 'ready') {
    await query(
      `update case_attachments set rendition_status = 'ready', rendition_page_count = 1,
         rendered_at = now() where id = $1`,
      [id],
    );
  }
  if (input.redacted === true) {
    await query(
      `update case_attachments set redacted_at = now(), original_filename = null, sha256 = null
       where id = $1`,
      [id],
    );
  }
  await stamp('case_attachments', 'id', id, input.at);
  return id;
}

async function fileRendition(at: Date) {
  const { inquiry } = await createTestInquiry(database.db, environmentId);
  const verificationId = testId('ver');
  await createVerification(database.db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  const fileId = testId('file');
  await createFile(database.db, environmentId, {
    id: fileId,
    verificationId,
    kind: 'front',
    storageKey: `${environmentId}/files/${fileId}`,
    mimeType: 'image/png',
    byteSize: 1024,
    sha256: randomBytes(32).toString('hex'),
    wrappedDek: `ov1.${'k'.repeat(11)}.${'d'.repeat(80)}`,
  });
  await seedFileRendition(database.db, environmentId, { fileId });
  await stamp('file_renditions', 'file_id', fileId, at);
  return fileId;
}

describe('the unfinished case file work (K8-28)', () => {
  it('lists the pending and running exports made before the cutoff, oldest first', async () => {
    const pending = (await seedCaseExport(database.db, environmentId)).id;
    const running = (await seedCaseExport(database.db, environmentId)).id;
    const recent = (await seedCaseExport(database.db, environmentId)).id;
    const failed = (await seedCaseExport(database.db, environmentId)).id;
    await query(`update case_exports set status = 'running' where id = $1`, [running]);
    await query(
      `update case_exports set status = 'failed', error_code = 'export_failed', request = null
       where id = $1`,
      [failed],
    );
    await stamp('case_exports', 'id', pending, new Date(OLD.getTime() - 1_000));
    await stamp('case_exports', 'id', running, OLD);
    await stamp('case_exports', 'id', failed, OLD);
    await stamp('case_exports', 'id', recent, NOW);

    expect(await listUnfinishedCaseExports(database.db, CUTOFF, 10)).toEqual([
      { id: pending, environmentId },
      { id: running, environmentId },
    ]);
  });

  it('claims a running export again only once its claim’s lease lapsed', async () => {
    const { id } = await seedCaseExport(database.db, environmentId);
    const claim = (now: Date) =>
      database.db.transaction((tx) => claimCaseExportRow(tx, environmentId, id, { now }));

    const first = await claim(NOW);
    const held = await claim(new Date(NOW.getTime() + 60_000));
    const lapsed = await claim(new Date(NOW.getTime() + 16 * 60_000));

    expect(first?.status).toBe('running');
    expect(held).toBeNull();
    expect(lapsed?.status).toBe('running');
  });

  it('lists the unredacted attachments whose scan is pending since before the cutoff', async () => {
    const waiting = await attachment({ scan: 'pending', at: OLD });
    await attachment({ scan: 'pending', at: NOW });
    await attachment({ scan: 'clean', at: OLD });
    await attachment({ scan: 'pending', at: OLD, redacted: true });

    expect(await listPendingCaseAttachmentScans(database.db, CUTOFF, 10)).toEqual([
      { id: waiting, environmentId },
    ]);
  });

  it('lists the pending renditions of unredacted attachments and of files, oldest first', async () => {
    await query(`update case_attachments set rendition_status = 'ready',
      rendition_page_count = 1, rendered_at = now() where rendition_status = 'pending'`);
    const file = await fileRendition(new Date(OLD.getTime() - 1_000));
    const waiting = await attachment({ at: OLD });
    await attachment({ at: NOW });
    await attachment({ at: OLD, rendition: 'ready' });
    await attachment({ at: OLD, redacted: true });
    await fileRendition(NOW);

    expect(await listPendingRenditionSources(database.db, CUTOFF, 10)).toEqual([
      { sourceId: file, environmentId },
      { sourceId: waiting, environmentId },
    ]);
  });

  it('reads the pending renditions through their partial indexes', async () => {
    const spy = vi.spyOn(database.client, 'query');
    let calls: unknown[][];
    try {
      await listPendingRenditionSources(database.db, CUTOFF, 10);
    } finally {
      calls = [...spy.mock.calls];
      spy.mockRestore();
    }
    const sent = calls
      .map(([text, params]) => ({ text: text as string, params: (params ?? []) as unknown[] }))
      .filter(({ text }) => text.includes('rendition'));
    expect(sent.length).toBeGreaterThan(0);
    const plans: string[] = [];
    await query('set enable_seqscan = off');
    try {
      for (const { text, params } of sent) {
        const explained = await query(`explain ${text}`, params);
        plans.push(
          (explained.rows as Record<string, string>[])
            .map((row) => Object.values(row).join(''))
            .join('\n'),
        );
      }
    } finally {
      await query('reset enable_seqscan');
    }
    const plan = plans.join('\n');

    expect(plan).toContain('case_attachments_rendition_pending_idx');
    expect(plan).toContain('file_renditions_pending_idx');
  });
});
