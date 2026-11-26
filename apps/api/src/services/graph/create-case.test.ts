/**
 * C140.6 (C103 amended; Workflow 8B, `api-case-workflows`): the graph explorer's "create case" bulk
 * action through the app. It makes one case holding the selected accounts that are neither redacted
 * nor consolidated, through `api-cases`' `createCaseInTx` (a fake here that writes the case by SQL),
 * with the query recorded as the case's origin; it needs `cases:write` beside the route's
 * `graph:read`, and the `case-create` limit holds. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import { createAccount, createAccountType, type Db } from '@openverify/db';
import {
  seedCaseTemplate,
  seedGraphQuery,
  seedGraphQueryTemplate,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import type { CaseCreationInput, CreatedCase } from '../cases/create.js';

const creation = vi.hoisted(() => ({ made: 0, inputs: [] as CaseCreationInput[] }));

vi.mock('../cases/create.js', async (original) => {
  const { SEALED, sealJson } = await import('@openverify/db');
  const { sql } = await import('drizzle-orm');
  return {
    ...(await original<typeof import('../cases/create.js')>()),
    createCaseInTx: async (tx: Db, _deps: unknown, input: CaseCreationInput): Promise<CreatedCase> => {
      creation.inputs.push(input);
      creation.made += 1;
      const id = newId('case');
      const name = `GQ-${String(creation.made)}`;
      await tx.execute(sql`
        insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
          status, status_category, creator_type, creator_id, fields)
        select ${id}, ${input.environmentId}, ${input.caseTemplateId}, v.id, ${name}, 'open',
          'initial', ${input.creator.type}, ${input.creator.id},
          ${sealJson(SEALED.caseFields, id, {})}
        from case_template_versions v
        where v.case_template_id = ${input.caseTemplateId} and v.status = 'published'`);
      return { id, name, heldObjects: [], staged: [] };
    },
  };
});

let api: TestApi;
let db: Db;

beforeAll(async () => {
  api = await createTestApi();
  db = api.database.db;
}, 120_000);

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  creation.inputs.length = 0;
});

async function storedResult() {
  const type = await createAccountType(db, api.environmentId, {
    id: newId('acctp'),
    name: `Type ${newId('acctp')}`,
  });
  const accounts: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const account = await createAccount(db, api.environmentId, {
      id: newId('acc'),
      accountTypeId: type.id,
      referenceId: null,
      fields: {},
    });
    accounts.push(account.id);
  }
  const template = await seedGraphQueryTemplate(db, api.environmentId);
  const query = await seedGraphQuery(db, api.environmentId, {
    graphQueryTemplateId: template.id,
    graphQueryTemplateVersionId: template.versionId,
    accountIds: accounts,
  });
  return { accounts, id: query.id };
}

const action = (id: string, attributes: Record<string, unknown>, key?: string, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1/graph-queries/${id}/actions`,
    headers: { ...bearer(token), ...(key === undefined ? {} : { 'idempotency-key': key }) },
    payload: { data: { attributes } },
  });

let keys = 0;

async function caseTemplate() {
  keys += 1;
  return seedCaseTemplate(db, api.environmentId, { key: `GQ${String(keys)}` });
}

describe('create-case on a stored graph result (C140.6)', () => {
  it('makes one case holding the selection, the query its origin, and answers its id', async () => {
    const { accounts, id } = await storedResult();
    const [first, redacted, consolidated] = accounts;
    await api.database.client.query(`update accounts set redacted_at = now() where id = $1`, [
      redacted,
    ]);
    await api.database.client.query(
      `update accounts set status = 'archived', consolidated_into = $1 where id = $2`,
      [first, consolidated],
    );
    const template = await caseTemplate();

    const response = await action(
      id,
      { action: 'create-case', 'case-template-id': template.id, all: true },
      `case-${randomBytes(4).toString('hex')}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    const { attributes } = response.json<{
      data: { attributes: { 'case-id': string; outcomes: unknown[] } };
    }>().data;
    expect(attributes['case-id']).toMatch(/^case_/);
    expect(attributes.outcomes).toEqual(
      expect.arrayContaining([
        { 'account-id': first, outcome: 'done' },
        { 'account-id': redacted, outcome: 'skipped_redacted' },
        { 'account-id': consolidated, outcome: 'skipped_consolidated' },
      ]),
    );
    expect(creation.inputs).toEqual([
      expect.objectContaining({
        environmentId: api.environmentId,
        caseTemplateId: template.id,
        objectIds: [first],
        origin: { 'graph-query-id': id },
      }),
    ]);
    const audit = api.audit.entries.find(
      (entry) => entry.action === 'graph-query.action' && entry.resourceId === id,
    );
    expect(audit?.metadata).toMatchObject({ action: 'create-case', 'case-id': attributes['case-id'] });
  });

  it('answers a null case id for a preview, and makes nothing', async () => {
    const { id } = await storedResult();
    const response = await action(id, {
      action: 'create-case',
      'case-template-id': (await caseTemplate()).id,
      all: true,
      preview: true,
    });
    expect(response.json()).toMatchObject({
      data: { attributes: { preview: true, 'selected-count': 3, 'case-id': null } },
    });
    expect(creation.inputs).toEqual([]);
  });

  it('makes no case when nothing selected can be held', async () => {
    const { accounts, id } = await storedResult();
    for (const account of accounts) {
      await api.database.client.query(`update accounts set redacted_at = now() where id = $1`, [
        account,
      ]);
    }
    const response = await action(
      id,
      { action: 'create-case', 'case-template-id': (await caseTemplate()).id, all: true },
      `case-${randomBytes(4).toString('hex')}`,
    );
    expect(response.json()).toMatchObject({ data: { attributes: { 'case-id': null } } });
    expect(creation.inputs).toEqual([]);
  });

  it('answers 429 past case-create, and makes nothing', async () => {
    const { id } = await storedResult();
    const consume = vi
      .spyOn(api.deps.rateLimiter, 'consume')
      .mockImplementation((key) =>
        Promise.resolve(
          key.startsWith('case-create:')
            ? { allowed: false, limit: 600, remaining: 0, resetAt: new Date(), retryAfterSeconds: 60 }
            : { allowed: true, limit: 600, remaining: 10, resetAt: new Date(), retryAfterSeconds: 0 },
        ),
      );
    try {
      const response = await action(
        id,
        { action: 'create-case', 'case-template-id': (await caseTemplate()).id, all: true },
        `case-${randomBytes(4).toString('hex')}`,
      );
      expect(response.statusCode).toBe(429);
      expect(creation.inputs).toEqual([]);
    } finally {
      consume.mockRestore();
    }
  });
});
