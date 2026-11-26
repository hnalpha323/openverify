/**
 * Workflow 8A Stage 1b (A) (C117.5, Stage 1a amendment 5): each `…InTx` form writes only in the
 * caller's transaction, so an effect row and its change commit or roll back together, and leaves its
 * events for the caller to dispatch after the commit. The public services keep their suites, which are
 * what shows the extraction preserved their behaviour. Synthetic values.
 */
import { newId, type AuditActor } from '@openverify/contracts';
import {
  getAccount,
  getInquiry,
  getReport,
  getTransaction,
  type Db,
} from '@openverify/db';
import { seedReport, seedReportTemplate, seedTransaction, seedTransactionType } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../auth/pii.js';
import type { StagedEvent } from '../events/index.js';
import { createInquiry as createInquiryRoute, createTemplate } from '../test-support/harness.js';
import {
  accountChangeIn,
  addAccountRelationInTx,
  changeAccountTagsInTx,
  createAccountInTx,
  removeAccountRelationInTx,
  updateAccountInTx,
} from './accounts.js';
import {
  changeInquiryTagsInTx,
  createInquiryInTx,
  updateInquiryInTx,
  type Acting,
} from './inquiries.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { generateOneTimeLinkInTx } from './one-time-links.js';
import { changeReportTagsInTx } from './reports/reports.js';
import { transactionChangeIn } from './transactions/shared.js';
import {
  changeTransactionTagsInTx,
  createTransactionInTx,
  updateTransactionInTx,
} from './transactions/transactions.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

class RolledBack extends Error {}

const db = (): Db => api.database.db;

const actor: AuditActor = { type: 'workflow-run', id: newId('wfr') };
const acting = (): Acting => ({
  ctx: { organizationId: api.organizationId, environmentId: api.environmentId },
  actor,
  mask: UNMASKED,
  environmentKind: 'sandbox',
});

/** `work` in a transaction the caller then abandons, so nothing it wrote may stay. */
async function abandoned(work: (tx: Db) => Promise<unknown>): Promise<void> {
  await expect(
    db().transaction(async (tx) => {
      await work(tx);
      throw new RolledBack();
    }),
  ).rejects.toBeInstanceOf(RolledBack);
}

describe('inquiries', () => {
  it('createInquiryInTx leaves nothing behind, and dispatches nothing itself', async () => {
    const templateId = await createTemplate(api);
    const before = api.events.named('inquiry.created').length;
    let id = '';

    await abandoned(async (tx) => {
      const { inquiry, staged } = await createInquiryInTx(tx, api.deps, acting(), {
        'inquiry-template-id': templateId,
      });
      id = inquiry.id;
      expect(staged.length).toBeGreaterThan(0);
    });

    expect(await getInquiry(db(), api.environmentId, id)).toBeNull();
    expect(api.events.named('inquiry.created')).toHaveLength(before);
  });

  it('updateInquiryInTx and changeInquiryTagsInTx leave the row as it was', async () => {
    const id = await createInquiryRoute(api);

    await abandoned(async (tx) => {
      await updateInquiryInTx(tx, api.deps, acting(), id, { 'reference-id': 'abandoned' });
      await changeInquiryTagsInTx(tx, api.deps, acting(), id, { kind: 'add', tag: 'abandoned' });
    });

    expect(await getInquiry(db(), api.environmentId, id)).toMatchObject({
      referenceId: null,
      tags: [],
    });
  });

  it('generateOneTimeLinkInTx records no link', async () => {
    const id = await createInquiryRoute(api);

    await abandoned((tx) =>
      generateOneTimeLinkInTx(tx, api.deps, acting(), id, undefined, 'ovl_synthetic'),
    );

    const links = await api.database.client.query(
      'select id from one_time_links where inquiry_id = $1',
      [id],
    );
    expect(links.rows).toEqual([]);
  });
});

describe('accounts', () => {
  const unit = (tx: Db, staged: StagedEvent[] = []) =>
    accountChangeIn(tx, api.deps, acting().ctx, actor, staged);

  it('each form leaves the account as it was', async () => {
    const [first, second] = await db().transaction(async (tx) => [
      await createAccountInTx(api.deps, unit(tx), {}),
      await createAccountInTx(api.deps, unit(tx), {}),
    ]);
    const accountId = first.account.id;
    const relation = {
      'related-account-id': second.account.id,
      'relation-type': 'synthetic',
    };
    let created = '';

    await abandoned(async (tx) => {
      created = (await createAccountInTx(api.deps, unit(tx), {})).account.id;
      await updateAccountInTx(unit(tx), accountId, { 'reference-id': 'abandoned' });
      await changeAccountTagsInTx(unit(tx), accountId, { kind: 'add', tag: 'abandoned' });
      await addAccountRelationInTx(unit(tx), accountId, relation);
      await removeAccountRelationInTx(unit(tx), accountId, relation);
    });

    expect(await getAccount(db(), api.environmentId, created)).toBeNull();
    expect(await getAccount(db(), api.environmentId, accountId)).toMatchObject({
      referenceId: null,
      tags: [],
    });
  });

  it('hands its events to the caller', async () => {
    const staged: StagedEvent[] = [];

    await db().transaction((tx) =>
      createAccountInTx(api.deps, unit(tx, staged), {}),
    );

    expect(staged).toHaveLength(1);
  });
});

describe('transactions', () => {
  it('each form leaves the transaction as it was', async () => {
    const type = await seedTransactionType(db(), api.environmentId);
    const { id } = await seedTransaction(db(), api.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
    const unit = (tx: Db) =>
      transactionChangeIn(tx, api.deps, acting(), []);
    let created = '';

    await abandoned(async (tx) => {
      created = (
        await createTransactionInTx(api.deps, unit(tx), acting(), {
          'transaction-type-id': type.id,
        })
      ).id;
      await updateTransactionInTx(api.deps, unit(tx), acting(), id, { status: 'approved' });
      await changeTransactionTagsInTx(unit(tx), acting(), id, { kind: 'add', tag: 'abandoned' });
    });

    expect(await getTransaction(db(), api.environmentId, created)).toBeNull();
    expect(await getTransaction(db(), api.environmentId, id)).toMatchObject({
      status: 'created',
      tags: [],
    });
  });
});

describe('reports', () => {
  it('changeReportTagsInTx leaves the report as it was', async () => {
    const template = await seedReportTemplate(db(), api.environmentId);
    const id = await seedReport(db(), api.environmentId, template);

    await abandoned((tx) =>
      changeReportTagsInTx(tx, api.deps, acting(), id, { kind: 'add', tag: 'abandoned' }),
    );

    expect(await getReport(db(), api.environmentId, id)).toMatchObject({ tags: [] });
  });
});
