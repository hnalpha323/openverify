// @vitest-environment node
import type { Permission } from '@openverify/core';
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { redirectTarget } from '../../testing/next-errors';
import {
  REPORT_CONFIG_IDS as IDS,
  reportTemplate,
  single,
} from '../../testing/report-config-fixtures';
import { CONFIG_EDITOR } from '../../testing/routes/report-config';
import { createReportTemplate } from './actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  as(...CONFIG_EDITOR);
  api.on('POST', '/report-templates', 201, single(reportTemplate()));
});

afterEach(() => {
  api.restore();
});

function as(...permissions: Permission[]) {
  api.me({ permissions });
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('createReportTemplate (C153.4, K14: POST /report-templates)', () => {
  it('creates the template with its type, name and configuration, then opens it', async () => {
    await expect(
      redirectTarget(
        createReportTemplate(
          null,
          form({
            name: 'Synthetic screening',
            'report-type': 'watchlist',
            config: JSON.stringify({ 'screen-weak-aliases': true }),
          }),
        ),
      ),
    ).resolves.toBe(`/report-templates/${IDS.template}`);
    expect(api.find('POST', '/report-templates')?.body).toEqual({
      data: {
        type: 'report-template',
        attributes: {
          'report-type': 'watchlist',
          name: 'Synthetic screening',
          config: { 'screen-weak-aliases': true },
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/report-templates');
  });

  it('refuses what the contract refuses for the type, at its pointer, before calling the API', async () => {
    const result = await createReportTemplate(
      null,
      form({
        name: '',
        'report-type': 'email-address',
        config: JSON.stringify({ 'search-lists': [] }),
      }),
    );

    expect(result.ok).toBe(false);
    const pointers = result.ok ? [] : (result.problem.errors ?? []).map((error) => error.pointer);
    expect(pointers).toContain('/data/attributes/name');
    expect(pointers).toContain('/data/attributes/config');
    expect(api.find('POST', '/report-templates')).toBeUndefined();
  });

  it('refuses a configuration that is not JSON', async () => {
    await expect(
      createReportTemplate(
        null,
        form({ name: 'Synthetic', 'report-type': 'watchlist', config: '{' }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/config' }] },
    });
  });

  it('needs report-templates:write', async () => {
    as('report-templates:read');

    await expect(
      createReportTemplate(
        null,
        form({ name: 'Synthetic', 'report-type': 'watchlist', config: '{}' }),
      ),
    ).resolves.toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
  });
});
