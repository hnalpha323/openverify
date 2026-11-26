/**
 * C114.4, C118.5: a run's trigger object: the server API's view of one object, with the related
 * resources the version's paths read, and nothing past that. Every value is synthetic.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { defaultInquiryTemplateAttributes, newId } from '@openverify/contracts';
import { createVerification, type Db } from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKFLOW_RUN_LIMITS } from '@openverify/workflow-engine';
import {
  isRedactedDocument,
  isRedactedObject,
  snapshotFits,
  triggerDocumentOf,
  triggerViewOf,
} from './objects.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const definitionReading = (path: string): WorkflowDefinition =>
  ({
    'schema-version': 1,
    trigger: {
      type: 'trigger-event',
      config: { events: ['inquiry.completed'], criteria: { var: path } },
    },
    inputs: [],
    variables: [],
    steps: [],
    edges: [],
    outputs: [],
    layout: {},
  }) as unknown as WorkflowDefinition;

describe('triggerDocumentOf (C118.5)', () => {
  it('reads an inquiry as the server API serves it, with its verifications', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId, {
      referenceId: 'ref-synthetic',
    });

    const document = await triggerDocumentOf(db, environmentId, 'inquiry', inquiry.id);

    expect(document?.data).toMatchObject({ type: 'inquiry', id: inquiry.id });
    expect(document?.included).toEqual([]);
  });

  it('answers null for an object it cannot find, here or in another environment', async () => {
    const other = (await createTestTenant(db)).environment.id;
    const { inquiry } = await createTestInquiry(db, other);

    await expect(triggerDocumentOf(db, environmentId, 'inquiry', inquiry.id)).resolves.toBeNull();
    await expect(triggerDocumentOf(db, environmentId, 'account', newId('acc'))).resolves.toBeNull();
    await expect(triggerDocumentOf(db, environmentId, 'report', newId('rep'))).resolves.toBeNull();
    await expect(
      triggerDocumentOf(db, environmentId, 'transaction', newId('txn')),
    ).resolves.toBeNull();
  });

  it('reads an account, a report and a transaction', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const account = await triggerDocumentOf(db, environmentId, 'account', inquiry.accountId);
    const template = await seedReportTemplate(db, environmentId);
    const report = await seedReport(db, environmentId, {
      templateId: template.templateId,
      versionId: template.versionId,
    });
    const type = await seedTransactionType(db, environmentId);
    const transaction = await seedTransaction(db, environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });

    expect(account?.data).toMatchObject({ type: 'account', id: inquiry.accountId });
    await expect(triggerDocumentOf(db, environmentId, 'report', report)).resolves.toMatchObject({
      data: { id: report },
    });
    await expect(
      triggerDocumentOf(db, environmentId, 'transaction', transaction.id),
    ).resolves.toMatchObject({ data: { type: 'transaction', id: transaction.id } });
  });

  it('has no object of a type Workflow 8B builds', async () => {
    await expect(triggerDocumentOf(db, environmentId, 'case', 'case_x')).resolves.toBeNull();
  });
});

describe('triggerViewOf (C114.4)', () => {
  it('flattens the document', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const document = await triggerDocumentOf(db, environmentId, 'inquiry', inquiry.id);

    const view = await triggerViewOf(
      db,
      environmentId,
      definitionReading('trigger.status'),
      document ?? { data: { type: 'inquiry', id: inquiry.id } },
    );

    expect(view).toMatchObject({ id: inquiry.id, type: 'inquiry' });
    expect(typeof view.status).toBe('string');
  });

  it('snapshots the related resource a path reads past its identifier', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const document = await triggerDocumentOf(db, environmentId, 'inquiry', inquiry.id);
    if (document === null) {
      throw new Error('no document');
    }

    const view = await triggerViewOf(
      db,
      environmentId,
      definitionReading('trigger.account.reference-id'),
      document,
    );

    expect((view.account as { 'reference-id': unknown } | null)?.['reference-id']).toBeDefined();
  });

  it('snapshots the template by its public name (C114.4)', async () => {
    const attributes = defaultInquiryTemplateAttributes();
    const { inquiry, template } = await createTestInquiry(db, environmentId, {
      flow: attributes.flow,
      verificationConfig: attributes['verification-config'],
    });
    const document = await triggerDocumentOf(db, environmentId, 'inquiry', inquiry.id);
    if (document === null) {
      throw new Error('no document');
    }

    const view = await triggerViewOf(
      db,
      environmentId,
      definitionReading('trigger.template.name'),
      document,
    );

    expect(view.template).toMatchObject({ id: template.id, name: template.name });
  });

  it('snapshots a verification of the event’s inquiry by its alias (C114.4)', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const verification = await createVerification(db, environmentId, {
      id: newId('ver'),
      inquiryId: inquiry.id,
      type: 'government_id',
      country: 'GB',
    });

    const view = await triggerViewOf(
      db,
      environmentId,
      definitionReading('trigger.verification_government_id.country'),
      {
        data: {
          type: 'inquiry',
          id: inquiry.id,
          attributes: { status: 'completed' },
          relationships: {
            verifications: {
              data: [{ type: 'verification/government-id', id: verification.id }],
            },
          },
        },
      },
    );

    expect(view.verification_government_id).toMatchObject({ id: verification.id, country: 'GB' });
  });

  it('reads a template reference as well as a condition', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const document = await triggerDocumentOf(db, environmentId, 'inquiry', inquiry.id);
    if (document === null) {
      throw new Error('no document');
    }
    const definition = {
      ...definitionReading('trigger.status'),
      outputs: [{ name: 'reference', pii: false, value: '{{ trigger.account.reference-id }}' }],
    } as unknown as WorkflowDefinition;

    const view = await triggerViewOf(db, environmentId, definition, document);

    expect((view.account as { 'reference-id': unknown } | null)?.['reference-id']).toBeDefined();
  });

  it('leaves a resource it cannot read as its identifier', async () => {
    const view = await triggerViewOf(
      db,
      environmentId,
      definitionReading('trigger.account.reference-id'),
      {
        data: {
          type: 'inquiry',
          id: newId('inq'),
          attributes: { status: 'completed' },
          relationships: { account: { data: { type: 'account', id: newId('acc') } } },
        },
      },
    );

    expect(view.account).toMatchObject({ type: 'account' });
    expect((view.account as Record<string, unknown>)['reference-id'] ?? null).toBeNull();
  });
});

describe('snapshotFits (C117.7)', () => {
  it('takes a snapshot up to the cap, and refuses one past it', () => {
    const limit = WORKFLOW_RUN_LIMITS['trigger-snapshot-bytes'].value;

    expect(snapshotFits({ value: 'x'.repeat(limit - 32) })).toBe(true);
    expect(snapshotFits({ value: 'x'.repeat(limit) })).toBe(false);
  });
});

describe('isRedactedDocument', () => {
  it('reads an object’s own redaction, and only that', () => {
    const id = newId('inq');

    expect(
      isRedactedObject({
        data: { type: 'inquiry', id, attributes: { 'redacted-at': '2026-10-20T12:00:00.000Z' } },
      }),
    ).toBe(true);
    expect(
      isRedactedObject({ data: { type: 'inquiry', id, attributes: { 'redacted-at': null } } }),
    ).toBe(false);
    expect(isRedactedObject({ data: { type: 'inquiry', id } })).toBe(false);
  });

  it('reads a redacted stub, and only that', () => {
    const id = newId('inq');

    expect(
      isRedactedDocument({
        data: { type: 'inquiry', id, attributes: { 'redacted-at': '2026-10-20T12:00:00.000Z' } },
      }),
    ).toBe(true);
    expect(
      isRedactedDocument({ data: { type: 'inquiry', id, attributes: { status: 'completed' } } }),
    ).toBe(false);
    expect(
      isRedactedDocument({
        data: {
          type: 'inquiry',
          id,
          attributes: { status: 'completed', 'redacted-at': '2026-10-20T12:00:00.000Z' },
        },
      }),
    ).toBe(false);
  });
});
