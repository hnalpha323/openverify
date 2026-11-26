// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../../lib/session-cookie';
import { SESSION_TOKEN } from '../../testing/api-fixtures';
import { meDocument, mockApi, type MockApi } from '../../testing/api-mock';
import { fakeRequest } from '../../testing/fake-request';
import ErrorProbePage from './page';

vi.mock('next/headers', () => import('../../testing/fake-request').then((m) => m.nextHeaders));

let api: MockApi;

beforeEach(() => {
  api = mockApi();
  fakeRequest.reset();
  fakeRequest.cookies.set(SESSION_COOKIE, SESSION_TOKEN);
});

afterEach(() => {
  api.restore();
  vi.unstubAllEnvs();
});

/** What a call of the page ended in: a thrown error's message, or Next.js's not-found digest. */
async function outcomeOf(): Promise<string> {
  try {
    await ErrorProbePage();
    return 'rendered';
  } catch (error) {
    if (error instanceof Error && 'digest' in error && typeof error.digest === 'string') {
      return error.digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404') ? 'not found' : error.digest;
    }
    return error instanceof Error ? error.message : String(error);
  }
}

describe('the error page trigger (C170.3; K9-15)', () => {
  it('throws for a signed-in operator in development mode, so the error boundary renders', async () => {
    vi.stubEnv('OPENVERIFY_MODE', 'development');
    api.reply(200, meDocument({ permissions: ['inquiries:read'] }));

    await expect(outcomeOf()).resolves.toBe(
      'The error page probe was opened on purpose (development mode only).',
    );
  });

  it.each([
    ['production mode', 'production'],
    ['no mode at all, as the compose dashboard runs', undefined],
    ['a mode spelled otherwise', 'Development'],
  ])('is the 404 page in %s, calling nothing', async (_case, mode) => {
    vi.stubEnv('OPENVERIFY_MODE', mode);

    await expect(outcomeOf()).resolves.toBe('not found');
    expect(api.requests).toHaveLength(0);
  });
});
