import { describe, expect, it } from 'vitest';
import { AT, AT_ISO, IDS, LATER, LATER_ISO } from './test-support.js';
import {
  USER_STATUSES,
  buildUserResource,
  listUsersQuerySchema,
  updateUserBodySchema,
  userDocumentSchema,
  userListDocumentSchema,
  userResourceSchema,
} from './users.js';

const user = {
  type: 'user',
  id: IDS.user,
  attributes: { email: 'operator@example.test', 'created-at': AT_ISO, 'updated-at': LATER_ISO },
};

describe('user resource (C4)', () => {
  it('identifies an operator by email', () => {
    expect(userResourceSchema.parse(user)).toEqual(user);
    expect(userDocumentSchema.safeParse({ data: user }).success).toBe(true);
  });

  it('never carries credentials', () => {
    for (const secret of [{ password: 'x' }, { 'password-hash': '$argon2id$...' }]) {
      const value = { ...user, attributes: { ...user.attributes, ...secret } };
      expect(userResourceSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects a malformed email', () => {
    const value = { ...user, attributes: { ...user.attributes, email: 'not-an-email' } };
    expect(userResourceSchema.safeParse(value).success).toBe(false);
  });

  it('is built from a user record', () => {
    expect(
      buildUserResource({
        id: IDS.user,
        email: 'operator@example.test',
        createdAt: AT,
        updatedAt: LATER,
      }),
    ).toEqual(user);
  });
});

describe('Phase 2 user attributes (C15)', () => {
  const operator = {
    ...user,
    attributes: { ...user.attributes, name: 'Sam Sample', status: 'active' },
    relationships: { roles: { data: [{ type: 'role', id: IDS.role }] } },
  };

  it('add the name, status and roles', () => {
    expect(USER_STATUSES).toEqual(['invited', 'active', 'deactivated']);
    expect(userResourceSchema.parse(operator)).toEqual(operator);
    expect(
      userListDocumentSchema.safeParse({ data: [operator, user], links: { next: null } }).success,
    ).toBe(true);
  });

  it('are built when the record carries them', () => {
    expect(
      buildUserResource({
        id: IDS.user,
        email: 'operator@example.test',
        createdAt: AT,
        updatedAt: LATER,
        name: 'Sam Sample',
        status: 'active',
        roleIds: [IDS.role],
      }),
    ).toEqual(operator);
  });

  it('say whether the user has an active MFA factor (Workflow 2C users list)', () => {
    const enrolled = { ...operator, attributes: { ...operator.attributes, 'mfa-enabled': true } };
    expect(userResourceSchema.parse(enrolled)).toEqual(enrolled);
    expect(
      buildUserResource({
        id: IDS.user,
        email: 'operator@example.test',
        createdAt: AT,
        updatedAt: LATER,
        name: 'Sam Sample',
        status: 'active',
        mfaEnabled: true,
        roleIds: [IDS.role],
      }),
    ).toEqual(enrolled);
    expect(
      userResourceSchema.safeParse({
        ...operator,
        attributes: { ...operator.attributes, 'mfa-enabled': 'yes' },
      }).success,
    ).toBe(false);
  });

  it('reject an unknown status or a role linkage of another type', () => {
    expect(
      userResourceSchema.safeParse({
        ...operator,
        attributes: { ...operator.attributes, status: 'suspended' },
      }).success,
    ).toBe(false);
    expect(
      userResourceSchema.safeParse({
        ...operator,
        relationships: { roles: { data: [{ type: 'user', id: IDS.user }] } },
      }).success,
    ).toBe(false);
  });

  it('PATCH changes role ids or the status', () => {
    const body = { data: { attributes: { 'role-ids': [IDS.role], status: 'deactivated' } } };
    expect(updateUserBodySchema.parse(body)).toEqual(body);
    for (const attributes of [
      {},
      { 'role-ids': [] },
      { 'role-ids': [IDS.role, IDS.role] },
      { email: 'new@example.test' },
      { status: 'invited' },
    ]) {
      expect(updateUserBodySchema.safeParse({ data: { attributes } }).success).toBe(false);
    }
  });

  it('lists users by status', () => {
    expect(listUsersQuerySchema.parse({ 'filter[status]': 'deactivated' })).toEqual({
      'filter[status]': 'deactivated',
    });
  });
});
