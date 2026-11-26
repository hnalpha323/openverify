// @vitest-environment node
import { revalidatePath } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CASE_PROBLEM_WORDS } from '../../../components/cases/case-words';
import { SESSION_COOKIE } from '../../../lib/session-cookie';
import { SESSION_TOKEN } from '../../../testing/api-fixtures';
import { ENVIRONMENTS } from '../../../testing/api-mock';
import { routeApi, type RouteApi } from '../../../testing/api-routes';
import { CASE_IDS, caseExport } from '../../../testing/cases-fixtures';
import { fakeRequest } from '../../../testing/fake-request';
import { CASE_ADMIN, CASE_DEVELOPER } from '../../../testing/routes/cases';
import { createCaseExport } from './actions';

vi.mock('next/headers', () => import('../../../testing/fake-request').then((m) => m.nextHeaders));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let api: RouteApi;

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: CASE_ADMIN });
  api.on('POST', '/case-exports', 202, { data: caseExport({ status: 'pending' }) });
});

afterEach(() => {
  api.restore();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set('environment-id', ENVIRONMENTS.sandbox.id);
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

describe('asking for a case export (C138.1, C142.1)', () => {
  it('exports every visible case without personal data when nothing narrows it', async () => {
    expect(await createCaseExport(null, form({ format: 'csv' }))).toEqual({
      ok: true,
      data: { id: CASE_IDS.export },
    });
    expect(api.find('POST', '/case-exports')?.body).toEqual({
      data: { type: 'case-export', attributes: { format: 'csv', 'include-personal-data': false } },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/cases/exports');
  });

  it('narrows by the filters chosen, and includes personal data only when confirmed', async () => {
    await createCaseExport(
      null,
      form({
        format: 'json',
        template: CASE_IDS.template,
        queue: CASE_IDS.queue,
        category: 'end',
        sla: '',
        'include-personal-data': 'on',
        'personal-data-confirmed': 'true',
      }),
    );

    expect(api.find('POST', '/case-exports')?.body).toEqual({
      data: {
        type: 'case-export',
        attributes: {
          format: 'json',
          'include-personal-data': true,
          filter: {
            'case-template-id': [CASE_IDS.template],
            'case-queue-id': [CASE_IDS.queue],
            'status-category': ['end'],
          },
        },
      },
    });
  });

  it('refuses personal data that was not confirmed, or without pii:view, before asking the API', async () => {
    expect(
      await createCaseExport(null, form({ format: 'csv', 'include-personal-data': 'on' })),
    ).toMatchObject({
      ok: false,
      problem: { errors: [{ pointer: '/data/attributes/include-personal-data' }] },
    });

    api.me({ permissions: [...CASE_DEVELOPER, 'cases:export'] });
    expect(
      await createCaseExport(
        null,
        form({ format: 'csv', 'include-personal-data': 'on', 'personal-data-confirmed': 'true' }),
      ),
    ).toMatchObject({ ok: false, problem: { title: 'You do not have access' } });
    expect(api.find('POST', '/case-exports')).toBeUndefined();
  });

  it('says in words that an export is too large', async () => {
    api.onProblem('POST', '/case-exports', 422, undefined, { code: 'export_too_large' });

    expect(await createCaseExport(null, form({ format: 'csv' }))).toMatchObject({
      ok: false,
      problem: { title: CASE_PROBLEM_WORDS.export_too_large },
    });
  });
});
