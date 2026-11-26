import { ACCESS_11B_AUDIT_ACTIONS, ssoBindingSchema } from '@openverify/contracts';
import type { User, UserSession } from '@openverify/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutboundHttp, type OutboundHttp } from '../../http/index.js';
import { fixedClock, type TestClock } from '../../test-support/fakes.js';
import {
  startTestOidcProvider,
  type StartTestOidcProviderOptions,
  type TestAuthorizeOptions,
  type TestOidcProvider,
  type TestOidcUser,
} from '../../test-support/oidc/provider.js';
import { sha256Hex } from './binding.js';
import { createOidcClient } from './client.js';
import { SsoFlowError, type SsoFailureCode } from './failures.js';
import {
  createSsoService,
  ssoRedirectUri,
  type SsoIdentityRecord,
  type SsoLoginStateRecord,
  type SsoProviderRecord,
  type SsoService,
  type SsoStore,
} from './service.js';

const ORG = 'org_01JC0000000000000000000001';
const OTHER_ORG = 'org_01JC0000000000000000000002';
const PROVIDER = 'ssop_01JC0000000000000000000001';
const SECOND = 'ssop_01JC0000000000000000000002';
const ROLE = 'role_01JC0000000000000000000001';
const SESSION_ID = 'uss_01JC0000000000000000000001';
const CONSOLE = 'https://console.example.com';
const SECRET = 'synthetic-client-secret-canary';

const userOf = (id: string, email: string, status: User['status'] = 'active'): User => ({
  // Every other column of a user as the database defaults it (an empty base keeps the type whole).
  ...({} as User),
  id,
  organizationId: ORG,
  email,
  passwordHash: '$argon2id$synthetic',
  name: null,
  status,
  invitationTokenHash: null,
  invitationExpiresAt: null,
  invitedBy: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

/** An in-memory store, as the Postgres one behaves for the service. */
class MemoryStore implements SsoStore {
  slugs = new Map<string, string>([['acme-sso', ORG]]);
  providers = new Map<string, SsoProviderRecord>();
  states = new Map<string, SsoLoginStateRecord & { consumed: boolean }>();
  identities: SsoIdentityRecord[] = [];
  users = new Map<string, User>();
  roles = new Map<string, readonly string[]>([[ROLE, ['inquiries:read']]]);
  sessions = new Map<string, string>();
  stepUps: { sessionId: string; at: Date }[] = [];
  audits: { action: string; userId: string; metadata: Record<string, unknown> }[] = [];
  provisioned = 0;

  findOrganizationIdBySlug(slug: string) {
    return Promise.resolve(this.slugs.get(slug) ?? null);
  }
  listProviders(organizationId: string) {
    return Promise.resolve(
      [...this.providers.values()].filter((each) => each.organizationId === organizationId),
    );
  }
  getProvider(id: string) {
    return Promise.resolve(this.providers.get(id) ?? null);
  }
  insertLoginState(state: SsoLoginStateRecord) {
    this.states.set(state.bindingSha256, { ...state, consumed: false });
    return Promise.resolve();
  }
  consumeLoginState(bindingSha256: string, now: Date) {
    const state = this.states.get(bindingSha256);
    if (state === undefined || state.consumed || state.expiresAt <= now) {
      return Promise.resolve(null);
    }
    state.consumed = true;
    return Promise.resolve(state);
  }
  findLinkedUser(providerId: string, issuer: string, subject: string) {
    const link = this.identities.find(
      (each) =>
        each.providerId === providerId && each.issuer === issuer && each.subject === subject,
    );
    return Promise.resolve(link === undefined ? null : (this.users.get(link.userId) ?? null));
  }
  listIdentitiesOfUser(userId: string) {
    return Promise.resolve(this.identities.filter((each) => each.userId === userId));
  }
  findUserByEmail(organizationId: string, email: string) {
    return Promise.resolve(
      [...this.users.values()].find(
        (user) => user.organizationId === organizationId && user.email === email,
      ) ?? null,
    );
  }
  linkIdentity(identity: SsoIdentityRecord) {
    const taken = this.identities.some(
      (each) =>
        each.providerId === identity.providerId &&
        (each.userId === identity.userId ||
          (each.issuer === identity.issuer && each.subject === identity.subject)),
    );
    if (!taken) {
      this.identities.push(identity);
    }
    return Promise.resolve(!taken);
  }
  rolePermissions(_organizationId: string, roleIds: readonly string[]) {
    return Promise.resolve(
      new Map(
        roleIds.flatMap((id) => (this.roles.has(id) ? [[id, this.roles.get(id) ?? []]] : [])),
      ),
    );
  }
  provisionUser(input: Parameters<SsoStore['provisionUser']>[0]) {
    this.provisioned += 1;
    const user = {
      ...userOf(`usr_01JC00000000000000000000P${String(this.provisioned)}`, input.email),
      name: input.name,
    };
    this.users.set(user.id, user);
    this.identities.push({ ...input.identity, userId: user.id });
    return Promise.resolve(user);
  }
  findLiveSession(sessionId: string) {
    const userId = this.sessions.get(sessionId);
    const user = userId === undefined ? undefined : this.users.get(userId);
    return Promise.resolve(user === undefined ? null : { user });
  }
  markSessionStepUp(sessionId: string, at: Date) {
    this.stepUps.push({ sessionId, at });
    return Promise.resolve(this.sessions.has(sessionId));
  }
  audit(entry: Parameters<SsoStore['audit']>[0]) {
    this.audits.push({ action: entry.action, userId: entry.userId, metadata: entry.metadata });
    return Promise.resolve();
  }
}

const CLIENT = { clientId: 'synthetic-client-id', clientSecret: SECRET };

/** The provider `setUp` stored. */
function firstProvider(): SsoProviderRecord {
  const provider = store.providers.get(PROVIDER);
  if (provider === undefined) {
    throw new Error('setUp stores the provider first');
  }
  return provider;
}

let outbound: OutboundHttp;
beforeAll(() => {
  outbound = createOutboundHttp();
});
afterAll(async () => {
  await outbound.close();
});

const providers: TestOidcProvider[] = [];
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

let clock: TestClock;
let store: MemoryStore;
let requireMfa: boolean;
let factors: Set<string>;
const refused: SsoFailureCode[] = [];
const notified: string[] = [];
/** The provider `amr` each opened session was given (KP11-26). */
const opened: (readonly string[] | null)[] = [];

beforeEach(() => {
  clock = fixedClock(new Date('2026-11-13T12:00:00Z'));
  store = new MemoryStore();
  requireMfa = true;
  factors = new Set();
  refused.length = 0;
  notified.length = 0;
  opened.length = 0;
});

interface Setup {
  idp: TestOidcProvider;
  service: SsoService;
}

async function setUp(
  provider: Partial<SsoProviderRecord> = {},
  idpOptions: Partial<StartTestOidcProviderOptions> = {},
  sharedIssuers?: readonly string[],
): Promise<Setup> {
  const idp = await startTestOidcProvider({
    shape: 'okta',
    clients: [
      {
        ...CLIENT,
        redirectUris: [
          ssoRedirectUri(CONSOLE, PROVIDER) ?? '',
          ssoRedirectUri(CONSOLE, SECOND) ?? '',
        ],
      },
    ],
    now: () => clock.now(),
    ...idpOptions,
  });
  providers.push(idp);
  store.providers.set(PROVIDER, {
    id: PROVIDER,
    organizationId: ORG,
    displayName: 'Workforce',
    issuer: idp.issuer,
    clientId: CLIENT.clientId,
    clientSecret: SECRET,
    allowedEmailDomains: ['example.com'],
    tenantPin: null,
    requiredAmr: ['mfa'],
    requiredAcr: [],
    jitProvisioning: false,
    defaultRoleIds: [ROLE],
    enforced: false,
    ...provider,
  });
  const service = createSsoService({
    store,
    oidc: createOidcClient({
      outbound,
      policy: { production: false, privateIssuers: [] },
      clock,
      ...(sharedIssuers === undefined ? {} : { sharedIssuers }),
    }),
    sessions: {
      requireMfa: () => Promise.resolve(requireMfa),
      openSession: (user, mfaPassed, providerAmr) => {
        opened.push(providerAmr ?? null);
        return Promise.resolve({
          token: `ovu_${'S'.repeat(43)}`,
          expiresAt: new Date(clock.now().getTime() + 3_600_000),
          session: { id: SESSION_ID, mfaSatisfied: mfaPassed } as UserSession,
          user,
        });
      },
      startMfaChallenge: (user) =>
        Promise.resolve(
          factors.has(user.id)
            ? {
                mfaToken: `ovm_${'M'.repeat(43)}`,
                expiresAt: new Date(clock.now().getTime() + 300_000),
                factors: [{ id: 'mfa_01JC0000000000000000000001', type: 'totp' }],
                user,
              }
            : null,
        ),
    },
    clock,
    dashboardPublicUrl: `${CONSOLE}/`,
    notifyLinked: (user) => {
      notified.push(user.id);
      return Promise.resolve();
    },
    onRefused: (failure, context) => {
      refused.push(failure);
      expect(Object.keys(context).every((key) => key === 'providerId')).toBe(true);
    },
  });
  return { idp, service };
}

const ADA: TestOidcUser = {
  sub: 'subject-ada',
  email: 'ada@example.com',
  emailVerified: true,
  claims: { amr: ['pwd', 'mfa'] },
};

/** The browser's round trip: start, the visit at the provider, the callback. */
async function signIn(
  { idp, service }: Setup,
  user: TestOidcUser = ADA,
  {
    authorize = {},
    rewrite,
    providerId = PROVIDER,
    callbackProvider,
    binding: bindingOf = (binding) => binding,
  }: {
    authorize?: TestAuthorizeOptions;
    rewrite?: (query: URLSearchParams) => URLSearchParams;
    providerId?: string;
    callbackProvider?: string;
    binding?: (binding: string) => string | undefined;
  } = {},
) {
  const started = await service.start('acme-sso', { providerId });
  if (started.kind !== 'redirect') {
    throw new Error('expected a redirect');
  }
  const query = idp.authorize(started['authorization-url'], user, authorize);
  return {
    started,
    query,
    result: await service.callback(
      callbackProvider ?? providerId,
      rewrite === undefined ? query : rewrite(query),
      bindingOf(started.binding),
    ),
  };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SsoFlowError);
  return `${(error as SsoFlowError).code ?? ''}:${(error as SsoFlowError).failure}`;
}

describe('the SSO start (C248.4)', () => {
  it('stores a single-use attempt by the binding’s digest and answers the provider’s URL', async () => {
    const setup = await setUp();
    const started = await setup.service.start('acme-sso', { returnTo: '/inquiries' });
    expect(started.kind).toBe('redirect');
    if (started.kind !== 'redirect') {
      return;
    }
    expect(ssoBindingSchema.safeParse(started.binding).success).toBe(true);
    expect(started['expires-at']).toBe('2026-11-13T12:10:00.000Z');
    const url = new URL(started['authorization-url']);
    expect(url.searchParams.get('redirect_uri')).toBe(`${CONSOLE}/sso/callback/${PROVIDER}`);
    const [stored] = [...store.states.values()];
    expect(stored).toMatchObject({
      bindingSha256: sha256Hex(started.binding),
      stateSha256: sha256Hex(url.searchParams.get('state') ?? ''),
      nonce: url.searchParams.get('nonce'),
      providerId: PROVIDER,
      organizationId: ORG,
      purpose: 'sign-in',
      sessionId: null,
      returnTo: '/inquiries',
    });
    expect(JSON.stringify(stored)).not.toContain(started.binding);
  });

  it('answers one sso_not_configured for an unknown name, no provider, or another organisation’s', async () => {
    await setUp();
    const { service } = await setUp();
    expect(await refusal(service.start('unknown-name', {}))).toBe(
      'sso_not_configured:organization_unknown',
    );
    expect(await refusal(service.start('acme-sso', { providerId: SECOND }))).toBe(
      'sso_not_configured:provider_unknown',
    );
    store.providers.set(SECOND, {
      ...firstProvider(),
      id: SECOND,
      organizationId: OTHER_ORG,
    });
    expect(await refusal(service.start('acme-sso', { providerId: SECOND }))).toBe(
      'sso_not_configured:provider_unknown',
    );
    store.providers.clear();
    expect(await refusal(service.start('acme-sso', {}))).toBe(
      'sso_not_configured:provider_unknown',
    );
  });

  it('asks to choose when the organisation has several providers', async () => {
    const { service } = await setUp();
    store.providers.set(SECOND, {
      ...firstProvider(),
      id: SECOND,
      displayName: 'Contractors',
    });
    await expect(service.start('acme-sso', {})).resolves.toEqual({
      kind: 'choose',
      providers: [
        { id: PROVIDER, 'display-name': 'Workforce' },
        { id: SECOND, 'display-name': 'Contractors' },
      ],
    });
    expect(store.states.size).toBe(0);
  });

  it('refuses a multi-tenant issuer without its pin before anything is stored', async () => {
    const idp = await startTestOidcProvider({ shape: 'entra', tenant: 'common', clients: [] });
    providers.push(idp);
    const { service } = await setUp({ issuer: `${idp.origin}/common/v2.0` });
    expect(await refusal(service.start('acme-sso', {}))).toBe(
      'sso_not_configured:tenant_pin_missing',
    );
    expect(store.states.size).toBe(0);
  });
});

describe('the SSO callback (C248.4-C248.6)', () => {
  it('links an existing user on a first verified email, audits and mails it, then signs in by subject', async () => {
    const setup = await setUp();
    const ada = userOf('usr_01JC0000000000000000000001', 'ada@example.com');
    store.users.set(ada.id, ada);
    const { result } = await signIn(setup);
    expect(result).toMatchObject({ kind: 'session', user: { id: ada.id } });
    expect(store.identities).toEqual([
      {
        userId: ada.id,
        providerId: PROVIDER,
        issuer: setup.idp.issuer,
        subject: 'subject-ada',
        linkedAt: clock.now(),
      },
    ]);
    expect(store.audits).toEqual([
      {
        action: ACCESS_11B_AUDIT_ACTIONS.ssoLinked,
        userId: ada.id,
        metadata: { 'sso-provider-id': PROVIDER },
      },
    ]);
    expect(notified).toEqual([ada.id]);
    // Returning: by subject only, whatever the token says of the email now.
    const again = await signIn(setup, { sub: 'subject-ada', claims: { amr: ['mfa'] } });
    expect(again.result).toMatchObject({ kind: 'session', user: { id: ada.id } });
    expect(store.audits).toHaveLength(1);
    expect(notified).toHaveLength(1);
  });

  it('never matches a user by email again once it has a link to the provider', async () => {
    const setup = await setUp();
    const ada = userOf('usr_01JC0000000000000000000001', 'ada@example.com');
    store.users.set(ada.id, ada);
    await signIn(setup);
    expect(
      await refusal(
        signIn(setup, { ...ADA, sub: 'subject-somebody-else' }).then((done) => done.result),
      ),
    ).toBe('sso_user_unknown:identity_linked_elsewhere');
  });

  it('refuses a replayed attempt, a missing binding, a swapped provider and a swapped state', async () => {
    const setup = await setUp();
    store.users.set(
      'usr_01JC0000000000000000000001',
      userOf('usr_01JC0000000000000000000001', 'ada@example.com'),
    );
    const { started, query } = await signIn(setup);
    expect(await refusal(setup.service.callback(PROVIDER, query, started.binding))).toBe(
      'sso_state_invalid:binding_unknown',
    );
    expect(await refusal(signIn(setup, ADA, { binding: () => undefined }))).toBe(
      'sso_state_invalid:binding_missing',
    );
    expect(await refusal(signIn(setup, ADA, { binding: () => 'ovsb_short' }))).toBe(
      'sso_state_invalid:binding_missing',
    );
    store.providers.set(SECOND, {
      ...firstProvider(),
      id: SECOND,
    });
    expect(await refusal(signIn(setup, ADA, { callbackProvider: SECOND }))).toBe(
      'sso_state_invalid:provider_mismatch',
    );
    expect(
      await refusal(
        signIn(setup, ADA, {
          rewrite: (query) => {
            query.set('state', 'swapped-state');
            return query;
          },
        }),
      ),
    ).toBe('sso_state_invalid:state_mismatch');
  });

  it('refuses an attempt older than 10 minutes', async () => {
    const setup = await setUp();
    const started = await setup.service.start('acme-sso', {});
    if (started.kind !== 'redirect') {
      throw new Error('expected a redirect');
    }
    const query = setup.idp.authorize(started['authorization-url'], ADA);
    clock.advance(600_001);
    expect(await refusal(setup.service.callback(PROVIDER, query, started.binding))).toBe(
      'sso_state_invalid:binding_unknown',
    );
  });

  it('refuses a first link without email_verified, or outside the domains', async () => {
    const setup = await setUp();
    store.users.set(
      'usr_01JC0000000000000000000001',
      userOf('usr_01JC0000000000000000000001', 'ada@example.com'),
    );
    expect(
      await refusal(
        signIn(setup, { sub: 's1', email: 'ada@example.com', claims: { amr: ['mfa'] } }),
      ),
    ).toBe('sso_email_unverified:email_unverified');
    expect(
      await refusal(signIn(setup, { sub: 's2', email: 'ada@example.org', emailVerified: true })),
    ).toBe('sso_user_unknown:email_domain_not_allowed');
    expect(store.identities).toEqual([]);
    expect(refused).toEqual(['email_unverified', 'email_domain_not_allowed']);
  });

  it('refuses an unknown user without just-in-time provisioning, and a deactivated one', async () => {
    const setup = await setUp();
    expect(await refusal(signIn(setup))).toBe('sso_user_unknown:user_unknown');
    store.users.set(
      'usr_01JC0000000000000000000001',
      userOf('usr_01JC0000000000000000000001', 'ada@example.com', 'deactivated'),
    );
    expect(await refusal(signIn(setup))).toBe('sso_user_unknown:user_inactive');
  });

  it('provisions a user just in time with the default roles, audited', async () => {
    const setup = await setUp({ jitProvisioning: true });
    const { result } = await signIn(setup, {
      ...ADA,
      claims: { amr: ['mfa'], name: 'Ada Example' },
    });
    expect(result).toMatchObject({
      kind: 'session',
      user: { email: 'ada@example.com', name: 'Ada Example' },
    });
    expect(store.audits).toEqual([
      expect.objectContaining({
        action: ACCESS_11B_AUDIT_ACTIONS.ssoProvisioned,
        metadata: { 'sso-provider-id': PROVIDER, 'role-ids': [ROLE] },
      }),
    ]);
  });

  it('refuses just in time when a default role gained a forbidden permission after the provider was saved', async () => {
    const setup = await setUp({ jitProvisioning: true });
    store.roles.set(ROLE, ['inquiries:read', 'settings:write']);
    expect(await refusal(signIn(setup))).toBe('sso_user_unknown:jit_role_refused');
    store.roles.set(ROLE, ['inquiries:read', 'users:write']);
    expect(await refusal(signIn(setup))).toBe('sso_user_unknown:jit_role_refused');
    store.roles.delete(ROLE);
    expect(await refusal(signIn(setup))).toBe('sso_user_unknown:jit_role_refused');
    expect(store.provisioned).toBe(0);
  });

  it('asks for the local factor when the token falls short of required-amr under require-mfa', async () => {
    const setup = await setUp({ requiredAmr: ['hwk'] });
    const ada = userOf('usr_01JC0000000000000000000001', 'ada@example.com');
    store.users.set(ada.id, ada);
    factors.add(ada.id);
    const { result } = await signIn(setup);
    expect(result).toMatchObject({ kind: 'mfa', user: { id: ada.id } });
    // Met, the token stands in for it.
    const met = await signIn(setup, { ...ADA, claims: { amr: ['hwk'] } });
    expect(met.result).toMatchObject({ kind: 'session', session: { mfaSatisfied: true } });
    // Without require-mfa, a session that did not pass a factor.
    requireMfa = false;
    const off = await signIn(setup);
    expect(off.result).toMatchObject({ kind: 'session', session: { mfaSatisfied: false } });
    // A user with no factor yet gets a session that must enrol one (C15).
    requireMfa = true;
    factors.clear();
    const none = await signIn(setup);
    expect(none.result).toMatchObject({ kind: 'session', session: { mfaSatisfied: false } });
  });

  // KP11-26 (C248.6, Workflow 11F): the session keeps the provider's amr for the console to show;
  // only short RFC 8176-shaped values are kept, at most ten, and a token without amr keeps none.
  it('opens the session with the token’s amr, and with none when the token names none', async () => {
    const setup = await setUp({ requiredAmr: [] });
    const ada = userOf('usr_01JC0000000000000000000001', 'ada@example.com');
    store.users.set(ada.id, ada);
    requireMfa = false;

    await signIn(setup);
    await signIn(setup, { ...ADA, claims: {} });
    await signIn(setup, {
      ...ADA,
      claims: { amr: ['hwk', 42, 'x'.repeat(65), 'not one value', ...'abcdefghijk'.split('')] },
    });

    expect(opened).toEqual([
      ['pwd', 'mfa'],
      null,
      ['hwk', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    ]);
  });

  it('checks the tenant pin on every token', async () => {
    const idp = await startTestOidcProvider({
      shape: 'google',
      clients: [{ ...CLIENT, redirectUris: [`${CONSOLE}/sso/callback/${PROVIDER}`] }],
      now: () => clock.now(),
    });
    providers.push(idp);
    const setup = await setUp(
      { issuer: idp.issuer, tenantPin: { claim: 'hd', value: 'example.com' } },
      {},
      [idp.issuer],
    );
    store.users.set(
      'usr_01JC0000000000000000000001',
      userOf('usr_01JC0000000000000000000001', 'ada@example.com'),
    );
    const pinned = { ...setup, idp };
    expect(
      await refusal(signIn(pinned, { ...ADA, claims: { amr: ['mfa'], hd: 'example.org' } })),
    ).toBe('sso_user_unknown:tenant_pin_mismatch');
    const { result } = await signIn(pinned, {
      ...ADA,
      claims: { amr: ['mfa'], hd: 'example.com' },
    });
    expect(result.kind).toBe('session');
  });

  it('never tells the refusal log a value from the provider', async () => {
    const setup = await setUp();
    const log = vi.fn();
    const service = createSsoService({
      store,
      oidc: createOidcClient({
        outbound,
        policy: { production: false, privateIssuers: [] },
        clock,
      }),
      sessions: {
        requireMfa: () => Promise.resolve(false),
        openSession: vi.fn(),
        startMfaChallenge: vi.fn(),
      },
      clock,
      dashboardPublicUrl: CONSOLE,
      onRefused: log,
    });
    await refusal(signIn({ ...setup, service }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/ada@|subject-ada|synthetic-client-secret/);
    expect(log).toHaveBeenCalledWith('user_unknown', { providerId: PROVIDER });
  });

  it('offers no SSO without the console’s public URL', async () => {
    await setUp();
    const service = createSsoService({
      store,
      oidc: createOidcClient({
        outbound,
        policy: { production: false, privateIssuers: [] },
        clock,
      }),
      sessions: { requireMfa: vi.fn(), openSession: vi.fn(), startMfaChallenge: vi.fn() },
      clock,
      dashboardPublicUrl: null,
    });
    expect(ssoRedirectUri(null, PROVIDER)).toBeNull();
    expect(await refusal(service.start('acme-sso', {}))).toBe(
      'sso_not_configured:redirect_uri_unset',
    );
  });
});

describe('the SSO step-up (C248.6, KP11-18)', () => {
  async function linked() {
    const setup = await setUp();
    const ada = userOf('usr_01JC0000000000000000000001', 'ada@example.com');
    store.users.set(ada.id, ada);
    await signIn(setup);
    store.sessions.set(SESSION_ID, ada.id);
    return { setup, ada };
  }

  it('re-authenticates the session’s own identity with prompt=login and max_age=0, then marks the step-up', async () => {
    const { setup, ada } = await linked();
    const redirect = await setup.service.startStepUp({ sessionId: SESSION_ID, user: ada });
    const url = new URL(redirect.authorizationUrl);
    expect(url.searchParams.get('prompt')).toBe('login');
    expect(url.searchParams.get('max_age')).toBe('0');
    const query = setup.idp.authorize(redirect.authorizationUrl, ADA, { authTime: clock.now() });
    await expect(setup.service.callback(PROVIDER, query, redirect.binding)).resolves.toEqual({
      kind: 'step-up',
      verifiedAt: clock.now(),
      returnTo: null,
      sessionId: SESSION_ID,
      user: ada,
    });
    expect(store.stepUps).toEqual([{ sessionId: SESSION_ID, at: clock.now() }]);
  });

  it('refuses a re-authentication older than the window, another identity, or short of required-amr', async () => {
    const { setup, ada } = await linked();
    const attempt = async (user: TestOidcUser, authTime: Date) => {
      const redirect = await setup.service.startStepUp({ sessionId: SESSION_ID, user: ada });
      const query = setup.idp.authorize(redirect.authorizationUrl, user, { authTime });
      return setup.service.callback(PROVIDER, query, redirect.binding);
    };
    const stale = new Date(clock.now().getTime() - 601_000);
    expect(await refusal(attempt(ADA, stale))).toMatch(/^sso_(state_invalid|user_unknown):/);
    expect(await refusal(attempt({ ...ADA, sub: 'subject-other' }, clock.now()))).toBe(
      'sso_user_unknown:step_up_identity_mismatch',
    );
    expect(await refusal(attempt({ ...ADA, claims: { amr: ['pwd'] } }, clock.now()))).toBe(
      'sso_user_unknown:step_up_requirement_unmet',
    );
    expect(store.stepUps).toEqual([]);
  });

  it('refuses a step-up of a session that ended meanwhile, and a user with no link', async () => {
    const { setup, ada } = await linked();
    const redirect = await setup.service.startStepUp({ sessionId: SESSION_ID, user: ada });
    store.sessions.clear();
    const query = setup.idp.authorize(redirect.authorizationUrl, ADA, { authTime: clock.now() });
    expect(await refusal(setup.service.callback(PROVIDER, query, redirect.binding))).toBe(
      'sso_state_invalid:session_gone',
    );
    const stranger = userOf('usr_01JC0000000000000000000009', 'grace@example.com');
    expect(
      await refusal(setup.service.startStepUp({ sessionId: SESSION_ID, user: stranger })),
    ).toBe('sso_not_configured:provider_unknown');
  });
});
