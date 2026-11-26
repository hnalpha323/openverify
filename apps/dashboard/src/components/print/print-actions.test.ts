// @vitest-environment node
/** C173.3: the print audit action posts the object id alone, and refuses anything else. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { PRINT_AUDITS_PATH, servePrintAudits } from '../../testing/routes/cases-reports';
import { recordObjectPrint } from './print-actions';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
  api.me({ permissions: ['reports:read'] });
  servePrintAudits(api);
});

afterEach(() => {
  api.restore();
});

const form = (objectId: string) => {
  const data = new FormData();
  data.set('object-id', objectId);
  return data;
};

describe('recordObjectPrint', () => {
  it('records the print of a report', async () => {
    const result = await recordObjectPrint(null, form('rep_01JB0000000000000000000001'));

    expect(result).toEqual({ ok: true, data: undefined });
    expect(api.find('POST', PRINT_AUDITS_PATH)?.body).toEqual({
      'object-id': 'rep_01JB0000000000000000000001',
    });
  });

  it('refuses an object without a print view without calling the API', async () => {
    const result = await recordObjectPrint(null, form('case_01JB0000000000000000000001'));

    expect(result.ok).toBe(false);
    expect(api.find('POST', PRINT_AUDITS_PATH)).toBeUndefined();
  });

  it('passes on the API’s refusal', async () => {
    api.onProblem('POST', PRINT_AUDITS_PATH, 404);

    const result = await recordObjectPrint(null, form('ver_01JB0000000000000000000001'));

    expect(!result.ok && result.problem.status).toBe(404);
  });
});
