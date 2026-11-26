// @vitest-environment node
/** C173.3: the print audit is one call naming the object only, before the print dialog opens. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { LIFECYCLE_IDS } from '../../testing/lifecycle-fixtures';
import {
  PRINT_AUDITS_PATH,
  PRINT_AUDIT_ID,
  servePrintAudits,
} from '../../testing/routes/cases-reports';
import { SESSION_COOKIE } from '../session-cookie';
import { recordPrintAudit } from './print-audits';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: RouteApi;

beforeEach(() => {
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
  api = routeApi();
});

afterEach(() => {
  api.restore();
});

describe('recordPrintAudit', () => {
  it('posts the object id alone with the session and answers the audit entry written', async () => {
    servePrintAudits(api);

    const document = await recordPrintAudit(LIFECYCLE_IDS.inquiry);

    expect(document.data.id).toBe(PRINT_AUDIT_ID);
    const request = api.find('POST', PRINT_AUDITS_PATH);
    expect(request?.body).toEqual({ 'object-id': LIFECYCLE_IDS.inquiry });
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });
});
