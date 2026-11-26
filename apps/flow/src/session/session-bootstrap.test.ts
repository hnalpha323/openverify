import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  SESSION_STORAGE_KEY,
  bootstrapSession,
  browserSessionStorage,
  type BootstrapEnvironment,
  type StorageLike,
} from './session-bootstrap';

const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const OTHER_INQUIRY_ID = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const TOKEN = `ovs_${'A'.repeat(43)}`;
const OTHER_TOKEN = `ovs_${'B'.repeat(43)}`;

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new DOMException('Access denied', 'SecurityError');
  }

  setItem(): void {
    throw new DOMException('Quota exceeded', 'QuotaExceededError');
  }

  removeItem(): void {
    throw new DOMException('Access denied', 'SecurityError');
  }
}

function environment(
  hash: string,
  storage: StorageLike | null = new MemoryStorage(),
): BootstrapEnvironment & { history: { replaceState: Mock<History['replaceState']> } } {
  return {
    location: { hash, pathname: '/start', search: '?lang=es' },
    history: { replaceState: vi.fn<History['replaceState']>(), state: { from: 'router' } },
    storage,
  };
}

function stored(storage: MemoryStorage): unknown {
  const value = storage.getItem(SESSION_STORAGE_KEY);
  return value === null ? null : JSON.parse(value);
}

describe('bootstrapSession', () => {
  it('reads valid credentials from the fragment', () => {
    const result = bootstrapSession(
      environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`),
    );

    expect(result).toEqual({
      status: 'ready',
      credentials: { inquiryId: INQUIRY_ID, sessionToken: TOKEN },
    });
  });

  it('accepts the fragment without its leading #', () => {
    const result = bootstrapSession(environment(`inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`));

    expect(result.status).toBe('ready');
  });

  it('removes the fragment from the address bar, keeping the path, query and history state', () => {
    const env = environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`);

    bootstrapSession(env);

    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.history.replaceState).toHaveBeenCalledWith({ from: 'router' }, '', '/start?lang=es');
  });

  it('keeps the credentials in this tab’s sessionStorage', () => {
    const storage = new MemoryStorage();

    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage));

    expect(stored(storage)).toEqual({ inquiryId: INQUIRY_ID, sessionToken: TOKEN });
  });

  it('resumes from sessionStorage after a reload, when the fragment is gone', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage));

    const env = environment('', storage);
    const result = bootstrapSession(env);

    expect(result).toEqual({
      status: 'ready',
      credentials: { inquiryId: INQUIRY_ID, sessionToken: TOKEN },
    });
    expect(env.history.replaceState).not.toHaveBeenCalled();
  });

  it('lets a new link replace the session stored in this tab', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage));

    const result = bootstrapSession(
      environment(`#inquiry-id=${OTHER_INQUIRY_ID}&session-token=${OTHER_TOKEN}`, storage),
    );

    expect(result).toEqual({
      status: 'ready',
      credentials: { inquiryId: OTHER_INQUIRY_ID, sessionToken: OTHER_TOKEN },
    });
    expect(stored(storage)).toEqual({ inquiryId: OTHER_INQUIRY_ID, sessionToken: OTHER_TOKEN });
  });

  it('reports a missing link when there is neither a fragment nor a stored session', () => {
    const env = environment('');

    expect(bootstrapSession(env)).toEqual({ status: 'error', reason: 'missing' });
    expect(env.history.replaceState).not.toHaveBeenCalled();
  });

  it('leaves an unrelated fragment alone', () => {
    const env = environment('#main-content');

    expect(bootstrapSession(env)).toEqual({ status: 'error', reason: 'missing' });
    expect(env.history.replaceState).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing session token', `#inquiry-id=${INQUIRY_ID}`],
    ['a missing inquiry ID', `#session-token=${TOKEN}`],
    ['a malformed token', `#inquiry-id=${INQUIRY_ID}&session-token=ovs_short`],
    [
      'a token with the wrong prefix',
      `#inquiry-id=${INQUIRY_ID}&session-token=ovu_${'A'.repeat(43)}`,
    ],
    ['a malformed inquiry ID', `#inquiry-id=inq_123&session-token=${TOKEN}`],
    ['an ID of another type', `#inquiry-id=ver_01M5CJXHG07XPHF3HRM6NREDH7&session-token=${TOKEN}`],
    [
      'a repeated token',
      `#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}&session-token=${OTHER_TOKEN}`,
    ],
    ['an empty token', `#inquiry-id=${INQUIRY_ID}&session-token=`],
  ])('rejects %s and still clears the fragment', (_label, hash) => {
    const env = environment(hash);

    expect(bootstrapSession(env)).toEqual({ status: 'error', reason: 'invalid' });
    expect(env.history.replaceState).toHaveBeenCalledWith({ from: 'router' }, '', '/start?lang=es');
  });

  it('forgets a stored session when a broken link is opened in the same tab', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage));

    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=nope`, storage));

    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ['not JSON', '{oops'],
    ['the wrong shape', JSON.stringify({ token: TOKEN })],
    ['an extra member', JSON.stringify({ inquiryId: INQUIRY_ID, sessionToken: TOKEN, x: 1 })],
    ['a malformed token', JSON.stringify({ inquiryId: INQUIRY_ID, sessionToken: 'ovs_x' })],
  ])('discards a stored session that is %s', (_label, value) => {
    const storage = new MemoryStorage();
    storage.setItem(SESSION_STORAGE_KEY, value);

    expect(bootstrapSession(environment('', storage))).toEqual({
      status: 'error',
      reason: 'missing',
    });
    expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('still works from the fragment when sessionStorage is unavailable', () => {
    expect(
      bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, null)),
    ).toMatchObject({ status: 'ready' });
    expect(bootstrapSession(environment('', null))).toEqual({ status: 'error', reason: 'missing' });
  });

  it('survives a sessionStorage that throws', () => {
    const storage = new ThrowingStorage();

    expect(
      bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage)),
    ).toMatchObject({ status: 'ready' });
    expect(bootstrapSession(environment('', storage))).toEqual({
      status: 'error',
      reason: 'missing',
    });
    expect(
      bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=bad`, storage)),
    ).toEqual({ status: 'error', reason: 'invalid' });
  });
});

describe('bootstrapSession with a one-time link (C19)', () => {
  const ONE_TIME_TOKEN = `ovo_${'C'.repeat(21)}_-${'d'.repeat(20)}`;
  const LINK = `#inquiry-id=${INQUIRY_ID}&one-time-token=${ONE_TIME_TOKEN}`;

  it('reads the one-time link for the flow to redeem', () => {
    expect(bootstrapSession(environment(LINK))).toEqual({
      status: 'one-time-link',
      link: { inquiryId: INQUIRY_ID, oneTimeToken: ONE_TIME_TOKEN },
    });
  });

  it('clears the fragment at once, keeping the path, query and history state', () => {
    const env = environment(LINK);

    bootstrapSession(env);

    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.history.replaceState).toHaveBeenCalledWith({ from: 'router' }, '', '/start?lang=es');
  });

  it('never writes the one-time token or a session to sessionStorage', () => {
    const storage = new MemoryStorage();

    bootstrapSession(environment(LINK, storage));

    expect(stored(storage)).toBeNull();
    expect(JSON.stringify([...storage.items])).not.toContain(ONE_TIME_TOKEN);
  });

  it('forgets a session stored in this tab, so the newest link wins', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage));

    bootstrapSession(environment(LINK, storage));

    expect(stored(storage)).toBeNull();
  });

  it('explains a reload after a one-time link instead of calling the link missing', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(LINK, storage));

    expect(bootstrapSession(environment('', storage))).toEqual({
      status: 'error',
      reason: 'reloaded',
    });
  });

  it('lets a later session link in the same tab resume normally', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(LINK, storage));
    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage));

    expect(bootstrapSession(environment('', storage))).toEqual({
      status: 'ready',
      credentials: { inquiryId: INQUIRY_ID, sessionToken: TOKEN },
    });
  });

  it.each([
    ['a missing inquiry ID', `#one-time-token=${ONE_TIME_TOKEN}`],
    ['a malformed token', `#inquiry-id=${INQUIRY_ID}&one-time-token=ovo_short`],
    ['a session token in its place', `#inquiry-id=${INQUIRY_ID}&one-time-token=${TOKEN}`],
    ['a repeated token', `${LINK}&one-time-token=${ONE_TIME_TOKEN}`],
    ['both a session token and a one-time token', `${LINK}&session-token=${TOKEN}`],
  ])('rejects %s and still clears the fragment', (_label, hash) => {
    const env = environment(hash);

    expect(bootstrapSession(env)).toEqual({ status: 'error', reason: 'invalid' });
    expect(env.history.replaceState).toHaveBeenCalledWith({ from: 'router' }, '', '/start?lang=es');
  });

  it('reads the link before clearing it from a live address bar', () => {
    // window.location is live: replaceState empties its hash at once.
    const location = { hash: LINK, pathname: '/start', search: '' };
    const history = {
      state: null,
      replaceState: vi.fn<History['replaceState']>(() => {
        location.hash = '';
      }),
    };

    expect(bootstrapSession({ location, history, storage: new MemoryStorage() })).toEqual({
      status: 'one-time-link',
      link: { inquiryId: INQUIRY_ID, oneTimeToken: ONE_TIME_TOKEN },
    });
    expect(location.hash).toBe('');
  });

  it('works without sessionStorage, or with one that throws', () => {
    expect(bootstrapSession(environment(LINK, null))).toMatchObject({ status: 'one-time-link' });
    expect(bootstrapSession(environment(LINK, new ThrowingStorage()))).toMatchObject({
      status: 'one-time-link',
    });
    expect(bootstrapSession(environment('', new ThrowingStorage()))).toEqual({
      status: 'error',
      reason: 'missing',
    });
  });
});

describe('bootstrapSession with a handoff link (C96.3, Workflow 7A)', () => {
  const HANDOFF_TOKEN = `ovh_${'E'.repeat(43)}`;
  const LINK = `#inquiry-id=${INQUIRY_ID}&handoff-token=${HANDOFF_TOKEN}`;

  it('reads the handoff link for the phone, which redeems it only on Continue', () => {
    expect(bootstrapSession(environment(LINK))).toEqual({
      status: 'handoff',
      handoff: { inquiryId: INQUIRY_ID, handoffToken: HANDOFF_TOKEN },
    });
  });

  it('clears the fragment at once, keeping the path, query and history state', () => {
    const env = environment(LINK);

    bootstrapSession(env);

    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.history.replaceState).toHaveBeenCalledWith({ from: 'router' }, '', '/start?lang=es');
  });

  it('never stores the token, and forgets a session stored in this tab', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(`#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}`, storage));

    bootstrapSession(environment(LINK, storage));

    expect(stored(storage)).toBeNull();
    expect(JSON.stringify([...storage.items])).not.toContain(HANDOFF_TOKEN);
  });

  it('explains a reload after a handoff link instead of calling the link missing', () => {
    const storage = new MemoryStorage();
    bootstrapSession(environment(LINK, storage));

    expect(bootstrapSession(environment('', storage))).toEqual({
      status: 'error',
      reason: 'reloaded',
    });
  });

  it.each([
    ['a short token', `#inquiry-id=${INQUIRY_ID}&handoff-token=ovh_short`],
    ['a session token as well', `${LINK}&session-token=${TOKEN}`],
    ['no inquiry', `#handoff-token=${HANDOFF_TOKEN}`],
  ])('refuses %s as an invalid link', (_label, hash) => {
    expect(bootstrapSession(environment(hash))).toEqual({ status: 'error', reason: 'invalid' });
  });
});

describe('browserSessionStorage', () => {
  it('returns the tab’s sessionStorage', () => {
    expect(browserSessionStorage(window)).toBe(window.sessionStorage);
  });

  it('returns null when the browser blocks access to it', () => {
    const blocked = Object.defineProperty({}, 'sessionStorage', {
      get() {
        throw new DOMException('Access denied', 'SecurityError');
      },
    }) as { sessionStorage: Storage };

    expect(browserSessionStorage(blocked)).toBeNull();
  });
});

// C161.2, C160.9 (Workflow 9A): the public `language` and `style-variant` of a fragment survive its
// removal, carried into the query (never the credentials), so the app reads them and a reload keeps them.
describe('the fragment public parameters', () => {
  it('are carried into the query when the fragment is removed', () => {
    const env = environment(
      `#inquiry-id=${INQUIRY_ID}&session-token=${TOKEN}&language=fr&style-variant=dark`,
    );

    expect(bootstrapSession(env)).toEqual({
      status: 'ready',
      credentials: { inquiryId: INQUIRY_ID, sessionToken: TOKEN },
    });
    expect(env.history.replaceState).toHaveBeenCalledWith(
      { from: 'router' },
      '',
      '/start?lang=es&language=fr&style-variant=dark',
    );
  });
});
