/**
 * C135 (Workflow 8B Stage 3, `api-case-files`): a case's attachments through their routes and jobs.
 *
 * - Upload (`POST /cases/:id/attachments`): one multipart file, typed by its bytes (422
 *   `attachment_type_refused`), within the version's policy (422 `case_attachment_limit`), sealed
 *   into storage with its sealed name; the case gains it, with history and `case.updated`, and an
 *   audit entry that names no file. A redacted case takes none (410), and `case-attachments` follows
 *   C12 (429 past it, through when the limiter cannot answer).
 * - Scanning (C135.5): with no scanner bound an attachment is `not_scanned` and served; with one it is
 *   `pending` (409 `attachment_scan_pending`) until the scan job says `clean`; `infected` and an
 *   `error` after three attempts are never served.
 * - Renditions (C135.3, C135.4): the content route serves only the rendition, 202 with Retry-After
 *   while it is made (asking for it again), 422 `rendition_unavailable` when vision cannot make it,
 *   each view audited, never without `pii:view`; the original goes to `cases:redact` with `pii:view`.
 * - The public PATCH (C135.1) stores through `acceptPatchAttachments` when given the store.
 * - Redaction (C139.1, P34) keeps the row's id, type, size and scan status and hands back every
 *   object; the content route then answers 404.
 *
 * Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { getCaseRow, listPendingRenditionSources } from '@openverify/db';
import { testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCaseAttachmentScanQueue,
  createCaseRenditionQueue,
} from '../../../jobs/case-file-queues.js';
import {
  processCaseAttachmentScan,
  processCaseRendition,
  type CaseFileJobDeps,
} from '../../../jobs/cases/index.js';
import {
  FAKE_PNG,
  createCapturingLogger,
  createFakeVision,
  createRecordingQueue,
} from '../../../jobs/testing.js';
import type {
  AttachmentScanner,
  CaseAttachmentScanJob,
  CaseRenditionJob,
  RateLimiter,
} from '../../../ports.js';
import { createAllowAllRateLimiter } from '../../../test-support/fakes.js';
import { bearer, createTestApi, type TestApi } from '../../../test-support/harness.js';
import { VisionServiceError } from '../../../vision/index.js';
import { acceptPatchAttachments } from './patch.js';
import { redactCaseAttachmentsInTx } from './redaction.js';
import { redactCasesInTx } from '../redaction.js';

const BOUNDARY = 'synthetic-boundary-0123456789';
const EICAR = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
  'EICAR-STANDARD-ANTIVIRUS-',
  'TEST-FILE!$H+H*',
].join('');

/** A PNG whose metadata a rendition would strip: here, just recognisable bytes after the header. */
const PNG = new Uint8Array([...FAKE_PNG, ...Buffer.from('synthetic-gps-canary')]);
const KEY = testId('key');
const RENDERED = new Uint8Array([...FAKE_PNG, 7, 7, 7]);

function multipart(bytes: Uint8Array, filename = 'synthetic-canary.png', name = 'file'): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

const scanJobs = createRecordingQueue<CaseAttachmentScanJob>();
const renditionJobs = createRecordingQueue<CaseRenditionJob>();
const scanners: { sandbox: 'sandbox' | 'clamd' | null; production: 'sandbox' | 'clamd' | null } = {
  sandbox: null,
  production: null,
};
const allow = createAllowAllRateLimiter();
let limiter: RateLimiter = allow;

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi({
    caseAttachmentScans: createCaseAttachmentScanQueue({ queue: scanJobs }),
    caseRenditions: createCaseRenditionQueue({ queue: renditionJobs }),
    attachmentScanners: scanners,
    rateLimiter: { consume: (key, policy) => limiter.consume(key, policy) },
  });
  token = api.newUserToken(api.environmentId);
}, 120_000);

afterAll(async () => {
  await api.close();
});

let calls = 0;
const request = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { payload?: unknown; multipart?: Buffer; as?: string } = {},
) =>
  api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...bearer(options.as ?? token),
      'idempotency-key': `attachments-${String((calls += 1))}`,
      ...(options.multipart === undefined
        ? {}
        : { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }),
    },
    ...(options.multipart === undefined
      ? options.payload === undefined
        ? {}
        : { payload: options.payload as Record<string, unknown> }
      : { payload: options.multipart }),
  });

interface Attachment {
  id: string;
  filename: string | null;
  url: string;
  'byte-size': number;
  'attachment-type': string;
  'scan-status': string;
  'scan-provider': string | null;
  'rendition-status': string;
  'page-count': number | null;
}

const attachmentsOf = (body: string) =>
  (JSON.parse(body) as { data: { attributes: { attachments: Attachment[] } } }).data.attributes
    .attachments;

/** A problem's code, or `undefined`. */
const codeOf = (response: { body: string }) =>
  (JSON.parse(response.body) as { code?: string }).code;

let keys = 0;
async function newCase(policy?: Record<string, unknown>): Promise<string> {
  keys += 1;
  const template = await request('POST', '/case-templates', {
    payload: { data: { attributes: { name: 'Synthetic files', key: `CF${String(keys)}` } } },
  });
  expect(template.statusCode, template.body).toBe(201);
  const created = JSON.parse(template.body) as {
    data: { id: string; relationships: { 'draft-version': { data: { id: string } } } };
  };
  const versionId = created.data.relationships['draft-version'].data.id;
  if (policy !== undefined) {
    await api.database.db.execute(
      sql`update case_template_versions set attachment_policy = ${JSON.stringify(policy)}::jsonb
          where id = ${versionId}`,
    );
  }
  const published = await request('POST', `/case-template-versions/${versionId}/publish`, {
    payload: { meta: {} },
  });
  expect(published.statusCode, published.body).toBe(200);
  const made = await request('POST', '/cases', {
    payload: { data: { attributes: { 'case-template-id': created.data.id } } },
  });
  expect(made.statusCode, made.body).toBe(201);
  return (JSON.parse(made.body) as { data: { id: string } }).data.id;
}

async function upload(caseId: string, bytes: Uint8Array = PNG) {
  const response = await request('POST', `/cases/${caseId}/attachments`, {
    multipart: multipart(bytes),
  });
  expect(response.statusCode, response.body).toBe(201);
  const attachments = attachmentsOf(response.body);
  const last = attachments.at(-1);
  if (last === undefined) {
    throw new Error('no attachment was answered');
  }
  return last;
}

const vision = createFakeVision();
const sandboxScanner: AttachmentScanner = {
  provider: 'sandbox',
  scan: ({ bytes }) =>
    Promise.resolve({
      verdict: Buffer.from(bytes).includes(Buffer.from(EICAR, 'latin1')) ? 'infected' : 'clean',
      provider: 'sandbox',
    }),
};
let scanner: AttachmentScanner | undefined = sandboxScanner;

function jobDeps(): CaseFileJobDeps {
  const bound = { attachmentScanner: scanner } as never;
  return {
    db: api.database.db,
    storage: api.storage,
    keyring: api.deps.keyring,
    vision: vision.client,
    events: api.deps.events,
    clock: api.clock,
    logger: createCapturingLogger(),
    providers: { sandbox: bound, production: bound },
  };
}

const render = (attachmentId: string) =>
  processCaseRendition({ environmentId: api.environmentId, sourceId: attachmentId }, jobDeps());
const scan = (attachmentId: string) =>
  processCaseAttachmentScan(
    { environmentId: api.environmentId, caseAttachmentId: attachmentId },
    jobDeps(),
  );

const content = (caseId: string, attachmentId: string, query = '', as?: string) =>
  request('GET', `/cases/${caseId}/attachments/${attachmentId}/content${query}`, {
    ...(as === undefined ? {} : { as }),
  });

const onePage = () => ({
  source: 'image' as const,
  pageCount: 1,
  truncated: false,
  pages: [{ page: 1, mediaType: 'image/png' as const, width: 1, height: 1, bytes: RENDERED }],
});

describe('uploading an attachment (C135.1, C135.2)', () => {
  it('stores it sealed, typed by its bytes, and the case gains it with history and an event', async () => {
    const caseId = await newCase();
    const before = api.events.named('case.updated').length;
    const queued = renditionJobs.jobs.length;
    const version = (await getCaseRow(api.database.db, api.environmentId, caseId))?.lockVersion;

    const made = await upload(caseId);

    expect(made).toMatchObject({
      filename: 'synthetic-canary.png',
      url: `/api/v1/cases/${caseId}/attachments/${made.id}/content`,
      'byte-size': PNG.byteLength,
      'attachment-type': 'png',
      'scan-status': 'not_scanned',
      'scan-provider': null,
      'rendition-status': 'pending',
      'page-count': null,
    });
    const stored = await api.database.client.query<{
      original_filename: string;
      sha256: string;
      storage_key: string;
      uploader_type: string;
    }>(
      'select original_filename, sha256, storage_key, uploader_type from case_attachments where id = $1',
      [made.id],
    );
    const row = stored.rows[0];
    expect(row?.original_filename).not.toContain('synthetic-canary');
    expect(row?.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(row?.uploader_type).toBe('user');
    const object = await api.storage.get(row?.storage_key ?? '');
    expect(Buffer.from(object ?? []).includes(Buffer.from('synthetic-gps-canary'))).toBe(false);
    expect(api.events.named('case.updated').slice(before)).toHaveLength(1);
    expect(JSON.stringify(api.events.named('case.updated').slice(before))).not.toContain(
      'synthetic-canary',
    );
    const history = await api.database.client.query<{ kind: string; to: unknown }>(
      `select kind, "to" from case_history where case_id = $1 and kind = 'attachment-added'`,
      [caseId],
    );
    expect(history.rows).toEqual([{ kind: 'attachment-added', to: { 'attachment-id': made.id } }]);
    const audit = api.audit.withAction('case-attachment.uploaded').at(-1);
    expect(audit?.metadata).toEqual({
      'case-id': caseId,
      'attachment-type': 'png',
      'byte-size': PNG.byteLength,
    });
    expect(renditionJobs.jobs.slice(queued).map(({ data }) => data.sourceId)).toEqual([made.id]);
    expect((await getCaseRow(api.database.db, api.environmentId, caseId))?.lockVersion).toBe(
      (version ?? 0) + 1,
    );
  });

  it('refuses a type its bytes are not, a type the policy leaves out, and one past the cap', async () => {
    const caseId = await newCase({ 'max-files': 1, types: ['png'] });
    const text = await request('POST', `/cases/${caseId}/attachments`, {
      multipart: multipart(Buffer.from('synthetic plain text')),
    });
    const pdf = await request('POST', `/cases/${caseId}/attachments`, {
      multipart: multipart(Buffer.from('%PDF-1.7\nsynthetic\n%%EOF\n')),
    });
    await upload(caseId);
    const second = await request('POST', `/cases/${caseId}/attachments`, {
      multipart: multipart(PNG),
    });
    const noFile = await request('POST', `/cases/${caseId}/attachments`, {
      multipart: multipart(PNG, 'x.png', 'other'),
    });

    expect([text.statusCode, codeOf(text)]).toEqual([422, 'attachment_type_refused']);
    expect([pdf.statusCode, codeOf(pdf)]).toEqual([422, 'attachment_type_refused']);
    expect([second.statusCode, codeOf(second)]).toEqual([422, 'case_attachment_limit']);
    expect(noFile.statusCode).toBe(400);
    expect(text.body).not.toContain('synthetic plain text');
  });

  it('refuses a redacted case, and follows C12 for case-attachments', async () => {
    const caseId = await newCase();
    const redacted = await newCase();
    await api.database.db.execute(
      sql`update cases set redacted_at = now(), fields = null where id = ${redacted}`,
    );

    const gone = await request('POST', `/cases/${redacted}/attachments`, {
      multipart: multipart(PNG),
    });
    limiter = {
      consume: (_key, policy) =>
        Promise.resolve({
          allowed: false,
          limit: policy.limit,
          remaining: 0,
          resetAt: new Date(),
          retryAfterSeconds: 9,
        }),
    };
    const limited = await request('POST', `/cases/${caseId}/attachments`, {
      multipart: multipart(PNG),
    });
    limiter = { consume: () => Promise.reject(new Error('synthetic limiter outage')) };
    const unanswered = await request('POST', `/cases/${caseId}/attachments`, {
      multipart: multipart(PNG),
    });
    limiter = allow;

    expect([gone.statusCode, codeOf(gone)]).toEqual([410, 'case_redacted']);
    expect([limited.statusCode, limited.headers['retry-after']]).toEqual([429, '9']);
    expect(unanswered.statusCode).toBe(201);
    expect(allow.calls.some(({ policy }) => policy.name === 'case-attachments')).toBe(true);
  });
});

describe('serving an attachment (C135.3, C135.4)', () => {
  it('answers 202 until the rendition is made, then the rendition alone, audited per view', async () => {
    const caseId = await newCase();
    const made = await upload(caseId);
    const queued = renditionJobs.jobs.length;

    const pending = await content(caseId, made.id);
    vision.answers.createRendition = onePage();
    await render(made.id);
    const page = await content(caseId, made.id);
    const pastEnd = await content(caseId, made.id, '?page=2');

    expect(pending.statusCode, pending.body).toBe(202);
    expect(pending.headers['retry-after']).toBe('5');
    expect(JSON.parse(pending.body)).toEqual({
      meta: { 'rendition-status': 'pending', 'retry-after-seconds': 5 },
    });
    expect(renditionJobs.jobs.slice(queued).map(({ data }) => data.sourceId)).toEqual([made.id]);
    expect(page.statusCode, page.body).toBe(200);
    expect(Buffer.from(page.rawPayload).equals(Buffer.from(RENDERED))).toBe(true);
    expect(page.headers).toMatchObject({
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="case-attachment-${made.id}.png"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    });
    expect(pastEnd.statusCode).toBe(404);
    expect(api.audit.withAction('case-attachment.viewed').at(-1)?.metadata).toEqual({
      'case-id': caseId,
      page: 1,
    });
    const listed = await request('GET', `/cases/${caseId}`);
    expect(listed.statusCode).toBe(200);
  });

  it('answers 422 rendition_unavailable when vision cannot make it, and keeps it pending on a retryable error', async () => {
    const caseId = await newCase();
    const retried = await upload(caseId);
    const failed = await upload(caseId);

    vision.answers.createRendition = new VisionServiceError('/v1/renditions', 503, 'busy');
    await render(retried.id);
    vision.answers.createRendition = new VisionServiceError('/v1/renditions', 422, 'pdf_encrypted');
    await render(failed.id);

    expect((await content(caseId, retried.id)).statusCode).toBe(202);
    const unavailable = await content(caseId, failed.id);
    expect([unavailable.statusCode, codeOf(unavailable)]).toEqual([422, 'rendition_unavailable']);
  });

  it('stops asking after three retryable failures, and serves rendition_unavailable (Workflow 8C review R003)', async () => {
    const caseId = await newCase();
    const made = await upload(caseId);
    vision.answers.createRendition = new VisionServiceError('/v1/renditions', 503, 'busy');

    await render(made.id);
    await render(made.id);
    expect((await content(caseId, made.id)).statusCode).toBe(202);
    await render(made.id);

    const unavailable = await content(caseId, made.id);
    expect([unavailable.statusCode, codeOf(unavailable)]).toEqual([422, 'rendition_unavailable']);
  });

  it('needs pii:view, and serves the original to cases:redact alone, audited', async () => {
    const caseId = await newCase();
    const made = await upload(caseId);
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['cases:read', 'cases:redact'],
      piiMasked: true,
    });
    const reader = await api.newApiKey(api.environmentId, { scopes: ['cases:read'] });

    const noPii = await content(caseId, made.id, '', masked);
    const original = await request('GET', `/cases/${caseId}/attachments/${made.id}/original`);
    const noRedact = await request('GET', `/cases/${caseId}/attachments/${made.id}/original`, {
      as: reader,
    });
    const otherCase = await content(await newCase(), made.id);

    expect(noPii.statusCode).toBe(403);
    expect(original.statusCode, original.body).toBe(200);
    expect(Buffer.from(original.rawPayload).equals(Buffer.from(PNG))).toBe(true);
    expect(original.headers['content-disposition']).toBe(
      `attachment; filename="case-attachment-${made.id}.png"`,
    );
    expect(api.audit.withAction('case-attachment.original-viewed').at(-1)?.metadata).toEqual({
      'case-id': caseId,
    });
    expect(noRedact.statusCode).toBe(403);
    expect(otherCase.statusCode).toBe(404);
  });
});

describe('scanning (C135.5)', () => {
  it('holds a pending attachment at 409, serves it once clean, and never an infected one', async () => {
    scanners.sandbox = 'sandbox';
    try {
      const caseId = await newCase();
      const scans = scanJobs.jobs.length;
      const clean = await upload(caseId);
      const infected = await upload(
        caseId,
        new Uint8Array([...PNG, ...Buffer.from(EICAR, 'latin1')]),
      );
      vision.answers.createRendition = onePage();
      await render(clean.id);

      const waiting = await content(caseId, clean.id);
      await scan(clean.id);
      await scan(infected.id);
      const served = await content(caseId, clean.id);
      const refused = await content(caseId, infected.id);
      const original = await request('GET', `/cases/${caseId}/attachments/${infected.id}/original`);

      expect(clean).toMatchObject({ 'scan-status': 'pending', 'scan-provider': 'sandbox' });
      // Each upload asks for its scan, and the request that found one pending asked again.
      expect(scanJobs.jobs.slice(scans).map(({ data }) => data.caseAttachmentId)).toEqual([
        clean.id,
        infected.id,
        clean.id,
      ]);
      expect([waiting.statusCode, codeOf(waiting)]).toEqual([409, 'attachment_scan_pending']);
      expect(served.statusCode).toBe(200);
      expect([refused.statusCode, codeOf(refused)]).toEqual([409, 'attachment_infected']);
      expect(original.statusCode).toBe(409);
      const history = await api.database.client.query<{ to: unknown }>(
        `select "to" from case_history where case_id = $1 and kind = 'attachment-scanned' order by id`,
        [caseId],
      );
      expect(history.rows.map(({ to }) => to)).toEqual([
        { 'attachment-id': clean.id, 'scan-status': 'clean' },
        { 'attachment-id': infected.id, 'scan-status': 'infected' },
      ]);
    } finally {
      scanners.sandbox = null;
    }
  });

  it('retries a scan error up to three attempts, then keeps it error and never serves it', async () => {
    scanners.sandbox = 'clamd';
    let attempts = 0;
    scanner = {
      provider: 'clamd',
      scan: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('synthetic outage'))
          : Promise.resolve({ verdict: 'error', provider: 'clamd' });
      },
    };
    try {
      const caseId = await newCase();
      const made = await upload(caseId);

      await scan(made.id);
      const refused = await content(caseId, made.id);

      expect(attempts).toBe(3);
      const row = await api.database.client.query<{ scan_status: string; scan_attempts: number }>(
        'select scan_status, scan_attempts from case_attachments where id = $1',
        [made.id],
      );
      expect(row.rows).toEqual([{ scan_status: 'error', scan_attempts: 3 }]);
      expect(refused.statusCode).toBe(409);
      // K8-27 (Workflow 9B, contracts B41): a scan that ended in error is named.
      expect(codeOf(refused)).toBe('attachment_scan_failed');
    } finally {
      scanners.sandbox = null;
      scanner = sandboxScanner;
    }
  });
});

describe('the rendition of an attachment that is never served (C135.3, C135.5)', () => {
  it('records it failed without asking vision, so the sweep never lists it again (Workflow 8D review R008)', async () => {
    scanners.sandbox = 'sandbox';
    try {
      const caseId = await newCase();
      const infected = await upload(
        caseId,
        new Uint8Array([...PNG, ...Buffer.from(EICAR, 'latin1')]),
      );
      const unscannable = await upload(caseId);
      await scan(infected.id);
      await api.database.client.query(
        `update case_attachments set scan_status = 'error', scan_attempts = 3 where id = $1`,
        [unscannable.id],
      );
      const ids = [infected.id, unscannable.id];
      const listed = async () =>
        (await listPendingRenditionSources(api.database.db, new Date(Date.now() + 60_000), 500))
          .map(({ sourceId }) => sourceId)
          .filter((id) => ids.includes(id));
      const asked = vision.calls.length;
      expect(await listed()).toEqual(expect.arrayContaining(ids));

      await render(infected.id);
      await render(unscannable.id);

      const rows = await api.database.client.query<{
        id: string;
        scan_status: string;
        rendition_status: string;
        rendition_error_code: string | null;
      }>(
        `select id, scan_status, rendition_status, rendition_error_code from case_attachments
          where id = any($1) order by scan_status`,
        [ids],
      );
      expect(rows.rows).toEqual([
        {
          id: unscannable.id,
          scan_status: 'error',
          rendition_status: 'failed',
          rendition_error_code: 'rendition_unavailable',
        },
        {
          id: infected.id,
          scan_status: 'infected',
          rendition_status: 'failed',
          rendition_error_code: 'rendition_unavailable',
        },
      ]);
      // Not a byte of either went to vision, and the sweep has nothing left of them to enqueue.
      expect(vision.calls.slice(asked)).toEqual([]);
      expect(await listed()).toEqual([]);
    } finally {
      scanners.sandbox = null;
    }
  });
});

describe('the public PATCH and redaction (C135.1, C139.1)', () => {
  it('stores PATCH items through acceptPatchAttachments when given the store', async () => {
    const caseId = await newCase();
    const at = api.clock.now();

    const ids = await api.database.db.transaction((tx) =>
      acceptPatchAttachments(
        tx,
        { environmentId: api.environmentId, caseId, uploader: { type: 'api-key', id: KEY } },
        [{ data: Buffer.from(PNG).toString('base64'), filename: 'synthetic-patch.png' }],
        { deps: api.deps, environmentKind: 'sandbox' },
      ),
    );
    const refused = api.database.db.transaction((tx) =>
      acceptPatchAttachments(
        tx,
        { environmentId: api.environmentId, caseId, uploader: { type: 'api-key', id: KEY } },
        [{ data: Buffer.from('not an image').toString('base64'), filename: 'x.txt' }],
        { deps: api.deps, environmentKind: 'sandbox' },
      ),
    );
    const read = await request('GET', `/cases/${caseId}`);

    expect(ids).toHaveLength(1);
    await expect(refused).rejects.toMatchObject({ code: 'attachment_type_refused' });
    expect(read.statusCode).toBe(200);
    const row = await api.database.client.query<{ uploader_type: string; created_at: Date }>(
      'select uploader_type, created_at from case_attachments where id = $1',
      [ids[0]],
    );
    expect(row.rows[0]?.uploader_type).toBe('api-key');
    expect(row.rows[0]?.created_at.getTime()).toBeGreaterThanOrEqual(at.getTime() - 60_000);
  });

  it('redacts a case’s attachments, handing back every object, and serves none after', async () => {
    const caseId = await newCase();
    const made = await upload(caseId);
    vision.answers.createRendition = onePage();
    await render(made.id);
    const keys = await api.database.client.query<{ storage_key: string }>(
      `select storage_key from case_attachments where id = $1
       union all select storage_key from rendition_pages where source_id = $1`,
      [made.id],
    );

    const redacted = await api.database.db.transaction((tx) =>
      redactCaseAttachmentsInTx(tx, {
        environmentId: api.environmentId,
        caseIds: [caseId],
        at: api.clock.now(),
      }),
    );
    const again = await api.database.db.transaction((tx) =>
      redactCaseAttachmentsInTx(tx, {
        environmentId: api.environmentId,
        caseIds: [caseId],
        at: api.clock.now(),
      }),
    );

    expect([...redacted.storageKeys].sort()).toEqual(
      keys.rows.map((row) => row.storage_key).sort(),
    );
    expect(again.storageKeys).toEqual([]);
    expect((await content(caseId, made.id)).statusCode).toBe(404);
    const row = await api.database.client.query<{ byte_size: number; scan_status: string }>(
      'select byte_size, scan_status from case_attachments where id = $1 and original_filename is null',
      [made.id],
    );
    expect(row.rows).toEqual([{ byte_size: PNG.byteLength, scan_status: 'not_scanned' }]);
  });
});

describe('the case’s own routes reach its attachments (C129.2, C135.1, C139.1; Workflow 8B Stage 4)', () => {
  it('serves them on GET /cases/:id, and an event’s case names no file', async () => {
    const caseId = await newCase();
    const before = api.events.named('case.updated').length;

    const made = await upload(caseId);
    const read = await request('GET', `/cases/${caseId}`);

    expect(read.statusCode, read.body).toBe(200);
    expect(attachmentsOf(read.body)).toEqual([made]);
    const events = api.events.named('case.updated').slice(before);
    expect(events).toHaveLength(1);
    const served = (
      events[0] as { payload: { data: { attributes: { attachments: Attachment[] } } } }
    ).payload.data.attributes.attachments;
    expect(served).toMatchObject([{ id: made.id, filename: null }]);
  });

  it('stores a PATCH item, serves it on the case, and asks for its rendition after the commit', async () => {
    const caseId = await newCase();
    const queued = renditionJobs.jobs.length;

    const patched = await request('PATCH', `/cases/${caseId}`, {
      payload: {
        data: {
          attributes: {
            attachments: [
              { data: Buffer.from(PNG).toString('base64'), filename: 'synthetic-patch.png' },
            ],
          },
        },
      },
    });

    expect(patched.statusCode, patched.body).toBe(200);
    const [stored] = attachmentsOf(patched.body);
    expect(stored).toMatchObject({ filename: 'synthetic-patch.png', 'attachment-type': 'png' });
    expect(renditionJobs.jobs.slice(queued).map(({ data }) => data.sourceId)).toEqual([stored?.id]);
  });

  it('hands back their objects when the case is redacted, keeping id, type, size and scan status', async () => {
    // The harness's RedactionService records calls, so the hook is called as the service calls it.
    const caseId = await newCase();
    const made = await upload(caseId);
    const stored = await api.database.client.query<{ storage_key: string }>(
      'select storage_key from case_attachments where id = $1',
      [made.id],
    );

    const redacted = await api.database.db.transaction((tx) =>
      redactCasesInTx(
        tx,
        { events: api.deps.events, clock: api.clock },
        {
          environmentId: api.environmentId,
          caseIds: [caseId],
          at: api.clock.now(),
          actor: { type: 'user', id: testId('usr') },
        },
      ),
    );

    expect(redacted.storageKeys).toEqual([stored.rows[0]?.storage_key]);
    const row = await api.database.client.query<{ byte_size: number; scan_status: string }>(
      'select byte_size, scan_status from case_attachments where id = $1 and original_filename is null',
      [made.id],
    );
    expect(row.rows).toEqual([{ byte_size: PNG.byteLength, scan_status: 'not_scanned' }]);
  });
});
