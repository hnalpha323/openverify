import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS } from '../../testing/api-mock';
import { ROLE_IDS, SETTINGS_IDS, grantableScope } from '../../testing/routes/settings';
import { assignmentScopes, isSensitivePermission, roleEditorRefusals } from './grantable';

const ENVS = [ENVIRONMENTS.sandbox, ENVIRONMENTS.production];

describe('roleEditorRefusals (C167.4)', () => {
  it('refuses a permission the editor does not hold in some environment, naming that environment', () => {
    const refusals = roleEditorRefusals(
      [
        grantableScope(SETTINGS_IDS.sandbox, ['inquiries:read', 'pii:view']),
        grantableScope(SETTINGS_IDS.production, ['inquiries:read']),
        grantableScope(null, ['inquiries:read']),
      ],
      ENVS,
    );

    expect(refusals.get('inquiries:read')).toBeUndefined();
    expect(refusals.get('pii:view')).toBe(
      'You do not hold it in Production, so you cannot grant it.',
    );
    expect(refusals.get('webhooks:write')).toBe(
      'You do not hold it in Sandbox or Production, so you cannot grant it.',
    );
  });

  it('judges an organisation-level permission by the organisation-wide scope only', () => {
    const refusals = roleEditorRefusals(
      [
        grantableScope(SETTINGS_IDS.sandbox),
        grantableScope(SETTINGS_IDS.production),
        grantableScope(null),
      ],
      ENVS,
    );

    expect(refusals.get('users:write')).toBeUndefined();
    expect(refusals.get('settings:write')).toBeUndefined();
  });

  it('refuses an organisation-level permission the editor does not hold organisation-wide', () => {
    const refusals = roleEditorRefusals(
      [
        grantableScope(SETTINGS_IDS.sandbox),
        grantableScope(SETTINGS_IDS.production),
        grantableScope(null, ['inquiries:read']),
      ],
      ENVS,
    );

    expect(refusals.get('roles:write')).toBe(
      'You do not hold it organisation-wide, so you cannot grant it.',
    );
  });
});

describe('isSensitivePermission (C167.4)', () => {
  it.each([
    ['pii:view', true],
    ['settings:privacy', true],
    ['inquiries:redact', true],
    ['inquiries:export', true],
    ['environments:production', true],
    ['secrets:write', true],
    ['inquiries:read', false],
    ['settings:write', false],
  ] as const)('%s: %s', (permission, sensitive) => {
    expect(isSensitivePermission(permission)).toBe(sensitive);
  });
});

describe('assignmentScopes (C167.2)', () => {
  it('offers every environment and organisation-wide where the role is grantable there, with reasons otherwise', () => {
    const scopes = assignmentScopes(
      ROLE_IDS.admin,
      [
        grantableScope(SETTINGS_IDS.sandbox),
        grantableScope(SETTINGS_IDS.production),
        grantableScope(null),
      ],
      ENVS,
    );

    expect(scopes).toEqual([
      { value: 'all', label: 'Every environment, current and future', refusal: null },
      {
        value: SETTINGS_IDS.sandbox,
        label: 'Sandbox only',
        refusal: 'The built-in admin role is granted organisation-wide only.',
      },
      {
        value: SETTINGS_IDS.production,
        label: 'Production only',
        refusal: 'The built-in admin role is granted organisation-wide only.',
      },
    ]);
  });

  it('refuses a scope where the editor may not grant the role', () => {
    const scopes = assignmentScopes(
      ROLE_IDS.reviewer,
      [
        grantableScope(SETTINGS_IDS.sandbox),
        {
          ...grantableScope(SETTINGS_IDS.production),
          roles: [{ 'role-id': ROLE_IDS.reviewer, grantable: false, reason: 'not-held' }],
        },
        {
          ...grantableScope(null),
          roles: [{ 'role-id': ROLE_IDS.reviewer, grantable: false, reason: 'not-held' }],
        },
      ],
      ENVS,
    );

    expect(scopes.map(({ value, refusal }) => [value, refusal])).toEqual([
      ['all', 'You do not hold every permission of this role there, so you cannot grant it.'],
      [SETTINGS_IDS.sandbox, null],
      [
        SETTINGS_IDS.production,
        'You do not hold every permission of this role there, so you cannot grant it.',
      ],
    ]);
  });
});
