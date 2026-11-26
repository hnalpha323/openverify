// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import { LIFECYCLE_IDS as IDS } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../session-cookie';
import { DEPLOYMENT_PAGE_SIZE, listTemplateDeployments } from './deployments';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
});

describe('the deployment history (C154.7, Workflow 9C)', () => {
  it('lists one page of a template’s deployments, newest first, from a cursor', async () => {
    api.reply(200, { data: [], links: { next: null } });

    const page = await listTemplateDeployments(IDS.template, {
      after: 'dply_01JB0000000000000000000001',
    });

    expect(page.data).toEqual([]);
    expect(api.last()).toMatchObject({ method: 'GET', path: '/api/v1/deployments' });
    expect(Object.fromEntries(api.last().query)).toEqual({
      'filter[inquiry-template-id]': IDS.template,
      'page[after]': 'dply_01JB0000000000000000000001',
      'page[size]': String(DEPLOYMENT_PAGE_SIZE),
    });
  });
});
