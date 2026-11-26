/**
 * C167.2 (Workflow 9B Stage 1a, (U); reviews P01, V14): which permissions and which settings are
 * organisation-level. Read through the package root, so the export lines are held too.
 */
import { describe, expect, it } from 'vitest';
import * as core from './index.js';

const pick = (name: string): unknown => (core as Readonly<Record<string, unknown>>)[name];

describe('PERMISSION_LEVEL (C167.2, review P01)', () => {
  it('marks users:* and roles:* organisation-level, and every other permission environment-level', () => {
    const levels = pick('PERMISSION_LEVEL') as Readonly<Record<string, string>> | undefined;
    expect(Object.keys(levels ?? {}).sort()).toEqual([...core.PERMISSIONS].sort());
    const organisation = Object.entries(levels ?? {})
      .filter(([, level]) => level === 'organization')
      .map(([permission]) => permission)
      .sort();
    // C231.9 (Workflow 11A; review P01): a connection carries both environment kinds' tokens, so
    // changing one and activating one are organisation-level too.
    expect(organisation).toEqual([
      'connect-connections:activate',
      'connect-connections:write',
      'roles:read',
      'roles:write',
      'users:read',
      'users:write',
    ]);
    expect(levels?.['connect-connections:read']).toBe('environment');
    expect(levels?.['connect-share-tokens:write']).toBe('environment');
    expect(levels?.['settings:write']).toBe('environment');
    expect(levels?.['environments:production']).toBe('environment');
  });

  it('answers a permission level and lists the organisation-level ones', () => {
    const levelOf = pick('permissionLevel') as ((permission: string) => string) | undefined;
    expect(levelOf?.('users:write')).toBe('organization');
    expect(levelOf?.('inquiries:read')).toBe('environment');
    expect(pick('ORGANIZATION_LEVEL_PERMISSIONS')).toEqual([
      'users:read',
      'users:write',
      'roles:read',
      'roles:write',
      'connect-connections:write',
      'connect-connections:activate',
    ]);
    expect(levelOf?.('connect-connections:write')).toBe('organization');
    expect(levelOf?.('connect-connections:activate')).toBe('organization');
  });
});

describe('SETTING_LEVEL (C167.2, V14)', () => {
  it('marks require-mfa and connect-inbound organisation-level, and any other setting environment-level', () => {
    // C231.10 (Workflow 11A; decision 71): an organisation receives connections only after its
    // admin turns connect-inbound on, organisation-wide.
    expect(pick('SETTING_LEVEL')).toEqual({
      'require-mfa': 'organization',
      'connect-inbound': 'organization',
      // C248.8 (Workflow 11B (A)): the organisation's sign-in name.
      'organization-slug': 'organization',
    });
    const levelOf = pick('settingLevel') as ((setting: string) => string) | undefined;
    expect(levelOf?.('require-mfa')).toBe('organization');
    expect(levelOf?.('connect-inbound')).toBe('organization');
    expect(levelOf?.('share-token-max-seconds')).toBe('environment');
    expect(levelOf?.('analytics-time-zone')).toBe('environment');
    expect(levelOf?.('allowed-embed-origins')).toBe('environment');
  });
});
