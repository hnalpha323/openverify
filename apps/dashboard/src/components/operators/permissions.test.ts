import { PERMISSIONS, isPermission } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { permissionAreas, permissionLabel } from './permissions';

describe('permissionAreas', () => {
  it('puts every permission in exactly one area', () => {
    const listed = permissionAreas().flatMap((area) => area.permissions);

    expect([...listed].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('orders the areas from daily review work to organization administration', () => {
    expect(permissionAreas().map((area) => area.label)).toEqual([
      'Inquiries',
      'Inquiry sessions',
      'Verifications',
      'Accounts',
      'Reports',
      'Lists',
      'Graph',
      'Transactions',
      'Cases',
      'Analytics',
      // Phase 11 (Workflow 11A).
      'Connect',
      'Workflows',
      'Templates',
      'Webhooks',
      'Events',
      'API keys',
      'API logs',
      'Workflow secrets',
      'Personal data',
      'Users',
      'Roles',
      'Audit logs',
      'Settings',
      'Environments',
    ]);
  });

  it('keeps each area to its own permissions, in the order core declares them', () => {
    const inquiries = permissionAreas().find((area) => area.id === 'inquiries');

    expect(inquiries?.permissions).toEqual([
      'inquiries:read',
      'inquiries:write',
      'inquiries:redact',
      'inquiries:export',
    ]);
  });

  it('can list only some permissions, leaving out empty areas', () => {
    expect(permissionAreas(['pii:view', 'inquiries:read'])).toEqual([
      { id: 'inquiries', label: 'Inquiries', permissions: ['inquiries:read'] },
      { id: 'pii', label: 'Personal data', permissions: ['pii:view'] },
    ]);
  });
});

describe('the Reports area (C72.2)', () => {
  it('holds the report, report template and watchlist source permissions', () => {
    expect(permissionAreas().find((area) => area.label === 'Reports')?.permissions).toEqual([
      'reports:read',
      'reports:write',
      'reports:review',
      'reports:redact',
      'report-templates:read',
      'report-templates:write',
      'report-templates:publish',
      'watchlists:read',
      'reports:export',
    ]);
    expect(permissionLabel('reports:review')).toBe('Review and dismiss report matches');
  });
});

describe('the Workflow 9A permissions (C167.1)', () => {
  it('sit with the templates whose flows they style and publish', () => {
    expect(permissionAreas().find((area) => area.id === 'templates')?.permissions).toEqual(
      expect.arrayContaining(['theme-sets:read', 'theme-sets:write', 'deployments:read']),
    );
    const label = (permission: string) =>
      isPermission(permission) ? permissionLabel(permission) : undefined;
    expect(label('theme-sets:read')).toBe('View theme sets');
    expect(label('theme-sets:write')).toBe('Create, edit and archive theme sets');
    expect(label('deployments:read')).toBe('View the deployment history of templates');
  });
});

describe('the Workflow 9B permissions (C167.1)', () => {
  const label = (permission: string) =>
    isPermission(permission) ? permissionLabel(permission) : undefined;
  const areaOf = (permission: string) =>
    permissionAreas().find((area) => (area.permissions as readonly string[]).includes(permission))
      ?.id;

  it('gives analytics an area of its own', () => {
    expect(areaOf('analytics:read')).toBe('analytics');
    expect(label('analytics:read')).toBe('View analytics');
  });

  it.each([
    ['inquiries:export', 'inquiries', 'Export inquiries'],
    ['verifications:export', 'verifications', 'Export verifications'],
    ['accounts:export', 'accounts', 'Export accounts'],
    ['reports:export', 'reports', 'Export reports'],
    ['lists:export', 'lists', 'Export lists and their items'],
    ['transactions:export', 'transactions', 'Export transactions'],
  ])('puts %s in the %s area, worded "%s"', (permission, area, words) => {
    expect(areaOf(permission)).toBe(area);
    expect(label(permission)).toBe(words);
  });

  // C240.1 (Phase 11, Workflow 11A): Connect has an area of its own.
  it.each([
    ['connect-connections:read', 'View connections and their share policies'],
    [
      'connect-connections:write',
      'Create, deactivate and reactivate connections, and change a share policy',
    ],
    ['connect-share-tokens:read', 'View share tokens and consent records'],
    ['connect-share-tokens:write', 'Create and expire share tokens, and withdraw a consent'],
    ['connect-share-tokens:redeem', 'Redeem share tokens from a partner'],
    ['connect-share-tokens:peek', 'Peek at what a share token would copy, before redeeming it'],
    ['connect-consent-records:attest', 'Attest a consent the platform did not witness'],
    ['connect-connections:activate', 'Accept a partner’s share policy and activate a connection'],
  ])('puts %s in the Connect area, worded "%s"', (permission, words) => {
    expect(areaOf(permission)).toBe('connect');
    expect(label(permission)).toBe(words);
  });

  it('says an attested consent was not witnessed, in the permission itself', () => {
    expect(label('connect-consent-records:attest')).toMatch(/did not witness/);
  });
});

describe('permissionLabel', () => {
  it('says what each permission allows in plain words', () => {
    expect(permissionLabel('inquiries:read')).toBe('View inquiries');
    expect(permissionLabel('pii:view')).toBe('View personal data and files');
    expect(permissionLabel('environments:production')).toBe('Use production');
    expect(new Set(PERMISSIONS.map(permissionLabel)).size).toBe(PERMISSIONS.length);
  });
});
