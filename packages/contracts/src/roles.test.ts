import { BUILTIN_ROLES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  buildRoleResource,
  createRoleBodySchema,
  listRolesQuerySchema,
  roleDocumentSchema,
  roleListDocumentSchema,
  roleResourceSchema,
  updateRoleBodySchema,
} from './roles.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';

const builtin = {
  type: 'role',
  id: IDS.role,
  attributes: {
    name: 'Reviewer',
    key: 'reviewer',
    builtin: true,
    permissions: [...BUILTIN_ROLES.reviewer.permissions],
    'created-at': AT_ISO,
    'updated-at': AT_ISO,
  },
};

const custom = {
  type: 'role',
  id: IDS.customRole,
  attributes: {
    name: 'Fraud analyst',
    key: null,
    builtin: false,
    permissions: ['inquiries:read', 'pii:view'],
    'created-at': AT_ISO,
    'updated-at': LATER_ISO,
  },
};

describe('role resource (C15)', () => {
  it('describes built-in roles by their key and custom roles without one', () => {
    expect(roleResourceSchema.parse(builtin)).toEqual(builtin);
    expect(roleResourceSchema.parse(custom)).toEqual(custom);
    expect(roleDocumentSchema.safeParse({ data: custom }).success).toBe(true);
    expect(
      roleListDocumentSchema.safeParse({ data: [builtin, custom], links: { next: null } }).success,
    ).toBe(true);
  });

  it.each([
    ['a built-in role without a key', { ...builtin.attributes, key: null }],
    ['a custom role with a key', { ...custom.attributes, key: 'admin' }],
    ['an unknown key', { ...builtin.attributes, key: 'owner' }],
    ['an unknown permission', { ...custom.attributes, permissions: ['inquiries:delete'] }],
    ['a duplicate permission', { ...custom.attributes, permissions: ['pii:view', 'pii:view'] }],
  ])('rejects %s', (_name, attributes) => {
    expect(roleResourceSchema.safeParse({ ...custom, attributes }).success).toBe(false);
  });

  it('is built from a role record', () => {
    expect(
      buildRoleResource({
        id: IDS.customRole,
        name: 'Fraud analyst',
        key: null,
        builtin: false,
        permissions: ['inquiries:read', 'pii:view'],
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(custom);
  });
});

describe('role requests (C15)', () => {
  it('create a custom role from a subset of the permissions', () => {
    const body = { data: { attributes: { name: 'Analyst', permissions: ['inquiries:read'] } } };
    expect(createRoleBodySchema.parse(body)).toEqual(body);
    expect(
      createRoleBodySchema.safeParse({ data: { attributes: { name: 'Analyst', permissions: [] } } })
        .success,
    ).toBe(false);
    expect(
      createRoleBodySchema.safeParse({
        data: { attributes: { name: 'Analyst', permissions: ['x'], builtin: true } },
      }).success,
    ).toBe(false);
  });

  it('update the name or permissions', () => {
    expect(
      updateRoleBodySchema.safeParse({ data: { attributes: { name: 'Senior analyst' } } }).success,
    ).toBe(true);
    expect(updateRoleBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
  });

  it('paginate by role id', () => {
    expect(listRolesQuerySchema.parse({ 'page[after]': IDS.role })).toEqual({
      'page[after]': IDS.role,
    });
  });
});
