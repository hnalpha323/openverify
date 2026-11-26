import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { hashSessionToken } from '../tokens.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  createUser,
  createUserSession,
  findActiveUserSessionByTokenHash,
  findUserByEmail,
  getUser,
  listUsersByEmail,
  normalizeEmail,
  revokeUserSession,
} from './users.js';

// Synthetic argon2id PHC string; the API does the real hashing.
const PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c3ludGhldGljc2FsdA$c3ludGhldGljaGFzaA';
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const newUser = async (email = `${testId('usr').toLowerCase()}@example.test`) => {
  const tenant = await createTestTenant(database.db);
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: tenant.organization.id,
    email,
    passwordHash: PASSWORD_HASH,
    name: 'Ada Operator',
  });
  return { ...tenant, user };
};

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ada.Operator@Example.TEST ')).toBe('ada.operator@example.test');
  });
});

describe('users', () => {
  it('stores the email normalised, so lookups ignore case and spaces', async () => {
    const { organization, user } = await newUser(' Ops.Lead@Example.TEST ');

    expect(user).toMatchObject({
      organizationId: organization.id,
      email: 'ops.lead@example.test',
      passwordHash: PASSWORD_HASH,
      name: 'Ada Operator',
    });
    expect(await findUserByEmail(database.db, organization.id, 'OPS.LEAD@example.test')).toEqual(
      user,
    );
    expect(await getUser(database.db, organization.id, user.id)).toEqual(user);
  });

  it('scopes reads to the organization', async () => {
    const { user } = await newUser();
    const other = await createTestTenant(database.db);

    expect(await getUser(database.db, other.organization.id, user.id)).toBeNull();
    expect(await findUserByEmail(database.db, other.organization.id, user.email)).toBeNull();
  });

  it('lists every account with an email across organizations, for login', async () => {
    onTestFinished(wallClockStepsBack());
    const email = `shared-${testId('usr').toLowerCase()}@example.test`;
    const clock = createdAtClock(database.db);
    const first = await newUser(email);
    await clock.at('users', first.user.id);
    const second = await newUser(email.toUpperCase());
    await clock.at('users', second.user.id);

    const found = await listUsersByEmail(database.db, ` ${email.toUpperCase()}`);

    expect(found.map((user) => user.id)).toEqual([first.user.id, second.user.id]);
    expect(await listUsersByEmail(database.db, 'nobody@example.test')).toEqual([]);
  });

  it('defaults the display name to null', async () => {
    const { organization } = await createTestTenant(database.db);

    const user = await createUser(database.db, {
      id: testId('usr'),
      organizationId: organization.id,
      email: 'no-name@example.test',
      passwordHash: PASSWORD_HASH,
    });

    expect(user.name).toBeNull();
  });
});

describe('user sessions', () => {
  it('finds an active session with its user by token hash', async () => {
    const { organization, environment, user } = await newUser();
    const tokenHash = hashSessionToken(`ovu_${testId('uss')}`);
    const session = await createUserSession(database.db, {
      id: testId('uss'),
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 12 * 3_600_000),
    });

    const found = await findActiveUserSessionByTokenHash(database.db, tokenHash);

    expect(found).toEqual({ session, user });
    expect(session).toMatchObject({ environmentId: environment.id, revokedAt: null });
  });

  it('ignores expired, revoked and unknown sessions', async () => {
    const { organization, environment, user } = await newUser();
    const now = new Date('2026-10-20T12:00:00.000Z');
    const session = async (expiresAt: Date) => {
      const tokenHash = hashSessionToken(testId('uss'));
      const created = await createUserSession(database.db, {
        id: testId('uss'),
        organizationId: organization.id,
        userId: user.id,
        environmentId: environment.id,
        tokenHash,
        expiresAt,
      });
      return { created, tokenHash };
    };
    const expired = await session(now);
    const revoked = await session(new Date(now.getTime() + 60_000));

    expect(await revokeUserSession(database.db, revoked.created.id, now)).toBe(true);
    expect(await revokeUserSession(database.db, revoked.created.id, now)).toBe(false);
    expect(await findActiveUserSessionByTokenHash(database.db, expired.tokenHash, now)).toBeNull();
    expect(await findActiveUserSessionByTokenHash(database.db, revoked.tokenHash, now)).toBeNull();
    expect(
      await findActiveUserSessionByTokenHash(database.db, hashSessionToken('unknown'), now),
    ).toBeNull();
  });
});
