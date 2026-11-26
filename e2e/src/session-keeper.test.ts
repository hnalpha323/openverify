/**
 * Workflow 5C review P021: the full-stack suite signs each seeded operator in once per run, so it
 * stays under the API's login limits (C4: 10 per email and 50 per address in 15 minutes).
 */
import { describe, expect, it } from 'vitest';
import {
  createSessionKeeper,
  type KeptSession,
  type SessionKeeperPorts,
} from './session-keeper.js';

const SANDBOX = 'env_sandbox';
const PRODUCTION = 'env_production';

/** A fake API: which tokens it accepts, and the environment each one is in. */
function fakeApi() {
  const environments = new Map<string, string>();
  const switches: [string, string][] = [];
  const ports: SessionKeeperPorts = {
    currentEnvironment: (token) => Promise.resolve(environments.get(token) ?? null),
    switchEnvironment: (token, environmentId) => {
      switches.push([token, environmentId]);
      environments.set(token, environmentId);
      return Promise.resolve();
    },
  };
  let issued = 0;
  const signIns: string[] = [];
  const signIn = (role: string) => (): Promise<KeptSession> => {
    issued += 1;
    const token = `ovu_${role}_${String(issued)}`;
    signIns.push(role);
    environments.set(token, SANDBOX);
    return Promise.resolve({ token, environmentId: SANDBOX });
  };
  return { ports, environments, switches, signIns, signIn };
}

describe('createSessionKeeper', () => {
  it('signs each role in once, however often its session is asked for', async () => {
    const api = fakeApi();
    const keeper = createSessionKeeper<'admin' | 'reviewer'>(api.ports);

    const first = await keeper.session('reviewer', api.signIn('reviewer'));
    for (let call = 0; call < 60; call += 1) {
      expect(await keeper.session('reviewer', api.signIn('reviewer'))).toEqual(first);
    }
    await keeper.session('admin', api.signIn('admin'));
    await keeper.session('admin', api.signIn('admin'));

    expect(api.signIns).toEqual(['reviewer', 'admin']);
  });

  it('signs in again once the API no longer accepts the kept session (signed out, expired)', async () => {
    const api = fakeApi();
    const keeper = createSessionKeeper<'viewer'>(api.ports);
    const first = await keeper.session('viewer', api.signIn('viewer'));

    api.environments.delete(first.token);
    const second = await keeper.session('viewer', api.signIn('viewer'));

    expect(second.token).not.toBe(first.token);
    expect(api.signIns).toEqual(['viewer', 'viewer']);
    expect(await keeper.session('viewer', api.signIn('viewer'))).toEqual(second);
  });

  it('moves a session a spec switched back into the environment its sign-in opened', async () => {
    const api = fakeApi();
    const keeper = createSessionKeeper<'developer'>(api.ports);
    const kept = await keeper.session('developer', api.signIn('developer'));

    api.environments.set(kept.token, PRODUCTION);
    expect(await keeper.session('developer', api.signIn('developer'))).toEqual(kept);

    expect(api.switches).toEqual([[kept.token, SANDBOX]]);
    expect(api.environments.get(kept.token)).toBe(SANDBOX);
    expect(api.signIns).toEqual(['developer']);
  });

  it('signs a role in once when its session is asked for twice at the same time', async () => {
    const api = fakeApi();
    const keeper = createSessionKeeper<'admin'>(api.ports);

    const [one, two] = await Promise.all([
      keeper.session('admin', api.signIn('admin')),
      keeper.session('admin', api.signIn('admin')),
    ]);

    expect(one).toEqual(two);
    expect(api.signIns).toEqual(['admin']);
  });

  it('keeps no session whose sign-in failed, so the next call tries again', async () => {
    const api = fakeApi();
    const keeper = createSessionKeeper<'admin'>(api.ports);

    await expect(
      keeper.session('admin', () => Promise.reject(new Error('Sign-in answered 429'))),
    ).rejects.toThrow('Sign-in answered 429');
    await keeper.session('admin', api.signIn('admin'));

    expect(api.signIns).toEqual(['admin']);
  });
});
