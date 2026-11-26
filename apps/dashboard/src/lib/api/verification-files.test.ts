// @vitest-environment node
/** C173.2 (K17): the verification read with its files, metadata only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { routeApi, type RouteApi } from '../../testing/api-routes';
import { fakeRequest } from '../../testing/fake-request';
import { LIFECYCLE_IDS as IDS, governmentIdVerification } from '../../testing/lifecycle-fixtures';
import { SESSION_COOKIE } from '../session-cookie';
import { getVerificationWithFiles } from './verification-files';

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

describe('getVerificationWithFiles', () => {
  it('asks for the files include and answers the document', async () => {
    api.on('GET', `/verifications/${IDS.governmentId}`, 200, {
      data: governmentIdVerification(),
      included: [],
    });

    const document = await getVerificationWithFiles(IDS.governmentId);

    expect(document.data.id).toBe(IDS.governmentId);
    expect(api.find('GET', `/verifications/${IDS.governmentId}`)?.query.get('include')).toBe(
      'files',
    );
  });
});
