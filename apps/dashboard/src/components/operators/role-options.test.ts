import { PERMISSIONS, type Permission } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { roleNames, roleOptions } from './role-options';
import { ROLE_IDS, allRoles, customRole } from './test-fixtures';

const REVIEWER_PERMISSIONS: Permission[] = [
  // Workflow 11A (C240.1): the two Connect reads.
  'connect-connections:read',
  'connect-share-tokens:read',
  // Workflow 9B (C167.1).
  'analytics:read',
  // Workflow 8B (C129.4, decision 68).
  'cases:read',
  'cases:write',
  'cases:assign',
  'case-templates:read',
  'case-queues:read',
  // Workflow 8A (C112.5, C127.9).
  'workflows:read',
  'workflows:trigger',
  'workflow-runs:read',
  'devices:write',
  // Workflow 7B.
  'lists:read',
  'lists:write',
  'importers:read',
  'graph:read',
  'graph:write',
  'transactions:read',
  'transactions:write',
  'transactions:redact',
  'inquiries:read',
  'inquiries:write',
  'inquiries:redact',
  'inquiry-sessions:read',
  'verifications:read',
  'accounts:read',
  'accounts:write',
  'accounts:redact',
  'events:read',
  // C72.2 (Phase 6): the reviewer role's report permissions.
  'reports:read',
  'reports:write',
  'reports:review',
  'reports:redact',
  'report-templates:read',
  'watchlists:read',
  'pii:view',
  'users:read',
  'users:write',
];

describe('roleOptions', () => {
  it('lists the built-in roles in their usual order, then custom roles by name', () => {
    const options = roleOptions(
      [
        customRole({ id: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y65', name: 'Zeta' }),
        ...allRoles(),
        customRole({ id: 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y66', name: 'Alpha' }),
      ],
      new Set(PERMISSIONS),
    );

    expect(options.map(({ name }) => name)).toEqual([
      'Admin',
      'Developer',
      'Reviewer',
      'Viewer',
      'Alpha',
      'Support',
      'Zeta',
    ]);
    expect(options.every(({ grantable }) => grantable)).toBe(true);
    expect(options[0]).toEqual({
      id: ROLE_IDS.admin,
      name: 'Admin',
      builtin: true,
      grantable: true,
    });
  });

  it('marks the roles that grant a permission the operator lacks as not grantable (C12)', () => {
    const options = roleOptions(allRoles(), new Set(REVIEWER_PERMISSIONS));

    expect(Object.fromEntries(options.map(({ name, grantable }) => [name, grantable]))).toEqual({
      Admin: false,
      Developer: false,
      Reviewer: true,
      Viewer: false,
      Support: true,
    });
  });
});

describe('roleNames', () => {
  it("names a user's roles, and keeps the ID of a role it does not know", () => {
    const unknown = 'role_01J9ZK3M5Q7R8S9T0V1W2X3Y6Z';

    expect(roleNames([ROLE_IDS.reviewer, unknown], allRoles())).toEqual(['Reviewer', unknown]);
  });
});
