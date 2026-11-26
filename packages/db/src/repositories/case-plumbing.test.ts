/**
 * Workflow 8B Stage 1b, checkpoint (C): what `foundation-8b` builds in the case repositories.
 *
 * - every sealed case column listed for the rewrap, and `kek:rewrap` re-wrapping each (C143.5);
 * - case and comment ids are redaction subjects (C143.5);
 * - the webhook filter on `case-template-ids`, and the every-held-inquiry rule (C143.4);
 * - an API key keeps the case templates it was minted with (C129.4);
 * - each repository stub names its owner, and the recurring trigger's case read answers nothing.
 *
 * Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { ENCRYPTED_COLUMNS, SEALED } from '../encrypted-columns.js';
import { openJson, openValue, sealJson, sealValue, type Sealed } from '../sealed.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { createApiKey, getApiKey } from './api-keys.js';
import { listCasesAfter } from './index.js';
import { REWRAP_TABLES, rewrapAll } from './key-rotation.js';
import { REDACTION_SUBJECT_ID_PREFIXES, subjectIdsIn } from './subject-ids.js';
import { createWebhook, listWebhooksForEvent } from './webhooks.js';
import { listWorkflowObjectsAfter } from './workflow-schedules.js';

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

let names = 0;

/** A template, its published version and a case, written by SQL: the case writes are `api-cases`'. */
async function seedCase(environmentId: string) {
  const templateId = testId('ctmpl');
  const versionId = testId('ctmplv');
  const caseId = testId('case');
  await query(
    `insert into case_templates (id, environment_id, name, key) values ($1, $2, 'Review', 'KYC')`,
    [templateId, environmentId],
  );
  await query(
    `insert into case_template_versions (id, environment_id, case_template_id, version, status,
       statuses, published_at)
     values ($1, $2, $3, 1, 'published', '[]'::jsonb, now())`,
    [versionId, environmentId, templateId],
  );
  names += 1;
  await query(
    `insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
       status, status_category, creator_type, creator_id, fields)
     values ($1, $2, $3, $4, $5, 'open', 'initial', 'user', $6, $7)`,
    [
      caseId,
      environmentId,
      templateId,
      versionId,
      `KYC-${String(names)}`,
      testId('usr'),
      sealJson(SEALED.caseFields, caseId, { canary: 'fields' }),
    ],
  );
  return { templateId, versionId, caseId };
}

const CASE_COLUMNS = [
  'cases.fields:row',
  'case_comments.message:row',
  'case_bulk_actions.request:row',
];

describe('C143.5: the sealed case columns', () => {
  it('are listed for the rewrap, under their seal names', () => {
    expect(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}:${c.aad}`)).toEqual(
      expect.arrayContaining(CASE_COLUMNS),
    );
    expect(REWRAP_TABLES).toEqual(
      expect.arrayContaining(['case_bulk_actions', 'case_comments', 'cases']),
    );
    expect([SEALED.caseFields, SEALED.caseCommentMessage, SEALED.caseBulkActionRequest]).toEqual(
      CASE_COLUMNS.map((column) => column.slice(0, -':row'.length)),
    );
  });

  it('are re-wrapped by kek:rewrap, so the new KEK alone opens them', async () => {
    const environmentId = await tenant();
    const { caseId } = await seedCase(environmentId);
    const commentId = testId('cscm');
    await query(
      `insert into case_comments (id, environment_id, case_id, message, commenter_type,
         commenter_id)
       values ($1, $2, $3, $4, 'user', $5)`,
      [
        commentId,
        environmentId,
        caseId,
        sealValue(SEALED.caseCommentMessage, commentId, 'synthetic canary comment'),
        testId('usr'),
      ],
    );
    const bulkId = testId('cblk');
    await query(
      `insert into case_bulk_actions (id, environment_id, action, creator_type, creator_id, request)
       values ($1, $2, 'add-tags', 'user', $3, $4)`,
      [
        bulkId,
        environmentId,
        testId('usr'),
        sealJson(SEALED.caseBulkActionRequest, bulkId, { canary: 'request' }),
      ],
    );

    await rewrapAll(database.db, { keyring: createKeyring(newKek, [oldKek]) });

    const newOnly = createKeyring(newKek);
    const read = async (table: string, column: string, id: string) => {
      const rows = await query<{ value: Sealed }>(
        `select "${column}" as value from "${table}" where id = $1`,
        [id],
      );
      return rows.rows[0]?.value;
    };
    const fields = await read('cases', 'fields', caseId);
    const message = await read('case_comments', 'message', commentId);
    const request = await read('case_bulk_actions', 'request', bulkId);
    expect(fields && openJson(SEALED.caseFields, caseId, fields, newOnly)).toEqual({
      canary: 'fields',
    });
    expect(message && openValue(SEALED.caseCommentMessage, commentId, message, newOnly)).toBe(
      'synthetic canary comment',
    );
    expect(request && openJson(SEALED.caseBulkActionRequest, bulkId, request, newOnly)).toEqual({
      canary: 'request',
    });
    setDefaultKeyring(createKeyring(newKek, [oldKek]));
  });
});

describe('C143.5: case and comment ids are redaction subjects', () => {
  it('finds each in a copy', () => {
    const caseId = testId('case');
    const commentId = testId('cscm');

    expect(REDACTION_SUBJECT_ID_PREFIXES).toEqual(expect.arrayContaining(['case', 'cscm']));
    expect(subjectIdsIn(JSON.stringify({ data: { id: caseId, comment: commentId } }))).toEqual(
      expect.arrayContaining([caseId, commentId]),
    );
  });
});

describe('C143.4: the case webhook filters', () => {
  async function seedWebhook(environmentId: string, filters: Record<string, string[]>) {
    return createWebhook(database.db, environmentId, {
      id: testId('wbh'),
      url: 'https://hooks.example.com/openverify',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic',
      filters,
    });
  }

  it('match a case by its template, and a strict case without one fails', async () => {
    const environmentId = await tenant();
    const wanted = testId('ctmpl');
    const webhook = await seedWebhook(environmentId, { 'case-template-ids': [wanted] });

    const hit = await listWebhooksForEvent(database.db, environmentId, 'case.created', {
      caseTemplateId: wanted,
      strict: true,
    });
    const miss = await listWebhooksForEvent(database.db, environmentId, 'case.created', {
      caseTemplateId: testId('ctmpl'),
      strict: true,
    });
    const none = await listWebhooksForEvent(database.db, environmentId, 'case.created', {
      strict: true,
    });

    expect(hit.map((row) => row.id)).toEqual([webhook.id]);
    expect(miss).toEqual([]);
    expect(none).toEqual([]);
  });

  it('match an inquiry-template filter only when it allows every held inquiry’s template', async () => {
    const environmentId = await tenant();
    const allowed = testId('itmpl');
    const webhook = await seedWebhook(environmentId, { 'inquiry-template-ids': [allowed] });
    const held = (heldInquiryTemplateIds: string[]) =>
      listWebhooksForEvent(database.db, environmentId, 'case.created', {
        heldInquiryTemplateIds,
        strict: true,
      });

    expect((await held([allowed, allowed])).map((row) => row.id)).toEqual([webhook.id]);
    expect(await held([allowed, testId('itmpl')])).toEqual([]);
    expect(await held([])).toEqual([]);
  });

  it('leave a loose subject unfiltered by a key it lacks, as before', async () => {
    const environmentId = await tenant();
    const webhook = await seedWebhook(environmentId, { 'case-template-ids': [testId('ctmpl')] });

    const hit = await listWebhooksForEvent(database.db, environmentId, 'inquiry.completed', {});

    expect(hit.map((row) => row.id)).toEqual([webhook.id]);
  });
});

describe('C129.4: an API key’s case templates', () => {
  it('keeps the list it was minted with, and none by default', async () => {
    const environmentId = await tenant();
    const templates = [testId('ctmpl'), testId('ctmpl')];
    const key = (id: string, caseTemplateIds?: readonly string[]) =>
      createApiKey(database.db, environmentId, {
        id,
        name: 'Synthetic',
        prefix: 'ov_sbx_',
        secretHash: randomBytes(32).toString('hex'),
        ...(caseTemplateIds === undefined ? {} : { caseTemplateIds }),
      });

    const restricted = await key(testId('key'), templates);
    const plain = await key(testId('key'));

    expect(restricted.caseTemplateIds).toEqual(templates);
    expect((await getApiKey(database.db, environmentId, restricted.id))?.caseTemplateIds).toEqual(
      templates,
    );
    expect(plain.caseTemplateIds).toBeNull();
  });
});

describe('the case repositories (built by api-cases)', () => {
  const db = () => database.db;

  it('read a case for the recurring trigger once api-cases built it (C118.4)', async () => {
    const environmentId = await tenant();
    const { caseId } = await seedCase(environmentId);

    expect(await listCasesAfter(db(), environmentId, { cursor: null, limit: 10 })).toEqual([
      caseId,
    ]);
    expect(
      await listWorkflowObjectsAfter(db(), environmentId, 'case', { cursor: null, limit: 10 }),
    ).toEqual([caseId]);
  });
});
