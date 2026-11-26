/**
 * C253.2 (Workflow 11B, `dsar-export`): the collector over the C16 suite's seeded subject
 * (`seedPiiSubject`), which writes one row of every table holding the subject's personal data, on
 * PGlite. Every family it reaches is checked by id, the sealed values read with `pii:view`, the
 * operator-review families apart, and what is never exported (fingerprint HMACs, templates, masked
 * images, a challenge token) absent. Synthetic values only.
 */
import {
  createTestDatabase,
  createTestTenant,
  seedCase,
  seedCaseComment,
  seedCaseTemplate,
  seedInquiryDecision,
  seedReport,
  seedReportAccount,
  seedReportAction,
  seedReportTemplate,
  seedWorkflow,
  seedWorkflowRun,
  seedWorkflowVersion,
  type TestDatabase,
} from '@openverify/db/testing';
import {
  attachCaseObjects,
  getEnvironment,
  listConsentRecordsOfSubjects,
  listInquiryVerifications,
  recordWorkflowRunSubjects,
  type Db,
} from '@openverify/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { fixedClock } from '../../test-support/fakes.js';
import { seedConnection, seedShareToken } from '../connect/consent.test-support.js';
import { PII_MARKER, seedPiiSubject, type SeededPiiSubject } from '../redaction.test-support.js';
import { AccountExportAccountMissingError, collectAccountExport } from './collect.js';
import { buildAccountExportManifest, type CollectedAccountExport } from './manifest.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
const clock = fixedClock(new Date('2026-11-13T12:00:00.000Z'));

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  const { environment } = await createTestTenant(db);
  environmentId = environment.id;
});

const seed = () =>
  seedPiiSubject({
    db,
    storage: createInMemoryFileStorage(),
    keyring: database.keyring,
    environmentId,
  });

const idsOf = (records: readonly { id: string }[]) => records.map(({ id }) => id).sort();
const typesOf = (records: readonly { type: string }[]) =>
  [...new Set(records.map(({ type }) => type))].sort();

describe('collectAccountExport (C253.2)', () => {
  let subject: SeededPiiSubject;
  let collected: CollectedAccountExport;

  beforeEach(async () => {
    subject = await seed();
    collected = await collectAccountExport({ db, clock }, environmentId, subject.accountId);
  });

  it('reads the account and its inquiry with pii:view', () => {
    expect(collected.account).toMatchObject({ type: 'account', id: subject.accountId });
    expect(JSON.stringify(collected.account)).toContain(PII_MARKER);
    expect(idsOf(collected.inquiries)).toEqual([subject.inquiryId]);
    expect(JSON.stringify(collected.inquiries)).toContain(PII_MARKER);
  });

  it('reads every verification of the inquiry, with its extracted data', async () => {
    const all = await listInquiryVerifications(db, environmentId, subject.inquiryId);
    expect(idsOf(collected.verifications)).toEqual(idsOf(all));
    expect(JSON.stringify(collected.verifications)).toContain('12 Lantern Row');
  });

  it('reads the session with its address, user agent and network facts (Workflow 7A)', () => {
    expect(typesOf(collected.inquirySessions)).toEqual(['inquiry-session', 'network']);
    expect(collected.inquirySessions.map(({ id }) => id)).toContain(subject.sessionId);
    const text = JSON.stringify(collected.inquirySessions);
    expect(text).toContain('203.0.113.7');
    expect(text).toContain(PII_MARKER);
  });

  it('lists the session’s device (its HMACs dropped in the manifest)', () => {
    expect(idsOf(collected.devices)).toEqual([subject.deviceId]);
  });

  it('reads every linked transaction with its fields, history and files (K7B-1)', () => {
    const ids = Object.values(subject.transactions).map(({ id }) => id);
    const transactions = collected.transactions.filter(({ type }) => type === 'transaction');
    expect(idsOf(transactions)).toEqual([...ids].sort());
    expect(JSON.stringify(transactions)).toContain(PII_MARKER);
    const files = collected.files.filter(({ kind }) => kind === 'transaction-file');
    expect(files.map(({ id }) => id).sort()).toEqual(
      Object.values(subject.transactions)
        .map(({ fileId }) => fileId)
        .sort(),
    );
  });

  it('lists each live verification file with its kind, size and SHA-256', () => {
    const files = collected.files.filter(({ kind }) => kind === 'verification-file');
    expect(files.map(({ id }) => id).sort()).toEqual([...subject.fileIds].sort());
    for (const file of files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
      expect(file['belongs-to']).toMatch(/^ver_/);
    }
  });

  it('reads the subject’s consent records with their evidence (C236, KP11-14)', () => {
    expect(collected.consentRecords).toHaveLength(2);
    const text = JSON.stringify(collected.consentRecords);
    expect(text).toContain('203.0.113.7');
    expect(text).toContain(PII_MARKER);
  });

  it('counts the face templates and never exports one (C253.3)', () => {
    expect(collected.faceTemplateCount).toBe(1);
    expect(JSON.stringify(collected)).not.toContain('0.088');
  });

  it('puts list memberships, signals and the integrity verdict in the operator part (P16)', () => {
    expect(collected.listMemberships.map(({ id }) => id)).toContain(subject.listMatchId);
    // C98.4: the items whose source is the inquiry, as present, never the template or masked image.
    for (const id of subject.listItemIds) {
      expect(collected.listMemberships.map((record) => record.id)).toContain(id);
    }
    expect(JSON.stringify(collected.listMemberships)).not.toContain(subject.maskedObjectKey);
    expect(typesOf(collected.signals)).toEqual(
      expect.arrayContaining(['graph-attributes', 'graph-query', 'inquiry-session-signals']),
    );
    expect(JSON.stringify(collected.signals)).toContain('Synthetic/Zone');
    expect(idsOf(collected.integrityVerdicts)).toEqual([subject.inquiryId]);
  });

  it('never exports a challenge token, a fingerprint HMAC or a graph value key', () => {
    const manifest = buildAccountExportManifest(collected, {
      exportId: 'aexp_01M5CN0000000000000011B100',
      environmentId,
      accountId: subject.accountId,
      generatedAt: clock.now(),
    });
    const text = JSON.stringify(manifest);
    expect(text).not.toContain('integrity token');
    expect(text).not.toMatch(/"(device|browser)-fingerprint"/);
    expect(text).not.toContain('value-key');
    expect(manifest['item-count']).toBeGreaterThan(20);
  });
});

describe('collectAccountExport refusals', () => {
  it('refuses an account outside the environment', async () => {
    const subject = await seed();
    const other = await createTestTenant(db);
    await expect(
      collectAccountExport({ db, clock }, other.environment.id, subject.accountId),
    ).rejects.toBeInstanceOf(AccountExportAccountMissingError);
  });
});

describe('collectAccountExport: decisions, reports, cases, runs and shares (C253.2)', () => {
  it('reads each family linked to the account or its inquiry', async () => {
    const subject = await seed();
    const decision = await seedInquiryDecision(db, environmentId, {
      subjectId: subject.inquiryId,
      comment: 'Synthetic decision comment',
    });
    const template = await seedReportTemplate(db, environmentId);
    const reportId = await seedReport(db, environmentId, {
      ...template,
      status: 'ready',
      accountId: subject.accountId,
      query: { term: 'Synthetic query' },
    });
    await seedReportAccount(db, environmentId, { reportId, accountId: subject.accountId });
    const actionId = await seedReportAction(db, environmentId, { reportId, actionType: 'review' });
    const caseTemplate = await seedCaseTemplate(db, environmentId);
    const held = await seedCase(db, environmentId, {
      caseTemplateId: caseTemplate.id,
      caseTemplateVersionId: caseTemplate.versionId,
      key: caseTemplate.key,
      number: 1,
    });
    await attachCaseObjects(db, environmentId, [
      {
        caseId: held.id,
        objectType: 'inquiry',
        objectId: subject.inquiryId,
        attachedByType: 'user',
        attachedById: 'usr_01M5CN0000000000000011B901',
        attachedState: {},
      },
    ]);
    const comment = await seedCaseComment(db, environmentId, {
      caseId: held.id,
      message: 'Synthetic case comment',
    });
    const workflow = await seedWorkflow(db, environmentId);
    const version = await seedWorkflowVersion(db, environmentId, {
      workflowId: workflow.id,
      definition: {
        'schema-version': 1,
        trigger: { type: 'trigger-account', config: {} },
        inputs: [{ name: 'note', type: 'string', required: false }],
        variables: [],
        steps: [{ id: 'output', type: 'output', name: 'Output', mappings: {} }],
        edges: [{ id: 'e1', from: 'trigger', 'from-port': 'next', to: 'output' }],
        outputs: [],
        layout: {},
      },
    });
    const run = await seedWorkflowRun(db, environmentId, {
      workflowId: workflow.id,
      workflowVersionId: version.id,
      inputs: { note: 'Synthetic input' },
    });
    await recordWorkflowRunSubjects(db, environmentId, run.id, [
      { subjectId: subject.accountId, source: 'trigger' },
    ]);
    const environment = await getEnvironment(db, environmentId);
    const partner = await createTestTenant(db);
    const connection = await seedConnection(db, {
      sourceOrganizationId: environment?.organizationId ?? '',
      destinationOrganizationId: partner.organization.id,
    });
    const [record] = await listConsentRecordsOfSubjects(db, environmentId, [
      { type: 'inquiry', id: subject.inquiryId },
    ]);
    const tokenId = await seedShareToken(db, {
      sourceEnvironmentId: environmentId,
      destinationEnvironmentId: partner.environment.id,
      connection,
      consentRecordId: record?.id ?? '',
      sourceType: 'inquiry',
      sourceId: subject.inquiryId,
      status: 'redeemed',
    });

    const collected = await collectAccountExport({ db, clock }, environmentId, subject.accountId);

    expect(idsOf(collected.decisions)).toEqual([decision.id]);
    expect(collected.reports.map(({ id }) => id)).toEqual([reportId, actionId]);
    expect(collected.cases.map(({ id }) => id)).toEqual([held.id, comment.id, run.id]);
    expect(JSON.stringify(collected.cases)).toContain('Synthetic case comment');
    expect(JSON.stringify(collected.cases)).toContain('Synthetic input');
    expect(collected.connectShares).toEqual([
      expect.objectContaining({
        'share-token-id': tokenId,
        direction: 'outbound',
        status: 'redeemed',
        recipient: {
          'organization-id': environment?.organizationId,
          'organization-name': 'Example Partner',
        },
        source: null,
      }),
    ]);
  });
});
