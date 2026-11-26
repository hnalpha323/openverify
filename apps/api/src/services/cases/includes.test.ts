/**
 * K8-19 (Workflow 8D; plan items 68, 102; C143.6): `GET /cases/:id?include=` serves the case's
 * queue and each held kind, every resource as its own route serves it to the same reader (masked
 * the same), and leaves out, never refuses, a kind the reader's scopes do not reach. A held kind
 * includes what the case's relationship names: its newest 50.
 *
 * Every value is synthetic.
 */
import { PERMISSIONS, type Permission } from '@openverify/core';
import { createVerification } from '@openverify/db';
import {
  createTestInquiry,
  seedCaseQueue,
  seedGraphQuery,
  seedGraphQueryTemplate,
  seedReport,
  seedReportRun,
  seedReportTemplate,
  seedTransaction,
  seedTransactionType,
  testId,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let token: string;
let caseId: string;
let queueId: string;
let held: Record<string, { path: string; id: string; type: string }>;

interface Resource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
}

const INCLUDES = [
  'case-queue',
  'accounts',
  'inquiries',
  'reports',
  'verifications',
  'txns',
  'report-runs',
  'graph-queries',
] as const;

let calls = 0;
const call = (method: 'GET' | 'POST', url: string, payload?: unknown, as = token) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `includes-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

const read = async (url: string, as = token) => {
  const response = await call('GET', url, undefined, as);
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as { data: Resource; included?: Resource[] };
};

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
  const { db } = api.database;
  const environmentId = api.environmentId;
  const { inquiry } = await createTestInquiry(db, environmentId);
  const verificationId = testId('ver');
  await createVerification(db, environmentId, {
    id: verificationId,
    inquiryId: inquiry.id,
    type: 'government_id',
  });
  const reportTemplate = await seedReportTemplate(db, environmentId);
  const reportId = await seedReport(db, environmentId, {
    templateId: reportTemplate.templateId,
    versionId: reportTemplate.versionId,
    status: 'ready',
    inquiryId: inquiry.id,
  });
  const runId = await seedReportRun(db, environmentId, { reportId, status: 'ready' });
  const type = await seedTransactionType(db, environmentId);
  const { id: transactionId } = await seedTransaction(db, environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  });
  const graphTemplate = await seedGraphQueryTemplate(db, environmentId);
  const { id: graphQueryId } = await seedGraphQuery(db, environmentId, {
    graphQueryTemplateId: graphTemplate.id,
    graphQueryTemplateVersionId: graphTemplate.versionId,
  });
  queueId = (await seedCaseQueue(db, environmentId)).id;
  const accountId = inquiry.accountId;
  held = {
    accounts: { path: `/accounts/${accountId}`, id: accountId, type: 'account' },
    inquiries: { path: `/inquiries/${inquiry.id}`, id: inquiry.id, type: 'inquiry' },
    reports: { path: `/reports/${reportId}`, id: reportId, type: 'report/watchlist' },
    verifications: {
      path: `/verifications/${verificationId}`,
      id: verificationId,
      type: 'verification/government-id',
    },
    txns: { path: `/transactions/${transactionId}`, id: transactionId, type: 'transaction' },
    'graph-queries': { path: `/graph-queries/${graphQueryId}`, id: graphQueryId, type: 'graph-query' },
    'report-runs': { path: '', id: runId, type: 'report-run' },
  };

  const template = await call('POST', '/case-templates', {
    data: { attributes: { name: 'Synthetic includes', key: 'INCL' } },
  });
  expect(template.statusCode, template.body).toBe(201);
  const created = JSON.parse(template.body) as {
    data: { id: string; relationships: Record<string, { data: { id: string } }> };
  };
  const draft = created.data.relationships['draft-version']?.data.id ?? '';
  const published = await call('POST', `/case-template-versions/${draft}/publish`, { meta: {} });
  expect(published.statusCode, published.body).toBe(200);
  const made = await call('POST', '/cases', {
    data: { attributes: { 'case-template-id': created.data.id, 'case-queue-id': queueId } },
    meta: { 'object-ids': Object.values(held).map(({ id }) => id) },
  });
  expect(made.statusCode, made.body).toBe(201);
  caseId = (JSON.parse(made.body) as { data: { id: string } }).data.id;
}, 120_000);

afterAll(async () => {
  await api.close();
});

const reader = (permissions: readonly Permission[]) =>
  api.newUserToken(api.environmentId, { permissions });

describe('GET /cases/:id?include= (K8-19)', () => {
  it('serves the queue and every held kind, each as its own route serves it', async () => {
    const document = await read(`/cases/${caseId}?include=${INCLUDES.join(',')}`);
    const included = document.included ?? [];

    expect(included.map(({ type, id }) => `${type}:${id}`).sort()).toEqual(
      [
        `case-queue:${queueId}`,
        ...Object.values(held).map(({ type, id }) => `${type}:${id}`),
      ].sort(),
    );
    expect(included.find(({ type }) => type === 'case-queue')).toEqual(
      (await read(`/case-queues/${queueId}`)).data,
    );
    for (const { path, id } of Object.values(held).filter(({ path }) => path !== '')) {
      expect(included.find((resource) => resource.id === id)).toEqual((await read(path)).data);
    }
    expect(included.find(({ type }) => type === 'report-run')?.attributes).toMatchObject({
      status: 'ready',
    });
  });

  it('masks each included resource as its own route masks it for a reader without pii:view', async () => {
    const masked = reader(PERMISSIONS.filter((permission) => permission !== 'pii:view'));
    const document = await read(`/cases/${caseId}?include=${INCLUDES.join(',')}`, masked);
    const included = document.included ?? [];

    for (const { path, id } of Object.values(held).filter(({ path }) => path !== '')) {
      expect(included.find((resource) => resource.id === id)).toEqual(
        (await read(path, masked)).data,
      );
    }
  });

  it('leaves out each kind the reader’s scopes do not reach, and refuses none', async () => {
    const narrow = reader(['cases:read', 'inquiries:read']);
    const document = await read(`/cases/${caseId}?include=${INCLUDES.join(',')}`, narrow);

    expect((document.included ?? []).map(({ type }) => type)).toEqual(['inquiry']);
  });
});
