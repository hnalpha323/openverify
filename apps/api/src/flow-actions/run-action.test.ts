/**
 * C152.3-C152.6, C152.8 (Workflow 9A, `api-flow-actions`): the flow actions that finish in the
 * transaction that enters them, each exactly once per entry:
 * - `tag_inquiry` with literal tags, `inquiry.updated-tags` staged and a system audit entry;
 * - `flag_for_review` with its reason code as a step-record note, never shown to the person;
 * - `update_account_fields` on the inquiry's account through the accounts service (the account type
 *   validates), `account.updated-fields` staged, the copied keys and the target on the action row,
 *   which the redaction's `flowActionCopyTargets` reads; an unknown value is never written;
 * - `copy_extractions` from a decided verification (passed or in review) into the inquiry's
 *   `fields` through the version's field rules (`validateInquiryFieldsWrite`, write-once respected),
 *   audited with the keys only; an unknown value is never written;
 * - a repeat of an entry runs nothing again; a redacted inquiry is never touched.
 *
 * Every value is synthetic.
 */
import { getAccount, getInquiry, getInquiryFlowAction, type Db } from '@openverify/db';
import type { FlowAction } from '@openverify/flow-spec';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FlowEngineProblemError } from '../flow-engine/problems.js';
import { ensureDefaultAccountType } from '../services/accounts.js';
import * as fieldRules from '../services/templates/fields.js';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { createInquiry } from '../test-support/harness.js';
import { flowActionCopyTargets } from './copies.js';
import { runFlowActionInTx, type FlowActionEntry, type FlowScopeRoots } from './run-action.js';

vi.mock('../services/templates/fields.js', { spy: true });

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
  await ensureDefaultAccountType(api.database.db, api.environmentId);
});

afterAll(async () => {
  await api.close();
});

const entryOf = (
  stepId: string,
  action: FlowAction,
  more: { entry?: number; scope?: FlowScopeRoots } = {},
): FlowActionEntry => ({ stepId, entry: more.entry ?? 1, action, scope: more.scope });

async function run(inquiryId: string, entry: FlowActionEntry) {
  const deps = { events: api.events, clock: api.clock, db: api.database.db };
  const ref = { environmentId: api.environmentId, inquiryId };
  const outcome = await api.database.db.transaction((tx) =>
    runFlowActionInTx(tx as Db, deps, ref, entry),
  );
  await api.events.dispatch(outcome.staged);
  return outcome;
}

async function auditOf(resourceId: string) {
  const { rows } = await api.database.client.query<{
    action: string;
    actor_type: string;
    actor_id: string | null;
    metadata: Record<string, unknown> | null;
  }>(
    `select action, actor_type, actor_id, metadata from audit_logs
      where environment_id = $1 and resource_id = $2 order by created_at, id`,
    [api.environmentId, resourceId],
  );
  return rows;
}

async function accountOf(inquiryId: string) {
  const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
  const accountId = inquiry?.accountId ?? '';
  return { accountId, account: await getAccount(api.database.db, api.environmentId, accountId) };
}

describe('tag_inquiry (C152.5)', () => {
  it('adds and removes literal tags once, staging inquiry.updated-tags, audited as the system', async () => {
    const inquiryId = await createInquiry(api);
    const before = api.events.named('inquiry.updated-tags').length;
    const entry = entryOf('tag_vip', { kind: 'tag_inquiry', add: ['vip', 'priority'] });
    const outcome = await run(inquiryId, entry);
    expect(outcome).toMatchObject({ state: 'done', port: 'next', errorType: null });
    const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
    expect([...(inquiry?.tags ?? [])].sort()).toEqual(['priority', 'vip']);
    expect(api.events.named('inquiry.updated-tags')).toHaveLength(before + 1);
    expect(
      await getInquiryFlowAction(api.database.db, api.environmentId, {
        inquiryId,
        stepId: 'tag_vip',
        entry: 1,
      }),
    ).toMatchObject({ status: 'completed', errorType: null, copiedKeys: [] });
    const audits = (await auditOf(inquiryId)).filter(
      ({ action }) => action === 'inquiry.updated-tags',
    );
    expect(audits).toEqual([
      {
        action: 'inquiry.updated-tags',
        actor_type: 'system',
        actor_id: null,
        metadata: { operation: 'flow-action', 'flow-step-id': 'tag_vip', entry: 1 },
      },
    ]);

    // A repeat of the same entry runs nothing again.
    const repeat = await run(inquiryId, entry);
    expect(repeat).toMatchObject({ state: 'done', port: 'next', errorType: null, staged: [] });
    expect(api.events.named('inquiry.updated-tags')).toHaveLength(before + 1);

    const removed = await run(
      inquiryId,
      entryOf('tag_vip', { kind: 'tag_inquiry', remove: ['vip'] }, { entry: 2 }),
    );
    expect(removed).toMatchObject({ state: 'done', port: 'next' });
    expect((await getInquiry(api.database.db, api.environmentId, inquiryId))?.tags).toEqual([
      'priority',
    ]);
  });

  it('changes nothing and stages nothing when the tags are already as asked', async () => {
    const inquiryId = await createInquiry(api);
    await run(inquiryId, entryOf('tag_a', { kind: 'tag_inquiry', add: ['vip'] }));
    const outcome = await run(
      inquiryId,
      entryOf('tag_b', { kind: 'tag_inquiry', add: ['vip'], remove: ['absent'] }),
    );
    expect(outcome).toMatchObject({ state: 'done', port: 'next', staged: [] });
  });
});

describe('flag_for_review (C152.6)', () => {
  it('records its reason code as a step-record note and moves nothing', async () => {
    const inquiryId = await createInquiry(api);
    const before = await getInquiry(api.database.db, api.environmentId, inquiryId);
    const outcome = await run(
      inquiryId,
      entryOf('flag_risk', { kind: 'flag_for_review', reasonCode: 'manual_check' }),
    );
    expect(outcome).toEqual({
      state: 'done',
      port: 'next',
      errorType: null,
      staged: [],
      notes: ['flag_for_review:manual_check'],
    });
    const after = await getInquiry(api.database.db, api.environmentId, inquiryId);
    expect(after?.status).toBe(before?.status);
    expect(
      await getInquiryFlowAction(api.database.db, api.environmentId, {
        inquiryId,
        stepId: 'flag_risk',
        entry: 1,
      }),
    ).toMatchObject({ status: 'completed' });
  });
});

describe('update_account_fields (C152.4, C152.8; V08)', () => {
  it('writes the mapped values to the inquiry’s account once, and records the target and keys', async () => {
    const inquiryId = await createInquiry(api);
    const { accountId } = await accountOf(inquiryId);
    const scope: FlowScopeRoots = {
      inquiry: { fields: { name_first: 'Alexis', name_middle: null } },
    };
    const before = api.events.named('account.updated-fields').length;
    const outcome = await run(
      inquiryId,
      entryOf(
        'copy_name',
        {
          kind: 'update_account_fields',
          mapping: {
            name_first: { path: 'inquiry.fields.name_first' },
            name_middle: { path: 'inquiry.fields.name_middle' },
            address_country_code: { literal: 'US' },
          },
        },
        { scope },
      ),
    );
    expect(outcome).toMatchObject({ state: 'done', port: 'next', errorType: null });
    const { account } = await accountOf(inquiryId);
    expect(account?.fields).toMatchObject({ name_first: 'Alexis', address_country_code: 'US' });
    // An unknown (null) value is never written over the account.
    expect(account?.fields).not.toHaveProperty('name_middle');
    expect(api.events.named('account.updated-fields')).toHaveLength(before + 1);
    const row = await getInquiryFlowAction(api.database.db, api.environmentId, {
      inquiryId,
      stepId: 'copy_name',
      entry: 1,
    });
    expect(row).toMatchObject({
      status: 'completed',
      targetAccountId: accountId,
      copiedKeys: ['address_country_code', 'name_first'],
    });
    const audits = (await auditOf(accountId)).filter(({ action }) => action === 'account.updated');
    expect(audits.at(-1)).toMatchObject({
      actor_type: 'system',
      metadata: { attributes: ['fields'], 'flow-step-id': 'copy_name', 'inquiry-id': inquiryId },
    });
    expect(
      await flowActionCopyTargets(api.database.db, { environmentId: api.environmentId, inquiryId }),
    ).toEqual([
      { accountId, keys: ['address_country_code', 'name_first'], stepId: 'copy_name', entry: 1 },
    ]);
    // A repeat of the entry writes nothing again.
    await run(
      inquiryId,
      entryOf(
        'copy_name',
        { kind: 'update_account_fields', mapping: { name_first: { literal: 'Robin' } } },
        { scope },
      ),
    );
    expect((await accountOf(inquiryId)).account?.fields).toMatchObject({ name_first: 'Alexis' });
  });

  it('takes error when the account type refuses a value, and writes and records nothing', async () => {
    const inquiryId = await createInquiry(api);
    const before = (await accountOf(inquiryId)).account?.fields;
    const outcome = await run(
      inquiryId,
      entryOf('copy_bad', {
        kind: 'update_account_fields',
        mapping: { not_a_field: { literal: 'x' }, name_first: { literal: 'Alexis' } },
      }),
    );
    expect(outcome).toMatchObject({
      state: 'done',
      port: 'error',
      errorType: 'account_fields_invalid',
      staged: [],
    });
    expect((await accountOf(inquiryId)).account?.fields).toEqual(before);
    expect(
      await getInquiryFlowAction(api.database.db, api.environmentId, {
        inquiryId,
        stepId: 'copy_bad',
        entry: 1,
      }),
    ).toMatchObject({ status: 'errored', errorType: 'account_fields_invalid', copiedKeys: [] });
    expect(
      await flowActionCopyTargets(api.database.db, { environmentId: api.environmentId, inquiryId }),
    ).toEqual([]);
  });

  it('takes error when a mapping reads the scope and none was given', async () => {
    const inquiryId = await createInquiry(api);
    const outcome = await run(
      inquiryId,
      entryOf('copy_scope', {
        kind: 'update_account_fields',
        mapping: { name_first: { path: 'inquiry.fields.name_first' } },
      }),
    );
    expect(outcome).toMatchObject({ port: 'error', errorType: 'scope_unavailable' });
  });

  it('records no target when every value was unknown', async () => {
    const inquiryId = await createInquiry(api);
    const outcome = await run(
      inquiryId,
      entryOf(
        'copy_none',
        {
          kind: 'update_account_fields',
          mapping: { name_first: { path: 'inquiry.fields.name_first' } },
        },
        { scope: { inquiry: { fields: {} } } },
      ),
    );
    expect(outcome).toMatchObject({ state: 'done', port: 'next', staged: [] });
    expect(
      await getInquiryFlowAction(api.database.db, api.environmentId, {
        inquiryId,
        stepId: 'copy_none',
        entry: 1,
      }),
    ).toMatchObject({ status: 'completed', targetAccountId: null, copiedKeys: [] });
  });
});

describe('copy_extractions (C152.3)', () => {
  const COPY: FlowAction = {
    kind: 'copy_extractions',
    fromStep: 'id_card',
    mapping: {
      birthdate: 'birthdate',
      address_country_code: 'country-code',
      expiration_date: 'expiration-date',
    },
  };
  const decided = (status: string | null): FlowScopeRoots => ({
    verifications: {
      id_card: {
        status,
        birthdate: '1990-04-12',
        'country-code': 'US',
        'expiration-date': null,
      },
    },
  });
  const fieldsOf = async (inquiryId: string) =>
    (await getInquiry(api.database.db, api.environmentId, inquiryId))?.fields;

  it('copies a decided verification’s known values into fields once, audited by key', async () => {
    const inquiryId = await createInquiry(api);
    const outcome = await run(inquiryId, entryOf('copy_id', COPY, { scope: decided('passed') }));
    expect(outcome).toMatchObject({ state: 'done', port: 'next', errorType: null });
    const fields = await fieldsOf(inquiryId);
    expect(fields).toMatchObject({ birthdate: '1990-04-12', address_country_code: 'US' });
    expect(fields).not.toHaveProperty('expiration_date');
    const inquiry = await getInquiry(api.database.db, api.environmentId, inquiryId);
    expect(fieldRules.validateInquiryFieldsWrite).toHaveBeenLastCalledWith(expect.anything(), {
      kind: 'copy-extractions',
      environmentId: api.environmentId,
      versionId: inquiry?.inquiryTemplateVersionId,
      inquiryId,
      fields: { birthdate: '1990-04-12', address_country_code: 'US' },
    });
    const audits = (await auditOf(inquiryId)).filter(({ action }) => action === 'inquiry.updated');
    expect(audits).toEqual([
      {
        action: 'inquiry.updated',
        actor_type: 'system',
        actor_id: null,
        metadata: {
          attributes: ['fields'],
          'field-keys': ['address_country_code', 'birthdate'],
          'flow-step-id': 'copy_id',
          entry: 1,
        },
      },
    ]);
    // A repeat of the entry writes nothing again.
    await run(
      inquiryId,
      entryOf('copy_id', COPY, {
        scope: { verifications: { id_card: { status: 'passed', birthdate: '1971-01-01' } } },
      }),
    );
    expect(await fieldsOf(inquiryId)).toMatchObject({ birthdate: '1990-04-12' });
  });

  it('copies from a verification in review too', async () => {
    const inquiryId = await createInquiry(api);
    const outcome = await run(
      inquiryId,
      entryOf('copy_id', COPY, { scope: decided('needs_review') }),
    );
    expect(outcome).toMatchObject({ port: 'next' });
    expect(await fieldsOf(inquiryId)).toMatchObject({ address_country_code: 'US' });
  });

  it('takes error for a verification not decided, failed or absent, and writes nothing', async () => {
    for (const status of ['failed', 'submitted', null]) {
      const inquiryId = await createInquiry(api);
      const before = await fieldsOf(inquiryId);
      const outcome = await run(inquiryId, entryOf('copy_id', COPY, { scope: decided(status) }));
      expect(outcome).toMatchObject({ port: 'error', errorType: 'verification_not_decided' });
      expect(await fieldsOf(inquiryId)).toEqual(before);
    }
    const inquiryId = await createInquiry(api);
    expect(
      await run(inquiryId, entryOf('copy_id', COPY, { scope: { verifications: {} } })),
    ).toMatchObject({ port: 'error', errorType: 'verification_not_decided' });
    expect(await run(inquiryId, entryOf('copy_other', COPY))).toMatchObject({
      port: 'error',
      errorType: 'scope_unavailable',
    });
  });

  it('takes error with the field rule’s code when the version refuses the write', async () => {
    const inquiryId = await createInquiry(api);
    const before = await fieldsOf(inquiryId);
    vi.mocked(fieldRules.validateInquiryFieldsWrite).mockRejectedValueOnce(
      new FlowEngineProblemError('field_write_once', 'This field is written once and is set.'),
    );
    const outcome = await run(inquiryId, entryOf('copy_id', COPY, { scope: decided('passed') }));
    expect(outcome).toMatchObject({ port: 'error', errorType: 'field_write_once', staged: [] });
    expect(await fieldsOf(inquiryId)).toEqual(before);
    expect(
      await getInquiryFlowAction(api.database.db, api.environmentId, {
        inquiryId,
        stepId: 'copy_id',
        entry: 1,
      }),
    ).toMatchObject({ status: 'errored', errorType: 'field_write_once' });
  });

  it('writes nothing, and takes next, when every value is unknown', async () => {
    const inquiryId = await createInquiry(api);
    const before = await fieldsOf(inquiryId);
    const calls = vi.mocked(fieldRules.validateInquiryFieldsWrite).mock.calls.length;
    const outcome = await run(
      inquiryId,
      entryOf('copy_id', COPY, { scope: { verifications: { id_card: { status: 'passed' } } } }),
    );
    expect(outcome).toMatchObject({ port: 'next' });
    expect(await fieldsOf(inquiryId)).toEqual(before);
    expect(vi.mocked(fieldRules.validateInquiryFieldsWrite).mock.calls).toHaveLength(calls);
  });
});

describe('a redacted inquiry (Phase 6 guard)', () => {
  it('is never touched: no row, no tag, the error port', async () => {
    const inquiryId = await createInquiry(api);
    await api.database.client.query(
      'update inquiries set redacted_at = now() where environment_id = $1 and id = $2',
      [api.environmentId, inquiryId],
    );
    const outcome = await run(inquiryId, entryOf('tag', { kind: 'tag_inquiry', add: ['vip'] }));
    expect(outcome).toMatchObject({ state: 'done', port: 'error', errorType: 'inquiry_redacted' });
    expect(
      await getInquiryFlowAction(api.database.db, api.environmentId, {
        inquiryId,
        stepId: 'tag',
        entry: 1,
      }),
    ).toBeNull();
    expect((await getInquiry(api.database.db, api.environmentId, inquiryId))?.tags).toEqual([]);
  });
});
