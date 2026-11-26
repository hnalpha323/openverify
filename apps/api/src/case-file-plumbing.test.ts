/**
 * Workflow 8B Stage 1b, checkpoint (F) (C135, C138, C143): what `foundation-8b` builds for an
 * attachment, a rendition and an export, beside the owners' stubs.
 *
 * - PII (C143.5, Stage 1a amendment 40): a PATCH item's `data` and `filename` are nulled in a stored
 *   API log inside `attachments` only, because `data` names every JSON:API body; an attachment's
 *   `filename` is nulled for a reader without `pii:view`, and it is PII in a case's trigger view.
 * - The scanner (C135.5, decision 66): the API reads the name each environment kind binds, `none`
 *   and unset reading none, a sandbox one refused for production; the worker binds a scanner whose
 *   stub never answers `clean`, and clamd needs its socket.
 * - The queues (C143.2): `case-export`, `case-attachment-scan` and `case-rendition` carry ids alone,
 *   each job id its row's, removed on completion and failure.
 *
 * Every value is synthetic.
 */
import { PII_CASE_ATTACHMENT_ATTRIBUTES } from '@openverify/contracts';
import {
  MASKED_ATTRIBUTE_NAMES,
  triggerViewType,
  type ScopeType,
} from '@openverify/workflow-engine';
import { describe, expect, it } from 'vitest';
import { MASKED_ATTRIBUTES, piiMaskFor } from './auth/pii.js';
import { loadConfig } from './config.js';
import {
  CASE_ATTACHMENT_SCAN_QUEUE,
  CASE_EXPORT_QUEUE,
  CASE_RENDITION_QUEUE,
  createCaseAttachmentScanQueue,
  createCaseExportQueue,
  createCaseRenditionQueue,
} from './jobs/case-file-queues.js';
import { createRecordingQueue } from './jobs/testing.js';
import type { Principal } from './ports.js';
import { NO_PROVIDERS, createProviderBindings } from './providers/index.js';
import { maskPersonalData } from './services/api-logs.js';

const ENV = 'env_01M5CJXHG0000000000000000A';
const CASE = 'case_01M5CJXHG0000000000000000A';
const ATTACHMENT = 'catt_01M5CJXHG0000000000000000A';
const FILE = 'file_01M5CJXHG0000000000000000A';
const EXPORT = 'cexp_01M5CJXHG0000000000000000A';

describe('C143.5: an attachment’s PII', () => {
  it('names the filename in every masked list', () => {
    expect(PII_CASE_ATTACHMENT_ATTRIBUTES).toEqual(['filename']);
    expect(MASKED_ATTRIBUTES).toContain('filename');
    expect([...MASKED_ATTRIBUTE_NAMES]).toContain('filename');
  });

  it('nulls a PATCH item’s data and name in a stored log, and no other data', () => {
    const masked = maskPersonalData({
      data: {
        type: 'case',
        attributes: {
          'case-queue-id': null,
          attachments: [
            { data: 'c3ludGhldGljIGJ5dGVz', filename: 'synthetic-canary.png' },
            { data: 'c3ludGhldGljIG1vcmU=', filename: 'synthetic-canary.pdf' },
          ],
        },
      },
      included: [{ data: 'kept', meta: { data: 'kept' } }],
    });

    expect(masked).toEqual({
      data: {
        type: 'case',
        attributes: {
          'case-queue-id': null,
          attachments: [
            { data: null, filename: null },
            { data: null, filename: null },
          ],
        },
      },
      included: [{ data: 'kept', meta: { data: 'kept' } }],
    });
  });

  it('nulls an attachment’s name for a reader without pii:view, and keeps the rest', () => {
    const attributes = {
      status: 'open',
      attachments: [
        {
          id: ATTACHMENT,
          filename: 'synthetic-canary.png',
          url: `/api/v1/cases/${CASE}/attachments/${ATTACHMENT}/content`,
          'byte-size': 1024,
        },
      ],
    };
    const user = (permissions: string[]) =>
      ({ kind: 'user', permissions: new Set(permissions) }) as unknown as Principal;

    expect(piiMaskFor(user([])).attributes(attributes)).toEqual({
      status: 'open',
      attachments: [{ ...attributes.attachments[0], filename: null }],
    });
    expect(piiMaskFor(user(['pii:view'])).attributes(attributes)).toEqual(attributes);
  });

  it('is PII in a case’s trigger view, so every exit masks it (Stage 1a amendment 40)', () => {
    const view = triggerViewType('case');
    const member = (type: ScopeType | null | undefined, name: string): ScopeType | undefined =>
      type?.kind === 'object' ? type.members[name] : undefined;
    const attachments = member(view, 'attachments');
    const item = attachments?.kind === 'list' ? attachments.of : undefined;

    expect(member(item, 'filename')?.pii).toBe(true);
    expect(member(item, 'byte-size')?.pii).not.toBe(true);
  });
});

describe('C135.5: the attachment scanner each environment kind binds', () => {
  const BASE: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgres://openverify:change-me-password@127.0.0.1:5432/openverify',
    REDIS_URL: 'redis://127.0.0.1:6379',
    S3_BUCKET: 'openverify',
    S3_ACCESS_KEY_ID: 'change-me-access-key',
    S3_SECRET_ACCESS_KEY: 'change-me-secret-key',
    OPENVERIFY_KEK: Buffer.alloc(32, 7).toString('base64'),
    OPENVERIFY_API_KEY_PEPPER: Buffer.alloc(32, 8).toString('base64'),
    OPENVERIFY_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString('base64'),
    OPENVERIFY_FLOW_PUBLIC_URL: 'http://localhost:5173',
    OPENVERIFY_VISION_SERVICE_TOKEN: 'change-me-vision-token-0123456789',
    NODE_ENV: 'development',
  };
  const scanners = (env: NodeJS.ProcessEnv) =>
    loadConfig({ ...BASE, ...env }).cases.attachmentScanners;

  it('reads the API’s fact by name: none and unset read none', () => {
    expect(scanners({})).toEqual({ sandbox: null, production: null });
    expect(
      scanners({
        OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX: 'sandbox',
        OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION: 'clamd',
      }),
    ).toEqual({ sandbox: 'sandbox', production: 'clamd' });
    expect(
      scanners({
        OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX: 'none',
        OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION: 'none',
      }),
    ).toEqual({ sandbox: null, production: null });
  });

  it('refuses a sandbox scanner for production and a name it does not know, quoting neither', () => {
    expect(() =>
      scanners({ OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION: 'sandbox' }),
    ).toThrow('OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_PRODUCTION');
    expect(() =>
      scanners({ OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX: 'synthetic-unknown' }),
    ).toThrow('OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX');
    expect(() =>
      scanners({ OPENVERIFY_PROVIDER_ATTACHMENT_SCANNER_SANDBOX: 'synthetic-unknown' }),
    ).not.toThrow('synthetic-unknown');
  });

  it('binds a scanner in the worker, answering for itself since Stage 3, and none for none', async () => {
    const { sandbox, production } = createProviderBindings(
      {
        ...NO_PROVIDERS,
        sandbox: { ...NO_PROVIDERS.sandbox, attachmentScanner: 'sandbox' },
        production: { ...NO_PROVIDERS.production, attachmentScanner: 'clamd' },
      },
      { clamdSocket: '/run/clamd/clamd.sock' },
    );

    expect(sandbox.attachmentScanner?.provider).toBe('sandbox');
    expect(production.attachmentScanner?.provider).toBe('clamd');
    await expect(
      sandbox.attachmentScanner?.scan({ attachmentId: ATTACHMENT, bytes: new Uint8Array(4) }),
    ).resolves.toEqual({ verdict: 'clean', provider: 'sandbox' });
    expect(createProviderBindings(NO_PROVIDERS).sandbox).not.toHaveProperty('attachmentScanner');
  });

  it('refuses clamd without its socket', () => {
    expect(() =>
      createProviderBindings({
        ...NO_PROVIDERS,
        production: { ...NO_PROVIDERS.production, attachmentScanner: 'clamd' },
      }),
    ).toThrow('OPENVERIFY_CLAMD_SOCKET');
  });
});

describe('C143.2: the case file queues', () => {
  it('enqueue an export, a scan and a rendition by id, each job its row’s', async () => {
    const exports = createRecordingQueue<{ environmentId: string; caseExportId: string }>();
    const scans = createRecordingQueue<{ environmentId: string; caseAttachmentId: string }>();
    const renditions = createRecordingQueue<{ environmentId: string; sourceId: string }>();

    await createCaseExportQueue({ queue: exports }).enqueueCaseExport({
      environmentId: ENV,
      caseExportId: EXPORT,
    });
    await createCaseAttachmentScanQueue({ queue: scans }).enqueueCaseAttachmentScan({
      environmentId: ENV,
      caseAttachmentId: ATTACHMENT,
    });
    const rendition = createCaseRenditionQueue({ queue: renditions });
    await rendition.enqueueCaseRendition({ environmentId: ENV, sourceId: FILE });
    await rendition.enqueueCaseRendition({ environmentId: ENV, sourceId: ATTACHMENT });

    expect(exports.jobs).toEqual([
      {
        name: CASE_EXPORT_QUEUE,
        data: { environmentId: ENV, caseExportId: EXPORT },
        options: expect.objectContaining({
          jobId: EXPORT,
          removeOnComplete: true,
          removeOnFail: true,
        }) as unknown,
      },
    ]);
    expect(scans.jobs.map(({ name, options }) => [name, options?.jobId])).toEqual([
      [CASE_ATTACHMENT_SCAN_QUEUE, ATTACHMENT],
    ]);
    expect(renditions.jobs.map(({ name, options }) => [name, options?.jobId])).toEqual([
      [CASE_RENDITION_QUEUE, FILE],
      [CASE_RENDITION_QUEUE, ATTACHMENT],
    ]);
  });

  it('refuse anything but ids, so no value reaches Valkey', async () => {
    const queue = createRecordingQueue<{ environmentId: string; sourceId: string }>();
    const rendition = createCaseRenditionQueue({ queue });

    await expect(
      rendition.enqueueCaseRendition({ environmentId: ENV, sourceId: 'synthetic.png' }),
    ).rejects.toThrow(TypeError);
    await expect(
      rendition.enqueueCaseRendition({
        environmentId: ENV,
        sourceId: 'inq_01M5CJXHG0000000000000000A',
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      createCaseExportQueue({ queue: createRecordingQueue() }).enqueueCaseExport({
        environmentId: ENV,
        caseExportId: CASE,
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      createCaseAttachmentScanQueue({ queue: createRecordingQueue() }).enqueueCaseAttachmentScan({
        environmentId: 'synthetic',
        caseAttachmentId: ATTACHMENT,
      }),
    ).rejects.toThrow(TypeError);
    expect(queue.jobs).toEqual([]);
  });

  it('close the queue they opened', async () => {
    const queue = createRecordingQueue<{ environmentId: string; caseExportId: string }>();
    const producer = createCaseExportQueue({ queue });

    await producer.close();

    expect(queue.closed).toBe(true);
  });
});
