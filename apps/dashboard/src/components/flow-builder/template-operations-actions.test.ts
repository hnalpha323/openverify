// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { problemDocument } from '../../testing/api-mock';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, draft, single, template } from '../../testing/lifecycle-fixtures';
import { copyTemplateAction, promoteTemplateAction } from './template-operations-actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TARGET = 'env_01JB0000000000000000000009';
const THEME_SET = 'theset_01JB0000000000000000000001';

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('copy a template (C154.4, C155.7)', () => {
  it('copies the version under the new name and answers the new template', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    api.on(
      'POST',
      `/inquiry-templates/${IDS.template}/copy`,
      201,
      single(template({ name: 'Synthetic copy' })),
    );

    const result = await copyTemplateAction({
      templateId: IDS.template,
      name: '  Synthetic copy ',
      versionId: IDS.version,
    });

    expect(result).toEqual({ ok: true, data: { id: IDS.template, name: 'Synthetic copy' } });
    expect(api.find('POST', `/inquiry-templates/${IDS.template}/copy`)?.body).toEqual({
      meta: { name: 'Synthetic copy', 'version-id': IDS.version },
    });
  });

  it('sends nothing for an empty name or without inquiry-templates:write', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    expect((await copyTemplateAction({ templateId: IDS.template, name: ' ' })).ok).toBe(false);
    api.me({ permissions: ['inquiry-templates:read'] });
    expect((await copyTemplateAction({ templateId: IDS.template, name: 'Copy' })).ok).toBe(false);
    expect(api.all('POST', `/inquiry-templates/${IDS.template}/copy`)).toEqual([]);
  });
});

describe('promote a template version (C154.5, C155.7)', () => {
  it('promotes into the named environment and answers the draft made there', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    api.on('POST', `/inquiry-templates/${IDS.template}/promote`, 201, {
      data: draft(),
      meta: { copied: [{ type: 'theme-set', id: THEME_SET }] },
    });

    const result = await promoteTemplateAction({
      templateId: IDS.template,
      environmentId: TARGET,
      versionId: IDS.version,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        versionId: IDS.draft,
        versionNumber: 2,
        copiedThemeSets: 1,
      },
    });
    expect(api.find('POST', `/inquiry-templates/${IDS.template}/promote`)?.body).toEqual({
      meta: { 'environment-id': TARGET, 'version-id': IDS.version },
    });
  });

  it('answers the API’s refusal with its status and code, never a promote', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });
    api.on(
      'POST',
      `/inquiry-templates/${IDS.template}/promote`,
      409,
      problemDocument(409, undefined, { code: 'draft_exists' }),
    );

    const result = await promoteTemplateAction({ templateId: IDS.template, environmentId: TARGET });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.problem).toMatchObject({ status: 409, code: 'draft_exists' });
  });

  it('refuses a malformed environment id before calling the API', async () => {
    api.me({ permissions: ['inquiry-templates:read', 'inquiry-templates:write'] });

    const result = await promoteTemplateAction({ templateId: IDS.template, environmentId: 'prod' });

    expect(result.ok).toBe(false);
    expect(api.all('POST', `/inquiry-templates/${IDS.template}/promote`)).toEqual([]);
  });
});
