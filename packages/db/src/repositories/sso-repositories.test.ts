/**
 * C248.3-C248.8 (Phase 11, Workflow 11B, `sso-oidc`): the SSO repositories on PGlite. The client
 * secret, the nonce and the PKCE verifier are sealed for their rows and opened only on purpose; an
 * attempt is consumed once and never after its expiry; a user has one link per provider and an
 * identity one user; a just-in-time user comes with its roles and its link; the sign-in name is
 * unique; the break-glass grant is used once before its time. Every value is synthetic.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roles, ssoLoginStates, ssoProviders, userRoles } from '../schema.js';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { createUser } from './users.js';
import {
  consumeSsoLoginState,
  createSsoProvider,
  deleteExpiredSsoLoginStates,
  deleteSsoProvider,
  findOrganizationIdBySlug,
  findSsoProvider,
  getOrganizationSlug,
  getSsoProvider,
  grantPasswordLogin,
  insertSsoLoginState,
  listSsoProviders,
  openSsoProviderSecret,
  organizationEnforcesSso,
  setOrganizationSlug,
  takePasswordLoginGrant,
  updateSsoProvider,
  type NewSsoProviderInput,
} from './sso-providers.js';
import {
  findUserBySsoIdentity,
  linkSsoIdentity,
  listSsoIdentitiesOfUser,
  provisionSsoUser,
} from './sso-identities.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const SECRET = 'synthetic-client-secret-canary';
const ISSUER = 'https://idp.example.com/oauth2/default';
const T0 = new Date('2026-11-13T12:00:00Z');
const hex = (character: string) => character.repeat(64);

async function tenant() {
  const { organization, environment } = await createTestTenant(database.db);
  return { organizationId: organization.id, environmentId: environment.id };
}

function providerInput(organizationId: string, overrides: Partial<NewSsoProviderInput> = {}) {
  return {
    id: testId('ssop'),
    organizationId,
    displayName: 'Workforce',
    issuer: ISSUER,
    clientId: 'synthetic-client-id',
    clientSecret: SECRET,
    allowedEmailDomains: ['example.com'],
    tenantPinClaim: null,
    tenantPinValue: null,
    requiredAmr: ['mfa'],
    requiredAcr: [],
    jitProvisioning: false,
    defaultRoleIds: [],
    enforced: false,
    at: T0,
    ...overrides,
  } satisfies NewSsoProviderInput;
}

async function aUser(organizationId: string, email = 'ada@example.com') {
  return createUser(database.db, {
    id: testId('usr'),
    organizationId,
    email,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
  });
}

describe('SSO providers (C248.3)', () => {
  it('seals the client secret for its row, opening it only on purpose', async () => {
    const { organizationId } = await tenant();
    const created = await createSsoProvider(database.db, providerInput(organizationId));
    expect(created.clientSecret).not.toContain(SECRET);
    expect(openSsoProviderSecret(created)).toBe(SECRET);
    const [raw] = await database.db
      .select({ secret: ssoProviders.clientSecret })
      .from(ssoProviders)
      .where(sql`${ssoProviders.id} = ${created.id}`);
    expect(raw?.secret).not.toContain(SECRET);
    // Bound to its row: another row's id does not open it.
    expect(() => openSsoProviderSecret({ ...created, id: testId('ssop') })).toThrow();
  });

  it('lists, reads, changes and deletes only the organisation’s own providers', async () => {
    const own = await tenant();
    const other = await tenant();
    const first = await createSsoProvider(database.db, providerInput(own.organizationId));
    const second = await createSsoProvider(
      database.db,
      providerInput(own.organizationId, {
        displayName: 'Contractors',
        at: new Date(T0.getTime() + 1000),
      }),
    );
    const foreign = await createSsoProvider(database.db, providerInput(other.organizationId));
    expect(
      (await listSsoProviders(database.db, own.organizationId)).map((each) => each.id),
    ).toEqual([first.id, second.id]);
    expect(await getSsoProvider(database.db, own.organizationId, foreign.id)).toBeNull();
    expect((await findSsoProvider(database.db, foreign.id))?.organizationId).toBe(
      other.organizationId,
    );
    expect(
      await updateSsoProvider(database.db, own.organizationId, foreign.id, {
        enforced: true,
        at: T0,
      }),
    ).toBeNull();
    const changed = await updateSsoProvider(database.db, own.organizationId, first.id, {
      enforced: true,
      clientSecret: 'synthetic-new-secret-canary',
      tenantPinClaim: 'hd',
      tenantPinValue: 'example.com',
      at: new Date(T0.getTime() + 5000),
    });
    expect(changed).toMatchObject({
      enforced: true,
      tenantPinClaim: 'hd',
      displayName: 'Workforce',
    });
    expect(openSsoProviderSecret(changed ?? first)).toBe('synthetic-new-secret-canary');
    expect(await organizationEnforcesSso(database.db, own.organizationId)).toBe(true);
    expect(await organizationEnforcesSso(database.db, other.organizationId)).toBe(false);
    expect(await deleteSsoProvider(database.db, other.organizationId, first.id)).toBe(false);
    expect(await deleteSsoProvider(database.db, own.organizationId, first.id)).toBe(true);
    expect(await organizationEnforcesSso(database.db, own.organizationId)).toBe(false);
  });

  it('holds the sign-in name unique across the install', async () => {
    const a = await tenant();
    const b = await tenant();
    const slug = `acme-${testId('org').slice(-8).toLowerCase()}`;
    expect(await getOrganizationSlug(database.db, a.organizationId)).toBeNull();
    expect(await setOrganizationSlug(database.db, a.organizationId, slug)).toBe('set');
    expect(await findOrganizationIdBySlug(database.db, slug)).toBe(a.organizationId);
    expect(await setOrganizationSlug(database.db, b.organizationId, slug)).toBe('taken');
    expect(await getOrganizationSlug(database.db, b.organizationId)).toBeNull();
    expect(await setOrganizationSlug(database.db, a.organizationId, null)).toBe('set');
    expect(await findOrganizationIdBySlug(database.db, slug)).toBeNull();
    // Inside a caller's transaction, a taken name leaves the transaction usable.
    await setOrganizationSlug(database.db, a.organizationId, slug);
    await database.db.transaction(async (tx) => {
      expect(await setOrganizationSlug(tx, b.organizationId, slug)).toBe('taken');
      expect(await getOrganizationSlug(tx, a.organizationId)).toBe(slug);
    });
  });
});

describe('sign-in attempts (C248.4; Stage 1a amendment 11)', () => {
  async function attempt(organizationId: string, providerId: string, key: string, expiresAt: Date) {
    await insertSsoLoginState(database.db, {
      bindingSha256: key,
      organizationId,
      providerId,
      purpose: 'sign-in',
      sessionId: null,
      stateSha256: hex('a'),
      nonce: 'synthetic-nonce-canary',
      codeVerifier: 'synthetic-verifier-canary',
      returnTo: '/inquiries',
      createdAt: T0,
      expiresAt,
    });
  }

  it('seals the nonce and verifier, and is consumed once before its expiry', async () => {
    const { organizationId } = await tenant();
    const provider = await createSsoProvider(database.db, providerInput(organizationId));
    const key = hex('b');
    await attempt(organizationId, provider.id, key, new Date(T0.getTime() + 600_000));
    const [raw] = await database.db
      .select()
      .from(ssoLoginStates)
      .where(sql`${ssoLoginStates.bindingSha256} = ${key}`);
    expect(JSON.stringify(raw)).not.toMatch(/synthetic-(nonce|verifier)-canary/);
    expect(await consumeSsoLoginState(database.db, hex('c'), T0)).toBeNull();
    const consumed = await consumeSsoLoginState(database.db, key, new Date(T0.getTime() + 1000));
    expect(consumed).toMatchObject({
      providerId: provider.id,
      nonce: 'synthetic-nonce-canary',
      codeVerifier: 'synthetic-verifier-canary',
      returnTo: '/inquiries',
      consumedAt: new Date(T0.getTime() + 1000),
    });
    expect(await consumeSsoLoginState(database.db, key, new Date(T0.getTime() + 2000))).toBeNull();
  });

  it('is never consumed at or after its expiry, and is deleted a day after it', async () => {
    const { organizationId } = await tenant();
    const provider = await createSsoProvider(database.db, providerInput(organizationId));
    const expiresAt = new Date(T0.getTime() + 600_000);
    await attempt(organizationId, provider.id, hex('d'), expiresAt);
    expect(await consumeSsoLoginState(database.db, hex('d'), expiresAt)).toBeNull();
    const deleted = await deleteExpiredSsoLoginStates(
      database.db,
      new Date(expiresAt.getTime() + 1),
    );
    expect(deleted).toBeGreaterThanOrEqual(1);
    const [left] = await database.db
      .select()
      .from(ssoLoginStates)
      .where(sql`${ssoLoginStates.bindingSha256} = ${hex('d')}`);
    expect(left).toBeUndefined();
  });
});

describe('linked identities and just-in-time users (C248.4, C248.5)', () => {
  it('finds a user only by its (provider, issuer, subject), one link per user and provider', async () => {
    const { organizationId } = await tenant();
    const provider = await createSsoProvider(database.db, providerInput(organizationId));
    const ada = await aUser(organizationId);
    const grace = await aUser(organizationId, 'grace@example.com');
    const identity = {
      providerId: provider.id,
      issuer: ISSUER,
      subject: 'subject-ada',
      linkedAt: T0,
    };
    expect(
      await linkSsoIdentity(database.db, { ...identity, organizationId, userId: ada.id }),
    ).toBe(true);
    expect((await findUserBySsoIdentity(database.db, provider.id, ISSUER, 'subject-ada'))?.id).toBe(
      ada.id,
    );
    expect(
      await findUserBySsoIdentity(database.db, provider.id, `${ISSUER}/`, 'subject-ada'),
    ).toBeNull();
    // The same identity for another user, or a second identity for the same user: refused.
    expect(
      await linkSsoIdentity(database.db, { ...identity, organizationId, userId: grace.id }),
    ).toBe(false);
    expect(
      await linkSsoIdentity(database.db, {
        ...identity,
        subject: 'subject-ada-2',
        organizationId,
        userId: ada.id,
      }),
    ).toBe(false);
    expect(await listSsoIdentitiesOfUser(database.db, ada.id)).toEqual([
      expect.objectContaining({ providerId: provider.id, subject: 'subject-ada' }),
    ]);
    // A provider's removal takes its links with it.
    await deleteSsoProvider(database.db, organizationId, provider.id);
    expect(await listSsoIdentitiesOfUser(database.db, ada.id)).toEqual([]);
  });

  it('provisions a user with its roles in every environment and its link, in one transaction', async () => {
    const { organizationId } = await tenant();
    const provider = await createSsoProvider(database.db, providerInput(organizationId));
    const [role] = await database.db
      .insert(roles)
      .values({
        id: testId('role'),
        organizationId,
        name: 'Support',
        permissions: ['inquiries:read'],
      })
      .returning();
    const user = await provisionSsoUser(database.db, {
      id: testId('usr'),
      organizationId,
      email: ' Ada@Example.com ',
      name: 'Ada Example',
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
      roleIds: [role?.id ?? ''],
      identity: { providerId: provider.id, issuer: ISSUER, subject: 'subject-new', linkedAt: T0 },
      at: T0,
    });
    expect(user).toMatchObject({ email: 'ada@example.com', name: 'Ada Example', status: 'active' });
    const held = await database.db
      .select()
      .from(userRoles)
      .where(sql`${userRoles.userId} = ${user.id}`);
    expect(held).toEqual([expect.objectContaining({ roleId: role?.id, environmentIds: null })]);
    expect((await findUserBySsoIdentity(database.db, provider.id, ISSUER, 'subject-new'))?.id).toBe(
      user.id,
    );
    // A role of nothing: the whole provision rolls back.
    await expect(
      provisionSsoUser(database.db, {
        id: testId('usr'),
        organizationId,
        email: 'grace@example.com',
        name: null,
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
        roleIds: [testId('role')],
        identity: {
          providerId: provider.id,
          issuer: ISSUER,
          subject: 'subject-grace',
          linkedAt: T0,
        },
        at: T0,
      }),
    ).rejects.toThrow();
    expect(
      await findUserBySsoIdentity(database.db, provider.id, ISSUER, 'subject-grace'),
    ).toBeNull();
  });
});

describe('the break-glass grant (C248.6; review F11)', () => {
  it('allows one password sign-in before its time, cleared when used', async () => {
    const { organizationId } = await tenant();
    const other = await tenant();
    const ada = await aUser(organizationId);
    const until = new Date(T0.getTime() + 86_400_000);
    expect(await takePasswordLoginGrant(database.db, organizationId, ada.id, T0)).toBe(false);
    expect(await grantPasswordLogin(database.db, other.organizationId, ada.id, until)).toBe(false);
    expect(await grantPasswordLogin(database.db, organizationId, ada.id, until)).toBe(true);
    expect(await takePasswordLoginGrant(database.db, organizationId, ada.id, until)).toBe(false);
    expect(await takePasswordLoginGrant(database.db, organizationId, ada.id, T0)).toBe(true);
    expect(await takePasswordLoginGrant(database.db, organizationId, ada.id, T0)).toBe(false);
  });
});
