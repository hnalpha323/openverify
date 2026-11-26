import { newId, newInvitationToken } from '@openverify/contracts';
import { BUILTIN_ROLES, PERMISSIONS } from '@openverify/core';
import { createUser, setUserRoles, syncBuiltinRoles } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../errors.js';
import type { PasswordHasher } from '../operator-auth/password-hasher.js';
import { ulidIdGenerator } from '../ports.js';
import { createRecordingAuditLogger, fixedClock } from '../test-support/fakes.js';
import { acceptInvitation, inviteUser } from './users.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('acceptInvitation', () => {
  it('refuses an unknown token before spending an Argon2id hash on the password', async () => {
    const hash = vi.fn(() => Promise.resolve('$argon2id$fake$unused'));
    const hasher: PasswordHasher = { hash, verify: () => Promise.resolve(false) };
    const audit = createRecordingAuditLogger();

    await expect(
      acceptInvitation(
        { db: database.db, audit, clock: fixedClock(), ids: ulidIdGenerator, hasher },
        { token: newInvitationToken(), password: 'correct horse battery staple', name: 'Nobody' },
        {},
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(hash).not.toHaveBeenCalled();
    expect(audit.entries).toEqual([]);
  });
});

describe('inviteUser', () => {
  it('keeps the SMTP failure kind on the 502 for the error log, never its message (2B F033)', async () => {
    const { organization, environment } = await createTestTenant(database.db);
    const [admin, , , viewer] = await syncBuiltinRoles(
      database.db,
      organization.id,
      Object.values(BUILTIN_ROLES),
      () => newId('role'),
    );
    const inviter = await createUser(database.db, {
      id: newId('usr'),
      organizationId: organization.id,
      email: 'synthetic-admin@example.test',
      passwordHash: '$argon2id$fake$unused',
    });
    // C167.2 (Workflow 9B): role-ids mean every environment, so the inviter holds the permissions
    // through a stored organisation-wide assignment.
    await setUserRoles(database.db, organization.id, inviter.id, [admin?.id ?? '']);
    const refused = Object.assign(
      new Error('Invalid login: 535 5.7.8 rejected for synthetic-invitee@example.test'),
      { code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' },
    );

    const failure = await inviteUser(
      {
        db: database.db,
        audit: createRecordingAuditLogger(),
        clock: fixedClock(),
        ids: ulidIdGenerator,
        mailer: { configured: true, send: () => Promise.reject(refused) },
        dashboardPublicUrl: 'https://dashboard.example.test',
      },
      {
        ctx: { organizationId: organization.id, environmentId: environment.id },
        actor: { type: 'user', id: inviter.id },
        permissions: new Set(PERMISSIONS),
      },
      { email: 'synthetic-invitee@example.test', roleIds: [viewer?.id ?? ''] },
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      status: 502,
      smtp: { name: 'Error', code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' },
    });
    expect(JSON.stringify(failure)).not.toContain('synthetic-invitee');
  });
});
