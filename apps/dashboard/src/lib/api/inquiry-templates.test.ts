// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { ENVIRONMENTS, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, draft, single, template } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../session-cookie';
import {
  copyTemplate,
  promoteTemplate,
  restoreTemplateVersion,
  templateUsedBy,
} from './inquiry-templates';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

const TEMPLATE_PATH = `/api/v1/inquiry-templates/${IDS.template}`;

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the template client (C154.4, C154.5, Workflow 9C)', () => {
  it('restores a version as a new draft', async () => {
    api.reply(201, single(draft()));

    const restored = await restoreTemplateVersion(IDS.template, IDS.version);

    expect(restored.id).toBe(IDS.draft);
    expect(api.last()).toMatchObject({ method: 'POST', path: `${TEMPLATE_PATH}/restore` });
    expect(api.last().body).toEqual({ meta: { 'version-id': IDS.version } });
  });

  it('copies a template, naming the version only when one is chosen', async () => {
    api.reply(201, single(template())).reply(201, single(template()));

    await copyTemplate(IDS.template, { name: 'Synthetic copy' });
    expect(api.requests[0]).toMatchObject({ method: 'POST', path: `${TEMPLATE_PATH}/copy` });
    expect(api.requests[0]?.body).toEqual({ meta: { name: 'Synthetic copy' } });

    await copyTemplate(IDS.template, { name: 'Synthetic copy', versionId: IDS.version });
    expect(api.requests[1]?.body).toEqual({
      meta: { name: 'Synthetic copy', 'version-id': IDS.version },
    });
  });

  it('promotes into another environment, answering the draft and what it copied', async () => {
    api.reply(201, { ...single(draft()), meta: { copied: [] } });

    const promoted = await promoteTemplate(IDS.template, {
      environmentId: ENVIRONMENTS.production.id,
      versionId: IDS.version,
    });

    expect(promoted.version.id).toBe(IDS.draft);
    expect(promoted.copied).toEqual([]);
    expect(api.last()).toMatchObject({ method: 'POST', path: `${TEMPLATE_PATH}/promote` });
    expect(api.last().body).toEqual({
      meta: { 'environment-id': ENVIRONMENTS.production.id, 'version-id': IDS.version },
    });
  });

  it('reads what uses a template, counting what the caller cannot read (review P34)', async () => {
    api.reply(200, {
      data: {
        type: 'inquiry-template-usage',
        id: IDS.template,
        attributes: {
          workflows: [{ id: 'wfl_01JB0000000000000000000001', name: 'Synthetic workflow' }],
          'workflows-hidden': 2,
          'report-templates': [],
          'report-templates-hidden': 0,
          'case-templates': [],
          'case-templates-hidden': 1,
          'embed-origins': ['https://shop.example.com'],
        },
      },
    });

    const usage = await templateUsedBy(IDS.template);

    expect(usage['workflows-hidden']).toBe(2);
    expect(api.last()).toMatchObject({ method: 'GET', path: `${TEMPLATE_PATH}/used-by` });
  });
});
