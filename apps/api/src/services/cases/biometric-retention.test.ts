/**
 * K8-21 (Workflow 8D; C139.3, P22, plan item 113): in the C16 pass, an image attachment of a case
 * that holds a selfie inquiry is redacted once that inquiry's biometric data goes: its selfie is past
 * the environment's `face-template-retention-days`, or the inquiry was redacted. The attachment keeps
 * its id, type, size and scan status; its original and rendition pages are deleted after the commit;
 * a system audit entry names it; the pass counts it. A PDF, a case holding no selfie inquiry and a
 * selfie inside its retention keep theirs. Every value is synthetic.
 */
import { createVerification, updateEnvironmentSettings } from '@openverify/db';
import {
  createTestInquiry,
  seedCase,
  seedCaseAttachment,
  seedCaseTemplate,
  seedRenditionPage,
  testId,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../../test-support/harness.js';
import { runCaseRetention } from './retention.js';

let api: TestApi;
const NOW = new Date('2026-11-03T12:00:00.000Z');
const DAY = 86_400_000;
let cases = 0;

beforeAll(async () => {
  api = await createTestApi();
  await updateEnvironmentSettings(api.database.db, api.environmentId, {
    'face-template-retention-days': 30,
  });
}, 120_000);

afterAll(async () => {
  await api.close();
});

/** A case holding an inquiry, with a selfie made `selfieAgeDays` ago unless `null`. */
async function caseHolding(selfieAgeDays: number | null, options: { redacted?: boolean } = {}) {
  const { db } = api.database;
  const template = await seedCaseTemplate(db, api.environmentId);
  cases += 1;
  const made = await seedCase(db, api.environmentId, {
    caseTemplateId: template.id,
    caseTemplateVersionId: template.versionId,
    key: template.key,
    number: cases,
  });
  const { inquiry } = await createTestInquiry(db, api.environmentId);
  if (selfieAgeDays !== null) {
    const id = testId('ver');
    await createVerification(db, api.environmentId, { id, inquiryId: inquiry.id, type: 'selfie' });
    await db.execute(sql`update verifications set created_at = ${new Date(
      NOW.getTime() - selfieAgeDays * DAY,
    ).toISOString()}::timestamptz where id = ${id}`);
  }
  if (options.redacted === true) {
    await db.execute(sql`update inquiries set redacted_at = ${NOW.toISOString()}::timestamptz
      where id = ${inquiry.id}`);
  }
  await db.execute(sql`insert into case_inquiries (environment_id, case_id, inquiry_id,
      attached_by_type, attached_by_id)
    values (${api.environmentId}, ${made.id}, ${inquiry.id}, 'user', ${testId('usr')})`);
  return { caseId: made.id, inquiryId: inquiry.id };
}

/** An attachment with its stored object and one rendition page's. */
async function attachment(caseId: string, mimeType: 'image/png' | 'application/pdf' = 'image/png') {
  const { db } = api.database;
  const { id, storageKey } = await seedCaseAttachment(db, api.environmentId, { caseId });
  if (mimeType !== 'image/png') {
    await db.execute(sql`update case_attachments set mime_type = ${mimeType} where id = ${id}`);
  }
  const pageId = await seedRenditionPage(db, api.environmentId, { sourceId: id });
  const pageKey = `${api.environmentId}/renditions/${pageId}`;
  await api.storage.put(storageKey, new Uint8Array([1, 2, 3]));
  await api.storage.put(pageKey, new Uint8Array([4, 5, 6]));
  return { id, storageKey, pageKey };
}

const stateOf = async (id: string) => {
  const { rows } = await api.database.client.query<{
    redacted: boolean;
    filename: boolean;
    rendition_status: string;
    scan_status: string;
    byte_size: number;
  }>(
    `select redacted_at is not null as redacted, original_filename is not null as filename,
       rendition_status, scan_status, byte_size
     from case_attachments where id = $1`,
    [id],
  );
  return rows[0];
};

const run = () =>
  runCaseRetention(
    { db: api.database.db, storage: api.storage, events: api.deps.events },
    { now: NOW, limit: 100 },
  );

describe('image attachments follow a held selfie inquiry’s biometric retention (K8-21)', () => {
  it('redacts the image of a case holding a selfie past retention, or a redacted one, and no other', async () => {
    const past = await caseHolding(40);
    const pastImage = await attachment(past.caseId);
    const pastPdf = await attachment(past.caseId, 'application/pdf');
    const redacted = await caseHolding(5, { redacted: true });
    const redactedImage = await attachment(redacted.caseId);
    const recent = await caseHolding(10);
    const recentImage = await attachment(recent.caseId);
    const noSelfie = await caseHolding(null);
    const noSelfieImage = await attachment(noSelfie.caseId);

    const report = await run();

    expect(report.redactedBiometricAttachments).toBe(2);
    for (const { id, storageKey, pageKey } of [pastImage, redactedImage]) {
      expect(await stateOf(id)).toEqual({
        redacted: true,
        filename: false,
        rendition_status: 'deleted',
        scan_status: 'not_scanned',
        byte_size: 1024,
      });
      expect(await api.storage.get(storageKey)).toBeNull();
      expect(await api.storage.get(pageKey)).toBeNull();
    }
    for (const { id, storageKey } of [pastPdf, recentImage, noSelfieImage]) {
      expect((await stateOf(id))?.redacted).toBe(false);
      expect(await api.storage.get(storageKey)).not.toBeNull();
    }
    const { rows } = await api.database.client.query<{
      actor_type: string;
      resource_id: string;
      metadata: Record<string, unknown>;
    }>(
      `select actor_type, resource_id, metadata from audit_logs
       where action = 'case-attachment.redacted' order by resource_id`,
    );
    expect(rows).toEqual(
      [
        {
          actor_type: 'system',
          resource_id: pastImage.id,
          metadata: {
            'case-id': past.caseId,
            'inquiry-id': past.inquiryId,
            retention: 'biometric',
          },
        },
        {
          actor_type: 'system',
          resource_id: redactedImage.id,
          metadata: {
            'case-id': redacted.caseId,
            'inquiry-id': redacted.inquiryId,
            retention: 'biometric',
          },
        },
      ].sort((left, right) => left.resource_id.localeCompare(right.resource_id)),
    );
  });

  it('redacts each image once', async () => {
    const report = await run();

    expect(report.redactedBiometricAttachments).toBe(0);
  });
});
