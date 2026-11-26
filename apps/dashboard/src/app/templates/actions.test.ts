// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import {
  LIFECYCLE_IDS as IDS,
  RESOLVED_SETTINGS,
  VERSION_CONTENT,
  draft,
  single,
  template,
} from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  createDraftVersion,
  publishVersion,
  updateDraftVersion,
  updateTemplateStatus,
} from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const TEMPLATE_PAGE = `/templates/${IDS.template}`;
const DRAFT_PAGE = `${TEMPLATE_PAGE}/versions/${IDS.draft}`;
let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as('inquiry-templates:read', 'inquiry-templates:write', 'inquiry-templates:publish');
  api.on('GET', `/inquiry-templates/${IDS.template}`, 200, single(template()));
  api.on('POST', '/inquiry-template-versions', 201, single(draft()));
  api.on('PATCH', `/inquiry-template-versions/${IDS.draft}`, 200, single(draft()));
  api.on(
    'POST',
    `/inquiry-template-versions/${IDS.draft}/publish`,
    200,
    single(draft({ status: 'published', 'published-at': '2026-10-20T06:00:00.000Z' })),
  );
  api.on('PATCH', `/inquiry-templates/${IDS.template}`, 200, single(template()));
});

afterEach(() => {
  api.restore();
});

function as(...permissions: Permission[]) {
  api.me({ permissions });
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

const editorForm = (overrides: Record<string, string> = {}) =>
  form({
    'inquiry-template-id': IDS.template,
    'version-id': IDS.draft,
    flow: JSON.stringify(VERSION_CONTENT.flow),
    'verification-config': JSON.stringify(VERSION_CONTENT['verification-config']),
    settings: JSON.stringify({ ...RESOLVED_SETTINGS, 'inquiry-expiration-seconds': 3600 }),
    ...overrides,
  });

describe('createDraftVersion', () => {
  it("drafts the current version's content as a new version and opens its editor", async () => {
    await expect(
      redirectTarget(createDraftVersion(null, form({ 'inquiry-template-id': IDS.template }))),
    ).resolves.toBe(DRAFT_PAGE);
    expect(api.find('POST', '/inquiry-template-versions')?.body).toEqual({
      data: {
        type: 'inquiry-template-version',
        attributes: {
          'inquiry-template-id': IDS.template,
          ...VERSION_CONTENT,
          settings: RESOLVED_SETTINGS,
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE_PAGE);
  });

  it('needs inquiry-templates:write', async () => {
    as('inquiry-templates:read');

    await expect(
      createDraftVersion(null, form({ 'inquiry-template-id': IDS.template })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('updateDraftVersion', () => {
  it('saves the three documents', async () => {
    await expect(updateDraftVersion(null, editorForm())).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(api.find('PATCH', `/inquiry-template-versions/${IDS.draft}`)?.body).toEqual({
      data: {
        type: 'inquiry-template-version',
        attributes: {
          ...VERSION_CONTENT,
          settings: { ...RESOLVED_SETTINGS, 'inquiry-expiration-seconds': 3600 },
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith(DRAFT_PAGE);
  });

  it('points at the document that is not JSON', async () => {
    await expect(updateDraftVersion(null, editorForm({ settings: '{' }))).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/settings', detail: 'is not valid JSON' }] },
    });
    expect(api.find('PATCH', `/inquiry-template-versions/${IDS.draft}`)).toBeUndefined();
  });

  it('reports contract errors by path inside each document', async () => {
    const result = await updateDraftVersion(
      null,
      editorForm({ settings: '{ "inquiry-expiration-seconds": 10 }' }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        errors: [{ pointer: '/data/attributes/settings/inquiry-expiration-seconds' }],
      },
    });
  });

  it('refuses a check config the contract refuses, at the key, with the pointer the API uses (C29.5, C37)', async () => {
    const config = structuredClone(VERSION_CONTENT['verification-config']);
    const governmentId = config['government-id'];
    if (governmentId === undefined) throw new Error('The fixture has a government ID config');
    governmentId.checks.id_blur_detection = {
      enabled: true,
      required: true,
      config: { 'min-blur-score': 5000 },
    };

    const result = await updateDraftVersion(
      null,
      editorForm({ 'verification-config': JSON.stringify(config) }),
    );

    expect(result).toMatchObject({
      ok: false,
      problem: {
        errors: [
          {
            pointer:
              '/data/attributes/verification-config/government-id/checks/id_blur_detection/config/min-blur-score',
            detail: expect.stringContaining('1000') as unknown,
          },
        ],
      },
    });
  });

  it("passes on the API's field errors for the verification config by pointer (its 400 and 422 shape)", async () => {
    const pointer = '/data/attributes/verification-config/government-id/allowed-id-classes/0';
    api.onProblem('PATCH', `/inquiry-template-versions/${IDS.draft}`, 422, undefined, {
      title: 'Unprocessable Content',
      detail: 'The version would no longer be a valid template.',
      errors: [{ location: 'body', pointer, detail: 'is not an ID class the flow allows' }],
    });

    await expect(updateDraftVersion(null, editorForm())).resolves.toMatchObject({
      ok: false,
      problem: {
        status: 422,
        detail: 'The version would no longer be a valid template.',
        errors: [{ pointer, detail: 'is not an ID class the flow allows' }],
      },
    });
  });

  it("shows the API's refusal to change a version that is no longer a draft", async () => {
    api.onProblem('PATCH', `/inquiry-template-versions/${IDS.draft}`, 409, 'invalid-transition');

    await expect(updateDraftVersion(null, editorForm())).resolves.toMatchObject({
      ok: false,
      problem: { status: 409 },
    });
  });
});

describe('publishVersion', () => {
  it('publishes the draft and refreshes the template and the version', async () => {
    await expect(
      publishVersion(null, form({ 'inquiry-template-id': IDS.template, 'version-id': IDS.draft })),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(api.find('POST', `/inquiry-template-versions/${IDS.draft}/publish`)).toBeDefined();
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE_PAGE);
    expect(revalidatePath).toHaveBeenCalledWith(DRAFT_PAGE);
  });

  it('needs inquiry-templates:publish', async () => {
    as('inquiry-templates:read', 'inquiry-templates:write');

    await expect(
      publishVersion(null, form({ 'inquiry-template-id': IDS.template, 'version-id': IDS.draft })),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});

describe('updateTemplateStatus', () => {
  it('archives the template', async () => {
    await updateTemplateStatus(
      null,
      form({ 'inquiry-template-id': IDS.template, status: 'archived' }),
    );

    expect(api.find('PATCH', `/inquiry-templates/${IDS.template}`)?.body).toEqual({
      data: { type: 'inquiry-template', attributes: { status: 'archived' } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(TEMPLATE_PAGE);
  });
});
