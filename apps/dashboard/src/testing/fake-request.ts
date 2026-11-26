/**
 * An in-memory request for tests of server code that reads `next/headers`. In a test file:
 *
 *     vi.mock('next/headers', () => import('../testing/fake-request').then((m) => m.nextHeaders));
 *     beforeEach(() => { fakeRequest.reset(); });
 *
 * The mock factory and the test import the same module instance, so the test controls what
 * `cookies()` and `headers()` return and sees what the code under test set or deleted.
 */
import { vi, type Mock } from 'vitest';

export interface FakeRequest {
  cookies: Map<string, string>;
  headers: Headers;
  setCookie: Mock;
  deleteCookie: Mock;
  reset: () => void;
}

interface FakeCookieStore {
  get: (name: string) => { name: string; value: string } | undefined;
  set: Mock;
  delete: Mock;
}

export const fakeRequest: FakeRequest = {
  /** Incoming cookies by name. */
  cookies: new Map<string, string>(),
  /** Incoming request headers. */
  headers: new Headers(),
  /** `cookies().set(name, value, options)` calls. */
  setCookie: vi.fn(),
  /** `cookies().delete(name)` calls. */
  deleteCookie: vi.fn(),
  reset: (): void => {
    fakeRequest.cookies.clear();
    fakeRequest.headers = new Headers();
    fakeRequest.setCookie.mockReset();
    fakeRequest.deleteCookie.mockReset();
  },
};

/** The `next/headers` module the factory hands to `vi.mock`. */
export const nextHeaders: {
  cookies: () => Promise<FakeCookieStore>;
  headers: () => Promise<Headers>;
} = {
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = fakeRequest.cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: fakeRequest.setCookie,
      delete: fakeRequest.deleteCookie,
    }),
  headers: () => Promise.resolve(fakeRequest.headers),
};
