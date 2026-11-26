/**
 * C70.4, C70.5, C84.4 (F08, F10; Workflow 6A Stage 3, `api-reports`): the report hooks of the
 * shared account, include and webhook code: consolidation moves the absorbed accounts' report
 * links (`moveReportLinksInTx`); `?include=reports` lists the inquiry's or account's reports,
 * newest first, at most 50, masked for the caller (`includedReportsFor`); report events resolve
 * their strict filter subjects from the linked inquiry's template and the home account's type
 * (`resolveReportFilterSubjects`). Synthetic values only.
 */
import {
  createAccount,
  getAccount,
  getReport,
  linkReportAccount,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { piiMaskFor, UNMASKED } from '../../auth/pii.js';
import type { Principal } from '../../ports.js';
import { moveReportLinksInTx } from './accounts.js';
import { resolveReportFilterSubjects } from './filter-subjects.js';
import { includedReportsFor, MAX_INCLUDED_REPORTS } from './includes.js';
import { reportResourceOf } from './reports.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let otherEnvironmentId: string;
let template: { templateId: string; versionId: string };
const MASKED = piiMaskFor({ kind: 'user', permissions: new Set() } as unknown as Principal);

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
  otherEnvironmentId = (await createTestTenant(db)).environment.id;
  template = await seedReportTemplate(db, environmentId, {
    config: { 'search-lists': ['openverify-sandbox'] },
  });
}, 60_000);

afterAll(async () => {
  await database.close();
});

const account = async () => (await createAccount(db, environmentId, { id: testId('acc') })).id;

async function report(options: { accountId?: string; inquiryId?: string; createdAt?: Date } = {}) {
  return seedReport(db, environmentId, {
    ...template,
    status: 'ready',
    accountId: options.accountId ?? null,
    inquiryId: options.inquiryId ?? null,
    createdAt: options.createdAt ?? new Date(),
  });
}

describe('moveReportLinksInTx (C84.4)', () => {
  it('moves the absorbed accounts’ home and linked reports to the absorbing account, once each', async () => {
    const target = await account();
    const source = await account();
    const home = await report({ accountId: source });
    const linked = await report();
    await linkReportAccount(db, environmentId, linked, source);
    const both = await report({ accountId: target });
    await linkReportAccount(db, environmentId, both, source);
    await db.transaction((tx) =>
      moveReportLinksInTx(tx, { environmentId, targetId: target, sourceIds: [source] }),
    );
    expect(await getReport(db, environmentId, home)).toMatchObject({
      accountId: target,
      accountIds: [target],
    });
    expect(await getReport(db, environmentId, linked)).toMatchObject({
      accountId: null,
      accountIds: [target],
    });
    expect(await getReport(db, environmentId, both)).toMatchObject({
      accountId: target,
      accountIds: [target],
    });
  });
});

describe('includedReportsFor (C70.5)', () => {
  it('lists an inquiry’s reports newest first, masked for the caller', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const older = await report({ inquiryId: inquiry.id, createdAt: new Date('2026-10-01T00:00:00.000Z') });
    const newer = await report({ inquiryId: inquiry.id, createdAt: new Date('2026-10-02T00:00:00.000Z') });
    await report();
    const unmasked = await includedReportsFor(db, environmentId, { inquiryId: inquiry.id }, UNMASKED);
    expect(unmasked.map((resource) => resource.id)).toEqual([newer, older]);
    expect(unmasked[0]?.attributes.query).toEqual({ 'name-first': 'Avery', 'name-last': 'Synthetic' });
    const masked = await includedReportsFor(db, environmentId, { inquiryId: inquiry.id }, MASKED);
    expect(masked[0]?.attributes.query).toEqual({ 'name-first': null, 'name-last': null });
    const stored = await getReport(db, environmentId, newer);
    if (stored === null) {
      throw new Error('the report is gone');
    }
    expect(unmasked[0]).toEqual(await reportResourceOf(db, stored, UNMASKED));
  });

  it('lists an account’s home and linked reports, at most the cap, and nothing of another environment', async () => {
    const holder = await account();
    const home = await report({ accountId: holder });
    const linked = await report();
    await linkReportAccount(db, environmentId, linked, holder);
    const listed = await includedReportsFor(db, environmentId, { accountId: holder }, UNMASKED);
    expect(listed.map((resource) => resource.id).sort()).toEqual([home, linked].sort());
    expect(await includedReportsFor(db, otherEnvironmentId, { accountId: holder }, UNMASKED)).toEqual([]);
    expect(MAX_INCLUDED_REPORTS).toBe(50);
  });
});

describe('resolveReportFilterSubjects (C70.4, F10)', () => {
  it('resolves the inquiry’s template and the home account’s type, and nothing for a standalone report', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const holder = await account();
    const accountType = await getAccount(db, environmentId, holder);
    const payloadOf = async (id: string) => {
      const stored = await getReport(db, environmentId, id);
      if (stored === null) {
        throw new Error('the report is gone');
      }
      return { data: await reportResourceOf(db, stored, UNMASKED) };
    };
    const payloads = [
      await payloadOf(await report({ inquiryId: inquiry.id })),
      await payloadOf(await report({ accountId: holder })),
      await payloadOf(await report({ inquiryId: inquiry.id, accountId: holder })),
      await payloadOf(await report()),
    ];
    expect(await resolveReportFilterSubjects(db, environmentId, payloads)).toEqual([
      { inquiryTemplateId: inquiry.inquiryTemplateId },
      { accountTypeId: accountType?.accountTypeId },
      { inquiryTemplateId: inquiry.inquiryTemplateId, accountTypeId: accountType?.accountTypeId },
      {},
    ]);
    expect(await resolveReportFilterSubjects(db, otherEnvironmentId, payloads.slice(0, 1))).toEqual([
      {},
    ]);
  });
});
