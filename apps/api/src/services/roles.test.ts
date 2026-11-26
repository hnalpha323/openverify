import { newId, roleResourceSchema } from '@openverify/contracts';
import { BUILTIN_ROLES, BUILTIN_ROLE_KEYS } from '@openverify/core';
import { createRole, listRoles, roles } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ulidIdGenerator } from '../ports.js';
import { PermissionDeniedError } from '../errors.js';
import {
  assertCanChangeAccess,
  builtinRoleId,
  roleResource,
  syncAllOrganizationRoles,
  syncOrganizationRoles,
} from './roles.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('syncOrganizationRoles', () => {
  it('seeds the four C15 built-in roles with their core permissions', async () => {
    const { organization } = await createTestTenant(database.db);

    const synced = await syncOrganizationRoles(database.db, organization.id, ulidIdGenerator);

    expect(synced.map((role) => role.key)).toEqual([...BUILTIN_ROLE_KEYS]);
    for (const role of synced) {
      expect(role.id).toMatch(/^role_/);
      expect(role.builtin).toBe(true);
      expect(role.permissions).toEqual([
        ...BUILTIN_ROLES[role.key as keyof typeof BUILTIN_ROLES].permissions,
      ]);
    }
  });

  it('is idempotent and puts drifted permissions back', async () => {
    const { organization } = await createTestTenant(database.db);
    const first = await syncOrganizationRoles(database.db, organization.id, ulidIdGenerator);
    const viewer = first.find((role) => role.key === 'viewer');
    await database.db
      .update(roles)
      .set({ permissions: ['pii:view'] })
      .where(eq(roles.id, viewer?.id ?? ''));

    const second = await syncOrganizationRoles(database.db, organization.id, ulidIdGenerator);

    expect(second.map((role) => role.id)).toEqual(first.map((role) => role.id));
    expect(second.find((role) => role.key === 'viewer')?.permissions).toEqual([
      ...BUILTIN_ROLES.viewer.permissions,
    ]);
  });
});

describe('syncAllOrganizationRoles', () => {
  it('syncs every organization, as the API does at startup', async () => {
    const tenants = [await createTestTenant(database.db), await createTestTenant(database.db)];

    const count = await syncAllOrganizationRoles(database.db, ulidIdGenerator);

    expect(count).toBeGreaterThanOrEqual(2);
    for (const { organization } of tenants) {
      const page = await listRoles(database.db, organization.id, { size: 100 });
      expect(page.items.filter((role) => role.builtin)).toHaveLength(4);
    }
  });
});

describe('builtinRoleId', () => {
  it('finds a built-in role by key, and throws when the organization has none', async () => {
    const { organization } = await createTestTenant(database.db);
    const synced = await syncOrganizationRoles(database.db, organization.id, ulidIdGenerator);
    const { organization: bare } = await createTestTenant(database.db);

    await expect(builtinRoleId(database.db, organization.id, 'reviewer')).resolves.toBe(
      synced.find((role) => role.key === 'reviewer')?.id,
    );
    await expect(builtinRoleId(database.db, bare.id, 'admin')).rejects.toThrow(
      'has no built-in role admin',
    );
  });
});

describe('roleResource', () => {
  it('maps built-in and custom roles to the C15 resource', async () => {
    const { organization } = await createTestTenant(database.db);
    const [admin] = await syncOrganizationRoles(database.db, organization.id, ulidIdGenerator);
    const custom = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Auditor',
      permissions: ['audit-logs:read', 'not-a-permission'],
    });

    expect(roleResourceSchema.parse(roleResource(admin ?? custom))).toMatchObject({
      attributes: { key: 'admin', builtin: true, name: 'Admin' },
    });
    expect(roleResource(custom)).toEqual({
      type: 'role',
      id: custom.id,
      attributes: {
        name: 'Synthetic Auditor',
        key: null,
        builtin: false,
        // A stored value core does not know grants nothing and is not shown.
        permissions: ['audit-logs:read'],
        'created-at': custom.createdAt.toISOString(),
        'updated-at': custom.updatedAt.toISOString(),
      },
    });
  });
});

describe('assertCanChangeAccess (Workflow 2D K002)', () => {
  const held = new Set(['inquiries:read', 'users:write'] as const);

  it('passes when the operator holds every permission the change touches', () => {
    expect(() => {
      assertCanChangeAccess(held, ['inquiries:read', 'inquiries:read'], 'remove');
    }).not.toThrow();
  });

  it('refuses with 403 forbidden naming each missing permission once, in PERMISSIONS order', () => {
    const refusal = (() => {
      try {
        assertCanChangeAccess(held, ['pii:view', 'inquiries:write', 'pii:view'], 'change-status');
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(refusal).toBeInstanceOf(PermissionDeniedError);
    expect(refusal).toMatchObject({
      status: 403,
      message:
        'You cannot change the status of a user with permissions you do not hold: ' +
        'inquiries:write, pii:view.',
    });
  });

  it('names what was refused: a grant, a removal, a status change or a role deletion', () => {
    const detailOf = (change: Parameters<typeof assertCanChangeAccess>[2]) => {
      try {
        assertCanChangeAccess(held, ['pii:view'], change);
      } catch (error) {
        return (error as PermissionDeniedError).message;
      }
      return undefined;
    };

    expect(detailOf('grant')).toBe('You cannot grant permissions you do not hold: pii:view.');
    expect(detailOf('remove')).toBe('You cannot remove permissions you do not hold: pii:view.');
    expect(detailOf('delete-role')).toBe(
      'You cannot delete a role with permissions you do not hold: pii:view.',
    );
  });
});
