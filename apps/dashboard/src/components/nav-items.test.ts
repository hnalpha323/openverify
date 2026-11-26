import { EXPORT_PERMISSIONS, PERMISSIONS, type Permission } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  NAV_GROUPS,
  NOTIFICATION_PREFERENCES_PATH,
  currentNavHref,
  homePath,
  isCurrentPath,
  visibleNavGroups,
} from './nav-items';

describe('NAV_GROUPS', () => {
  it('lists every C23 console route, each gated by the permission that reads it', () => {
    const items = NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => [item.href, item.permission]),
    );

    expect(items).toEqual([
      ['/inquiries', 'inquiries:read'],
      ['/accounts', 'accounts:read'],
      ['/account-types', 'accounts:read'],
      ['/templates', 'inquiry-templates:read'],
      ['/theme-sets', 'theme-sets:read'],
      ['/analytics', 'analytics:read'],
      ['/exports', 'inquiries:export'],
      ['/reports', 'reports:read'],
      ['/report-templates', 'report-templates:read'],
      ['/watchlist-sources', 'watchlists:read'],
      ['/exports/bulk-reports', 'reports:write'],
      ['/lists', 'lists:read'],
      ['/graph', 'graph:read'],
      ['/transactions', 'transactions:read'],
      ['/transaction-types', 'transactions:read'],
      ['/cases', 'cases:read'],
      ['/case-templates', 'case-templates:read'],
      ['/case-queues', 'case-queues:read'],
      ['/case-settings', 'case-queues:read'],
      ['/workflows', 'workflows:read'],
      ['/secrets', 'secrets:read'],
      ['/webhooks', 'webhooks:read'],
      ['/api-keys', 'api-keys:read'],
      ['/api-logs', 'api-logs:read'],
      ['/events', 'events:read'],
      ['/users', 'users:read'],
      ['/roles', 'roles:read'],
      ['/audit-logs', 'audit-logs:read'],
      ['/settings', 'settings:read'],
      ['/trust-anchors', 'settings:read'],
      ['/network-sources', 'settings:read'],
    ]);
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      'Verifications',
      'Insights',
      'Reports',
      'Risk',
      'Cases',
      'Automation',
      'Integrations',
      'Organization',
    ]);
  });
});

describe('the Phase 8 pages (C141, C142)', () => {
  const labels = (permissions: Permission[]) =>
    visibleNavGroups(new Set(permissions)).flatMap((group) =>
      group.items.map((item) => item.label),
    );

  it('group the case pages, each item read with the scope its API route requires', () => {
    // GET /cases (cases:read), GET /case-templates (case-templates:read), GET /case-queues and
    // GET /case-assignment-policies (case-queues:read), GET /case-sla-policies and
    // GET /case-calendars (case-queues:read, C129.5).
    expect(NAV_GROUPS.find((group) => group.label === 'Cases')?.items).toEqual([
      { href: '/cases', label: 'Cases', permission: 'cases:read' },
      { href: '/case-templates', label: 'Case templates', permission: 'case-templates:read' },
      { href: '/case-queues', label: 'Queues', permission: 'case-queues:read' },
      { href: '/case-settings', label: 'Case settings', permission: 'case-queues:read' },
    ]);
  });

  it('group the workflow pages, read with workflows:read and secrets:read (C112.5)', () => {
    // GET /workflows (workflows:read), GET /workflow-secrets (secrets:read, never a viewer's).
    expect(NAV_GROUPS.find((group) => group.label === 'Automation')?.items).toEqual([
      { href: '/workflows', label: 'Workflows', permission: 'workflows:read' },
      { href: '/secrets', label: 'Secrets', permission: 'secrets:read' },
    ]);
  });

  it.each([
    ['cases:read', ['Cases']],
    ['case-templates:read', ['Case templates']],
    ['case-queues:read', ['Queues', 'Case settings']],
    ['workflows:read', ['Workflows']],
    ['secrets:read', ['Secrets']],
  ] as const)('shows %s its own items only', (scope, expected) => {
    expect(labels([scope])).toEqual(expected);
  });

  it('never marks Cases for a case template, queue or settings page', () => {
    expect(isCurrentPath('/case-templates/ctmpl_1', '/cases')).toBe(false);
    expect(isCurrentPath('/case-queues/cqueue_1', '/cases')).toBe(false);
    expect(isCurrentPath('/case-settings', '/cases')).toBe(false);
    expect(isCurrentPath('/cases/case_1', '/cases')).toBe(true);
  });

  it('keeps the inquiries page first, so the console still opens there', () => {
    expect(homePath(new Set(PERMISSIONS))).toBe('/inquiries');
    expect(homePath(new Set<Permission>(['cases:read', 'workflows:read']))).toBe('/cases');
  });
});

describe('the reports pages (C86)', () => {
  const labels = (permissions: Permission[]) =>
    visibleNavGroups(new Set(permissions)).flatMap((group) =>
      group.items.map((item) => item.label),
    );

  it('are a group of their own, each item read with the scope its API route requires', () => {
    // GET /dashboard/reports (reports:read), GET /report-templates (report-templates:read),
    // GET /dashboard/watchlist-sources (watchlists:read): C72.2, C72.3.
    expect(NAV_GROUPS.find((group) => group.label === 'Reports')?.items).toEqual([
      { href: '/reports', label: 'Reports', permission: 'reports:read' },
      { href: '/report-templates', label: 'Report templates', permission: 'report-templates:read' },
      { href: '/watchlist-sources', label: 'Watchlist sources', permission: 'watchlists:read' },
      // C166.5 (Workflow 9C): `POST /reports/bulk` needs reports:write.
      { href: '/exports/bulk-reports', label: 'Bulk reports', permission: 'reports:write' },
    ]);
  });

  it.each([
    ['reports:read', 'Reports'],
    ['report-templates:read', 'Report templates'],
    ['watchlists:read', 'Watchlist sources'],
  ] as const)(
    'shows an item to a principal holding %s only, and hides it otherwise',
    (scope, label) => {
      expect(labels([scope])).toEqual([label]);
      expect(labels(['inquiries:read', 'settings:read'])).not.toContain(label);
    },
  );

  it('never marks Templates for a report template page, or Reports for one', () => {
    expect(isCurrentPath('/report-templates/rptp_1', '/templates')).toBe(false);
    expect(isCurrentPath('/report-templates/rptp_1', '/reports')).toBe(false);
    expect(isCurrentPath('/reports/rep_1', '/reports')).toBe(true);
  });
});

describe('the chip trust store (C62.10, C66)', () => {
  it('is linked under Organization after Settings, read with settings:read as its API route is', () => {
    const organization = NAV_GROUPS.find((group) => group.label === 'Organization');

    expect(organization?.items.at(-2)).toEqual({
      href: '/trust-anchors',
      label: 'Chip trust store',
      permission: 'settings:read',
    });
  });

  it('is a section of its own, never marked as Settings', () => {
    expect(isCurrentPath('/trust-anchors', '/settings')).toBe(false);
    expect(isCurrentPath('/settings', '/trust-anchors')).toBe(false);
  });

  it('is shown to a role that reads settings, and hidden from one that does not', () => {
    const labels = (permissions: Permission[]) =>
      visibleNavGroups(new Set(permissions)).flatMap((group) =>
        group.items.map((item) => item.label),
      );

    expect(labels(['settings:read'])).toEqual(['Settings', 'Chip trust store', 'Network sources']);
    expect(labels(['inquiries:read'])).not.toContain('Chip trust store');
  });
});

describe('the Phase 7 pages (C108)', () => {
  const labels = (permissions: Permission[]) =>
    visibleNavGroups(new Set(permissions)).flatMap((group) =>
      group.items.map((item) => item.label),
    );

  it('are a group of their own, each item read with the scope its API route requires', () => {
    // GET /lists (lists:read), GET /graph-queries and GET /graph-query-templates (graph:read),
    // GET /transactions (transactions:read), GET /transaction-types (transactions:read; editing
    // needs transaction-types:write).
    expect(NAV_GROUPS.find((group) => group.label === 'Risk')?.items).toEqual([
      { href: '/lists', label: 'Lists', permission: 'lists:read' },
      { href: '/graph', label: 'Graph', permission: 'graph:read' },
      { href: '/transactions', label: 'Transactions', permission: 'transactions:read' },
      { href: '/transaction-types', label: 'Transaction types', permission: 'transactions:read' },
    ]);
  });

  it('link the network sources page under Organization, read with settings:read as GET /dashboard/network-sources is', () => {
    expect(NAV_GROUPS.find((group) => group.label === 'Organization')?.items.at(-1)).toEqual({
      href: '/network-sources',
      label: 'Network sources',
      permission: 'settings:read',
    });
  });

  it.each([
    ['lists:read', ['Lists']],
    ['graph:read', ['Graph']],
    ['transactions:read', ['Transactions', 'Transaction types']],
  ] as const)('shows %s its own items only', (scope, expected) => {
    expect(labels([scope])).toEqual(expected);
  });

  it('never shows the graph to a viewer, who holds the three reads but never graph:read', () => {
    expect(labels(['lists:read', 'transactions:read', 'inquiries:read'])).not.toContain('Graph');
  });

  it('never marks Transactions for a transaction type page, or Lists for another page', () => {
    expect(isCurrentPath('/transaction-types/txntp_1', '/transactions')).toBe(false);
    expect(isCurrentPath('/transactions/txn_1', '/transactions')).toBe(true);
    expect(isCurrentPath('/graph/grphq_1', '/graph')).toBe(true);
  });
});

describe('visibleNavGroups', () => {
  it('shows an admin everything', () => {
    expect(visibleNavGroups(new Set(PERMISSIONS)).flatMap((group) => group.items)).toHaveLength(31);
  });

  it('hides items without the permission, and groups left empty', () => {
    const reviewer = new Set<Permission>(['inquiries:read', 'accounts:read', 'events:read']);

    const groups = visibleNavGroups(reviewer);

    expect(groups.map((group) => [group.label, group.items.map((item) => item.label)])).toEqual([
      ['Verifications', ['Inquiries', 'Accounts', 'Account types']],
      ['Integrations', ['Events']],
    ]);
  });
});

describe('homePath', () => {
  it('is the first page the operator may see', () => {
    expect(homePath(new Set(PERMISSIONS))).toBe('/inquiries');
    expect(homePath(new Set<Permission>(['users:read', 'roles:read']))).toBe('/users');
  });

  it('is the security page when no console page is allowed', () => {
    expect(homePath(new Set())).toBe('/account/security');
  });
});

describe('isCurrentPath', () => {
  it.each([
    ['/inquiries', '/inquiries', true],
    ['/inquiries/inq_1', '/inquiries', true],
    ['/accounts', '/account-types', false],
    ['/account-types', '/accounts', false],
    ['/webhooks/new', '/webhooks', true],
    ['/', '/inquiries', false],
  ])('%s is under %s: %s', (pathname, href, expected) => {
    expect(isCurrentPath(pathname, href)).toBe(expected);
  });
});

describe('the Phase 9 pages (Workflow 9C)', () => {
  const labels = (permissions: Permission[]) =>
    visibleNavGroups(new Set(permissions)).flatMap((group) =>
      group.items.map((item) => item.label),
    );

  it('link theme sets under Verifications, read with theme-sets:read as GET /theme-sets is', () => {
    expect(NAV_GROUPS.find((group) => group.label === 'Verifications')?.items.at(-1)).toEqual({
      href: '/theme-sets',
      label: 'Theme sets',
      permission: 'theme-sets:read',
    });
    expect(labels(['theme-sets:read'])).toEqual(['Theme sets']);
    expect(labels(['inquiry-templates:read'])).not.toContain('Theme sets');
  });

  it('group analytics and exports as Insights, analytics read with analytics:read', () => {
    expect(
      NAV_GROUPS.find((group) => group.label === 'Insights')?.items.map((item) => item.href),
    ).toEqual(['/analytics', '/exports']);
    expect(labels(['analytics:read'])).toEqual(['Analytics']);
  });

  it.each(Object.values(EXPORT_PERMISSIONS))(
    'show Exports to a principal holding %s alone: GET /exports lists the types it may still export',
    (scope) => {
      expect(labels([scope])).toEqual(['Exports']);
    },
  );

  it('hide Exports from a principal holding no :export permission, as every viewer and reviewer', () => {
    expect(labels(['inquiries:read', 'reports:read', 'analytics:read'])).not.toContain('Exports');
    expect(labels(['cases:export'])).not.toContain('Exports');
  });

  it('show bulk reports only with reports:write, the scope of POST /reports/bulk', () => {
    expect(labels(['reports:write'])).toEqual(['Bulk reports']);
    expect(labels(['reports:read'])).toEqual(['Reports']);
  });

  it('keep the inquiries page first, so the console still opens there', () => {
    expect(homePath(new Set(PERMISSIONS))).toBe('/inquiries');
    expect(homePath(new Set<Permission>(['analytics:read']))).toBe('/analytics');
  });

  it('put notification preferences at their own path, beside the security page', () => {
    expect(NOTIFICATION_PREFERENCES_PATH).toBe('/notifications');
  });
});

describe('currentNavHref', () => {
  const all = visibleNavGroups(new Set(PERMISSIONS));

  it.each([
    ['/exports/bulk-reports', '/exports/bulk-reports'],
    ['/exports/bulk-reports/rbulk_1', '/exports/bulk-reports'],
    ['/exports/exp_1', '/exports'],
    ['/templates/itmpl_1/theme', '/templates'],
    ['/theme-sets/theset_1', '/theme-sets'],
    ['/', null],
  ])('marks the most specific item for %s: %s', (pathname, expected) => {
    expect(currentNavHref(pathname, all)).toBe(expected);
  });
});
