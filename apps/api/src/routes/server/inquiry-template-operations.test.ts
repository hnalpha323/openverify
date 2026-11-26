/**
 * C154.4-C154.7 (Workflow 9A, `api-templates`): the routes around a template's versions: validate
 * (a dry run on the stored draft or an unsaved body), diff of any two versions keyed by step ids with
 * its flagged consequences, restore (409 `draft_exists` while a draft stands), copy, used by,
 * promote into another environment of the organisation (users only, never over a draft, references
 * re-resolved or `promote_unresolved` at their pointer) and the deployment history in the caller's
 * environment only. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { PERMISSIONS } from '@openverify/core';
import {
  createEnvironment,
  createRole,
  createUser,
  setUserRoleAssignments,
  themeAssets,
  themeSets,
} from '@openverify/db';
import { eq } from 'drizzle-orm';
import { seedList, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, createTemplate, multipart } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const linear = JSON.parse(
  readFileSync(
    new URL('../../../../../contracts/fixtures/flows/v2/projection-linear.json', import.meta.url),
    'utf8',
  ),
) as { steps: Record<string, unknown>[]; edges: unknown[] };
const defaults = defaultInquiryTemplateAttributes()['verification-config'];

const call = (method: 'GET' | 'POST', url: string, payload?: object, token = api.token) =>
  payload === undefined
    ? api.app.inject({ method, url: `/api/v1${url}`, headers: bearer(token) })
    : api.app.inject({ method, url: `/api/v1${url}`, headers: bearer(token), payload });

async function draft(templateId: string, attributes: Record<string, unknown> = {}) {
  const response = await call('POST', '/inquiry-template-versions', {
    data: {
      attributes: {
        'inquiry-template-id': templateId,
        flow: linear,
        'verification-config': defaults,
        ...attributes,
      },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: { id: string } }>().data.id;
}

const publish = async (id: string) => {
  const response = await call('POST', `/inquiry-template-versions/${id}/publish`, {});
  expect(response.statusCode, response.body).toBe(200);
};

describe('deployments (C154.7)', () => {
  it('lists and reads the deployments of the caller environment only', async () => {
    const templateId = await createTemplate(api, api.token);
    await publish(await draft(templateId));
    const listed = await call('GET', `/deployments?filter[inquiry-template-id]=${templateId}`);
    expect(listed.statusCode, listed.body).toBe(200);
    const items = listed.json<{ data: { id: string }[] }>().data;
    expect(items).toHaveLength(1);
    const one = await call('GET', `/deployments/${items[0]?.id ?? ''}`);
    expect(one.statusCode).toBe(200);
    const other = await call(
      'GET',
      '/deployments?filter[environment-id]=env_01M5CJXHG0000000000000000A',
    );
    expect(other.json<{ data: unknown[] }>().data).toEqual([]);
    const stranger = await api.newTenant();
    expect(
      (await call('GET', `/deployments/${items[0]?.id ?? ''}`, undefined, stranger.token))
        .statusCode,
    ).toBe(404);
  });
});

describe('validate (C154.4)', () => {
  it('runs every rule on an unsaved body without storing it, and on the stored draft', async () => {
    const templateId = await createTemplate(api, api.token);
    const id = await draft(templateId);
    const unsaved = await call('POST', `/inquiry-template-versions/${id}/validate`, {
      data: { attributes: { flow: { ...linear, edges: linear.edges.slice(0, 2) } } },
    });
    expect(unsaved.statusCode, unsaved.body).toBe(200);
    const attributes = unsaved.json<{
      data: {
        type: string;
        attributes: { validation: { status: string; problems: { code: string }[] } };
      };
    }>().data;
    expect(attributes.type).toBe('inquiry-template-version-validation');
    expect(attributes.attributes.validation.status).toBe('invalid');
    const stored = await call('POST', `/inquiry-template-versions/${id}/validate`, {
      meta: { mode: 'publish' },
    });
    expect(
      stored.json<{ data: { attributes: { validation: { status: string } } } }>().data.attributes
        .validation.status,
    ).toBe('valid');
  });
});

describe('diff (C154.6)', () => {
  it('names the changed step by id and flags a required check made optional', async () => {
    const templateId = await createTemplate(api, api.token);
    const first = await draft(templateId);
    await publish(first);
    const relaxed = structuredClone(defaults) as {
      'government-id': { checks: Record<string, { enabled: boolean; required: boolean }> };
    };
    const [name] =
      Object.entries(relaxed['government-id'].checks).find(([, check]) => check.required) ?? [];
    expect(name).toBeDefined();
    relaxed['government-id'].checks[name ?? ''] = { enabled: true, required: false };
    const second = await draft(templateId, {
      flow: {
        ...linear,
        steps: linear.steps.map((step) =>
          step.id === 'face' ? { ...step, maxAttempts: 2 } : step,
        ),
      },
      'verification-config': relaxed,
    });
    const response = await call(
      'GET',
      `/inquiry-template-versions/${second}/diff?against=${first}`,
    );
    expect(response.statusCode, response.body).toBe(200);
    const diff = response.json<{
      data: {
        attributes: {
          steps: { changed: { 'step-id': string }[] };
          consequences: { code: string }[];
          'layout-only': boolean;
        };
      };
    }>().data.attributes;
    expect(diff.steps.changed.map((change) => change['step-id'])).toEqual(['face']);
    expect(diff.consequences.map(({ code }) => code)).toContain('required_check_relaxed');
    expect(diff['layout-only']).toBe(false);
  });
});

describe('restore and copy (C154.4)', () => {
  it('restores a version as a new draft, and refuses while a draft stands', async () => {
    const templateId = await createTemplate(api, api.token);
    const first = await draft(templateId, { description: 'The first' });
    await publish(first);
    const pending = await draft(templateId);
    const refused = await call('POST', `/inquiry-templates/${templateId}/restore`, {
      meta: { 'version-id': first },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('draft_exists');
    await publish(pending);
    const restored = await call('POST', `/inquiry-templates/${templateId}/restore`, {
      meta: { 'version-id': first },
    });
    expect(restored.statusCode, restored.body).toBe(201);
    expect(
      restored.json<{ data: { attributes: { status: string; description: string } } }>().data
        .attributes,
    ).toMatchObject({
      status: 'draft',
      description: 'The first',
    });
  });

  it('copies a template into a new one of the given name', async () => {
    const templateId = await createTemplate(api, api.token);
    const copied = await call('POST', `/inquiry-templates/${templateId}/copy`, {
      meta: { name: 'Copy of KYC' },
    });
    expect(copied.statusCode, copied.body).toBe(201);
    const data = copied.json<{ data: { id: string; attributes: { name: string } } }>().data;
    expect(data.id).not.toBe(templateId);
    expect(data.attributes.name).toBe('Copy of KYC');
  });
});

describe('used by (C154.4)', () => {
  it('answers what names the template, counted where the caller cannot read it', async () => {
    const templateId = await createTemplate(api, api.token);
    const response = await call('GET', `/inquiry-templates/${templateId}/used-by`);
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json<{ data: { attributes: Record<string, unknown> } }>().data.attributes,
    ).toMatchObject({
      workflows: [],
      'workflows-hidden': 0,
      'embed-origins': [],
    });
  });
});

/** The organisation's production environment (one per kind), the promote target. */
let production: string | undefined;
async function productionEnvironment(): Promise<string> {
  production ??= (
    await createEnvironment(api.database.db, {
      id: testId('env'),
      organizationId: api.organizationId,
      kind: 'production',
    })
  ).id;
  return production;
}

/**
 * A stored user of `api`'s organisation holding every permission through one assignment, reaching
 * `environmentIds` (null: organisation-wide), with a session in the sandbox. A promote reads the
 * user's stored assignments for the target (C167.2; Workflow 9B, api-access U5), so the session's
 * permissions alone never carry it into another environment.
 */
async function storedUserToken(
  environmentIds: readonly string[] | null,
  narrower: { environmentIds: readonly string[]; permissions: readonly string[] }[] = [],
): Promise<string> {
  const userId = testId('usr');
  await createUser(api.database.db, {
    id: userId,
    organizationId: api.organizationId,
    email: `${userId.toLowerCase()}@example.test`,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$synthetic$synthetic',
  });
  const role = await createRole(api.database.db, api.organizationId, {
    id: testId('role'),
    name: `Synthetic promoter ${testId('role')}`,
    permissions: [...PERMISSIONS],
  });
  const others = await Promise.all(
    narrower.map(async (assignment) => ({
      roleId: (
        await createRole(api.database.db, api.organizationId, {
          id: testId('role'),
          name: `Synthetic narrower ${testId('role')}`,
          permissions: [...assignment.permissions],
        })
      ).id,
      environmentIds: assignment.environmentIds,
    })),
  );
  await setUserRoleAssignments(api.database.db, api.organizationId, userId, [
    { roleId: role.id, environmentIds },
    ...others,
  ]);
  return api.newUserToken(api.environmentId, { userId });
}

describe('promote (C154.5)', () => {
  it('copies a published version as a draft into another environment, users only, never over a draft', async () => {
    const target = { id: await productionEnvironment() };
    const templateId = await createTemplate(api, api.token);
    const body = { meta: { 'environment-id': target.id } };
    expect((await call('POST', `/inquiry-templates/${templateId}/promote`, body)).statusCode).toBe(
      403,
    );
    const user = await storedUserToken(null);
    const promoted = await call('POST', `/inquiry-templates/${templateId}/promote`, body, user);
    expect(promoted.statusCode, promoted.body).toBe(201);
    expect(
      promoted.json<{ data: { attributes: { status: string } }; meta: { copied: unknown[] } }>(),
    ).toMatchObject({
      data: { attributes: { status: 'draft' } },
      meta: { copied: [] },
    });
    const again = await call('POST', `/inquiry-templates/${templateId}/promote`, body, user);
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('draft_exists');
  });

  it('needs the rights in the target environment too: a user narrowed to the sandbox is refused', async () => {
    const target = { id: await productionEnvironment() };
    const templateId = await createTemplate(api, api.token);
    const narrow = await storedUserToken([api.environmentId]);

    const response = await call(
      'POST',
      `/inquiry-templates/${templateId}/promote`,
      { meta: { 'environment-id': target.id } },
      narrow,
    );

    expect(response.statusCode, response.body).toBe(403);
    const wide = await storedUserToken([api.environmentId, target.id]);
    const promoted = await call(
      'POST',
      `/inquiry-templates/${templateId}/promote`,
      { meta: { 'environment-id': target.id } },
      wide,
    );
    expect(promoted.statusCode, promoted.body).toBe(201);
  });

  it('copies a theme set only for a user who may write theme sets in the target (C160.8)', async () => {
    const target = { id: await productionEnvironment() };
    const set = await call('POST', '/theme-sets', {
      data: { type: 'theme-set', attributes: { name: `Synthetic brand ${testId('theset')}` } },
    });
    expect(set.statusCode, set.body).toBe(201);
    const themeSetId = set.json<{ data: { id: string } }>().data.id;
    const templateId = await createTemplate(api, api.token);
    await publish(await draft(templateId, { 'theme-set-id': themeSetId }));
    const withoutThemes = PERMISSIONS.filter((permission) => permission !== 'theme-sets:write');
    const sourceOnly = await storedUserToken(
      [api.environmentId],
      [{ environmentIds: [target.id], permissions: withoutThemes }],
    );
    const body = { meta: { 'environment-id': target.id } };

    const refused = await call(
      'POST',
      `/inquiry-templates/${templateId}/promote`,
      body,
      sourceOnly,
    );

    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json<{ code: string }>().code).toBe('promote_unresolved');
    const both = await storedUserToken(null);
    const promoted = await call('POST', `/inquiry-templates/${templateId}/promote`, body, both);
    expect(promoted.statusCode, promoted.body).toBe(201);
    expect(promoted.json<{ meta: { copied: { type: string }[] } }>().meta.copied).toEqual([
      expect.objectContaining({ type: 'theme-set' }),
    ]);
  });

  it('copies a theme set with an uploaded font, its asset copied as stored, instead of refusing it (K9-32, C160.8)', async () => {
    const target = { id: await productionEnvironment() };
    const font = new Uint8Array(64);
    font.set([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0, 0, 64, 0, 1]);
    const form = await multipart({
      kind: 'font',
      'meta[licence-attested]': 'true',
      file: { bytes: font, filename: 'brand.woff2' },
    });
    const uploaded = await api.app.inject({
      method: 'POST',
      url: '/api/v1/theme-sets/assets',
      headers: { ...bearer(api.newUserToken(api.environmentId)), ...form.headers },
      payload: form.payload,
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const assetId = uploaded.json<{ data: { id: string } }>().data.id;
    const set = await call('POST', '/theme-sets', {
      data: {
        type: 'theme-set',
        attributes: {
          name: `Synthetic font brand ${testId('theset')}`,
          styles: { typography: { font: { kind: 'uploaded', 'asset-id': assetId } } },
        },
      },
    });
    expect(set.statusCode, set.body).toBe(201);
    const templateId = await createTemplate(api, api.token);
    await publish(
      await draft(templateId, { 'theme-set-id': set.json<{ data: { id: string } }>().data.id }),
    );

    const promoted = await call(
      'POST',
      `/inquiry-templates/${templateId}/promote`,
      { meta: { 'environment-id': target.id } },
      await storedUserToken(null),
    );

    expect(promoted.statusCode, promoted.body).toBe(201);
    const [copied] = promoted.json<{ meta: { copied: { type: string; id: string }[] } }>().meta
      .copied;
    expect(copied?.type).toBe('theme-set');
    const copy = await api.database.db
      .select()
      .from(themeSets)
      .where(eq(themeSets.id, copied?.id ?? ''));
    const copiedFont = (copy[0]?.styles as { typography: { font: { 'asset-id': string } } })
      .typography.font['asset-id'];
    expect(copiedFont).not.toBe(assetId);
    const [asset] = await api.database.db
      .select()
      .from(themeAssets)
      .where(eq(themeAssets.id, copiedFont));
    expect(asset).toMatchObject({ environmentId: target.id, kind: 'font', byteSize: 64 });
  });

  it('refuses a list it cannot find by kind and name in the target, at its pointer', async () => {
    const target = { id: await productionEnvironment() };
    const { id: listId } = await seedList(api.database.db, api.environmentId, {
      name: 'Synthetic blocklist',
    });
    const templateId = await createTemplate(api, api.token);
    await publish(await draft(templateId, { 'list-config': { screen: [listId] } }));
    const user = await storedUserToken(null);
    const response = await call(
      'POST',
      `/inquiry-templates/${templateId}/promote`,
      { meta: { 'environment-id': target.id } },
      user,
    );
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json<{ code: string; errors: { pointer: string }[] }>()).toMatchObject({
      code: 'promote_unresolved',
      errors: [{ pointer: '/data/attributes/list-config/screen/0' }],
    });
  });
});
