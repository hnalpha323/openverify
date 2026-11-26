/**
 * C129.4 (P14, V08), C129.4's key restriction, C143.4 and C134.4 (Workflow 8B Stage 3, `api-cases`):
 * the exits a case leaves by outside its own routes.
 *
 * - `filterCaseVisibility`: an item naming a case, or a comment of a case, whose template the reader
 *   may not see is left out; a user sees a restricted template through a listed role, a key through
 *   its `case-template-ids`; an id naming nothing hides nothing.
 * - `assertKeyTemplateRestrictionInTx`: a key's list names templates of this environment that its
 *   creator may see, and nothing wider.
 * - `resolveCaseFilterSubjects`: a case's template and every held inquiry's template; a comment
 *   resolves through its case.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createCaseCommentRow, createUser, type Db } from '@openverify/db';
import { createTestInquiry, seedCase, seedCaseTemplate, testId } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import { apiKeyPrincipal, userPrincipal } from '../../test-support/principals.js';
import { resolveCaseFilterSubjects } from './filter-subjects.js';
import { assertKeyTemplateRestrictionInTx } from './key-restriction.js';
import { filterCaseVisibility } from './visibility.js';

let api: TestApi;
let db: Db;

beforeAll(async () => {
  api = await createTestApi();
  db = api.database.db;
}, 120_000);

afterAll(async () => {
  await api.close();
});

async function user(roleIds: readonly string[] = []): Promise<string> {
  const id = testId('usr');
  await createUser(db, {
    id,
    organizationId: api.organizationId,
    email: `${id.toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$c3ludGhldGljaGFzaA',
  });
  for (const roleId of roleIds) {
    await db.execute(sql`insert into user_roles (organization_id, user_id, role_id)
      values (${api.organizationId}, ${id}, ${roleId})`);
  }
  return id;
}

async function role(permissions: readonly string[] = ['cases:read']): Promise<string> {
  const id = testId('role');
  await db.execute(sql`insert into roles (id, organization_id, name, permissions)
    values (${id}, ${api.organizationId}, ${`Synthetic ${id}`},
      ${`{${permissions.join(',')}}`}::text[])`);
  return id;
}

/** A template restricted to `roleId`, and one open to all, each with a case and a comment. */
async function restricted(roleId: string) {
  const hidden = await seedCaseTemplate(db, api.environmentId);
  await db.execute(
    sql`update case_templates set visible_to_roles = ${`{${roleId}}`}::text[] where id = ${hidden.id}`,
  );
  const open = await seedCaseTemplate(db, api.environmentId);
  const hiddenCase = await seedCase(db, api.environmentId, {
    caseTemplateId: hidden.id,
    caseTemplateVersionId: hidden.versionId,
    key: hidden.key,
    number: 1,
  });
  const openCase = await seedCase(db, api.environmentId, {
    caseTemplateId: open.id,
    caseTemplateVersionId: open.versionId,
    key: open.key,
    number: 1,
  });
  const comment = await createCaseCommentRow(db, api.environmentId, {
    id: newId('cscm'),
    caseId: hiddenCase.id,
    message: 'synthetic',
    commenterType: 'user',
    commenterId: testId('usr'),
    mentions: [],
  });
  return { hidden, open, hiddenCase, openCase, comment };
}

describe('filterCaseVisibility (C129.4)', () => {
  it('leaves out what names a case of a template the reader may not see', async () => {
    const roleId = await role();
    const { hidden, hiddenCase, openCase, comment } = await restricted(roleId);
    const items = [
      { name: 'hidden', ids: [hiddenCase.id] },
      { name: 'comment', ids: [comment.id] },
      { name: 'open', ids: [openCase.id] },
      { name: 'none', ids: [testId('case')] },
      { name: 'plain', ids: [] },
    ];
    const visible = async (principal: Parameters<typeof filterCaseVisibility>[1]['principal']) =>
      (
        await filterCaseVisibility(
          db,
          { environmentId: api.environmentId, principal },
          items,
          ({ ids }) => ids,
        )
      ).map(({ name }) => name);
    const base = { organizationId: api.organizationId, environmentId: api.environmentId };

    expect(await visible(userPrincipal({ ...base, userId: await user() }))).toEqual([
      'open',
      'none',
      'plain',
    ]);
    expect(await visible(userPrincipal({ ...base, userId: await user([roleId]) }))).toHaveLength(5);
    const keyId = testId('key');
    expect(await visible(apiKeyPrincipal({ ...base, apiKeyId: keyId }))).toHaveLength(3);
    await db.execute(sql`update api_keys set case_template_ids = ${`{${hidden.id}}`}::text[]
      where id = ${keyId}`);
    expect(await visible(apiKeyPrincipal({ ...base, apiKeyId: keyId }))).toHaveLength(3);
  });

  it('lets a key that lists the template see it', async () => {
    const roleId = await role();
    const { hidden, hiddenCase } = await restricted(roleId);
    const token = await api.newApiKey(api.environmentId);
    const [{ id: keyId } = { id: '' }] = (
      await api.database.client.query<{ id: string }>(
        'select id from api_keys order by created_at desc, id desc limit 1',
      )
    ).rows;
    await db.execute(sql`update api_keys set case_template_ids = ${`{${hidden.id}}`}::text[]
      where id = ${keyId}`);

    const read = await api.app.inject({
      method: 'GET',
      url: `/api/v1/cases/${hiddenCase.id}`,
      headers: bearer(token),
    });

    expect(read.statusCode, read.body).toBe(200);
  });
});

describe('assertKeyTemplateRestrictionInTx (C129.4)', () => {
  it('holds a key’s list to templates of this environment its creator may see', async () => {
    const roleId = await role();
    const { hidden, open } = await restricted(roleId);
    const base = { organizationId: api.organizationId, environmentId: api.environmentId };
    const outsider = userPrincipal({ ...base, userId: await user() });
    const insider = userPrincipal({ ...base, userId: await user([roleId]) });
    const check = (creator: typeof outsider, ids: readonly string[] | null) =>
      db.transaction((tx) => assertKeyTemplateRestrictionInTx(tx, api.environmentId, creator, ids));

    await expect(check(outsider, null)).resolves.toBeUndefined();
    await expect(check(outsider, [])).resolves.toBeUndefined();
    await expect(check(outsider, [open.id])).resolves.toBeUndefined();
    await expect(check(insider, [hidden.id, open.id])).resolves.toBeUndefined();
    await expect(check(outsider, [hidden.id])).rejects.toMatchObject({ status: 422 });
    await expect(check(insider, [testId('ctmpl')])).rejects.toMatchObject({ status: 422 });
  });
});

describe('resolveCaseFilterSubjects (C143.4)', () => {
  it('names a case’s template and every held inquiry’s, and a comment’s through its case', async () => {
    const template = await seedCaseTemplate(db, api.environmentId);
    const made = await seedCase(db, api.environmentId, {
      caseTemplateId: template.id,
      caseTemplateVersionId: template.versionId,
      key: template.key,
      number: 1,
    });
    const { inquiry, template: inquiryTemplate } = await createTestInquiry(db, api.environmentId);
    await db.execute(sql`insert into case_inquiries (environment_id, case_id, inquiry_id,
        attached_by_type, attached_by_id)
      values (${api.environmentId}, ${made.id}, ${inquiry.id}, 'user', ${testId('usr')})`);
    const comment = await createCaseCommentRow(db, api.environmentId, {
      id: newId('cscm'),
      caseId: made.id,
      message: 'synthetic',
      commenterType: 'user',
      commenterId: testId('usr'),
      mentions: [],
    });

    const subjects = await resolveCaseFilterSubjects(db, api.environmentId, [
      { data: { type: 'case', id: made.id } },
      {
        data: {
          type: 'case-comment',
          id: comment.id,
          relationships: { case: { data: { type: 'case', id: made.id } } },
        },
      },
      { data: { type: 'case', id: testId('case') } },
    ]);

    const expected = {
      caseTemplateId: template.id,
      heldInquiryTemplateIds: [inquiryTemplate.id],
    };
    expect(subjects).toEqual([expected, expected, {}]);
  });
});
